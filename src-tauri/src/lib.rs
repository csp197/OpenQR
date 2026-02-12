mod commands;
mod models;
mod state;

use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Determine data directory
            let home = app.path().home_dir().map_err(|e| e.to_string())?;
            let data_dir = home.join(".openqr");
            std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

            let data_dir_str = data_dir.to_string_lossy().to_string();

            // Load config
            let config = commands::config::load_config(&data_dir_str);

            let app_state = AppState {
                config: Arc::new(Mutex::new(config)),
                data_dir: data_dir_str,
                listener_active: Arc::new(Mutex::new(false)),
            };

            // Build system tray
            let show_item =
                MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
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

            // Handle window close — hide to tray if configured
            let state_for_close = app_state.config.clone();
            if let Some(main_window) = app.get_webview_window("main") {
                let window_clone = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let close_to_tray = state_for_close
                            .lock()
                            .map(|c| c.close_to_tray)
                            .unwrap_or(false);

                        if close_to_tray {
                            api.prevent_close();
                            let _ = window_clone.hide();
                        }
                    }
                });
            }

            app.manage(app_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::url::check_url,
            commands::config::get_config,
            commands::config::save_config,
            commands::history::add_scan,
            commands::history::get_history,
            commands::history::clear_history,
            commands::scan::process_scan,
            commands::scan::start_global_listener,
            commands::scan::stop_global_listener,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
