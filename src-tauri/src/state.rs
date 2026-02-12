use std::sync::{Arc, Mutex};

use crate::models::config::Config;

pub struct AppState {
    pub config: Arc<Mutex<Config>>,
    pub data_dir: String,
    pub listener_active: Arc<Mutex<bool>>,
}
