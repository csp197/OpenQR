use crate::commands::scan::has_input_permission;

/// Whether the OS currently grants OpenQR permission to read global
/// keyboard input. Always `true` on platforms that don't require an
/// explicit grant (only macOS does, via Input Monitoring).
#[tauri::command]
pub fn check_input_permission() -> bool {
    has_input_permission()
}

/// Open the OS settings pane where the user can grant Input Monitoring
/// permission. A no-op on platforms that don't have such a pane.
#[tauri::command]
pub fn open_input_permission_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
