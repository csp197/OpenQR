use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};

use crate::models::config::Config;

pub struct AppState {
    pub config: Arc<Mutex<Config>>,
    pub data_dir: String,
    pub listener_active: Arc<AtomicBool>,
    /// Bumped every time the tray state changes; a running pulse thread
    /// stops as soon as its captured generation no longer matches (bug #5).
    pub tray_pulse_gen: Arc<AtomicU64>,
    /// The tray's last-requested state ("idle"/"listening"/"generating"),
    /// so `set_tray_state` can no-op on a redundant request.
    pub tray_state: Mutex<String>,
}
