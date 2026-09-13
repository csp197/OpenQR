use url::{Host, Url};

use crate::models::scan::{ScanError, ScanErrorKind, ScanResult, ScanWarning};

/// Known URL-shortener hosts. These only get a warning, not a block, because
/// the real destination is hidden until the link is actually followed.
const SHORTENER_HOSTS: &[&str] = &[
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "ow.ly",
    "is.gd",
    "buff.ly",
    "rebrand.ly",
    "cutt.ly",
    "shorturl.at",
    "tiny.cc",
];

fn not_a_link(raw: &str) -> ScanError {
    ScanError {
        kind: ScanErrorKind::NotALink,
        message: "This QR code isn't a web link".to_string(),
        raw: raw.to_string(),
        host: None,
    }
}

/// Classify raw scanned/typed text as a checkable http(s) URL, or reject it.
///
/// 1. Anything that already parses with an http/https scheme is accepted.
/// 2. Text that looks like a *different* scheme (`mailto:`, `WIFI:`, `tel:`,
///    `javascript:`, ...) is rejected rather than mangled into a web
///    address. A scheme-like prefix is text before a `:` that has no `.`,
///    where what follows the `:` isn't just a port number — that's what
///    lets `localhost:3000` and `example.com:8080/path` fall through to
///    step 3 instead of being rejected here.
/// 3. Anything else is assumed to be a bare domain: prepend `https://` and
///    parse it. Whitespace or a missing host is rejected. The host must
///    contain a `.`, be an IPv4/IPv6 address (bracketed, for IPv6), or be
///    `localhost` — this is what rejects a bare word like `hello`.
pub fn classify_url(input: &str) -> Result<Url, ScanError> {
    let trimmed = input.trim();

    if let Ok(url) = Url::parse(trimmed) {
        if url.scheme() == "http" || url.scheme() == "https" {
            return Ok(url);
        }
    }

    if let Some((before, after)) = trimmed.split_once(':') {
        let looks_like_port = !after.is_empty() && after.chars().all(|c| c.is_ascii_digit());
        if !before.is_empty() && !before.contains('.') && !looks_like_port {
            return Err(not_a_link(trimmed));
        }
    }

    if trimmed.chars().any(|c| c.is_whitespace()) {
        return Err(not_a_link(trimmed));
    }

    let candidate = format!("https://{}", trimmed);
    let url = Url::parse(&candidate).map_err(|_| not_a_link(trimmed))?;
    let host = url.host_str().ok_or_else(|| not_a_link(trimmed))?;

    let is_valid_host = host.contains('.')
        || host == "localhost"
        || matches!(url.host(), Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)));
    if !is_valid_host {
        return Err(not_a_link(trimmed));
    }

    Ok(url)
}

/// Strip scheme, a leading `*.`, path/query, port, and any trailing dots
/// (e.g. `example.com.`, a valid DNS root-label form browsers treat the same
/// as `example.com`) from an allowlist or blocklist entry so it compares
/// cleanly against a URL's host.
pub fn normalize_entry(entry: &str) -> String {
    let mut s = entry.trim().to_lowercase();

    if let Some(idx) = s.find("://") {
        s = s[idx + 3..].to_string();
    }
    if let Some(stripped) = s.strip_prefix("*.") {
        s = stripped.to_string();
    }
    if let Some(idx) = s.find(['/', '?', '#']) {
        s = s[..idx].to_string();
    }

    // Bracketed or bare IPv6 literals aren't supported as list entries: a
    // literal's internal colons are indistinguishable from a port
    // separator, so naively cutting at the first `:` could truncate the
    // entry into a fragment that accidentally matches a real host. Reject
    // them outright instead - this mirrors `normalizeDomain` on the
    // frontend, which also rejects IPv6 entries.
    if s.starts_with('[') || s.matches(':').count() > 1 {
        return String::new();
    }

    if let Some(idx) = s.find(':') {
        s = s[..idx].to_string();
    }

    s = s.trim_end_matches('.').to_string();

    // Userinfo-shaped garbage (e.g. "user:pass@example.com", which the
    // ':' handling above already truncated to "user", or "user@example.com"
    // with no colon at all) must never be treated as a plausible list
    // entry just because a fragment of it survived stripping.
    if s.contains('@') {
        return String::new();
    }

    // Mirror `normalizeDomain`'s plausibility check on the frontend: a
    // list entry must actually look like a host - contain a dot, be an
    // IPv4 literal, or be exactly "localhost" - otherwise reject it. This
    // is what turns "user:pass@example.com" (stripped to the inert "user"
    // above) into "" instead of a garbage entry that can never match
    // anything but also never legitimately should have been kept.
    let is_plausible_host = s == "localhost" || is_ipv4_literal(&s) || s.contains('.');
    if !is_plausible_host {
        return String::new();
    }

    s
}

