use std::sync::{Arc, Mutex};
use std::thread;

use rdev::{listen, Event, EventType, Key};
use tauri::{AppHandle, Emitter, State};

use crate::commands::history::add_scan_internal;
use crate::commands::url::check_url;
use crate::models::config::{PrefixConfig, SuffixConfig};
use crate::models::scan::ScanObject;
use crate::state::AppState;

#[tauri::command]
pub fn process_scan(state: State<'_, AppState>, raw_input: String) -> Result<String, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?.clone();

    let after_prefix = strip_prefix(&raw_input, &config.prefix);
    let cleaned = strip_suffix(&after_prefix, &config.suffix);

    let hostname = check_url(
        cleaned.clone(),
        config.allowlist.clone(),
        config.blocklist.clone(),
    )?;

    let scan = ScanObject {
        id: uuid::Uuid::new_v4().to_string(),
        url: cleaned,
        timestamp: chrono::Local::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
    };
    add_scan_internal(&state.data_dir, config.max_history_items, &scan)?;

    Ok(hostname)
}

#[tauri::command]
pub fn start_global_listener(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let active = state.listener_active.clone();

    {
        let mut flag = active.lock().map_err(|e| e.to_string())?;
        if *flag {
            return Err("Listener already running".to_string());
        }
        *flag = true;
    }

    let active_clone = active.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
        let buffer: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let buffer_clone = buffer.clone();
        let active_inner = active_clone;
        let app_inner = app_clone.clone();

        let callback = move |event: Event| {
            let is_active = active_inner.lock().map(|f| *f).unwrap_or(false);
            if !is_active {
                return;
            }

            if let EventType::KeyPress(key) = event.event_type {
                match key {
                    Key::Return => {
                        let mut buf = buffer_clone.lock().unwrap();
                        if !buf.is_empty() {
                            let content = buf.clone();
                            buf.clear();
                            let _ = app_inner.emit("scan-input", content);
                        }
                    }
                    _ => {
                        // Use event.name for actual character (works on macOS/Windows)
                        // Fall back to key_to_char mapping for Linux or when name is unavailable
                        if let Some(ref name) = event.name {
                            if name.len() == 1 {
                                if let Some(ch) = name.chars().next() {
                                    let mut buf = buffer_clone.lock().unwrap();
                                    buf.push(ch);
                                    return;
                                }
                            }
                        }
                        if let Some(ch) = key_to_char(&key) {
                            let mut buf = buffer_clone.lock().unwrap();
                            buf.push(ch);
                        }
                    }
                }
            }
        };

        if let Err(error) = listen(callback) {
            let _ = app_clone.emit("scan-error", format!("Listener error: {:?}", error));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_global_listener(state: State<'_, AppState>) -> Result<(), String> {
    let mut flag = state.listener_active.lock().map_err(|e| e.to_string())?;
    *flag = false;
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

#[cfg(test)]
mod tests {
    use super::*;

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
            strip_prefix(
                "SCAN:https://example.com",
                &prefix("custom", Some("SCAN:"))
            ),
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

    #[test]
    fn key_to_char_letters() {
        assert_eq!(key_to_char(&Key::KeyA), Some('a'));
        assert_eq!(key_to_char(&Key::KeyZ), Some('z'));
    }

    #[test]
    fn key_to_char_numbers() {
        assert_eq!(key_to_char(&Key::Num0), Some('0'));
        assert_eq!(key_to_char(&Key::Num9), Some('9'));
    }

    #[test]
    fn key_to_char_symbols() {
        assert_eq!(key_to_char(&Key::Dot), Some('.'));
        assert_eq!(key_to_char(&Key::Slash), Some('/'));
        assert_eq!(key_to_char(&Key::Minus), Some('-'));
    }

    #[test]
    fn key_to_char_unknown() {
        assert_eq!(key_to_char(&Key::Return), None);
        assert_eq!(key_to_char(&Key::ShiftLeft), None);
    }
}
