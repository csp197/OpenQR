use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use crate::commands::history::add_scan_internal;
use crate::commands::url::check_url;
use crate::models::config::{PrefixConfig, SuffixConfig};
use crate::models::scan::{
    ListenerError, ListenerErrorKind, ScanError, ScanErrorKind, ScanObject, ScanResult,
};
use crate::state::AppState;

/// Messages sent from the keyboard callback to the processing thread.
#[derive(Debug, PartialEq)]
enum KeyMessage {
    Char(char),
    Enter,
    Tab,
    /// Backspace/Delete. Only meaningful for correcting hand-typed input
    /// when `require_scanner_speed` is off (see `ScanSettings`); harmless
    /// to feed through in either mode since popping a char off the buffer
    /// never causes a false-positive scan.
    Backspace,
    /// Delete pressed with Option/Command/Control held - macOS deletes a
    /// whole word or line on screen for these, not one character, so the
    /// scan buffer must be wiped entirely rather than popping a single
    /// char (see `key_message_for`). Also harmless to feed through in
    /// either mode, same reasoning as `Backspace`.
    ClearBuffer,
}

/// A key message paired with the `Instant` it was captured at inside the OS
/// callback (not when it's dequeued — that's what lets `process_key_buffer`
/// tell a human typing from a scanner firing off a burst of keystrokes).
type TimedKeyMessage = (KeyMessage, Instant);

/// Keystrokes further apart than this are treated as unrelated to each
/// other: a human typing, not a barcode scanner's burst input. See bug #4.
/// Applies only between two *characters* — see `SCANNER_MAX_TERMINATOR_GAP`
/// for the gap allowed before the trigger key (Enter/Tab) itself.
const SCANNER_MAX_KEY_GAP: Duration = Duration::from_millis(80);

/// Gap allowed between the last buffered character and the trigger key
/// (Enter/Tab) that ends a scan. This is deliberately much larger than
/// `SCANNER_MAX_KEY_GAP`: many HID scanners insert an extra delay before
/// sending the configured suffix keystroke, on top of their normal
/// inter-character timing — some 100ms+. Reusing the tight inter-character
/// gap here meant the terminator itself could arrive "too late", get
/// dropped, clear the buffer, and leave the app stuck in "listening"
/// forever with nothing to show for it (confirmed regression: this used to
/// be a single shared `max_gap` before the terminator-arrives-late case was
/// considered).
const SCANNER_MAX_TERMINATOR_GAP: Duration = Duration::from_millis(500);

/// Minimum number of characters required before a trigger key can fire a
/// scan. Filters out stray Enter/Tab presses that aren't from a scanner.
const MIN_SCAN_LENGTH: usize = 6;

/// Upper bound on the scan buffer. A held key's auto-repeat arrives faster
/// than `SCANNER_MAX_KEY_GAP` apart, so it never trips the gap-based reset —
/// without this, holding a key down would grow the buffer unbounded. If
/// pushing a character would exceed it, the (garbage) buffer is dropped
/// first.
const MAX_SCAN_BUFFER: usize = 4096;

/// Live-reloadable settings `process_key_buffer` needs on every event.
/// Bundled into one struct (rather than two separate `impl Fn` params) so a
/// single config-lock acquisition per event can supply both — see
/// `start_global_listener`'s `settings` closure.
struct ScanSettings {
    /// "tab" → Tab triggers a scan, Enter is ignored; anything else →
    /// Enter triggers, Tab is ignored.
    trigger_mode: String,
    /// When `true` (the default, for non-technical users): current
    /// behaviour — inter-char/terminator gap enforcement and
    /// `MIN_SCAN_LENGTH`. When `false`: gaps are never enforced (so a
    /// human hand-typing, e.g. to test scanning without a physical
    /// scanner, doesn't get their buffer cleared or their terminator
    /// dropped) and the minimum length drops to 1 (non-empty).
    require_scanner_speed: bool,
}

/// Why a trigger key (Enter/Tab) did or didn't fire a scan — surfaced to
/// `on_debug` so a `show_debug_toasts` user can see exactly what happened
/// to their last scan instead of the app just silently doing nothing.
enum TriggerOutcome {
    Fired,
    GapExceeded,
    WrongTriggerKey,
    Empty,
    TooShort,
}

impl TriggerOutcome {
    fn reason(&self) -> &'static str {
        match self {
            TriggerOutcome::Fired => "fired",
            TriggerOutcome::GapExceeded => "gap_exceeded",
            TriggerOutcome::WrongTriggerKey => "wrong_trigger_key",
            TriggerOutcome::Empty => "empty",
            TriggerOutcome::TooShort => "too_short",
        }
    }
}

