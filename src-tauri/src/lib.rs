// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn check_domain(
    url: String,
    allowlist: Vec<String>,
    blocklist: Vec<String>,
) -> Result<String, String> {
    let full_url = if !url.contains("://") {
        format!("https://{}", url)
    } else {
        url.clone()
    };
    let parsed = url::Url::parse(&full_url).map_err(|_| "Invalid URL format".to_string())?;
    let domain = parsed
        .domain()
        .ok_or("Could not find domain".to_string())?
        .to_lowercase();

    // 1. Check blocklist first (High priority)
    if blocklist.iter().any(|d| domain.contains(&d.to_lowercase())) {
        return Err(format!("Domain '{}' is explicitly blocklisted.", domain));
    }

    // 2. Check Allowlist
    if allowlist.is_empty() || allowlist.iter().any(|d| domain.contains(&d.to_lowercase())) {
        Ok("Safe".into())
    } else {
        Err(format!("Domain '{}' is not on your allowlist.", domain))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![check_domain])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
