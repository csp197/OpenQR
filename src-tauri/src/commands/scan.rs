use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::thread;

use tauri::{AppHandle, Emitter, State};

use crate::commands::history::add_scan_internal;
use crate::commands::url::check_url;
use crate::models::config::{PrefixConfig, SuffixConfig};
use crate::models::scan::ScanObject;
use crate::state::AppState;

/// Messages sent from the keyboard callback to the processing thread.
#[derive(Debug, PartialEq)]
enum KeyMessage {
    Char(char),
    Enter,
    Tab,
}

/// Process buffered key messages: accumulate chars, emit on trigger key.
/// The `suffix_mode` controls which key triggers scan completion:
/// - "tab" → Tab triggers scan, Enter is ignored
/// - anything else → Enter triggers scan, Tab is ignored
fn process_key_buffer(
    rx: mpsc::Receiver<KeyMessage>,
    suffix_mode: &str,
    mut on_scan: impl FnMut(String),
) {
    let mut buffer = String::new();
    let use_tab_trigger = suffix_mode == "tab";

    while let Ok(msg) = rx.recv() {
        match msg {
            KeyMessage::Char(c) => {
                buffer.push(c);
            }
            KeyMessage::Enter => {
                if !use_tab_trigger && !buffer.is_empty() {
                    on_scan(buffer.clone());
                    buffer.clear();
                }
            }
            KeyMessage::Tab => {
                if use_tab_trigger && !buffer.is_empty() {
                    on_scan(buffer.clone());
                    buffer.clear();
                }
            }
        }
    }
}

/// Convert a keycode + unicode character into a KeyMessage.
/// Extracted for testability. Returns None for events that should be ignored
/// (modifier keys, unmapped keys, etc.)
fn keycode_to_message(keycode: i64, unicode_char: Option<char>) -> Option<KeyMessage> {
    // macOS virtual key codes
    const VK_RETURN: i64 = 0x24;
    const VK_KP_ENTER: i64 = 0x4C;
    const VK_TAB: i64 = 0x30;

    if keycode == VK_RETURN || keycode == VK_KP_ENTER {
        Some(KeyMessage::Enter)
    } else if keycode == VK_TAB {
        Some(KeyMessage::Tab)
    } else if let Some(c) = unicode_char {
        if !c.is_control() {
            Some(KeyMessage::Char(c))
        } else {
            None
        }
    } else {
        None
    }
}

// ─── macOS: Custom CGEventTap listener ───────────────────────────────────────
//
// We bypass rdev entirely on macOS because:
//   - Original rdev (Narsil) crashes on keypress: its raw_callback calls UCKeyTranslate
//     (a thread-unsafe TIS API) from a background thread → segfault.
//   - The fufesou/rdev fork fixes the crash by using CFRunLoopGetMain(), but this
//     puts the event source on the main thread while CFRunLoopRun() runs on the
//     background thread → listen() returns immediately → events never delivered.
//
// Our solution: use CGEventKeyboardGetUnicodeString instead of UCKeyTranslate.
// It reads the unicode directly from the CGEvent object (thread-safe), and we use
// CFRunLoopGetCurrent() so the source and run loop are on the same background thread.

#[cfg(target_os = "macos")]
mod macos_listener {
    use super::KeyMessage;
    use std::os::raw::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::Sender;
    use std::sync::Arc;
    use std::sync::Mutex;

    // ─── FFI type aliases ─────────────────────────────────────
    type CGEventTapProxy = *const c_void;
    type CGEventRef = *const c_void;
    type CFMachPortRef = *const c_void;
    type CFRunLoopSourceRef = *const c_void;
    type CFRunLoopRef = *const c_void;
    type CFRunLoopMode = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CFIndex = i64;
    type UniChar = u16;
    type UniCharCount = usize;

    const K_CG_HID_EVENT_TAP: u32 = 0;
    const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
    const K_CG_EVENT_TAP_OPTION_LISTEN_ONLY: u32 = 1;
    const K_CG_EVENT_KEY_DOWN: u64 = 10;
    const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const KEYBOARD_EVENT_MASK: u64 = (1 << 10) | (1 << 11) | (1 << 12);

    // ─── FFI declarations ─────────────────────────────────────
    #[link(name = "Cocoa", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: u64,
            callback: unsafe extern "C" fn(
                CGEventTapProxy,
                u64,
                CGEventRef,
                *mut c_void,
            ) -> CGEventRef,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CFMachPortCreateRunLoopSource(
            allocator: CFAllocatorRef,
            port: CFMachPortRef,
            order: CFIndex,
        ) -> CFRunLoopSourceRef;
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CFRunLoopRun();