/// Matches the same shape as the frontend's `normalizeDomain`
/// (`/^\d{1,3}(\.\d{1,3}){3}$/`): four dot-separated groups of 1-3 ASCII
/// digits each. Deliberately doesn't validate the 0-255 range, to stay in
/// sync with the frontend check it mirrors.
fn is_ipv4_literal(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 3 && p.chars().all(|c| c.is_ascii_digit()))
}

/// A host matches a list entry if it equals the entry or is one of its
/// subdomains. No substring matching, so `x.com` never matches `netflix.com`
/// and `example.com.example.net` never matches `example.com`. Empty entries (which
/// a degenerate input like `""`, `"."`, or `"https://"` normalizes to) never
/// match anything.
pub fn matches_list(host: &str, list: &[String]) -> bool {
    list.iter()
        .any(|entry| !entry.is_empty() && (host == entry || host.ends_with(&format!(".{entry}"))))
}

/// Non-blocking warnings surfaced to the user before opening a checked link.
pub fn compute_warnings(url: &Url) -> Vec<ScanWarning> {
    let mut warnings = Vec::new();

    if url.scheme() == "http" {
        warnings.push(ScanWarning::NotHttps);
    }

    if matches!(url.host(), Some(Host::Ipv4(_)) | Some(Host::Ipv6(_))) {
        warnings.push(ScanWarning::IpAddress);
    }

    if let Some(host) = url.host_str() {
        if host.split('.').any(|label| label.starts_with("xn--")) {
            warnings.push(ScanWarning::Punycode);
        }
        if SHORTENER_HOSTS.contains(&host) {
            warnings.push(ScanWarning::Shortener);
        }
    }

    if !url.username().is_empty() || url.password().is_some() {
        warnings.push(ScanWarning::Userinfo);
    }

    warnings
}

