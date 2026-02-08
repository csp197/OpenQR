use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize, Clone)]
struct ScanObject {
    id: String,
    url: String,
    timestamp: String,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn check_url(
    url: String,
    allow_list: Vec<String>,
    block_list: Vec<String>,
) -> Result<String, String> {
    let full_url = normalize_url(&url)?;

    let parsed = url::Url::parse(&full_url).map_err(|_| "Invalid URL format".to_string())?;

    let domain = parsed
        .domain()
        .ok_or_else(|| "URL has no valid domain".to_string())?
        .to_lowercase();

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL has no valid hostname".to_string())?
        .to_lowercase();

    let allow_list = normalize_list(allow_list);
    let block_list = normalize_list(block_list);

    if matches_list(&domain, &host, &block_list) {
        return Err(format!("Domain '{}' is blocked.", domain));
    }

    if !allow_list.is_empty() && !matches_list(&domain, &host, &allow_list) {
        return Err(format!("Domain '{}' is not in your allowlist.", domain));
    }

    Ok(host)
}

fn normalize_url(url: &str) -> Result<String, String> {
    if url.contains("://") {
        Ok(url.to_string())
    } else {
        Ok(format!("https://{}", url))
    }
}

fn normalize_list(list: Vec<String>) -> Vec<String> {
    list.into_iter().map(|s| s.to_lowercase()).collect()
}

fn matches_list(domain: &str, host: &str, list: &[String]) -> bool {
    list.iter()
        .any(|entry| domain.contains(entry) || host.contains(entry))
}

// TODO: Add a command to append history directly to a file in Rust

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![check_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
