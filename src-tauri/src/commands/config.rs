use std::path::PathBuf;

use tauri::State;

use crate::models::config::Config;
use crate::state::AppState;

fn config_path(data_dir: &str) -> PathBuf {
    PathBuf::from(data_dir).join("config.json")
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub fn save_config(state: State<'_, AppState>, config: Config) -> Result<(), String> {
    let path = config_path(&state.data_dir);
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    let mut current = state.config.lock().map_err(|e| e.to_string())?;
    *current = config;
    Ok(())
}

pub fn load_config(data_dir: &str) -> Config {
    let path = config_path(data_dir);
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<Config>(&content).ok())
            .unwrap_or_default()
    } else {
        let config = Config::default();
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = std::fs::write(&path, json);
        }
        config
    }
}