pub fn check_url(
    url: String,
    allow_list: Vec<String>,
    block_list: Vec<String>,
) -> Result<ScanResult, ScanError> {
    let parsed = classify_url(&url)?;
    let host = parsed.host_str().unwrap_or_default().to_string();
    // WHATWG hosts keep a trailing dot (`example.com.`), which browsers treat
    // identically to `example.com.` - match on the dot-stripped form so a
    // trailing dot can't bypass the allow/block lists, while leaving the
    // returned `host` (and the opened URL) untouched.
    let match_host = host.trim_end_matches('.');

    let allow_list: Vec<String> = allow_list.iter().map(|e| normalize_entry(e)).collect();
    let block_list: Vec<String> = block_list.iter().map(|e| normalize_entry(e)).collect();

    if matches_list(match_host, &block_list) {
        return Err(ScanError {
            kind: ScanErrorKind::Blocked,
            message: format!("Blocked: {} is on your blocklist", host),
            raw: url,
            host: Some(host),
        });
    }

    if !allow_list.is_empty() && !matches_list(match_host, &allow_list) {
        return Err(ScanError {
            kind: ScanErrorKind::NotAllowed,
            message: format!("{} isn't on your allowlist", host),
            raw: url,
            host: Some(host),
        });
    }

    Ok(ScanResult {
        url: parsed.to_string(),
        host,
        warnings: compute_warnings(&parsed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── classify_url ─────────────────────────────────────────

    #[test]
    fn classify_accepts_https() {
        let url = classify_url("https://example.com").unwrap();
        assert_eq!(url.host_str(), Some("example.com"));
    }

    #[test]
    fn classify_accepts_http() {
        let url = classify_url("http://example.com").unwrap();
        assert_eq!(url.scheme(), "http");
    }

    #[test]
    fn classify_adds_https_to_bare_domain() {
        let url = classify_url("example.com").unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("example.com"));
    }

    #[test]
    fn classify_bare_word_is_not_a_link() {
        let err = classify_url("hello").unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotALink);
        assert_eq!(err.raw, "hello");
    }

    #[test]
    fn classify_mailto_is_not_a_link() {
        let err = classify_url("mailto:someone@example.com").unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotALink);
    }

    #[test]
    fn classify_wifi_qr_is_not_a_link() {
        let err = classify_url("WIFI:S:x;;").unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotALink);
    }

    #[test]
    fn classify_javascript_scheme_is_not_a_link() {
        let err = classify_url("javascript:alert(1)").unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotALink);
    }

    #[test]
    fn classify_tel_scheme_is_not_a_link() {
        let err = classify_url("tel:+1-555-1234").unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotALink);
    }

    #[test]
    fn classify_domain_with_port_and_path_is_ok() {
        let url = classify_url("example.com:8080/path").unwrap();
        assert_eq!(url.host_str(), Some("example.com"));
        assert_eq!(url.port(), Some(8080));
        assert_eq!(url.path(), "/path");
    }

    #[test]
    fn classify_localhost_with_port_is_ok() {
        let url = classify_url("localhost:3000").unwrap();
        assert_eq!(url.host_str(), Some("localhost"));
        assert_eq!(url.port(), Some(3000));
    }

    #[test]
    fn classify_ip_address_is_ok() {
        let url = classify_url("192.168.1.1").unwrap();
        assert_eq!(url.host_str(), Some("192.168.1.1"));
    }

    #[test]
    fn classify_bracketed_ipv6_with_scheme_is_ok() {
        let url = classify_url("http://[::1]/admin").unwrap();
        assert_eq!(url.host_str(), Some("[::1]"));
        assert_eq!(url.path(), "/admin");
    }

    #[test]
    fn classify_whitespace_is_not_a_link() {
        let err = classify_url("hello world").unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotALink);
    }

    // ─── normalize_entry ──────────────────────────────────────

    #[test]
    fn normalize_entry_plain() {
        assert_eq!(normalize_entry("example.com"), "example.com");
    }

    #[test]
    fn normalize_entry_strips_scheme_wildcard_path_and_port() {
        assert_eq!(
            normalize_entry("HTTPS://*.Example.com:8080/foo?bar"),
            "example.com"
        );
    }

    #[test]
    fn normalize_entry_trims_and_lowercases() {
        assert_eq!(normalize_entry("  Example.COM  "), "example.com");
    }

    #[test]
    fn normalize_entry_cuts_at_fragment() {
        assert_eq!(normalize_entry("example.com#frag"), "example.com");
    }

    #[test]
    fn normalize_entry_rejects_userinfo_with_colon() {
        // Used to strip down to the inert "user" (the ':' handling ran
        // before any plausibility check existed) - must be fully rejected.
        assert_eq!(normalize_entry("user:pass@example.com"), "");
    }

    #[test]
    fn normalize_entry_rejects_userinfo_without_colon() {
        assert_eq!(normalize_entry("user@example.com"), "");
    }

    #[test]
    fn normalize_entry_rejects_bare_word() {
        assert_eq!(normalize_entry("foo"), "");
    }

    #[test]
    fn normalize_entry_accepts_localhost() {
        assert_eq!(normalize_entry("localhost"), "localhost");
    }

    #[test]
    fn normalize_entry_accepts_ipv4_literal() {
        assert_eq!(normalize_entry("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn normalize_entry_rejects_ipv6_literals() {
        // Ambiguous with a port separator - rejected outright, same as
        // `normalizeDomain` on the frontend.
        assert_eq!(normalize_entry("[::1]"), "");
        assert_eq!(normalize_entry("2001:db8::1"), "");
    }

    // ─── matches_list ─────────────────────────────────────────

    #[test]
    fn matches_list_exact() {
        assert!(matches_list("example.com", &["example.com".to_string()]));
    }

    #[test]
    fn matches_list_subdomain() {
        assert!(matches_list(
            "sub.example.com",
            &["example.com".to_string()]
        ));
    }

    #[test]
    fn matches_list_no_substring_match() {
        // "x.com" must never match "netflix.com"
        assert!(!matches_list("netflix.com", &["x.com".to_string()]));
    }

    #[test]
    fn matches_list_lookalike_suffix_does_not_match() {
        // "example.com.example.net" must never match "example.com"
        assert!(!matches_list(
            "example.com.example.net",
            &["example.com".to_string()]
        ));
    }

    // ─── trailing-dot bypass (regression) ────────────────────

    #[test]
    fn normalize_entry_strips_trailing_dot() {
        assert_eq!(normalize_entry("example.com."), "example.com");
    }

    #[test]
    fn normalize_entry_degenerate_entries_become_empty() {
        assert_eq!(normalize_entry(""), "");
        assert_eq!(normalize_entry("."), "");
        assert_eq!(normalize_entry("https://"), "");
    }

    #[test]
    fn matches_list_degenerate_entries_match_nothing() {
        // Empty / dot-only / scheme-only entries must never match any host.
        assert!(!matches_list("example.com", &["".to_string()]));
        assert!(!matches_list("example.com", &[".".to_string()]));
        assert!(!matches_list("", &["".to_string()]));
    }

    #[test]
    fn check_url_trailing_dot_host_is_blocked() {
        // Browsers treat "example.com." the same as "example.com" - the
        // blocklist must too.
        let err = check_url(
            "https://example.com./path".to_string(),
            vec![],
            vec!["example.com".to_string()],
        )
        .unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::Blocked);
    }

    #[test]
    fn check_url_trailing_dot_host_is_allowed() {
        let result = check_url(
            "https://example.com./path".to_string(),
            vec!["example.com".to_string()],
            vec![],
        )
        .unwrap();
        assert_eq!(result.host, "example.com.");
    }

    #[test]
    fn check_url_trailing_dot_subdomain_is_blocked() {
        let err = check_url(
            "https://sub.example.com.".to_string(),
            vec![],
            vec!["example.com".to_string()],
        )
        .unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::Blocked);
    }

    // ─── compute_warnings ─────────────────────────────────────

    #[test]
    fn warning_not_https() {
        let url = Url::parse("http://example.com").unwrap();
        assert!(compute_warnings(&url).contains(&ScanWarning::NotHttps));
    }

    #[test]
    fn warning_ip_address() {
        let url = Url::parse("https://192.168.1.1").unwrap();
        assert!(compute_warnings(&url).contains(&ScanWarning::IpAddress));
    }

    #[test]
    fn warning_ipv6_address() {
        let url = Url::parse("http://[::1]/admin").unwrap();
        assert!(compute_warnings(&url).contains(&ScanWarning::IpAddress));
    }

    #[test]
    fn warning_punycode() {
        let url = Url::parse("https://xn--80ak6aa92e.com").unwrap();
        assert!(compute_warnings(&url).contains(&ScanWarning::Punycode));
    }

    #[test]
    fn warning_shortener() {
        let url = Url::parse("https://bit.ly/abc").unwrap();
        assert!(compute_warnings(&url).contains(&ScanWarning::Shortener));
    }

    #[test]
    fn warning_userinfo() {
        let url = Url::parse("https://user:pass@example.com").unwrap();
        assert!(compute_warnings(&url).contains(&ScanWarning::Userinfo));
    }

    #[test]
    fn no_warnings_for_plain_https() {
        let url = Url::parse("https://example.com").unwrap();
        assert!(compute_warnings(&url).is_empty());
    }

    // ─── check_url ────────────────────────────────────────────

    #[test]
    fn check_url_allowed() {
        let result = check_url(
            "https://good.com/path".to_string(),
            vec!["good.com".to_string()],
            vec![],
        )
        .unwrap();
        assert_eq!(result.host, "good.com");
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn check_url_blocked() {
        let err = check_url(
            "https://example.com/path".to_string(),
            vec![],
            vec!["example.com".to_string()],
        )
        .unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::Blocked);
        assert_eq!(err.host.as_deref(), Some("example.com"));
    }

    #[test]
    fn check_url_not_in_allowlist() {
        let err = check_url(
            "https://random.com".to_string(),
            vec!["only-this.com".to_string()],
            vec![],
        )
        .unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotAllowed);
    }

    #[test]
    fn check_url_empty_allowlist_allows_all() {
        let result = check_url("https://anything.com".to_string(), vec![], vec![]).unwrap();
        assert_eq!(result.host, "anything.com");
    }

    #[test]
    fn check_url_blocklist_takes_priority_over_allowlist() {
        let err = check_url(
            "https://example.com".to_string(),
            vec!["example.com".to_string()],
            vec!["example.com".to_string()],
        )
        .unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::Blocked);
    }

    #[test]
    fn check_url_matches_subdomain() {
        let result = check_url(
            "https://sub.example.com".to_string(),
            vec!["example.com".to_string()],
            vec![],
        )
        .unwrap();
        assert_eq!(result.host, "sub.example.com");
    }

    #[test]
    fn check_url_case_insensitive_list_entries() {
        let result = check_url(
            "https://good.com/path".to_string(),
            vec!["GOOD.COM".to_string()],
            vec![],
        )
        .unwrap();
        assert_eq!(result.host, "good.com");
    }

    #[test]
    fn check_url_blocklist_x_com_does_not_block_netflix() {
        let result = check_url(
            "https://netflix.com".to_string(),
            vec![],
            vec!["x.com".to_string()],
        )
        .unwrap();
        assert_eq!(result.host, "netflix.com");
    }

    #[test]
    fn check_url_allowlist_does_not_allow_lookalike() {
        let err = check_url(
            "https://example.com.example.net".to_string(),
            vec!["example.com".to_string()],
            vec![],
        )
        .unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotAllowed);
    }

    #[test]
    fn check_url_not_a_link_reports_raw_input() {
        let err = check_url("hello".to_string(), vec![], vec![]).unwrap_err();
        assert_eq!(err.kind, ScanErrorKind::NotALink);
        assert_eq!(err.raw, "hello");
        assert!(err.host.is_none());
    }
}
