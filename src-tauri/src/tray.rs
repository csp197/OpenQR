use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use tauri::image::Image;
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

/// RGBA color tuple
type Color = (u8, u8, u8, u8);

/// Generate a 22x22 RGBA image with a centered filled circle.
fn generate_circle_icon(r: u8, g: u8, b: u8, a: u8) -> Vec<u8> {
    const SIZE: usize = 22;
    const CENTER: f64 = 10.5; // center of 22x22 (0-indexed: 0..21, center at 10.5)
    const RADIUS: f64 = 8.0;

    let mut pixels = vec![0u8; SIZE * SIZE * 4];

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f64 - CENTER;
            let dy = y as f64 - CENTER;
            let dist = (dx * dx + dy * dy).sqrt();

            let offset = (y * SIZE + x) * 4;
            if dist <= RADIUS - 0.5 {
                // Fully inside circle
                pixels[offset] = r;
                pixels[offset + 1] = g;
                pixels[offset + 2] = b;
                pixels[offset + 3] = a;
            } else if dist <= RADIUS + 0.5 {
                // Anti-aliased edge
                let coverage = (RADIUS + 0.5 - dist).clamp(0.0, 1.0);
                pixels[offset] = r;
                pixels[offset + 1] = g;
                pixels[offset + 2] = b;
                pixels[offset + 3] = (a as f64 * coverage) as u8;
            }
            // else: transparent (already 0)
        }
    }

    pixels
}

/// Create a Tauri Image from RGBA color values.
fn icon_from_color(r: u8, g: u8, b: u8, a: u8) -> Image<'static> {
    let rgba = generate_circle_icon(r, g, b, a);
    Image::new_owned(rgba, 22, 22)
}

/// State colors
const COLOR_IDLE: Color = (161, 161, 170, 255); // zinc-400
const COLOR_LISTENING_BRIGHT: Color = (239, 68, 68, 255); // red-500
const COLOR_LISTENING_DIM: Color = (185, 28, 28, 160); // red-700, semi-transparent
const COLOR_GENERATING: Color = (59, 130, 246, 255); // blue-500

/// Build the system tray and return the tray icon handle.
pub fn build_tray(app: &tauri::App) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = icon_from_color(COLOR_IDLE.0, COLOR_IDLE.1, COLOR_IDLE.2, COLOR_IDLE.3);

    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("OpenQR")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(tray)
}

/// Set the tray icon state. Valid states: "idle", "listening", "generating".
#[tauri::command]
pub fn set_tray_state(app: AppHandle, state: State<'_, AppState>, tray_state: String) {
    // Stop any existing pulse animation
    state.tray_pulse_active.store(false, Ordering::SeqCst);

    let tray = match app.tray_by_id("main") {
        Some(t) => t,
        None => {
            // Try the default tray (first one)
            if let Some(t) = get_first_tray(&app) {
                t
            } else {
                return;
            }
        }
    };

    match tray_state.as_str() {
        "listening" => {
            // Start pulse animation
            let pulse_active = state.tray_pulse_active.clone();
            pulse_active.store(true, Ordering::SeqCst);

            let app_clone = app.clone();
            thread::spawn(move || {
                let mut bright = true;
                while pulse_active.load(Ordering::Relaxed) {
                    let (r, g, b, a) = if bright {
                        COLOR_LISTENING_BRIGHT
                    } else {
                        COLOR_LISTENING_DIM
                    };
                    let icon = icon_from_color(r, g, b, a);

                    if let Some(tray) = get_first_tray(&app_clone) {
                        let _ = tray.set_icon(Some(icon));
                    }

                    bright = !bright;
                    thread::sleep(Duration::from_millis(800));
                }
            });
        }
        "generating" => {
            let icon = icon_from_color(
                COLOR_GENERATING.0,
                COLOR_GENERATING.1,
                COLOR_GENERATING.2,
                COLOR_GENERATING.3,
            );
            let _ = tray.set_icon(Some(icon));
        }
        _ => {
            // idle
            let icon = icon_from_color(COLOR_IDLE.0, COLOR_IDLE.1, COLOR_IDLE.2, COLOR_IDLE.3);
            let _ = tray.set_icon(Some(icon));
        }
    }
}

/// Get the first tray icon from the app.
fn get_first_tray(app: &AppHandle) -> Option<TrayIcon> {
    app.tray_by_id("main")
        .or_else(|| {
            // Fallback: try to get any tray
            None
        })
}
