use rdev::{listen, EventType, Key};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter; // Note: Use tauri::Manager if on v1

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn to_qrcode(url: &str) -> String {
    format!("Converting {} to a QR Code!", url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let buffer = Arc::new(Mutex::new(String::new()));
            let last_key_time = Arc::new(Mutex::new(Instant::now()));

            // Spawn the global listener thread
            std::thread::spawn(move || {
                listen(move |event| {
                    if let EventType::KeyPress(key) = event.event_type {
                        let mut buf = buffer.lock().unwrap();
                        let mut last_time = last_key_time.lock().unwrap();
                        let now = Instant::now();

                        // QR scanners usually dump text with < 20ms between keys
                        if now.duration_since(*last_time) > Duration::from_millis(100) {
                            buf.clear(); // Reset if it's slow (likely a human)
                        }
                        *last_time = now;

                        match key {
                            Key::Return => {
                                if !buf.is_empty() {
                                    // Send the completed string to React
                                    app_handle.emit("qr-scanned", buf.clone()).unwrap();
                                    buf.clear();
                                }
                            }
                            // Convert key to character (simplified)
                            _ => {
                                if let Some(c) = key_to_char(key) {
                                    buf.push(c);
                                }
                            }
                        }
                    }
                })
                .expect("Could not listen to keyboard");
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
// Helper to turn rdev Keys into characters
fn key_to_char(key: Key) -> Option<char> {
    match key {
        Key::KeyA => Some('a'),
        Key::KeyB => Some('b'), // ... add mapping as needed
        Key::SemiColon => Some(':'),
        Key::Slash => Some('/'),
        Key::Dot => Some('.'),
        _ => None,
    }
}
