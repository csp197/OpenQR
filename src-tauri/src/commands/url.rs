#[tauri::command]
pub fn check_url(
    url: String,
    allow_list: Vec<String>,
    block_list: Vec<String>,
) -> Result<String, String> {
    let full_url = normalize_url(&url)?;

    let parsed = url::Url::parse(&full_url).map_err(|_| "Invalid URL format".to_string())?;
    let domain = parsed
        .domain()
        .ok_or_else(|| "URL has no valid domain".to_string())?
        .to_lowercase();

    let host = parsed
        .host_str()
        .ok_or_else(|| "URL has no valid hostname".to_string())?
        .to_lowercase();

    let allow_list = normalize_list(allow_list);
    let block_list = normalize_list(block_list);

    if matches_list(&domain, &host, &block_list) {
        return Err(format!("Domain '{}' is blocked.", domain));
    }

    if !allow_list.is_empty() && !matches_list(&domain, &host, &allow_list) {
        return Err(format!("Domain '{}' is not in your allowlist.", domain));
    }

    Ok(host)
}

pub fn normalize_url(url: &str) -> Result<String, String> {
    if url.contains("://") {
        Ok(url.to_string())
    } else {
        Ok(format!("https://{}", url))
    }
}

pub fn normalize_list(list: Vec<String>) -> Vec<String> {
    list.into_iter().map(|s| s.to_lowercase()).collect()
}

pub fn matches_list(domain: &str, host: &str, list: &[String]) -> bool {
    list.iter()
        .any(|entry| domain.contains(entry) || host.contains(entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_with_scheme() {
        assert_eq!(
            normalize_url("https://example.com").unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn normalize_url_without_scheme() {
        assert_eq!(normalize_url("example.com").unwrap(), "https://example.com");
    }

    #[test]
    fn normalize_url_http() {
        assert_eq!(
            normalize_url("http://example.com").unwrap(),
            "http://example.com"
        );
    }

    #[test]
    fn check_url_allowed() {
        let result = check_url(
            "https://good.com/path".to_string(),
            vec!["good.com".to_string()],
            vec![],
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "good.com");
    }

    #[test]
    fn check_url_blocked() {
        let result = check_url(
            "https://evil.com/path".to_string(),
            vec![],
            vec!["evil.com".to_string()],
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked"));
    }

    #[test]
    fn check_url_not_in_allowlist() {
        let result = check_url(
            "https://random.com".to_string(),
            vec!["only-this.com".to_string()],
            vec![],
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not in your allowlist"));
    }

    #[test]
    fn empty_allowlist_allows_all() {
        let result = check_url("https://anything.com".to_string(), vec![], vec![]);
        assert!(result.is_ok());
    }

    #[test]
    fn blocklist_takes_priority_over_allowlist() {
        let result = check_url(
            "https://evil.com".to_string(),
            vec!["evil.com".to_string()],
            vec!["evil.com".to_string()],
        );
        assert!(result.is_err());
    }

    #[test]
    fn matches_subdomain() {
        assert!(matches_list(
            "sub.example.com",
            "sub.example.com",
            &["example.com".to_string()]
        ));
    }

    #[test]
    fn case_insensitive() {
        let result = check_url(
            "https://GOOD.COM/path".to_string(),
            vec!["good.com".to_string()],
            vec![],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn url_without_scheme_gets_validated() {
        let result = check_url("example.com/page".to_string(), vec![], vec![]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "example.com");
    }
}