        // NEW: Cleanup and stop declarations
        fn CFRunLoopStop(rl: CFRunLoopRef);
        fn CFMachPortInvalidate(port: CFMachPortRef);
        fn CFRelease(cf: *const c_void);

        fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
        fn CGEventKeyboardGetUnicodeString(
            event: CGEventRef,
            max_string_length: UniCharCount,
            actual_string_length: *mut UniCharCount,
            unicode_string: *mut UniChar,
        );

        static kCFRunLoopCommonModes: CFRunLoopMode;
    }

    struct ListenerContext {
        active: Arc<AtomicBool>,
        tx: Sender<KeyMessage>,
        run_loop: CFRunLoopRef, // NEW: Track the run loop so we can stop it
    }

    // NEW: We must implement Send/Sync because CFRunLoopRef is a raw pointer (*const c_void)
    unsafe impl Send for ListenerContext {}
    unsafe impl Sync for ListenerContext {}

    static LISTENER_CTX: Mutex<Option<Box<ListenerContext>>> = Mutex::new(None);

    unsafe extern "C" fn raw_callback(
        _proxy: CGEventTapProxy,
        event_type: u64,
        cg_event: CGEventRef,
        _user_info: *mut c_void,
    ) -> CGEventRef {
        if event_type != K_CG_EVENT_KEY_DOWN {
            return cg_event;
        }

        let guard = match LISTENER_CTX.lock() {
            Ok(g) => g,
            Err(_) => return cg_event,
        };
        let ctx = match guard.as_ref() {
            Some(ctx) => ctx,
            None => return cg_event,
        };

        if !ctx.active.load(Ordering::Relaxed) {
            return cg_event;
        }

        let keycode = CGEventGetIntegerValueField(cg_event, K_CG_KEYBOARD_EVENT_KEYCODE);

        let mut length: UniCharCount = 0;
        let mut buffer: [UniChar; 4] = [0; 4];
        CGEventKeyboardGetUnicodeString(cg_event, 4, &mut length, buffer.as_mut_ptr());

        let unicode_char = if length == 1 {
            char::from_u32(buffer[0] as u32)
        } else {
            None
        };

        if let Some(msg) = super::keycode_to_message(keycode, unicode_char) {
            let _ = ctx.tx.send(msg);
        }

        drop(guard);
        cg_event
    }

    pub fn listen_keyboard(active: Arc<AtomicBool>, tx: Sender<KeyMessage>) -> Result<(), String> {
        unsafe {
            // Grab the run loop for THIS thread immediately
            let current_loop = CFRunLoopGetCurrent();

            *LISTENER_CTX.lock().map_err(|e| e.to_string())? = Some(Box::new(ListenerContext {
                active,
                tx,
                run_loop: current_loop,
            }));

            let tap = CGEventTapCreate(
                K_CG_HID_EVENT_TAP,
                K_CG_HEAD_INSERT_EVENT_TAP,
                K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                KEYBOARD_EVENT_MASK,
                raw_callback,
                std::ptr::null_mut(),
            );

            if tap.is_null() {
                let _ = LISTENER_CTX.lock().map(|mut g| *g = None);
                return Err(
                    "Failed to create event tap. Grant Accessibility permission in \
                     System Settings → Privacy & Security → Accessibility."
                        .to_string(),
                );
            }

            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
            if source.is_null() {
                let _ = LISTENER_CTX.lock().map(|mut g| *g = None);
                CFRelease(tap);
                return Err("Failed to create run loop source.".to_string());
            }

            CFRunLoopAddSource(current_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);

            // This blocks until CFRunLoopStop is called
            CFRunLoopRun();

            // NEW: Run loop has been stopped. Invalidate the tap and free memory.
            CFMachPortInvalidate(tap);
            CFRelease(tap);
            CFRelease(source);
        }

        // Clean up context after run loop exits
        let _ = LISTENER_CTX.lock().map(|mut g| *g = None);
        Ok(())
    }

    // NEW: Stop the run loop safely from another thread
    pub fn stop_listener() {
        if let Ok(guard) = LISTENER_CTX.lock() {
            if let Some(ctx) = guard.as_ref() {
                unsafe {
                    CFRunLoopStop(ctx.run_loop);
                }
            }
        }
    }
}

