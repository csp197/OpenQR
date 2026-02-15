use std::path::PathBuf;

use rusqlite::Connection;
use tauri::State;

use crate::models::scan::ScanObject;
use crate::state::AppState;

// ─── Path helpers ────────────────────────────────────────────────────────────

fn db_path(data_dir: &str) -> String {
    format!("{}/history.db", data_dir)
}

fn json_path(data_dir: &str) -> PathBuf {
    PathBuf::from(data_dir).join("history.json")
}

// ─── SQLite storage ──────────────────────────────────────────────────────────

fn open_db(data_dir: &str) -> Result<Connection, String> {
    let path = db_path(data_dir);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn add_scan_sqlite(data_dir: &str, max_items: u32, scan: &ScanObject) -> Result<(), String> {
    let conn = open_db(data_dir)?;
    conn.execute(
        "INSERT INTO history (url, timestamp) VALUES (?1, ?2)",
        [&scan.url, &scan.timestamp],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM history WHERE id NOT IN (
            SELECT id FROM history ORDER BY timestamp DESC LIMIT ?1
        )",
        [max_items],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn get_history_sqlite(data_dir: &str, max_items: u32) -> Result<Vec<ScanObject>, String> {
    let conn = open_db(data_dir)?;
    let mut stmt = conn
        .prepare("SELECT id, url, timestamp FROM history ORDER BY timestamp DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map([max_items], |row| {
            Ok(ScanObject {
                id: row.get(0)?,
                url: row.get(1)?,
                timestamp: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    results
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn clear_history_sqlite(data_dir: &str) -> Result<(), String> {
    let conn = open_db(data_dir)?;
    conn.execute("DELETE FROM history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── JSON storage ────────────────────────────────────────────────────────────

fn read_json_history(data_dir: &str) -> Result<Vec<ScanObject>, String> {
    let path = json_path(data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn write_json_history(data_dir: &str, history: &[ScanObject]) -> Result<(), String> {
    let path = json_path(data_dir);
    let json = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn add_scan_json(data_dir: &str, max_items: u32, scan: &ScanObject) -> Result<(), String> {
    let mut history = read_json_history(data_dir)?;
    history.insert(0, scan.clone());
    history.truncate(max_items as usize);
    write_json_history(data_dir, &history)
}

fn get_history_json(data_dir: &str, max_items: u32) -> Result<Vec<ScanObject>, String> {
    let history = read_json_history(data_dir)?;
    Ok(history
        .into_iter()
        .take(max_items as usize)
        .enumerate()
        .map(|(i, mut scan)| {
            scan.id = i as i64;
            scan
        })
        .collect())
}

fn clear_history_json(data_dir: &str) -> Result<(), String> {
    write_json_history(data_dir, &[])
}

// ─── Dispatching (config-aware) ──────────────────────────────────────────────

pub fn add_scan_internal(
    data_dir: &str,
    max_items: u32,
    scan: &ScanObject,
    storage_method: &str,
) -> Result<(), String> {
    match storage_method {
        "sqlite" => add_scan_sqlite(data_dir, max_items, scan),
        _ => add_scan_json(data_dir, max_items, scan),
    }
}

#[tauri::command]
pub fn add_scan(state: State<'_, AppState>, scan: ScanObject) -> Result<(), String> {
    let (max, method) = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        (
            config.max_history_items,
            config.history_storage_method.clone(),
        )
    };
    add_scan_internal(&state.data_dir, max, &scan, &method)
}

#[tauri::command]
pub fn get_history(state: State<'_, AppState>) -> Result<Vec<ScanObject>, String> {
    let (max, method) = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        (
            config.max_history_items,
            config.history_storage_method.clone(),
        )
    };
    match method.as_str() {
        "sqlite" => get_history_sqlite(&state.data_dir, max),
        _ => get_history_json(&state.data_dir, max),
    }
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let method = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        config.history_storage_method.clone()
    };
    match method.as_str() {
        "sqlite" => clear_history_sqlite(&state.data_dir),
        _ => clear_history_json(&state.data_dir),
    }
}

#[tauri::command]
pub fn migrate_history(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<u32, String> {
    let max = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        config.max_history_items
    };
    let data_dir = &state.data_dir;

    // Read from source
    let items = match from.as_str() {
        "sqlite" => get_history_sqlite(data_dir, max)?,
        _ => get_history_json(data_dir, max)?,
    };

    let count = items.len() as u32;

    // Write to destination
    for scan in &items {
        match to.as_str() {
            "sqlite" => add_scan_sqlite(data_dir, max, scan)?,
            _ => add_scan_json(data_dir, max, scan)?,
        }
    }

    Ok(count)
}

// ─── Test helpers ────────────────────────────────────────────────────────────

#[cfg(test)]
pub fn get_history_internal(
    data_dir: &str,
    max_items: u32,
    storage_method: &str,
) -> Result<Vec<ScanObject>, String> {
    match storage_method {
        "sqlite" => get_history_sqlite(data_dir, max_items),
        _ => get_history_json(data_dir, max_items),
    }
}

#[cfg(test)]
pub fn clear_history_internal(data_dir: &str, storage_method: &str) -> Result<(), String> {
    match storage_method {
        "sqlite" => clear_history_sqlite(data_dir),
        _ => clear_history_json(data_dir),
    }
}

#[cfg(test)]
mod tests {
    // use crate::models::scan;

    use super::*;

    fn make_scan(url: &str, ts: &str) -> ScanObject {
        ScanObject {
            id: 0,
            url: url.to_string(),
            timestamp: ts.to_string(),
        }
    }

    // ─── SQLite tests ────────────────────────────────────────

    #[test]
    fn sqlite_add_and_get() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();
        let scan = make_scan("https://example.com", "2024-01-01 00:00:00");
        add_scan_internal(&data_dir, 100, &scan, "sqlite").unwrap();

        let history = get_history_internal(&data_dir, 100, "sqlite").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].url, "https://example.com");
    }

    #[test]
    fn sqlite_max_items_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        for i in 0..10 {
            let scan = make_scan(
                &format!("https://example{}.com", i),
                &format!("2024-01-01 00:00:{:02}", i),
            );
            add_scan_internal(&data_dir, 5, &scan, "sqlite").unwrap();
        }

        let history = get_history_internal(&data_dir, 5, "sqlite").unwrap();
        assert_eq!(history.len(), 5);
    }

    #[test]
    fn sqlite_clear() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let scan = make_scan("https://example.com", "2024-01-01 00:00:00");
        add_scan_internal(&data_dir, 100, &scan, "sqlite").unwrap();

        clear_history_internal(&data_dir, "sqlite").unwrap();

        let history = get_history_internal(&data_dir, 100, "sqlite").unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn sqlite_empty_history() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let history = get_history_internal(&data_dir, 100, "sqlite").unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn sqlite_order_is_desc_by_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://old.com", "2024-01-01 00:00:00"),
            "sqlite",
        )
        .unwrap();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://new.com", "2024-06-01 00:00:00"),
            "sqlite",
        )
        .unwrap();

        let history = get_history_internal(&data_dir, 100, "sqlite").unwrap();
        assert_eq!(history[0].url, "https://new.com");
        assert_eq!(history[1].url, "https://old.com");
    }

    // ─── JSON tests ──────────────────────────────────────────

    #[test]
    fn json_add_and_get() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let scan = make_scan("https://example.com", "2024-01-01 00:00:00");
        add_scan_internal(&data_dir, 100, &scan, "json").unwrap();

        let history = get_history_internal(&data_dir, 100, "json").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].url, "https://example.com");
    }

    #[test]
    fn json_max_items_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        for i in 0..10 {
            let scan = make_scan(
                &format!("https://example{}.com", i),
                &format!("2024-01-01 00:00:{:02}", i),
            );
            add_scan_internal(&data_dir, 5, &scan, "json").unwrap();
        }

        let history = get_history_internal(&data_dir, 5, "json").unwrap();
        assert_eq!(history.len(), 5);
    }

    #[test]
    fn json_clear() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let scan = make_scan("https://example.com", "2024-01-01 00:00:00");
        add_scan_internal(&data_dir, 100, &scan, "json").unwrap();

        clear_history_internal(&data_dir, "json").unwrap();

        let history = get_history_internal(&data_dir, 100, "json").unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn json_empty_history() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let history = get_history_internal(&data_dir, 100, "json").unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn json_order_is_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://first.com", "2024-01-01 00:00:00"),
            "json",
        )
        .unwrap();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://second.com", "2024-06-01 00:00:00"),
            "json",
        )
        .unwrap();

        let history = get_history_internal(&data_dir, 100, "json").unwrap();
        // Newest insert is first (insert at position 0)
        assert_eq!(history[0].url, "https://second.com");
        assert_eq!(history[1].url, "https://first.com");
    }

    // ─── Migration tests ─────────────────────────────────────

    #[test]
    fn migrate_json_to_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        // Add items to JSON
        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://a.com", "2024-01-01 00:00:00"),
            "json",
        )
        .unwrap();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://b.com", "2024-01-02 00:00:00"),
            "json",
        )
        .unwrap();

        // Migrate JSON → SQLite
        let json_items = get_history_json(&data_dir, 100).unwrap();
        for scan in &json_items {
            add_scan_sqlite(&data_dir, 100, scan).unwrap();
        }

        // Verify SQLite has the items
        let sqlite_history = get_history_sqlite(&data_dir, 100).unwrap();
        assert_eq!(sqlite_history.len(), 2);
    }

    #[test]
    fn migrate_sqlite_to_json() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        // Add items to SQLite
        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://a.com", "2024-01-01 00:00:00"),
            "sqlite",
        )
        .unwrap();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://b.com", "2024-01-02 00:00:00"),
            "sqlite",
        )
        .unwrap();

        // Migrate SQLite → JSON
        let sqlite_items = get_history_sqlite(&data_dir, 100).unwrap();
        for scan in &sqlite_items {
            add_scan_json(&data_dir, 100, scan).unwrap();
        }

        // Verify JSON has the items
        let json_history = get_history_json(&data_dir, 100).unwrap();
        assert_eq!(json_history.len(), 2);
    }
}
