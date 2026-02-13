use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::models::config::Config;

pub struct AppState {
    pub config: Arc<Mutex<Config>>,
    pub data_dir: String,
    pub listener_active: Arc<AtomicBool>,
    pub tray_pulse_active: Arc<AtomicBool>,
}
