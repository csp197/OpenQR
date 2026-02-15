use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanObject {
    #[serde(default)]
    pub id: i64,
    pub url: String,
    pub timestamp: String,
}
