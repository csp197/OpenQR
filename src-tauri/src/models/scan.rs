use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanObject {
    #[serde(default)]
    pub id: i64,
    pub url: String,
    pub timestamp: String,
}

// ─── Shared contract with the frontend (see plan: "Shared contract") ────────
//
// Field names and enum values here are load-bearing: the TS side matches
// them exactly (snake_case strings via `rename_all = "snake_case"`).

/// Non-blocking warning surfaced to the user before a checked link opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanWarning {
    NotHttps,
    IpAddress,
    Punycode,
    Shortener,
    Userinfo,
}

/// A successfully checked scan: the normalized URL that will be opened and
/// stored in history, its host, and any warnings the user should see first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScanResult {
    pub url: String,
    pub host: String,
    pub warnings: Vec<ScanWarning>,
}

/// Why a scan could not be turned into an openable link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanErrorKind {
    NotALink,
    Blocked,
    NotAllowed,
    Internal,
}

/// Serialized as a struct (not a bare string) so the frontend can branch on
/// `kind` and still show the user their original input via `raw`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScanError {
    pub kind: ScanErrorKind,
    pub message: String,
    pub raw: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
}

impl ScanError {
    /// An error kind with no host context, e.g. a poisoned mutex or a
    /// storage failure. `raw` is whatever input we had cleaned so far, so
    /// the user can still copy it out.
    pub fn internal(message: impl std::fmt::Display, raw: impl Into<String>) -> Self {
        ScanError {
            kind: ScanErrorKind::Internal,
            message: message.to_string(),
            raw: raw.into(),
            host: None,
        }
    }
}

/// Why the global keyboard listener failed to start, sent to the frontend
/// via the `scan-error` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ListenerErrorKind {
    Permission,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListenerError {
    pub kind: ListenerErrorKind,
    pub message: String,
}
