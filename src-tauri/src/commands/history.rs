use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

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
            SELECT id FROM history ORDER BY timestamp DESC, id DESC LIMIT ?1
        )",
        [max_items],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn get_history_sqlite(data_dir: &str, max_items: u32) -> Result<Vec<ScanObject>, String> {
    let conn = open_db(data_dir)?;
    let mut stmt = conn
        .prepare("SELECT id, url, timestamp FROM history ORDER BY timestamp DESC, id DESC LIMIT ?1")
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

// Per-process counter mixed into temp file names so two writes on the same
// thread within the same nanosecond still can't collide.
static TMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn write_json_history(data_dir: &str, history: &[ScanObject]) -> Result<(), String> {
    let path = json_path(data_dir);
    let json = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    // Write to a uniquely-named temp file first and rename over the target so
    // a crash or concurrent read never sees a partially-written file. The name
    // is unique per call (pid + nanos-since-epoch + a per-process counter) so
    // two concurrent writers (e.g. `add_scan` racing `migrate_history` or
    // `clear_history` on different threads) never share a temp file - sharing
    // one meant the first rename could consume the second writer's temp file,
    // making the second rename fail with ENOENT and silently dropping data.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = TMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_path = PathBuf::from(format!(
        "{}.{}.{}.{}.tmp",
        path.display(),
        std::process::id(),
        nanos,
        counter
    ));

    if let Err(e) = std::fs::write(&tmp_path, json) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e.to_string());
    }

    if let Err(e) = std::fs::rename(&tmp_path, &path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e.to_string());
    }

    Ok(())
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

/// Move history from one storage backend to another. The destination is
/// cleared first, then rewritten in bulk, so re-running the same migration
/// (or migrating back and forth) never duplicates entries.
///
/// Source items come back newest-first (both backends already return them
/// that way). Writing to JSON is then a direct bulk write. Writing to
/// SQLite has to insert oldest-first, inside a transaction, so autoincrement
/// ids land in chronological order — that's what keeps
/// `ORDER BY timestamp DESC, id DESC` correct afterwards.
pub fn migrate_history_internal(
    data_dir: &str,
    max_items: u32,
    from: &str,
    to: &str,
) -> Result<u32, String> {
    if from == to {
        return Ok(0);
    }

    let items = match from {
        "sqlite" => get_history_sqlite(data_dir, max_items)?,
        _ => get_history_json(data_dir, max_items)?,
    };

    let count = items.len() as u32;

    match to {
        "sqlite" => {
            let mut conn = open_db(data_dir)?;
            // Delete-then-insert in one transaction so a failure partway
            // through never leaves the destination cleared but not
            // repopulated (or vice versa).
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM history", [])
                .map_err(|e| e.to_string())?;
            for scan in items.iter().rev() {
                tx.execute(
                    "INSERT INTO history (url, timestamp) VALUES (?1, ?2)",
                    [&scan.url, &scan.timestamp],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
        _ => {
            // `write_json_history` overwrites the whole file (atomically,
            // via a rename) so a separate clear step first would just add
            // a non-atomic window without replacing anything extra.
            write_json_history(data_dir, &items)?;
        }
    }

    Ok(count)
}

#[tauri::command]
pub fn migrate_history(
    state: State<'_, AppState>,
    max_items: u32,
    from: String,
    to: String,
) -> Result<u32, String> {
    migrate_history_internal(&state.data_dir, max_items, &from, &to)
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

    #[test]
    fn write_json_history_concurrent_writes_are_safe() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        let thread_count = 8;
        let writes_per_thread = 50;

        // All values any thread might have written, so we can check the
        // final file settled on one of them rather than something mangled.
        let mut all_values = Vec::new();
        for t in 0..thread_count {
            for i in 0..writes_per_thread {
                all_values.push(make_scan(&format!("https://thread{}-{}.com", t, i), "2024-01-01 00:00:00"));
            }
        }

        let handles: Vec<_> = (0..thread_count)
            .map(|t| {
                let data_dir = data_dir.clone();
                std::thread::spawn(move || -> Result<(), String> {
                    for i in 0..writes_per_thread {
                        let scan = make_scan(&format!("https://thread{}-{}.com", t, i), "2024-01-01 00:00:00");
                        write_json_history(&data_dir, &[scan])?;
                    }
                    Ok(())
                })
            })
            .collect();

        for h in handles {
            // No errors returned from any concurrent write.
            h.join().unwrap().unwrap();
        }

        // The final file must parse as valid JSON equal to one of the
        // written values (read_json_history round-trips through serde_json).
        let final_history = read_json_history(&data_dir).unwrap();
        assert_eq!(final_history.len(), 1);
        assert!(
            all_values.iter().any(|v| v.url == final_history[0].url
                && v.timestamp == final_history[0].timestamp),
            "final history {:?} was not one of the written values",
            final_history
        );

        // No leftover temp files from any writer.
        let leftover_tmp: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(
            leftover_tmp.is_empty(),
            "leftover tmp files: {:?}",
            leftover_tmp
        );
    }

    // ─── Migration tests ─────────────────────────────────────
    // These call `migrate_history_internal` directly, exercising the same
    // clear-then-bulk-write logic the `migrate_history` command uses.

    #[test]
    fn migrate_from_equals_to_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://a.com", "2024-01-01 00:00:00"),
            "json",
        )
        .unwrap();

        let count = migrate_history_internal(&data_dir, 100, "json", "json").unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn migrate_json_to_sqlite_keeps_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

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
        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://c.com", "2024-01-03 00:00:00"),
            "json",
        )
        .unwrap();

        let count = migrate_history_internal(&data_dir, 100, "json", "sqlite").unwrap();
        assert_eq!(count, 3);

        let history = get_history_internal(&data_dir, 100, "sqlite").unwrap();
        assert_eq!(
            history.iter().map(|s| s.url.as_str()).collect::<Vec<_>>(),
            vec!["https://c.com", "https://b.com", "https://a.com"]
        );
    }

    #[test]
    fn migrate_sqlite_to_json_keeps_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

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

        let count = migrate_history_internal(&data_dir, 100, "sqlite", "json").unwrap();
        assert_eq!(count, 2);

        let history = get_history_internal(&data_dir, 100, "json").unwrap();
        assert_eq!(
            history.iter().map(|s| s.url.as_str()).collect::<Vec<_>>(),
            vec!["https://b.com", "https://a.com"]
        );
    }

    #[test]
    fn migrate_twice_does_not_duplicate() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

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

        migrate_history_internal(&data_dir, 100, "json", "sqlite").unwrap();
        migrate_history_internal(&data_dir, 100, "json", "sqlite").unwrap();

        let history = get_history_internal(&data_dir, 100, "sqlite").unwrap();
        assert_eq!(history.len(), 2);
    }

    #[test]
    fn migrate_replaces_preexisting_destination_rows() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().to_string_lossy().to_string();

        // The destination already has an unrelated row before migrating -
        // it must be gone afterwards, not merged with the migrated items.
        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://stale.com", "2020-01-01 00:00:00"),
            "sqlite",
        )
        .unwrap();

        add_scan_internal(
            &data_dir,
            100,
            &make_scan("https://fresh.com", "2024-01-01 00:00:00"),
            "json",
        )
        .unwrap();

        migrate_history_internal(&data_dir, 100, "json", "sqlite").unwrap();

        let history = get_history_internal(&data_dir, 100, "sqlite").unwrap();
        assert_eq!(
            history.iter().map(|s| s.url.as_str()).collect::<Vec<_>>(),
            vec!["https://fresh.com"]
        );
    }
}