// ─── Non-macOS: use rdev ─────────────────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
mod fallback_listener {
    use super::KeyMessage;
    use rdev::{listen, Event, EventType, Key};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::Sender;
    use std::sync::{Arc, Mutex};

    // ─── Global State for rdev ───────────────────────────────────────────────
    // rdev cannot be stopped once started. We track if the thread is spawned,
    // and store the current active channel sender in a Mutex so we can
    // redirect keystrokes to the latest Tauri command thread.
    static RDEV_SPAWNED: AtomicBool = AtomicBool::new(false);
    static LISTENER_TX: Mutex<Option<Sender<KeyMessage>>> = Mutex::new(None);
    static LISTENER_ACTIVE: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

    fn key_to_char(key: &Key) -> Option<char> {
        match key {
            Key::KeyA => Some('a'),
            Key::KeyB => Some('b'),
            Key::KeyC => Some('c'),
            Key::KeyD => Some('d'),
            Key::KeyE => Some('e'),
            Key::KeyF => Some('f'),
            Key::KeyG => Some('g'),
            Key::KeyH => Some('h'),
            Key::KeyI => Some('i'),
            Key::KeyJ => Some('j'),
            Key::KeyK => Some('k'),
            Key::KeyL => Some('l'),
            Key::KeyM => Some('m'),
            Key::KeyN => Some('n'),
            Key::KeyO => Some('o'),
            Key::KeyP => Some('p'),
            Key::KeyQ => Some('q'),
            Key::KeyR => Some('r'),
            Key::KeyS => Some('s'),
            Key::KeyT => Some('t'),
            Key::KeyU => Some('u'),
            Key::KeyV => Some('v'),
            Key::KeyW => Some('w'),
            Key::KeyX => Some('x'),
            Key::KeyY => Some('y'),
            Key::KeyZ => Some('z'),
            Key::Num0 => Some('0'),
            Key::Num1 => Some('1'),
            Key::Num2 => Some('2'),
            Key::Num3 => Some('3'),
            Key::Num4 => Some('4'),
            Key::Num5 => Some('5'),
            Key::Num6 => Some('6'),
            Key::Num7 => Some('7'),
            Key::Num8 => Some('8'),
            Key::Num9 => Some('9'),
            Key::Dot => Some('.'),
            Key::Slash => Some('/'),
            Key::BackSlash => Some('\\'),
            Key::Minus => Some('-'),
            Key::Equal => Some('='),
            Key::SemiColon => Some(';'),
            Key::Quote => Some('\''),
            Key::Comma => Some(','),
            Key::Space => Some(' '),
            Key::LeftBracket => Some('['),
            Key::RightBracket => Some(']'),
            Key::BackQuote => Some('`'),
            _ => None,
        }
    }

    fn char_from_event(event: &Event, key: &Key) -> Option<char> {
        event
            .unicode
            .as_ref()
            .and_then(|u| u.name.as_ref())
            .and_then(|n| {
                let mut chars = n.chars();
                let first = chars.next()?;
                if chars.next().is_none() {
                    Some(first)
                } else {
                    None
                }
            })
            .or_else(|| key_to_char(key))
    }

    pub fn listen_keyboard(active: Arc<AtomicBool>, tx: Sender<KeyMessage>) -> Result<(), String> {
        // 1. Update global pointers to the *new* channel and active state.
        // NOTE: Assigning a new `tx` here drops the old `tx`. This causes your
        // old processor thread's `rx.recv()` to fail, killing the old thread cleanly!
        if let Ok(mut global_tx) = LISTENER_TX.lock() {
            *global_tx = Some(tx);
        }
        if let Ok(mut global_active) = LISTENER_ACTIVE.lock() {
            *global_active = Some(active);
        }

        // 2. If rdev is already hooked into the OS, we are done.
        // Returning `Ok(())` kills the duplicate thread spawned by Tauri,
        // leaving the original rdev thread running with our newly updated Mutex state.
        if RDEV_SPAWNED.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        // 3. First time startup: Block this thread forever with rdev.
        let callback = move |event: Event| {
            // Check if we are currently active
            let is_active = if let Ok(guard) = LISTENER_ACTIVE.lock() {
                guard
                    .as_ref()
                    .map(|a| a.load(Ordering::Relaxed))
                    .unwrap_or(false)
            } else {
                false
            };

            if !is_active {
                return;
            }

            if let EventType::KeyPress(key) = event.event_type {
                let msg = match key {
                    Key::Return | Key::KpReturn => Some(KeyMessage::Enter),
                    Key::Tab => Some(KeyMessage::Tab),
                    _ => char_from_event(&event, &key).map(KeyMessage::Char),
                };

                if let Some(m) = msg {
                    // Send to whichever Tauri channel is currently active
                    if let Ok(guard) = LISTENER_TX.lock() {
                        if let Some(sender) = guard.as_ref() {
                            let _ = sender.send(m);
                        }
                    }
                }
            }
        };

        listen(callback).map_err(|e| {
            RDEV_SPAWNED.store(false, Ordering::SeqCst);
            format!("Listener error: {:?}", e)
        })
    }

