use rusqlite::Connection;
use tauri::State;

use crate::models::scan::ScanObject;
use crate::state::AppState;

fn db_path(data_dir: &str) -> String {
    format!("{}/history.db", data_dir)
}

fn open_db(data_dir: &str) -> Result<Connection, String> {
    let path = db_path(data_dir);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS scan_history (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn add_scan_internal(data_dir: &str, max_items: u32, scan: &ScanObject) -> Result<(), String> {
    let conn = open_db(data_dir)?;
    conn.execute(
        "INSERT INTO scan_history (id, url, timestamp) VALUES (?1, ?2, ?3)",
        [&scan.id, &scan.url, &scan.timestamp],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM scan_history WHERE id NOT IN (
            SELECT id FROM scan_history ORDER BY timestamp DESC LIMIT ?1
        )",
        [max_items],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn add_scan(state: State<'_, AppState>, scan: ScanObject) -> Result<(), String> {
    let max = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        config.max_history_items
    };
    add_scan_internal(&state.data_dir, max, &scan)
}

#[tauri::command]
pub fn get_history(state: State<'_, AppState>) -> Result<Vec<ScanObject>, String> {
    let max = {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        config.max_history_items
    };
    let conn = open_db(&state.data_dir)?;
    let mut stmt = conn
        .prepare("SELECT id, url, timestamp FROM scan_history ORDER BY timestamp DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;

    let results = stmt
        .query_map([max], |row| {
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

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let conn = open_db(&state.data_dir)?;
    conn.execute("DELETE FROM scan_history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get history directly from a data_dir (used in tests and internally).
#[cfg(test)]
pub fn get_history_internal(data_dir: &str, max_items: u32) -> Result<Vec<ScanObject>, String> {
    let conn = open_db(data_dir)?;
    let mut stmt = conn
        .prepare("SELECT id, url, timestamp FROM scan_history ORDER BY timestamp DESC LIMIT ?1")
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

/// Clear history directly from a data_dir (used in tests).
#[cfg(test)]
pub fn clear_history_internal(data_dir: &str) -> Result<(), String> {
    let conn = open_db(data_dir)?;
    conn.execute("DELETE FROM scan_history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_scan(id: &str, url: &str, ts: &str) -> ScanObject {
        ScanObject {
            id: id.to_string(),
            url: url.to_string(),
            timestamp: ts.to_string(),
        }
    }

    #[test]
    fn add_and_get() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let scan = make_scan("1", "https://example.com", "2024-01-01 00:00:00");
        add_scan_internal(&data_dir, 100, &scan).unwrap();

        let history = get_history_internal(&data_dir, 100).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].url, "https://example.com");
    }

    #[test]
    fn max_items_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        for i in 0..10 {
            let scan = make_scan(
                &format!("id-{}", i),
                &format!("https://example{}.com", i),
                &format!("2024-01-01 00:00:{:02}", i),
            );
            add_scan_internal(&data_dir, 5, &scan).unwrap();
        }

        let history = get_history_internal(&data_dir, 5).unwrap();
        assert_eq!(history.len(), 5);
    }

    #[test]
    fn clear() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let scan = make_scan("1", "https://example.com", "2024-01-01 00:00:00");
        add_scan_internal(&data_dir, 100, &scan).unwrap();

        clear_history_internal(&data_dir).unwrap();

        let history = get_history_internal(&data_dir, 100).unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn empty_history() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let history = get_history_internal(&data_dir, 100).unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn order_is_desc_by_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("1", "https://old.com", "2024-01-01 00:00:00"),
        )
        .unwrap();
        add_scan_internal(
            &data_dir,
            100,
            &make_scan("2", "https://new.com", "2024-06-01 00:00:00"),
        )
        .unwrap();

        let history = get_history_internal(&data_dir, 100).unwrap();
        assert_eq!(history[0].url, "https://new.com");
        assert_eq!(history[1].url, "https://old.com");
    }
}
