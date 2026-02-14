use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

/// RGBA color tuple
type Color = (u8, u8, u8, u8);

/// State colors
const COLOR_IDLE: Color = (161, 161, 170, 255); // zinc-400
const COLOR_LISTENING_BRIGHT: Color = (239, 68, 68, 255); // red-500
const COLOR_LISTENING_DIM: Color = (185, 28, 28, 255); // red-700
const COLOR_GENERATING: Color = (59, 130, 246, 255); // blue-500

/// Dot overlay parameters
const DOT_RADIUS: f64 = 4.0;

/// Cached base icon (decoded RGBA from the embedded 32x32 PNG)
struct BaseIcon {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

static BASE_ICON: Mutex<Option<BaseIcon>> = Mutex::new(None);

/// Decode the embedded 32x32.png into RGBA and cache it.
fn init_base_icon() {
    let png_bytes = include_bytes!("../icons/32x32.png");
    if let Ok(icon) = Image::from_bytes(png_bytes) {
        let rgba = icon.rgba().to_vec();
        let width = icon.width();
        let height = icon.height();
        if let Ok(mut guard) = BASE_ICON.lock() {
            *guard = Some(BaseIcon { rgba, width, height });
        }
    }
}

/// Create a tray icon by compositing a colored dot onto the base app icon.
fn icon_with_dot(r: u8, g: u8, b: u8, a: u8) -> Image<'static> {
    let guard = BASE_ICON.lock().unwrap();
    let base = guard.as_ref().expect("base icon not initialized");

    let w = base.width as usize;
    let h = base.height as usize;
    let mut pixels = base.rgba.clone();

    // Dot center: bottom-right corner with small margin
    let cx = w as f64 - DOT_RADIUS - 1.0;
    let cy = h as f64 - DOT_RADIUS - 1.0;

    for y in 0..h {
        for x in 0..w {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist <= DOT_RADIUS + 0.5 {
                let offset = (y * w + x) * 4;
                let coverage = if dist <= DOT_RADIUS - 0.5 {
                    1.0
                } else {
                    (DOT_RADIUS + 0.5 - dist).clamp(0.0, 1.0)
                };

                // Alpha-blend the dot over the existing pixel
                let dot_a = (a as f64 * coverage) / 255.0;
                let bg_a = pixels[offset + 3] as f64 / 255.0;
                let out_a = dot_a + bg_a * (1.0 - dot_a);

                if out_a > 0.0 {
                    pixels[offset] =
                        ((r as f64 * dot_a + pixels[offset] as f64 * bg_a * (1.0 - dot_a)) / out_a) as u8;
                    pixels[offset + 1] =
                        ((g as f64 * dot_a + pixels[offset + 1] as f64 * bg_a * (1.0 - dot_a)) / out_a) as u8;
                    pixels[offset + 2] =
                        ((b as f64 * dot_a + pixels[offset + 2] as f64 * bg_a * (1.0 - dot_a)) / out_a) as u8;
                    pixels[offset + 3] = (out_a * 255.0) as u8;
                }
            }
        }
    }

    Image::new_owned(pixels, w as u32, h as u32)
}

/// Build the system tray and return the tray icon handle.
pub fn build_tray(app: &tauri::App) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    // Decode and cache the base app icon for later compositing
    init_base_icon();

    let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = icon_with_dot(COLOR_IDLE.0, COLOR_IDLE.1, COLOR_IDLE.2, COLOR_IDLE.3);

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
        None => return,
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
                    let icon = icon_with_dot(r, g, b, a);

                    if let Some(tray) = app_clone.tray_by_id("main") {
                        let _ = tray.set_icon(Some(icon));
                    }

                    bright = !bright;
                    thread::sleep(Duration::from_millis(800));
                }
            });
        }
        "generating" => {
            let icon = icon_with_dot(
                COLOR_GENERATING.0,
                COLOR_GENERATING.1,
                COLOR_GENERATING.2,
                COLOR_GENERATING.3,
            );
            let _ = tray.set_icon(Some(icon));
        }
        _ => {
            // idle
            let icon = icon_with_dot(COLOR_IDLE.0, COLOR_IDLE.1, COLOR_IDLE.2, COLOR_IDLE.3);
            let _ = tray.set_icon(Some(icon));
        }
    }
}