    pub fn stop_listener() {
        // We drop the sender entirely. This guarantees the Tauri processor
        // thread gets disconnected and dies gracefully immediately on stop.
        if let Ok(mut global_tx) = LISTENER_TX.lock() {
            *global_tx = None;
        }
        if let Ok(mut global_active) = LISTENER_ACTIVE.lock() {
            *global_active = None;
        }
    }
}

#[tauri::command]
pub fn process_scan(
    _app: AppHandle,
    state: State<'_, AppState>,
    raw_input: String,
) -> Result<String, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?.clone();

    let after_prefix = strip_prefix(&raw_input, &config.prefix);
    let cleaned = strip_suffix(&after_prefix, &config.suffix)
        .trim()
        .to_string();

    // Debug: emit raw buffer so frontend can see what was actually captured
    // let _ = app.emit(
    //     "scan-debug",
    //     format!(
    //         "raw={:?} cleaned={:?} len={}",
    //         raw_input,
    //         cleaned,
    //         cleaned.len()
    //     ),
    // );

    let hostname = check_url(
        cleaned.clone(),
        config.allowlist.clone(),
        config.blocklist.clone(),
    )?;

    let scan = ScanObject {
        id: uuid::Uuid::new_v4().to_string(),
        url: cleaned,
        timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };
    add_scan_internal(
        &state.data_dir,
        config.max_history_items,
        &scan,
        &config.history_storage_method,
    )?;

    Ok(hostname)
}

#[tauri::command]
pub fn start_global_listener(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let active = state.listener_active.clone();

    if active.swap(true, Ordering::SeqCst) {
        return Err("Listener already running".to_string());
    }

    let active_for_listener = active.clone();
    let active_for_cleanup = active.clone();
    let app_clone = app.clone();

    // Read suffix mode from config for the processor thread
    let suffix_mode = state
        .config
        .lock()
        .map(|c| c.suffix.mode.clone())
        .unwrap_or_else(|_| "enter".to_string());

    let (tx, rx) = mpsc::channel::<KeyMessage>();

    // Listener thread — blocks until the event tap is stopped
    thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let result = macos_listener::listen_keyboard(active_for_listener, tx);

        #[cfg(not(target_os = "macos"))]
        let result = fallback_listener::listen_keyboard(active_for_listener, tx);

        if let Err(error) = result {
            let _ = app_clone.emit("scan-error", error);
        }

        active_for_cleanup.store(false, Ordering::SeqCst);
    });

    // Processor thread — reads key messages and emits scan events to Tauri
    let app_for_emit = app.clone();
    thread::spawn(move || {
        process_key_buffer(rx, &suffix_mode, |content| {
            let _ = app_for_emit.emit("scan-input", content);
        });
    });

    Ok(())
}

