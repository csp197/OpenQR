use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrefixConfig {
    pub mode: String,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuffixConfig {
    pub mode: String,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub allowlist: Vec<String>,
    pub blocklist: Vec<String>,
    pub history_storage_method: String,
    pub scan_mode: String,
    pub notification_type: String,
    pub max_history_items: u32,
    pub prefix: PrefixConfig,
    pub suffix: SuffixConfig,
    #[serde(default)]
    pub close_to_tray: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            allowlist: vec![],
            blocklist: vec![],
            history_storage_method: "json".to_string(),
            scan_mode: "single".to_string(),
            notification_type: "toast".to_string(),
            max_history_items: 100,
            prefix: PrefixConfig {
                mode: "none".to_string(),
                value: None,
            },
            suffix: SuffixConfig {
                mode: "enter".to_string(),
                value: None,
            },
            close_to_tray: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values() {
        let config = Config::default();
        assert_eq!(config.max_history_items, 100);
        assert_eq!(config.scan_mode, "single");
        assert_eq!(config.notification_type, "toast");
        assert!(!config.close_to_tray);
        assert!(config.allowlist.is_empty());
        assert!(config.blocklist.is_empty());
        assert_eq!(config.prefix.mode, "none");
        assert_eq!(config.suffix.mode, "enter");
    }

    #[test]
    fn serialization_roundtrip() {
        let config = Config::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.max_history_items, config.max_history_items);
        assert_eq!(deserialized.close_to_tray, config.close_to_tray);
        assert_eq!(deserialized.scan_mode, config.scan_mode);
    }

    #[test]
    fn backward_compat_missing_close_to_tray() {
        let json = r#"{
            "allowlist": [],
            "blocklist": [],
            "history_storage_method": "json",
            "scan_mode": "single",
            "notification_type": "toast",
            "max_history_items": 100,
            "prefix": {"mode": "none"},
            "suffix": {"mode": "enter"}
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert!(!config.close_to_tray);
    }

    #[test]
    fn custom_prefix_value() {
        let json = r#"{
            "allowlist": [],
            "blocklist": [],
            "history_storage_method": "json",
            "scan_mode": "single",
            "notification_type": "toast",
            "max_history_items": 50,
            "prefix": {"mode": "custom", "value": "QR:"},
            "suffix": {"mode": "none"},
            "close_to_tray": true
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.prefix.mode, "custom");
        assert_eq!(config.prefix.value.as_deref(), Some("QR:"));
        assert!(config.close_to_tray);
        assert_eq!(config.max_history_items, 50);
    }
}