/// Process buffered key messages: accumulate chars, emit on trigger key.
///
/// `settings` is read fresh on every message (not captured once at listener
/// startup) so a suffix-mode or `require_scanner_speed` change in Settings
/// takes effect immediately without restarting the listener (bug #10):
/// - `trigger_mode` "tab" → Tab triggers scan, Enter is ignored
/// - anything else → Enter triggers scan, Tab is ignored
///
/// Timing (bug #4): when `require_scanner_speed` is `true`, if the gap
/// since the previous character exceeds `max_char_gap`, the buffer is
/// cleared before the new character is handled — this is what stops
/// "anything typed on the keyboard" from being treated as a scan. The
/// trigger key itself is allowed a separate, longer `max_terminator_gap`
/// (see its doc comment) before it's considered part of a different,
/// unrelated burst. A scan also needs at least `MIN_SCAN_LENGTH` buffered
/// characters to fire at all.
///
/// When `require_scanner_speed` is `false`, none of the above gap checks
/// apply — the buffer is never cleared for timing reasons and the
/// terminator fires regardless of how long ago the last character arrived
/// — and the minimum length drops to 1 (still requires a non-empty
/// buffer). This lets a human hand-type input (e.g. to exercise scanning
/// without a physical scanner) while keeping the `MAX_SCAN_BUFFER` cap (a
/// held key's auto-repeat is still bounded) and while still honouring
/// `KeyMessage::Backspace` to correct mistakes either way.
///
/// `on_debug` is called with a human-readable line every time a trigger key
/// is seen (fired or not); callers gate whether that's actually shown to
/// the user (e.g. on `show_debug_toasts`), so it's safe — and expected — to
/// call unconditionally here.
fn process_key_buffer(
    rx: mpsc::Receiver<TimedKeyMessage>,
    settings: impl Fn() -> ScanSettings,
    max_char_gap: Duration,
    max_terminator_gap: Duration,
    mut on_scan: impl FnMut(String),
    mut on_debug: impl FnMut(String),
) {
    let mut buffer = String::new();
    let mut last_char_time: Option<Instant> = None;

    while let Ok((msg, time)) = rx.recv() {
        match msg {
            KeyMessage::Char(c) => {
                let require_scanner_speed = settings().require_scanner_speed;
                let gap_exceeded = require_scanner_speed
                    && last_char_time
                        .map(|t| time.saturating_duration_since(t) > max_char_gap)
                        .unwrap_or(false);

                if gap_exceeded || buffer.len() >= MAX_SCAN_BUFFER {
                    buffer.clear();
                }
                buffer.push(c);
                last_char_time = Some(time);
            }
            KeyMessage::Backspace => {
                // Harmless in either mode: popping never causes a
                // false-positive scan, and it's the only way to correct a
                // mistake while hand-typing with the gap checks off.
                // Deliberately does NOT touch `last_char_time` - see the
                // regression test `backspace_does_not_refresh_last_char_time_stale_prefix_is_cleared_before_fast_burst`.
                buffer.pop();
            }
            KeyMessage::ClearBuffer => {
                // Option/Command/Control+Delete erased a whole word or
                // line on screen; mirror that in the buffer instead of
                // popping one character. Same reasoning as `Backspace`
                // about not touching `last_char_time`.
                buffer.clear();
            }
            KeyMessage::Enter | KeyMessage::Tab => {
                let ScanSettings {
                    trigger_mode,
                    require_scanner_speed,
                } = settings();

                let gap_ms = last_char_time
                    .map(|t| time.saturating_duration_since(t).as_millis())
                    .unwrap_or(0);
                let gap_exceeded = require_scanner_speed
                    && last_char_time
                        .map(|t| time.saturating_duration_since(t) > max_terminator_gap)
                        .unwrap_or(false);
                let min_scan_length = if require_scanner_speed { MIN_SCAN_LENGTH } else { 1 };

                let use_tab_trigger = trigger_mode == "tab";
                let is_trigger_key = if use_tab_trigger {
                    matches!(msg, KeyMessage::Tab)
                } else {
                    matches!(msg, KeyMessage::Enter)
                };
                let buffer_len = buffer.len();

                let outcome = if gap_exceeded {
                    buffer.clear();
                    TriggerOutcome::GapExceeded
                } else if !is_trigger_key {
                    TriggerOutcome::WrongTriggerKey
                } else if buffer_len == 0 {
                    TriggerOutcome::Empty
                } else if buffer_len < min_scan_length {
                    TriggerOutcome::TooShort
                } else {
                    on_scan(buffer.clone());
                    buffer.clear();
                    TriggerOutcome::Fired
                };

                let terminator = if matches!(msg, KeyMessage::Tab) { "Tab" } else { "Enter" };
                on_debug(format!(
                    "terminator={terminator} gap_ms={gap_ms} buffer_len={buffer_len} trigger_mode={} scanner_speed={} -> {}: {}",
                    if use_tab_trigger { "tab" } else { "enter" },
                    if require_scanner_speed { "on" } else { "off" },
                    if matches!(outcome, TriggerOutcome::Fired) { "fired" } else { "ignored" },
                    outcome.reason(),
                ));
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
    const VK_DELETE: i64 = 0x33; // "Delete" (backspace) key

    if keycode == VK_RETURN || keycode == VK_KP_ENTER {
        Some(KeyMessage::Enter)
    } else if keycode == VK_TAB {
        Some(KeyMessage::Tab)
    } else if keycode == VK_DELETE {
        Some(KeyMessage::Backspace)
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

/// macOS `CGEventFlags` bits for the modifiers `key_message_for` cares
/// about. Defined here (rather than inside `macos_listener`) so the pure
/// keycode+unicode+flags mapping stays unit-testable without any CGEvent
/// FFI.
const CG_EVENT_FLAG_MASK_COMMAND: u64 = 0x100000;
const CG_EVENT_FLAG_MASK_CONTROL: u64 = 0x40000;
const CG_EVENT_FLAG_MASK_ALTERNATE: u64 = 0x80000;

/// The "Delete" (backspace) key's macOS virtual keycode - see
/// `keycode_to_message`'s `VK_DELETE`. Duplicated here (rather than shared)
/// because `keycode_to_message` keeps its constants private to its own body.
const VK_DELETE: i64 = 0x33;

/// `keycode_to_message` plus modifier awareness. The plain keycode+unicode
/// mapping has no way to know Option/Command/Control was held, so this
/// layers that on top - extracted so both behaviours are unit-testable
/// without any CGEvent FFI (see the `key_message_for_*` tests).
///
/// - Delete (0x33) pressed with Option, Command, or Control held is macOS's
///   "delete previous word" / "delete to start of line" - it erases more
///   than one character on screen, so popping a single char off the scan
///   buffer (the plain-Backspace behaviour) would leave the buffer out of
///   sync with what's actually left in the field being typed into.
///   Promoted to `KeyMessage::ClearBuffer`, which drops the whole buffer
///   instead.
/// - A *character* pressed with Command or Control held (Cmd+Tab, Cmd+V
///   into some other app, ...) is suppressed entirely - it isn't part of
///   anything a scanner would send. Enter/Tab are deliberately exempted:
///   some scanners' emulated terminator keystroke reports spurious
///   modifier flag bits, and suppressing it entirely would drop the
///   terminator and leave the buffer to fill up with no scan ever firing.
fn key_message_for(keycode: i64, unicode_char: Option<char>, flags: u64) -> Option<KeyMessage> {
    let msg = keycode_to_message(keycode, unicode_char)?;

    let modifier_held = flags
        & (CG_EVENT_FLAG_MASK_COMMAND | CG_EVENT_FLAG_MASK_CONTROL | CG_EVENT_FLAG_MASK_ALTERNATE)
        != 0;
    if keycode == VK_DELETE && matches!(msg, KeyMessage::Backspace) && modifier_held {
        return Some(KeyMessage::ClearBuffer);
    }

    let is_modified_char = matches!(msg, KeyMessage::Char(_))
        && flags & (CG_EVENT_FLAG_MASK_COMMAND | CG_EVENT_FLAG_MASK_CONTROL) != 0;
    if is_modified_char {
        return None;
    }

    Some(msg)
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
    use super::TimedKeyMessage;
    use std::os::raw::c_void;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::mpsc::Sender;
    use std::sync::Arc;
    use std::sync::Mutex;
    use std::time::Instant;

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
    // `CGEventType` is `uint32_t` in CGEventTypes.h - NOT `uint64_t`. Only
    // `CGEventMask` (the bitmask of event types to *listen for*, passed to
    // `CGEventTapCreate`) is 64-bit; the type tag actually delivered to the
    // callback is 32-bit. Declaring/comparing it as u64 (as this constant
    // and `raw_callback`'s `event_type` parameter previously did) reads 4
    // extra bytes that the calling convention does not guarantee are zero,
    // so the `==`/`!=` comparisons below could spuriously fail on arm64 and
    // drop every key-down event - see `K_CG_EVENT_TAP_DISABLED_BY_*` too.
    const K_CG_EVENT_KEY_DOWN: u32 = 10;
    const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const KEYBOARD_EVENT_MASK: u64 = (1 << 10) | (1 << 11) | (1 << 12);

    /// Error returned (and matched on by name in `super::start_global_listener`)
    /// when OpenQR doesn't have Input Monitoring permission yet.
    pub const PERMISSION_ERR: &str =
        "OpenQR needs permission to read keyboard input. Grant it in \
         System Settings → Privacy & Security → Input Monitoring.";

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
                u32,
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

        // Input Monitoring permission (bug #9) and modifier-key flags.
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
        fn CGEventGetFlags(event: CGEventRef) -> u64;

        // Accessibility trust check (ApplicationServices/HIServices,
        // transitively available through the Cocoa umbrella framework we
        // already link against). `CGPreflightListenEventAccess` alone can
        // report `false` even when the process is actually authorized to
        // create a listen-only event tap - e.g. right after the user grants
        // Input Monitoring but before the TCC cache refreshes, or under
        // `tauri dev` where the responsible process differs from the
        // binary actually calling this. Checking `AXIsProcessTrusted` too
        // avoids showing a false "no permission" banner in that case.
        fn AXIsProcessTrusted() -> bool;

        // Polling variant of CFRunLoopRun(): returns after `seconds` (or
        // sooner if a source fires), so the run loop can check a per-
        // generation stop flag instead of blocking on CFRunLoopRun()
        // forever - a CFRunLoopStop() issued before the loop starts
        // running is otherwise lost. `return_after_source_handled` is a
        // Boolean (0/1).
        fn CFRunLoopRunInMode(
            mode: CFRunLoopMode,
            seconds: f64,
            return_after_source_handled: u8,
        ) -> i32;

        static kCFRunLoopCommonModes: CFRunLoopMode;
        static kCFRunLoopDefaultMode: CFRunLoopMode;
    }

    /// Event types delivered to the tap callback instead of a real keyboard
    /// event when macOS disables the tap (e.g. it was deemed too slow, or
    /// the user toggled Input Monitoring). Left unhandled, the tap stays
    /// disabled and scanning silently stops.
    const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

    /// Whether the OS currently grants OpenQR permission to read global
    /// keyboard input. Backs the `check_input_permission` command.
    ///
    /// OR'd with `AXIsProcessTrusted()` rather than relying on
    /// `CGPreflightListenEventAccess()` alone: the latter is known to
    /// under-report (returning `false` even though a tap would succeed),
    /// which would otherwise show the user a permission banner even though
    /// scanning actually works fine. See `listen_keyboard` for why the
    /// authoritative check is "does creating the tap actually succeed".
    pub fn has_permission() -> bool {
        unsafe { CGPreflightListenEventAccess() || AXIsProcessTrusted() }
    }

    struct ListenerContext {
        active: Arc<AtomicBool>,
        tx: Sender<TimedKeyMessage>,
        run_loop: CFRunLoopRef, // NEW: Track the run loop so we can stop it
        generation: u64,
        // Per-generation stop flag: `stop_listener` sets this AND calls
        // CFRunLoopStop, so a stop issued before the run loop has actually
        // started (CFRunLoopStop is a no-op then) is still picked up the
        // next time the polling loop below wakes up.
        stop_flag: Arc<AtomicBool>,
        // The tap itself, so a disabled-tap callback (bug: macOS silently
        // disables taps it thinks are too slow, or on user toggle) can
        // re-enable it.
        tap: CFMachPortRef,
    }

    // NEW: We must implement Send/Sync because CFRunLoopRef is a raw pointer (*const c_void)
    unsafe impl Send for ListenerContext {}
    unsafe impl Sync for ListenerContext {}

    static LISTENER_CTX: Mutex<Option<Box<ListenerContext>>> = Mutex::new(None);

    // Bug #9: stop/restart race. Each call to `listen_keyboard` gets a new
    // generation number; cleanup only clears LISTENER_CTX if it still holds
    // the context for the generation that's cleaning up, so a fast
    // Stop-then-Start can't have the old listener's shutdown wipe out the
    // new listener's context.
    static NEXT_GEN: AtomicU64 = AtomicU64::new(0);

    fn clear_ctx_if_current(generation: u64) {
        if let Ok(mut guard) = LISTENER_CTX.lock() {
            if guard.as_ref().map(|ctx| ctx.generation) == Some(generation) {
                *guard = None;
            }
        }
    }

    /// Smuggle a generation counter through `CGEventTapCreate`'s `user_info`
    /// `*mut c_void` parameter. Extracted (from what was previously an
    /// inline cast at each call site) so the round trip through the raw
    /// pointer representation can be unit tested directly - see
    /// `generation_user_info_round_trip` below.
    fn generation_to_user_info(generation: u64) -> *mut c_void {
        generation as usize as *mut c_void
    }

    /// The inverse of `generation_to_user_info`, used by `raw_callback` to
    /// recover the generation a tap was created for.
    fn user_info_to_generation(user_info: *mut c_void) -> u64 {
        user_info as usize as u64
    }

    unsafe extern "C" fn raw_callback(
        _proxy: CGEventTapProxy,
        event_type: u32,
        cg_event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef {
        // The generation this tap was created for, stashed in `user_info` at
        // `CGEventTapCreate` time (see `listen_keyboard`).
        let call_generation = user_info_to_generation(user_info);

        if event_type == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT
            || event_type == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
        {
            // macOS disabled our tap - re-enable it (only if it's still the
            // current listener's tap) so scanning doesn't silently die.
            if let Ok(guard) = LISTENER_CTX.lock() {
                if let Some(ctx) = guard.as_ref() {
                    if ctx.generation == call_generation {
                        CGEventTapEnable(ctx.tap, true);
                    }
                }
            }
            return cg_event;
        }

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

        // Ignore callbacks from an orphaned tap whose generation no longer
        // matches the current listener - a stop/start race could otherwise
        // leave an old tap alive alongside a new one, double-delivering keys.
        if ctx.generation != call_generation {
            return cg_event;
        }

        if !ctx.active.load(Ordering::Relaxed) {
            return cg_event;
        }

        let keycode = CGEventGetIntegerValueField(cg_event, K_CG_KEYBOARD_EVENT_KEYCODE);
        let flags = CGEventGetFlags(cg_event);

        let mut length: UniCharCount = 0;
        let mut buffer: [UniChar; 4] = [0; 4];
        CGEventKeyboardGetUnicodeString(cg_event, 4, &mut length, buffer.as_mut_ptr());

        let unicode_char = if length == 1 {
            char::from_u32(buffer[0] as u32)
        } else {
            None
        };

        // `key_message_for` folds in modifier awareness: it suppresses a
        // *character* pressed with Command or Control held (e.g. Cmd+Tab
        // app-switching or Cmd+V pasting into some other app shouldn't feed
        // into the scan buffer - Enter/Tab are deliberately exempted, see
        // its doc comment) and promotes Option/Command/Control+Delete to
        // `ClearBuffer` instead of a single `Backspace`, since those delete
        // a whole word or line on screen, not one character.
        if let Some(msg) = super::key_message_for(keycode, unicode_char, flags) {
            let _ = ctx.tx.send((msg, Instant::now()));
        }

        drop(guard);
        cg_event
    }

    pub fn listen_keyboard(
        active: Arc<AtomicBool>,
        tx: Sender<TimedKeyMessage>,
        on_start: impl FnOnce(u64, bool),
    ) -> Result<(), String> {
        let generation = NEXT_GEN.fetch_add(1, Ordering::SeqCst) + 1;
        let stop_flag = Arc::new(AtomicBool::new(false));

        unsafe {
            // Grab the run loop for THIS thread immediately
            let current_loop = CFRunLoopGetCurrent();

            // Try creating the tap FIRST rather than gating on
            // `CGPreflightListenEventAccess()` up front. That preflight
            // check is known to report `false` even when a tap would
            // actually succeed - e.g. immediately after the user grants
            // Input Monitoring (before the TCC cache catches up), or when
            // running under `tauri dev` where the process macOS considers
            // "responsible" for the permission prompt is the terminal, not
            // this binary. Gating on it unconditionally (as a prior
            // revision did) meant OpenQR would refuse to even attempt the
            // tap on exactly the machines where it used to work, which is
            // the scanning regression this fixes. `CGEventTapCreate`
            // itself performs the real, authoritative authorization check.
            //
            // The tap is created before the context is published so the
            // context can carry its own `tap` field (needed to re-enable a
            // disabled tap) and so `raw_callback` never has to worry about
            // a not-yet-stored generation. The generation is smuggled to
            // the callback via `user_info` so an orphaned tap from a
            // previous generation can be told apart from the current one.
            let tap = CGEventTapCreate(
                K_CG_HID_EVENT_TAP,
                K_CG_HEAD_INSERT_EVENT_TAP,
                K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                KEYBOARD_EVENT_MASK,
                raw_callback,
                generation_to_user_info(generation),
            );

            if tap.is_null() {
                // Only now do we know the tap genuinely can't be created.
                // Prompt the OS to add OpenQR to the Input Monitoring list;
                // the user still has to flip it on and relaunch.
                CGRequestListenEventAccess();
                return Err(PERMISSION_ERR.to_string());
            }

            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
            if source.is_null() {
                CFRelease(tap);
                return Err("Failed to create run loop source.".to_string());
            }

            *LISTENER_CTX.lock().map_err(|e| e.to_string())? = Some(Box::new(ListenerContext {
                active,
                tx,
                run_loop: current_loop,
                generation,
                stop_flag: stop_flag.clone(),
                tap,
            }));

            CFRunLoopAddSource(current_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);

            // Diagnostic for `show_debug_toasts` users: the tap is up and
            // running at this point. `preflight` is reported for context
            // (it can legitimately be `false` here - see the long comment
            // above on why creation is attempted before checking it).
            on_start(generation, CGPreflightListenEventAccess());

            // Poll instead of blocking on CFRunLoopRun(): a CFRunLoopStop()
            // issued before we ever reach this point (bug #9's stop/start
            // race) would otherwise be lost, since CFRunLoopRunSpecific
            // resets the "stopped" flag on each call. Checking `stop_flag`
            // every 250ms picks that up instead of hanging forever.
            while !stop_flag.load(Ordering::SeqCst) {
                CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.25, 0);
            }

            // NEW: Run loop has been stopped. Invalidate the tap and free memory.
            CFMachPortInvalidate(tap);
            CFRelease(tap);
            CFRelease(source);
        }

        // Clean up context after run loop exits, but only if it's still ours.
        clear_ctx_if_current(generation);
        Ok(())
    }

    // NEW: Stop the run loop safely from another thread
    pub fn stop_listener() {
        if let Ok(guard) = LISTENER_CTX.lock() {
            if let Some(ctx) = guard.as_ref() {
                ctx.stop_flag.store(true, Ordering::SeqCst);
                unsafe {
                    CFRunLoopStop(ctx.run_loop);
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        // Rules out "generation mismatch" as a cause of dropped scan input:
        // the value stashed into `CGEventTapCreate`'s `user_info` pointer
        // and read back in `raw_callback` must survive the round trip
        // exactly, for any generation the atomic counter can produce.
        #[test]
        fn generation_user_info_round_trip() {
            for generation in [0u64, 1, 2, 42, u32::MAX as u64, u64::MAX] {
                let user_info = generation_to_user_info(generation);
                assert_eq!(user_info_to_generation(user_info), generation);
            }
        }

        #[test]
        fn generation_user_info_round_trip_sequence() {
            // Mirrors real usage: NEXT_GEN.fetch_add(1) + 1, called
            // repeatedly across stop/start cycles.
            let mut generation = 0u64;
            for _ in 0..10 {
                generation += 1;
                let user_info = generation_to_user_info(generation);
                assert_eq!(user_info_to_generation(user_info), generation);
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_listener {
    use super::{KeyMessage, TimedKeyMessage};
    use std::ptr;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::mpsc::Sender;
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    use winapi::shared::minwindef::{DWORD, LPARAM, LRESULT, UINT, WPARAM};
    use winapi::shared::windef::HWND;
    use winapi::um::libloaderapi::GetModuleHandleW;
    use winapi::um::winuser::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetRawInputData,
        PostThreadMessageW, RegisterClassW, RegisterRawInputDevices, TranslateMessage, CS_HREDRAW,
        CS_VREDRAW, CW_USEDEFAULT, MSG, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK,
        RID_INPUT, RIM_TYPEKEYBOARD, WM_INPUT, WM_QUIT, WNDCLASSW, WS_OVERLAPPEDWINDOW,
    };

    use winapi::um::winnt::LPCWSTR;

    static THREAD_ID: AtomicU32 = AtomicU32::new(0);
    static LISTENER_TX: Mutex<Option<Sender<TimedKeyMessage>>> = Mutex::new(None);
    static LISTENER_ACTIVE: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);
    static SHIFT_PRESSED: AtomicBool = AtomicBool::new(false);

    const VK_RETURN: u16 = 0x0D;
    const VK_TAB: u16 = 0x09;
    const VK_BACK: u16 = 0x08;
    const VK_SHIFT: u16 = 0x10;
    const VK_LSHIFT: u16 = 0xA0;
    const VK_RSHIFT: u16 = 0xA1;
    const RI_KEY_BREAK: u16 = 0x0001;

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: UINT,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_INPUT => {
                let mut size: UINT = 0;

                // Get required buffer size
                GetRawInputData(
                    l_param as _,
                    RID_INPUT,
                    ptr::null_mut(),
                    &mut size,
                    std::mem::size_of::<RAWINPUTHEADER>() as UINT,
                );

                if size > 0 {
                    let mut buffer = vec![0u8; size as usize];

                    if GetRawInputData(
                        l_param as _,
                        RID_INPUT,
                        buffer.as_mut_ptr() as _,
                        &mut size,
                        std::mem::size_of::<RAWINPUTHEADER>() as UINT,
                    ) == size
                    {
                        let raw = &*(buffer.as_ptr() as *const RAWINPUT);

                        if raw.header.dwType == RIM_TYPEKEYBOARD {
                            let keyboard = raw.data.keyboard();
                            let vk = keyboard.VKey as u16;

                            let is_keyup = (keyboard.Flags & RI_KEY_BREAK) != 0;
                            let is_keydown = !is_keyup;

                            if vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT {
                                SHIFT_PRESSED.store(is_keydown, Ordering::Relaxed);
                            } else if is_keydown {
                                let is_active = LISTENER_ACTIVE
                                    .lock()
                                    .ok()
                                    .and_then(|g| g.as_ref().map(|a| a.load(Ordering::Relaxed)))
                                    .unwrap_or(false);

                                if is_active {
                                    let msg = if vk == VK_RETURN {
                                        Some(KeyMessage::Enter)
                                    } else if vk == VK_TAB {
                                        Some(KeyMessage::Tab)
                                    } else if vk == VK_BACK {
                                        Some(KeyMessage::Backspace)
                                    } else if let Some(c) = vk_to_char(vk) {
                                        Some(KeyMessage::Char(c))
                                    } else {
                                        None
                                    };

                                    if let Some(m) = msg {
                                        if let Ok(guard) = LISTENER_TX.lock() {
                                            if let Some(sender) = guard.as_ref() {
                                                let _ = sender.send((m, Instant::now()));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                0
            }
            _ => DefWindowProcW(hwnd, msg, w_param, l_param),
        }
    }

    fn vk_to_char(vk: u16) -> Option<char> {
        let shift = SHIFT_PRESSED.load(Ordering::Relaxed);

        match vk {
            // Letters
            0x41..=0x5A => {
                let c = vk as u8 as char;
                Some(if shift { c } else { c.to_ascii_lowercase() })
            }

            // Numbers
            0x30..=0x39 => {
                if shift {
                    match vk {
                        0x31 => Some('!'),
                        0x32 => Some('@'),
                        0x33 => Some('#'),
                        0x34 => Some('$'),
                        0x35 => Some('%'),
                        0x36 => Some('^'),
                        0x37 => Some('&'),
                        0x38 => Some('*'),
                        0x39 => Some('('),
                        0x30 => Some(')'),
                        _ => None,
                    }
                } else {
                    Some(vk as u8 as char)
                }
            }

            // Space and punctuation
            0x20 => Some(' '),
            0xBA => Some(if shift { ':' } else { ';' }), // ; :
            0xBF => Some(if shift { '?' } else { '/' }), // / ?
            0xBE => Some(if shift { '>' } else { '.' }), // . >
            0xBC => Some(if shift { '<' } else { ',' }), // , <
            0xBD => Some(if shift { '_' } else { '-' }), // - _
            0xBB => Some(if shift { '+' } else { '=' }), // = +
            0xC0 => Some(if shift { '~' } else { '`' }), // ` ~
            0xDB => Some(if shift { '{' } else { '[' }), // [ {
            0xDD => Some(if shift { '}' } else { ']' }), // ] }
            0xDC => Some(if shift { '|' } else { '\\' }), // \ |
            0xDE => Some(if shift { '"' } else { '\'' }), // ' "

            // Numpad digits (Num Lock behavior is out of scope; scanners
            // configured for numpad output send plain digits)
            0x60..=0x69 => Some((b'0' + (vk - 0x60) as u8) as char),

            _ => None,
        }
    }

    pub fn listen_keyboard(
        active: Arc<AtomicBool>,
        tx: Sender<TimedKeyMessage>,
    ) -> Result<(), String> {
        if let Ok(mut global_tx) = LISTENER_TX.lock() {
            *global_tx = Some(tx);
        }

        if let Ok(mut global_active) = LISTENER_ACTIVE.lock() {
            *global_active = Some(active);
        }

        unsafe {
            THREAD_ID.store(
                winapi::um::processthreadsapi::GetCurrentThreadId(),
                Ordering::SeqCst,
            );

            let class_name: Vec<u16> = "RawInputWindow\0".encode_utf16().collect();

            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(wnd_proc),
                hInstance: GetModuleHandleW(ptr::null()),
                lpszClassName: class_name.as_ptr(),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hIcon: ptr::null_mut(),
                hCursor: ptr::null_mut(),
                hbrBackground: ptr::null_mut(),
                lpszMenuName: ptr::null(),
            };

            RegisterClassW(&wc);

            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                class_name.as_ptr(),
                WS_OVERLAPPEDWINDOW,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                ptr::null_mut(),
                ptr::null_mut(),
                GetModuleHandleW(ptr::null()),
                ptr::null_mut(),
            );

            let rid = RAWINPUTDEVICE {
                usUsagePage: 0x01, // Generic Desktop Controls
                usUsage: 0x06,     // Keyboard
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            };

            if RegisterRawInputDevices(&rid, 1, std::mem::size_of::<RAWINPUTDEVICE>() as UINT) == 0
            {
                return Err("Failed to register raw input device".to_string());
            }

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        Ok(())
    }

    pub fn stop_listener() {
        let thread_id = THREAD_ID.load(Ordering::SeqCst);
        if thread_id != 0 {
            unsafe {
                PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
            }
        }
    }
}

// ─── Linux: use rdev ─────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
mod fallback_listener {
    use super::{KeyMessage, TimedKeyMessage};
    use rdev::{listen, Event, EventType, Key};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::Sender;
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    // ─── Global State for rdev ───────────────────────────────────────────────
    // rdev cannot be stopped once started. We track if the thread is spawned,
    // and store the current active channel sender in a Mutex so we can
    // redirect keystrokes to the latest Tauri command thread.
    static RDEV_SPAWNED: AtomicBool = AtomicBool::new(false);
    static LISTENER_TX: Mutex<Option<Sender<TimedKeyMessage>>> = Mutex::new(None);
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

    pub fn listen_keyboard(
        active: Arc<AtomicBool>,
        tx: Sender<TimedKeyMessage>,
    ) -> Result<(), String> {
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
                    Key::Backspace => Some(KeyMessage::Backspace),
                    _ => char_from_event(&event, &key).map(KeyMessage::Char),
                };

                if let Some(m) = msg {
                    // Send to whichever Tauri channel is currently active
                    if let Ok(guard) = LISTENER_TX.lock() {
                        if let Some(sender) = guard.as_ref() {
                            let _ = sender.send((m, Instant::now()));
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

/// Whether the OS currently grants OpenQR permission to read global
/// keyboard input. Always `true` on platforms that don't require an
/// explicit grant. Backs the `check_input_permission` command.
pub fn has_input_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_listener::has_permission()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Build the `scan-debug` line for a scan. With `require_scanner_speed` on,
/// the scanned content only ever arrives at scanner speed - a human can't
/// hand-type it - so it's safe to echo back verbatim, same as before. With
/// it off, *anything* typed anywhere (a password into a login form, for
/// instance) followed by Enter reaches this point, so the content itself
/// must never be shown - only its length, which is enough to debug a
/// prefix/suffix-stripping problem without exposing what was typed.
fn debug_line_for_scan(raw_input: &str, cleaned: &str, require_scanner_speed: bool) -> String {
    if require_scanner_speed {
        format!(
            "raw={:?} cleaned={:?} len={}",
            raw_input,
            cleaned,
            cleaned.len()
        )
    } else {
        format!(
            "raw=<hidden: scanner-speed filter off> len={}",
            cleaned.len()
        )
    }
}

/// Strip the scanned text out of a `not_a_link` error's `raw` field when
/// `require_scanner_speed` is off (see `debug_line_for_scan`) - otherwise it
/// would reach the frontend's toast, complete with a "Copy" button, and
/// display whatever was typed right on screen. Other error kinds (blocked /
/// not_allowed) keep `raw`: by that point the input parsed as an actual URL
/// that was then checked against a real host, not just arbitrary typed
/// text a scanner-speed filter would otherwise have screened out.
fn scrub_not_a_link_raw(mut err: ScanError, require_scanner_speed: bool) -> ScanError {
    if !require_scanner_speed && err.kind == ScanErrorKind::NotALink {
        err.raw = String::new();
    }
    err
}

#[tauri::command]
pub fn process_scan(
    _app: AppHandle,
    state: State<'_, AppState>,
    raw_input: String,
) -> Result<ScanResult, ScanError> {
    let config = state
        .config
        .lock()
        .map_err(|e| ScanError::internal(e, raw_input.clone()))?
        .clone();

    let after_prefix = strip_prefix(&raw_input, &config.prefix);
    let cleaned = strip_suffix(&after_prefix, &config.suffix)
        .trim()
        .to_string();

    // Debug: emit raw buffer so frontend can see what was actually captured,
    // only when the user has opted into debug toasts (this still runs on
    // every scan otherwise, which is wasted work and traffic). See
    // `debug_line_for_scan` for why the content itself is redacted when
    // `require_scanner_speed` is off.
    if config.show_debug_toasts {
        let _ = _app.emit(
            "scan-debug",
            debug_line_for_scan(&raw_input, &cleaned, config.require_scanner_speed),
        );
    }

    let result = check_url(
        cleaned.clone(),
        config.allowlist.clone(),
        config.blocklist.clone(),
    )
    .map_err(|e| scrub_not_a_link_raw(e, config.require_scanner_speed))?;

    let scan = ScanObject {
        id: 0,
        url: result.url.clone(),
        timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };
    add_scan_internal(
        &state.data_dir,
        config.max_history_items,
        &scan,
        &config.history_storage_method,
    )
    .map_err(|e| ScanError::internal(e, cleaned.clone()))?;

    Ok(result)
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
    #[cfg(target_os = "macos")]
    let config_for_listener_debug = state.config.clone();
    #[cfg(target_os = "macos")]
    let app_for_listener_debug = app.clone();

    let (tx, rx) = mpsc::channel::<TimedKeyMessage>();

    // Listener thread — blocks until the event tap is stopped
    thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let result = macos_listener::listen_keyboard(
            active_for_listener,
            tx,
            move |generation, preflight| {
                let show = config_for_listener_debug
                    .lock()
                    .map(|c| c.show_debug_toasts)
                    .unwrap_or(false);
                if show {
                    let _ = app_for_listener_debug.emit(
                        "scan-debug",
                        format!("listener started (gen {generation}, preflight={preflight})"),
                    );
                }
            },
        );

        #[cfg(target_os = "windows")]
        let result = windows_listener::listen_keyboard(active_for_listener, tx);

        #[cfg(target_os = "linux")]
        let result = fallback_listener::listen_keyboard(active_for_listener, tx);

        // ONLY force the active state to false if the listener crashed.
        // If it returned Ok(()), it was either intentionally stopped via
        // stop_global_listener (which already sets it to false), or it
        // returned early on Windows to prevent thread stacking.
        if let Err(error) = result {
            #[cfg(target_os = "macos")]
            let is_permission = error == macos_listener::PERMISSION_ERR;
            #[cfg(not(target_os = "macos"))]
            let is_permission = false;

            let listener_error = ListenerError {
                kind: if is_permission {
                    ListenerErrorKind::Permission
                } else {
                    ListenerErrorKind::Other
                },
                message: error,
            };
            let _ = app_clone.emit("scan-error", listener_error);
            active_for_cleanup.store(false, Ordering::SeqCst);
        }
    });

    // Processor thread — reads key messages and emits scan events to Tauri.
    // The config is read fresh on every message (not captured once here)
    // so a suffix-mode or require_scanner_speed change in Settings applies
    // live (bug #10). The lock is taken and dropped within the closure
    // call itself (never held across `process_key_buffer`'s blocking
    // `rx.recv()`), so this can't deadlock with `process_scan`'s own
    // `state.config.lock()`; a poisoned mutex defaults to the safe,
    // protection-on settings rather than propagating the panic.
    let app_for_emit = app.clone();
    let app_for_debug = app.clone();
    let config_for_settings = state.config.clone();
    let config_for_debug = state.config.clone();
    thread::spawn(move || {
        let settings = move || match config_for_settings.lock() {
            Ok(c) => ScanSettings {
                trigger_mode: c.suffix.mode.clone(),
                require_scanner_speed: c.require_scanner_speed,
            },
            Err(_) => ScanSettings {
                trigger_mode: "enter".to_string(),
                require_scanner_speed: true,
            },
        };

        process_key_buffer(
            rx,
            settings,
            SCANNER_MAX_KEY_GAP,
            SCANNER_MAX_TERMINATOR_GAP,
            |content| {
                let _ = app_for_emit.emit("scan-input", content);
            },
            move |debug_line| {
                let show = config_for_debug
                    .lock()
                    .map(|c| c.show_debug_toasts)
                    .unwrap_or(false);
                if show {
                    let _ = app_for_debug.emit("scan-debug", debug_line);
                }
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn stop_global_listener(state: State<'_, AppState>) -> Result<(), String> {
    state.listener_active.store(false, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    macos_listener::stop_listener();

    #[cfg(target_os = "windows")]
    windows_listener::stop_listener();

    #[cfg(target_os = "linux")]
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

    /// require_scanner_speed = true (current/default behaviour).
    fn enter_mode() -> impl Fn() -> ScanSettings {
        || ScanSettings {
            trigger_mode: "enter".to_string(),
            require_scanner_speed: true,
        }
    }

    /// require_scanner_speed = true (current/default behaviour).
    fn tab_mode() -> impl Fn() -> ScanSettings {
        || ScanSettings {
            trigger_mode: "tab".to_string(),
            require_scanner_speed: true,
        }
    }

    /// require_scanner_speed = false: gap checks disabled, min length 1.
    fn enter_mode_no_speed_check() -> impl Fn() -> ScanSettings {
        || ScanSettings {
            trigger_mode: "enter".to_string(),
            require_scanner_speed: false,
        }
    }

    /// Send `msg` at `base + offset_ms` milliseconds.
    fn send_at(
        tx: &mpsc::Sender<TimedKeyMessage>,
        base: Instant,
        offset_ms: u64,
        msg: KeyMessage,
    ) {
        tx.send((msg, base + Duration::from_millis(offset_ms)))
            .unwrap();
    }

    /// Send each char of `s` back-to-back (well within the gap), starting
    /// at `base + start_ms`, 1ms apart. Returns the offset right after the
    /// last character, for chaining a trigger key or more input.
    fn send_word(
        tx: &mpsc::Sender<TimedKeyMessage>,
        base: Instant,
        start_ms: u64,
        s: &str,
    ) -> u64 {
        let mut offset = start_ms;
        for c in s.chars() {
            send_at(tx, base, offset, KeyMessage::Char(c));
            offset += 1;
        }
        offset
    }

    /// Run `process_key_buffer` with production gap constants and a no-op
    /// debug sink, collecting fired scans into `results`. Most tests only
    /// care about `on_scan` output, not the diagnostic line - tests that
    /// exercise `on_debug` directly call `process_key_buffer` themselves.
    fn run_buffer(
        rx: mpsc::Receiver<TimedKeyMessage>,
        settings: impl Fn() -> ScanSettings,
        results: &mut Vec<String>,
    ) {
        process_key_buffer(
            rx,
            settings,
            SCANNER_MAX_KEY_GAP,
            SCANNER_MAX_TERMINATOR_GAP,
            |s| results.push(s),
            |_| {},
        );
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
    fn keycode_delete_sends_backspace() {
        assert_eq!(keycode_to_message(0x33, None), Some(KeyMessage::Backspace));
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
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "testxy");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["testxy"]);
    }

    #[test]
    fn process_buffer_multiple_scans() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "https://a.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);

        let offset = send_word(&tx, t0, offset + 1, "https://b.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);

        drop(tx);
        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://a.com", "https://b.com"]);
    }

    #[test]
    fn process_buffer_ignores_enter_on_empty_buffer() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::Enter);
        send_at(&tx, t0, 1, KeyMessage::Enter);
        let offset = send_word(&tx, t0, 2, "abcdef");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["abcdef"]);
    }

    #[test]
    fn process_buffer_pending_chars_without_enter() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_word(&tx, t0, 0, "abcde");
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
    }

    #[test]
    fn process_buffer_under_min_length_does_not_fire() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "abc");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
    }

    #[test]
    fn process_buffer_slow_human_typing_then_enter_does_not_fire() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // Each character arrives well past the scanner gap, so the buffer
        // resets on every keystroke; by the time Enter arrives there's at
        // most one buffered character.
        let gap_ms = SCANNER_MAX_KEY_GAP.as_millis() as u64 * 3;
        let mut offset = 0;
        for c in "hello".chars() {
            send_at(&tx, t0, offset, KeyMessage::Char(c));
            offset += gap_ms;
        }
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
    }

    #[test]
    fn process_buffer_junk_then_pause_then_fast_scan_only_scan_fires() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // Junk typed slowly by a human (gaps exceed the scanner threshold).
        let gap_ms = SCANNER_MAX_KEY_GAP.as_millis() as u64 * 3;
        send_at(&tx, t0, 0, KeyMessage::Char('x'));
        send_at(&tx, t0, gap_ms, KeyMessage::Char('y'));

        // A long pause, then a fast scanner burst.
        let scan_start = gap_ms * 5;
        let offset = send_word(&tx, t0, scan_start, "https://ok.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
    }

    #[test]
    fn process_buffer_trigger_after_gap_does_not_fire() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // A buffer well over MIN_SCAN_LENGTH, so the only reason this can
        // fail to fire is the terminator gap - not buffer length.
        let offset = send_word(&tx, t0, 0, "testxy");
        let gap_ms = SCANNER_MAX_TERMINATOR_GAP.as_millis() as u64 * 3;
        send_at(&tx, t0, offset + gap_ms, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
    }

    #[test]
    fn process_buffer_terminator_within_relaxed_gap_still_fires() {
        // Confirmed regression: some HID scanners insert extra delay before
        // sending the configured suffix keystroke, well past the tight
        // inter-character gap but still well within a reasonable overall
        // scan window. The terminator must use its own, more generous
        // allowance (`SCANNER_MAX_TERMINATOR_GAP`) rather than the
        // inter-character one, or the terminator gets dropped and the scan
        // never fires - leaving the app stuck in "listening" forever.
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // Characters arrive at realistic scanner speed (10-30ms apart).
        let mut offset = 0u64;
        for (i, c) in "https://ok.com".chars().enumerate() {
            offset = (i as u64) * 20;
            send_at(&tx, t0, offset, KeyMessage::Char(c));
        }
        let last_char_offset = offset;

        // Enter arrives 400ms after the last character - past the 80ms
        // inter-character gap, but within the 500ms terminator allowance.
        send_at(&tx, t0, last_char_offset + 400, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
    }

    #[test]
    fn process_buffer_terminator_past_relaxed_gap_does_not_fire() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "https://ok.com");
        // 700ms - past even the relaxed 500ms terminator allowance.
        send_at(&tx, t0, offset + 700, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
    }

    #[test]
    fn process_buffer_slow_human_typing_plus_enter_does_not_fire() {
        // Human typing (~150ms between keys) resets the buffer on every
        // character via the tight inter-character gap, regardless of how
        // generous the terminator gap is.
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let mut offset = 0u64;
        for c in "https://ok.com".chars() {
            send_at(&tx, t0, offset, KeyMessage::Char(c));
            offset += 150;
        }
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
    }

    #[test]
    fn process_buffer_overflow_drops_garbage_and_keeps_scanning() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // A held key's auto-repeat (or any burst) longer than the buffer
        // cap, all well within the scanner gap, followed by a short
        // trailing scan and Enter.
        let filler = "x".repeat(MAX_SCAN_BUFFER);
        let offset = send_word(&tx, t0, 0, &filler);
        let offset = send_word(&tx, t0, offset, "abcdefghij");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        // The overflow clears the garbage buffer before continuing, so only
        // what was typed after the cap was hit survives.
        assert_eq!(results, vec!["abcdefghij"]);
    }

    // ─── on_debug diagnostics ────────────────────────────────

    /// Collect every `on_debug` line `process_key_buffer` emits, so tests
    /// can assert on the exact reason a scan did or didn't fire - this is
    /// what a `show_debug_toasts` user sees as a toast for each terminator
    /// key, and it's what makes "why didn't my scan fire" debuggable.
    fn run_buffer_with_debug(
        rx: mpsc::Receiver<TimedKeyMessage>,
        settings: impl Fn() -> ScanSettings,
        results: &mut Vec<String>,
    ) -> Vec<String> {
        let mut debug_lines = Vec::new();
        process_key_buffer(
            rx,
            settings,
            SCANNER_MAX_KEY_GAP,
            SCANNER_MAX_TERMINATOR_GAP,
            |s| results.push(s),
            |line| debug_lines.push(line),
        );
        debug_lines
    }

    #[test]
    fn on_debug_reports_fired() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "https://ok.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        let debug_lines = run_buffer_with_debug(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
        assert_eq!(debug_lines.len(), 1);
        assert!(debug_lines[0].contains("fired"), "{}", debug_lines[0]);
        assert!(debug_lines[0].contains("terminator=Enter"), "{}", debug_lines[0]);
    }

    #[test]
    fn on_debug_reports_gap_exceeded() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "https://ok.com");
        let gap_ms = SCANNER_MAX_TERMINATOR_GAP.as_millis() as u64 * 3;
        send_at(&tx, t0, offset + gap_ms, KeyMessage::Enter);
        drop(tx);

        let debug_lines = run_buffer_with_debug(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
        assert_eq!(debug_lines.len(), 1);
        assert!(debug_lines[0].contains("gap_exceeded"), "{}", debug_lines[0]);
    }

    #[test]
    fn on_debug_reports_too_short() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "abc");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        let debug_lines = run_buffer_with_debug(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
        assert_eq!(debug_lines.len(), 1);
        assert!(debug_lines[0].contains("too_short"), "{}", debug_lines[0]);
        assert!(debug_lines[0].contains("buffer_len=3"), "{}", debug_lines[0]);
    }

    #[test]
    fn on_debug_reports_wrong_trigger_key() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "abcdef");
        send_at(&tx, t0, offset, KeyMessage::Tab); // enter_mode ignores Tab
        drop(tx);

        let debug_lines = run_buffer_with_debug(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
        assert_eq!(debug_lines.len(), 1);
        assert!(debug_lines[0].contains("wrong_trigger_key"), "{}", debug_lines[0]);
    }

    #[test]
    fn on_debug_reports_empty() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::Enter);
        drop(tx);

        let debug_lines = run_buffer_with_debug(rx, enter_mode(), &mut results);

        assert_eq!(results, Vec::<String>::new());
        assert_eq!(debug_lines.len(), 1);
        assert!(debug_lines[0].contains("empty"), "{}", debug_lines[0]);
    }

    #[test]
    fn on_debug_includes_scanner_speed_on() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "https://ok.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        let debug_lines = run_buffer_with_debug(rx, enter_mode(), &mut results);

        assert_eq!(debug_lines.len(), 1);
        assert!(debug_lines[0].contains("scanner_speed=on"), "{}", debug_lines[0]);
    }

    #[test]
    fn on_debug_includes_scanner_speed_off() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::Char('x'));
        send_at(&tx, t0, 1, KeyMessage::Enter);
        drop(tx);

        let debug_lines = run_buffer_with_debug(rx, enter_mode_no_speed_check(), &mut results);

        assert_eq!(debug_lines.len(), 1);
        assert!(debug_lines[0].contains("scanner_speed=off"), "{}", debug_lines[0]);
    }

    // ─── require_scanner_speed = false ───────────────────────
    // Old/HEAD behaviour: an opt-out so a user without a physical scanner
    // can hand-type input. Gap checks are disabled entirely, minimum
    // length drops to 1, and Backspace is honoured to correct mistakes.

    #[test]
    fn no_speed_check_slow_typing_still_fires() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // ~300ms between keystrokes - far past SCANNER_MAX_KEY_GAP, but
        // with the flag off this must not clear the buffer.
        let mut offset = 0u64;
        for c in "https://ok.com".chars() {
            send_at(&tx, t0, offset, KeyMessage::Char(c));
            offset += 300;
        }
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode_no_speed_check(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
    }

    #[test]
    fn no_speed_check_terminator_arriving_late_still_fires() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "https://ok.com");
        // 2s after the last character - way past SCANNER_MAX_TERMINATOR_GAP.
        send_at(&tx, t0, offset + 2000, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode_no_speed_check(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
    }

    #[test]
    fn no_speed_check_single_char_buffer_fires() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::Char('x'));
        send_at(&tx, t0, 1, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode_no_speed_check(), &mut results);

        assert_eq!(results, vec!["x"]);
    }

    #[test]
    fn no_speed_check_empty_buffer_still_ignored() {
        // Minimum length drops to 1, but an empty buffer must still not
        // fire - "non-empty" is the floor, not "anything at all".
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode_no_speed_check(), &mut results);

        assert_eq!(results, Vec::<String>::new());
    }

    #[test]
    fn no_speed_check_backspace_corrects_buffer() {
        // Simulates "htx<backspace>tp://ok.com" - fat-fingering the third
        // character of "http" and correcting it before continuing.
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let mut offset = 0u64;
        for c in "htx".chars() {
            send_at(&tx, t0, offset, KeyMessage::Char(c));
            offset += 1;
        }
        send_at(&tx, t0, offset, KeyMessage::Backspace);
        offset += 1;
        for c in "tp://ok.com".chars() {
            send_at(&tx, t0, offset, KeyMessage::Char(c));
            offset += 1;
        }
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode_no_speed_check(), &mut results);

        assert_eq!(results, vec!["http://ok.com"]);
    }

    #[test]
    fn backspace_on_empty_buffer_is_a_no_op() {
        // Must not panic, and must not let a stray Backspace turn into a
        // scan by itself.
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::Backspace);
        let offset = send_word(&tx, t0, 1, "https://ok.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
    }

    #[test]
    fn require_scanner_speed_toggle_takes_effect_live() {
        // The processor thread reads `require_scanner_speed` fresh on every
        // message via `settings()`, same as `trigger_mode` (bug #10) - so
        // toggling the Settings checkbox mid-session must change behaviour
        // on the very next keystroke, without restarting the listener.
        // Modelled here with a shared `Arc<AtomicBool>` standing in for the
        // live config, matching how `start_global_listener`'s `settings`
        // closure reads `state.config` fresh each time.
        use std::sync::atomic::AtomicBool;
        use std::sync::{Arc, Mutex};

        let (tx, rx) = mpsc::channel::<TimedKeyMessage>();
        let (debug_tx, debug_rx) = mpsc::channel::<String>();
        let require_speed = Arc::new(AtomicBool::new(true));
        let require_speed_for_closure = require_speed.clone();
        let settings = move || ScanSettings {
            trigger_mode: "enter".to_string(),
            require_scanner_speed: require_speed_for_closure.load(Ordering::SeqCst),
        };

        let results: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let results_for_thread = results.clone();

        let handle = thread::spawn(move || {
            process_key_buffer(
                rx,
                settings,
                SCANNER_MAX_KEY_GAP,
                SCANNER_MAX_TERMINATOR_GAP,
                move |s| results_for_thread.lock().unwrap().push(s),
                move |line| {
                    let _ = debug_tx.send(line);
                },
            );
        });

        let t0 = Instant::now();
        let gap_ms = SCANNER_MAX_KEY_GAP.as_millis() as u64 * 3;

        // Flag ON: hand-typed speed (well past the scanner gap) resets the
        // buffer on every char, so this does not fire. The terminator also
        // arrives well past SCANNER_MAX_TERMINATOR_GAP, so the (single,
        // stray) leftover char is discarded too - otherwise it would leak
        // into the next assertion below.
        let mut offset = 0u64;
        let mut last_char_offset = 0u64;
        for c in "abcdef".chars() {
            send_at(&tx, t0, offset, KeyMessage::Char(c));
            last_char_offset = offset;
            offset += gap_ms;
        }
        offset = last_char_offset + SCANNER_MAX_TERMINATOR_GAP.as_millis() as u64 * 2;
        send_at(&tx, t0, offset, KeyMessage::Enter);
        let line = debug_rx.recv().expect("first terminator processed");
        assert!(line.contains("scanner_speed=on"), "{line}");
        assert!(line.contains("gap_exceeded"), "{line}");
        assert!(results.lock().unwrap().is_empty());

        // Toggle live, then repeat the exact same hand-typed pattern - it
        // must fire now, with no listener restart.
        require_speed.store(false, Ordering::SeqCst);
        offset += 1000;
        for c in "ghijkl".chars() {
            send_at(&tx, t0, offset, KeyMessage::Char(c));
            offset += gap_ms;
        }
        send_at(&tx, t0, offset, KeyMessage::Enter);
        let line = debug_rx.recv().expect("second terminator processed");
        assert!(line.contains("scanner_speed=off"), "{line}");

        drop(tx);
        handle.join().unwrap();

        assert_eq!(*results.lock().unwrap(), vec!["ghijkl"]);
    }

    // ─── Tab trigger tests ──────────────────────────────────

    #[test]
    fn process_buffer_tab_trigger_fires_on_tab() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "testxy");
        send_at(&tx, t0, offset, KeyMessage::Tab);
        drop(tx);

        run_buffer(rx, tab_mode(), &mut results);

        assert_eq!(results, vec!["testxy"]);
    }

    #[test]
    fn process_buffer_tab_trigger_ignores_enter() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "abcdef");
        send_at(&tx, t0, offset, KeyMessage::Enter); // ignored in tab mode
        let offset = send_word(&tx, t0, offset + 1, "gh");
        send_at(&tx, t0, offset, KeyMessage::Tab);
        drop(tx);

        run_buffer(rx, tab_mode(), &mut results);

        // Enter doesn't flush the buffer in tab mode, so "abcdef" + "gh" = "abcdefgh"
        assert_eq!(results, vec!["abcdefgh"]);
    }

    #[test]
    fn process_buffer_enter_trigger_ignores_tab() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "wxyzab");
        send_at(&tx, t0, offset, KeyMessage::Tab); // ignored in enter mode
        let offset = send_word(&tx, t0, offset + 1, "cd");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["wxyzabcd"]);
    }

    #[test]
    fn process_buffer_tab_trigger_empty_buffer_ignored() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::Tab);
        send_at(&tx, t0, 1, KeyMessage::Tab);
        let offset = send_word(&tx, t0, 2, "wxyzab");
        send_at(&tx, t0, offset, KeyMessage::Tab);
        drop(tx);

        run_buffer(rx, tab_mode(), &mut results);

        assert_eq!(results, vec!["wxyzab"]);
    }

    // ─── Integration: keycode → channel → buffer ─────────────

    #[test]
    fn integration_full_url_scan() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

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

        for (i, (keycode, unicode)) in keystrokes.into_iter().enumerate() {
            if let Some(msg) = keycode_to_message(keycode, unicode) {
                send_at(&tx, t0, i as u64, msg);
            }
        }

        drop(tx);
        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://example.com"]);
    }

    #[test]
    fn integration_rapid_sequential_scans() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();
        let mut offset = 0;

        for word in &["abcdef", "defghi", "hijklm"] {
            for c in word.chars() {
                if let Some(msg) = keycode_to_message(0x00, Some(c)) {
                    send_at(&tx, t0, offset, msg);
                    offset += 1;
                }
            }
            send_at(&tx, t0, offset, KeyMessage::Enter);
            offset += 1;
        }

        drop(tx);
        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["abcdef", "defghi", "hijklm"]);
    }

    #[test]
    fn integration_modifier_keys_ignored() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // Shift down/up produce no unicode and are already filtered out by
        // keycode_to_message, well before process_key_buffer ever sees them.
        assert_eq!(keycode_to_message(0x38, None), None); // Shift down
        let offset = send_word(&tx, t0, 0, "testxy");
        assert_eq!(keycode_to_message(0x38, None), None); // Shift up
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["testxy"]);
    }

    #[test]
    fn integration_tab_ignored_in_enter_mode() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // Tab is recognized as KeyMessage::Tab but ignored in enter mode
        if let Some(msg) = keycode_to_message(0x30, Some('\t')) {
            send_at(&tx, t0, 0, msg);
        }
        let offset = send_word(&tx, t0, 1, "abcdef");
        if let Some(msg) = keycode_to_message(0x35, Some('\u{1b}')) {
            send_at(&tx, t0, offset, msg);
        }
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["abcdef"]);
    }

    #[test]
    fn integration_tab_triggers_in_tab_mode() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // Simulate a scanner that sends URL chars followed by Tab
        let mut offset = 0;
        for c in "https://test.com".chars() {
            if let Some(msg) = keycode_to_message(0x00, Some(c)) {
                send_at(&tx, t0, offset, msg);
                offset += 1;
            }
        }
        // Tab key (0x30)
        if let Some(msg) = keycode_to_message(0x30, Some('\t')) {
            send_at(&tx, t0, offset, msg);
        }
        drop(tx);

        run_buffer(rx, tab_mode(), &mut results);

        assert_eq!(results, vec!["https://test.com"]);
    }

    // ─── key_message_for tests (bug #4: modified Backspace) ──

    #[test]
    fn key_message_for_plain_delete_is_backspace() {
        assert_eq!(
            key_message_for(0x33, None, 0),
            Some(KeyMessage::Backspace)
        );
    }

    #[test]
    fn key_message_for_option_delete_clears_buffer() {
        assert_eq!(
            key_message_for(0x33, None, CG_EVENT_FLAG_MASK_ALTERNATE),
            Some(KeyMessage::ClearBuffer)
        );
    }

    #[test]
    fn key_message_for_command_delete_clears_buffer() {
        assert_eq!(
            key_message_for(0x33, None, CG_EVENT_FLAG_MASK_COMMAND),
            Some(KeyMessage::ClearBuffer)
        );
    }

    #[test]
    fn key_message_for_control_delete_clears_buffer() {
        assert_eq!(
            key_message_for(0x33, None, CG_EVENT_FLAG_MASK_CONTROL),
            Some(KeyMessage::ClearBuffer)
        );
    }

    #[test]
    fn key_message_for_modifier_on_other_keys_does_not_clear_buffer() {
        // Only Delete (0x33) is promoted to ClearBuffer - a modifier held
        // on Enter/Tab must not turn those into a buffer wipe.
        assert_eq!(
            key_message_for(0x24, None, CG_EVENT_FLAG_MASK_COMMAND),
            Some(KeyMessage::Enter)
        );
    }

    #[test]
    fn key_message_for_command_char_is_suppressed() {
        assert_eq!(
            key_message_for(0x00, Some('a'), CG_EVENT_FLAG_MASK_COMMAND),
            None
        );
    }

    #[test]
    fn key_message_for_control_char_is_suppressed() {
        assert_eq!(
            key_message_for(0x00, Some('a'), CG_EVENT_FLAG_MASK_CONTROL),
            None
        );
    }

    #[test]
    fn key_message_for_plain_char_passes_through() {
        assert_eq!(key_message_for(0x00, Some('a'), 0), Some(KeyMessage::Char('a')));
    }

    #[test]
    fn key_message_for_command_enter_is_not_suppressed() {
        // Some scanners' emulated terminator keystroke reports a spurious
        // Command/Control-like flag bit - Enter/Tab must fire regardless.
        assert_eq!(
            key_message_for(0x24, None, CG_EVENT_FLAG_MASK_COMMAND),
            Some(KeyMessage::Enter)
        );
        assert_eq!(
            key_message_for(0x30, Some('\t'), CG_EVENT_FLAG_MASK_CONTROL),
            Some(KeyMessage::Tab)
        );
    }

    #[test]
    fn key_message_for_unmapped_key_is_none_regardless_of_flags() {
        assert_eq!(key_message_for(0xFF, None, CG_EVENT_FLAG_MASK_COMMAND), None);
    }

    // ─── ClearBuffer wipes the whole buffer ──────────────────

    #[test]
    fn clear_buffer_empties_the_buffer() {
        // Option/Command+Delete deletes a whole word/line on screen; the
        // scan buffer must match that instead of popping one character.
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        let offset = send_word(&tx, t0, 0, "htxxxx");
        send_at(&tx, t0, offset, KeyMessage::ClearBuffer);
        let offset = send_word(&tx, t0, offset + 1, "https://ok.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
    }

    #[test]
    fn clear_buffer_on_empty_buffer_is_a_no_op() {
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        send_at(&tx, t0, 0, KeyMessage::ClearBuffer);
        let offset = send_word(&tx, t0, 1, "https://ok.com");
        send_at(&tx, t0, offset, KeyMessage::Enter);
        drop(tx);

        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["https://ok.com"]);
    }

    // ─── Backspace must not refresh last_char_time (bug #5) ──

    #[test]
    fn backspace_does_not_refresh_last_char_time_stale_prefix_is_cleared_before_fast_burst() {
        // Regression: if Backspace refreshed `last_char_time` to "now", a
        // real scanner burst arriving shortly after a backspace that
        // corrected some stale leftover input would land inside the same
        // gap window as that backspace and get concatenated onto the
        // leftover text, instead of the stale prefix being wiped by the
        // ordinary timing-gap check.
        let (tx, rx) = mpsc::channel();
        let mut results: Vec<String> = Vec::new();
        let t0 = Instant::now();

        // Stale leftover input, typed well before anything else.
        send_word(&tx, t0, 0, "abc");
        // Correct one character - buffer is now "ab". Sent long after the
        // leftover chars and long before the burst below, so the fake
        // clock can't accidentally keep it inside either gap window.
        send_at(&tx, t0, 1000, KeyMessage::Backspace);

        // A real scanner burst arrives shortly after the backspace - well
        // within SCANNER_MAX_KEY_GAP of *the backspace itself*, but nowhere
        // near last_char_time from the stale "abc" (over 900ms ago). If
        // Backspace incorrectly refreshed last_char_time, this burst would
        // not see gap_exceeded and would be appended onto the stale "ab".
        let after_burst = send_word(&tx, t0, 1010, "XYZ1234567");
        send_at(&tx, t0, after_burst, KeyMessage::Enter);

        drop(tx);
        run_buffer(rx, enter_mode(), &mut results);

        assert_eq!(results, vec!["XYZ1234567".to_string()]);
    }

    // ─── process_scan debug/privacy helpers (bug #2) ─────────

    #[test]
    fn debug_line_for_scan_with_speed_check_shows_content() {
        let line = debug_line_for_scan("https://example.com\r\n", "https://example.com", true);
        assert!(line.contains("raw=\"https://example.com\\r\\n\""));
        assert!(line.contains("cleaned=\"https://example.com\""));
        assert!(line.contains("len=19"));
    }

    #[test]
    fn debug_line_for_scan_without_speed_check_hides_content() {
        let line = debug_line_for_scan("hunter2\n", "hunter2", false);
        assert!(!line.contains("hunter2"));
        assert!(line.contains("raw=<hidden: scanner-speed filter off>"));
        assert!(line.contains("len=7"));
    }

    #[test]
    fn scrub_not_a_link_raw_keeps_raw_when_speed_check_is_on() {
        let err = ScanError {
            kind: ScanErrorKind::NotALink,
            message: "This QR code isn't a web link".to_string(),
            raw: "hunter2".to_string(),
            host: None,
        };
        let scrubbed = scrub_not_a_link_raw(err, true);
        assert_eq!(scrubbed.raw, "hunter2");
    }

    #[test]
    fn scrub_not_a_link_raw_empties_raw_when_speed_check_is_off() {
        let err = ScanError {
            kind: ScanErrorKind::NotALink,
            message: "This QR code isn't a web link".to_string(),
            raw: "hunter2".to_string(),
            host: None,
        };
        let scrubbed = scrub_not_a_link_raw(err, false);
        assert_eq!(scrubbed.raw, "");
        assert_eq!(scrubbed.message, "This QR code isn't a web link");
    }

    #[test]
    fn scrub_not_a_link_raw_leaves_other_kinds_untouched_even_with_speed_check_off() {
        let err = ScanError {
            kind: ScanErrorKind::Blocked,
            message: "Blocked: example.com is on your blocklist".to_string(),
            raw: "https://example.com".to_string(),
            host: Some("example.com".to_string()),
        };
        let scrubbed = scrub_not_a_link_raw(err, false);
        assert_eq!(scrubbed.raw, "https://example.com");
    }
}