#[tauri::command]
pub fn stop_global_listener(state: State<'_, AppState>) -> Result<(), String> {
    state.listener_active.store(false, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    macos_listener::stop_listener();

    #[cfg(not(target_os = "macos"))]
    fallback_listener::stop_listener();

    Ok(())
}

pub fn strip_prefix(input: &str, prefix: &PrefixConfig) -> String {
    match prefix.mode.as_str() {
        "none" => input.to_string(),
        "default" => input.trim_start_matches("QR:").to_string(),
        "custom" => {
            if let Some(ref val) = prefix.value {
                input
                    .strip_prefix(val.as_str())
                    .unwrap_or(input)
                    .to_string()
            } else {
                input.to_string()
            }
        }
        _ => input.to_string(),
    }
}

pub fn strip_suffix(input: &str, suffix: &SuffixConfig) -> String {
    match suffix.mode.as_str() {
        "none" => input.to_string(),
        "newline" | "enter" => input
            .trim_end_matches('\n')
            .trim_end_matches('\r')
            .to_string(),
        "tab" => input.trim_end_matches('\t').to_string(),
        "custom" => {
            if let Some(ref val) = suffix.value {
                input
                    .strip_suffix(val.as_str())
                    .unwrap_or(input)
                    .to_string()
            } else {
                input.to_string()
            }
        }
        _ => input.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Helpers ──────────────────────────────────────────────

    fn prefix(mode: &str, value: Option<&str>) -> PrefixConfig {
        PrefixConfig {
            mode: mode.to_string(),
            value: value.map(|s| s.to_string()),
        }
    }

    fn suffix(mode: &str, value: Option<&str>) -> SuffixConfig {
        SuffixConfig {
            mode: mode.to_string(),
            value: value.map(|s| s.to_string()),
        }
    }

    // ─── strip_prefix tests ──────────────────────────────────

    #[test]
    fn strip_prefix_none() {
        assert_eq!(
            strip_prefix("https://example.com", &prefix("none", None)),
            "https://example.com"
        );
    }

    #[test]
    fn strip_prefix_default() {
        assert_eq!(
            strip_prefix("QR:https://example.com", &prefix("default", None)),
            "https://example.com"
        );
    }

    #[test]
    fn strip_prefix_default_not_present() {
        assert_eq!(
            strip_prefix("https://example.com", &prefix("default", None)),
            "https://example.com"
        );
    }

    #[test]
    fn strip_prefix_custom() {
        assert_eq!(
            strip_prefix("SCAN:https://example.com", &prefix("custom", Some("SCAN:"))),
            "https://example.com"
        );
    }

    #[test]
    fn strip_prefix_custom_not_present() {
        assert_eq!(
            strip_prefix("https://example.com", &prefix("custom", Some("SCAN:"))),
            "https://example.com"
        );
    }

    #[test]
    fn strip_prefix_custom_no_value() {
        assert_eq!(
            strip_prefix("https://example.com", &prefix("custom", None)),
            "https://example.com"
        );
    }

    // ─── strip_suffix tests ──────────────────────────────────

    #[test]
    fn strip_suffix_none() {
        assert_eq!(
            strip_suffix("https://example.com", &suffix("none", None)),
            "https://example.com"
        );
    }

    #[test]
    fn strip_suffix_enter() {
        assert_eq!(
            strip_suffix("https://example.com\r\n", &suffix("enter", None)),
            "https://example.com"
        );
    }

    #[test]
    fn strip_suffix_newline() {
        assert_eq!(
            strip_suffix("https://example.com\n", &suffix("newline", None)),
            "https://example.com"
        );
    }

    #[test]
    fn strip_suffix_tab() {
        assert_eq!(
            strip_suffix("https://example.com\t", &suffix("tab", None)),
            "https://example.com"
        );
    }

    #[test]
    fn strip_suffix_custom() {
        assert_eq!(
            strip_suffix("https://example.comEND", &suffix("custom", Some("END"))),
            "https://example.com"
        );
    }

    #[test]
    fn strip_suffix_custom_not_present() {
        assert_eq!(
            strip_suffix("https://example.com", &suffix("custom", Some("END"))),
            "https://example.com"
        );
    }

    // ─── keycode_to_message tests ────────────────────────────
    // These test the core logic shared by the macOS listener.
    // macOS virtual key codes: Return=0x24, KpEnter=0x4C

    #[test]
    fn keycode_return_sends_enter() {
        assert_eq!(keycode_to_message(0x24, None), Some(KeyMessage::Enter));
    }

    #[test]
    fn keycode_kp_enter_sends_enter() {
        assert_eq!(keycode_to_message(0x4C, None), Some(KeyMessage::Enter));
    }

    #[test]
    fn keycode_return_ignores_unicode() {
        // Return should produce Enter regardless of unicode char
        assert_eq!(
            keycode_to_message(0x24, Some('\n')),
            Some(KeyMessage::Enter)
        );
    }

    #[test]
    fn keycode_letter_with_unicode() {
        assert_eq!(
            keycode_to_message(0x00, Some('a')),
            Some(KeyMessage::Char('a'))
        );
    }

    #[test]
    fn keycode_letter_with_shifted_unicode() {
        // Shift+A produces 'A' via CGEventKeyboardGetUnicodeString
        assert_eq!(
            keycode_to_message(0x00, Some('A')),
            Some(KeyMessage::Char('A'))
        );
    }

    #[test]
    fn keycode_colon_via_shifted_semicolon() {
        // Shift+; produces ':' via CGEventKeyboardGetUnicodeString
        assert_eq!(
            keycode_to_message(0x29, Some(':')),
            Some(KeyMessage::Char(':'))
        );
    }

    #[test]
    fn keycode_no_unicode_no_message() {
        // Unknown key with no unicode → None
        assert_eq!(keycode_to_message(0xFF, None), None);
    }

    #[test]
    fn keycode_tab_sends_tab() {
        assert_eq!(keycode_to_message(0x30, Some('\t')), Some(KeyMessage::Tab));
    }

    #[test]
    fn keycode_control_char_ignored() {
        // Control characters (escape, etc.) should be ignored
        assert_eq!(keycode_to_message(0x35, Some('\u{1b}')), None); // Escape
    }

    #[test]
    fn keycode_number_keys() {
        // Number row: 1=0x12, 2=0x13, ..., 0=0x1D
        assert_eq!(
            keycode_to_message(0x12, Some('1')),
            Some(KeyMessage::Char('1'))
        );
        assert_eq!(
            keycode_to_message(0x1D, Some('0')),
            Some(KeyMessage::Char('0'))
        );
    }

    #[test]
    fn keycode_url_symbols() {
        // Common URL characters
        assert_eq!(
            keycode_to_message(0x2F, Some('.')),
            Some(KeyMessage::Char('.'))
        );
        assert_eq!(
            keycode_to_message(0x2C, Some('/')),
            Some(KeyMessage::Char('/'))
        );
        assert_eq!(
            keycode_to_message(0x1B, Some('-')),
            Some(KeyMessage::Char('-'))
        );
    }

    // ─── process_key_buffer tests ────────────────────────────

    #[test]
    fn process_buffer_simple_word_and_enter() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        tx.send(KeyMessage::Char('h')).unwrap();
        tx.send(KeyMessage::Char('i')).unwrap();
        tx.send(KeyMessage::Enter).unwrap();
        drop(tx);

        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["hi"]);
    }

    #[test]
    fn process_buffer_multiple_scans() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        for c in "https://a.com".chars() {
            tx.send(KeyMessage::Char(c)).unwrap();
        }
        tx.send(KeyMessage::Enter).unwrap();

        for c in "https://b.com".chars() {
            tx.send(KeyMessage::Char(c)).unwrap();
        }
        tx.send(KeyMessage::Enter).unwrap();

        drop(tx);
        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["https://a.com", "https://b.com"]);
    }

    #[test]
    fn process_buffer_ignores_enter_on_empty_buffer() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        tx.send(KeyMessage::Enter).unwrap();
        tx.send(KeyMessage::Enter).unwrap();
        tx.send(KeyMessage::Char('a')).unwrap();
        tx.send(KeyMessage::Enter).unwrap();
        drop(tx);

        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["a"]);
    }

    #[test]
    fn process_buffer_pending_chars_without_enter() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        tx.send(KeyMessage::Char('a')).unwrap();
        tx.send(KeyMessage::Char('b')).unwrap();
        drop(tx);

        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, Vec::<String>::new());
    }

    // ─── Tab trigger tests ──────────────────────────────────

    #[test]
    fn process_buffer_tab_trigger_fires_on_tab() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        tx.send(KeyMessage::Char('h')).unwrap();
        tx.send(KeyMessage::Char('i')).unwrap();
        tx.send(KeyMessage::Tab).unwrap();
        drop(tx);

        process_key_buffer(rx, "tab", |s| results.push(s));

        assert_eq!(results, vec!["hi"]);
    }

    #[test]
    fn process_buffer_tab_trigger_ignores_enter() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        tx.send(KeyMessage::Char('a')).unwrap();
        tx.send(KeyMessage::Enter).unwrap(); // should be ignored in tab mode
        tx.send(KeyMessage::Char('b')).unwrap();
        tx.send(KeyMessage::Tab).unwrap();
        drop(tx);

        process_key_buffer(rx, "tab", |s| results.push(s));

        // Enter doesn't trigger, so "a" + Enter ignored, buffer continues: "ab"
        // Wait — Enter doesn't flush, so buffer is "a" then Enter is ignored,
        // then 'b' added → buffer is "ab", then Tab flushes "ab"
        assert_eq!(results, vec!["ab"]);
    }

    #[test]
    fn process_buffer_enter_trigger_ignores_tab() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        tx.send(KeyMessage::Char('x')).unwrap();
        tx.send(KeyMessage::Tab).unwrap(); // should be ignored in enter mode
        tx.send(KeyMessage::Char('y')).unwrap();
        tx.send(KeyMessage::Enter).unwrap();
        drop(tx);

        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["xy"]);
    }

    #[test]
    fn process_buffer_tab_trigger_empty_buffer_ignored() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        tx.send(KeyMessage::Tab).unwrap();
        tx.send(KeyMessage::Tab).unwrap();
        tx.send(KeyMessage::Char('z')).unwrap();
        tx.send(KeyMessage::Tab).unwrap();
        drop(tx);

        process_key_buffer(rx, "tab", |s| results.push(s));

        assert_eq!(results, vec!["z"]);
    }

    // ─── Integration: keycode → channel → buffer ─────────────

    #[test]
    fn integration_full_url_scan() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        // Simulate CGEventTap callback processing for "https://example.com\n"
        // Each tuple: (macOS keycode, unicode char from CGEventKeyboardGetUnicodeString)
        let keystrokes: Vec<(i64, Option<char>)> = vec![
            (0x04, Some('h')),
            (0x11, Some('t')),
            (0x11, Some('t')),
            (0x23, Some('p')),
            (0x01, Some('s')),
            (0x29, Some(':')), // shift+; → ':'
            (0x2C, Some('/')),
            (0x2C, Some('/')),
            (0x0E, Some('e')),
            (0x07, Some('x')),
            (0x00, Some('a')),
            (0x2E, Some('m')),
            (0x23, Some('p')),
            (0x25, Some('l')),
            (0x0E, Some('e')),
            (0x2F, Some('.')),
            (0x08, Some('c')),
            (0x1F, Some('o')),
            (0x2E, Some('m')),
            (0x24, None), // Return
        ];

        for (keycode, unicode) in keystrokes {
            if let Some(msg) = keycode_to_message(keycode, unicode) {
                tx.send(msg).unwrap();
            }
        }

        drop(tx);
        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["https://example.com"]);
    }

    #[test]
    fn integration_rapid_sequential_scans() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        for url in &["abc", "def", "ghi"] {
            for c in url.chars() {
                if let Some(msg) = keycode_to_message(0x00, Some(c)) {
                    tx.send(msg).unwrap();
                }
            }
            tx.send(KeyMessage::Enter).unwrap();
        }

        drop(tx);
        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["abc", "def", "ghi"]);
    }

    #[test]
    fn integration_modifier_keys_ignored() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        // Shift down (no unicode), then 'A', then shift up (no unicode), then Enter
        keycode_to_message(0x38, None); // Shift — returns None, nothing sent
        tx.send(keycode_to_message(0x00, Some('A')).unwrap())
            .unwrap();
        keycode_to_message(0x38, None); // Shift up
        tx.send(KeyMessage::Enter).unwrap();
        drop(tx);

        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["A"]);
    }

    #[test]
    fn integration_tab_ignored_in_enter_mode() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        // Tab is now recognized as KeyMessage::Tab but ignored in enter mode
        if let Some(msg) = keycode_to_message(0x30, Some('\t')) {
            tx.send(msg).unwrap();
        }
        tx.send(keycode_to_message(0x00, Some('a')).unwrap())
            .unwrap();
        if let Some(msg) = keycode_to_message(0x35, Some('\u{1b}')) {
            tx.send(msg).unwrap();
        }
        tx.send(KeyMessage::Enter).unwrap();
        drop(tx);

        process_key_buffer(rx, "enter", |s| results.push(s));

        assert_eq!(results, vec!["a"]);
    }

    #[test]
    fn integration_tab_triggers_in_tab_mode() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();

        // Simulate a scanner that sends URL chars followed by Tab
        for c in "https://test.com".chars() {
            if let Some(msg) = keycode_to_message(0x00, Some(c)) {
                tx.send(msg).unwrap();
            }
        }
        // Tab key (0x30)
        if let Some(msg) = keycode_to_message(0x30, Some('\t')) {
            tx.send(msg).unwrap();
        }
        drop(tx);

        process_key_buffer(rx, "tab", |s| results.push(s));

        assert_eq!(results, vec!["https://test.com"]);
    }
}
