use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanObject {
    pub id: String,
    pub url: String,
    pub timestamp: String,
}
