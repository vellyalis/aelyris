//! URL auto-detection and hyperlink rendering.
//!
//! Scans terminal rows for URLs and highlights them on Ctrl+hover.
//! Clicking opens the URL in the default browser.

/// A detected URL range in a terminal row.
#[derive(Clone, Debug)]
pub struct LinkRange {
    pub col_start: usize,
    pub col_end: usize,
    pub url: String,
}

/// Detect URLs in a row of text.
pub fn detect_links(text: &str) -> Vec<LinkRange> {
    let mut links = Vec::new();
    // Simple URL detection — find http:// or https:// patterns
    let mut search_start = 0;
    while search_start < text.len() {
        if let Some(start) = text[search_start..].find("https://").or_else(|| text[search_start..].find("http://")) {
            let abs_start = search_start + start;
            // Find the end of the URL (whitespace or common delimiters)
            let url_slice = &text[abs_start..];
            let end = url_slice
                .find(|c: char| c.is_whitespace() || "<>{}|\\^`[]\"".contains(c))
                .unwrap_or(url_slice.len());
            let url = &url_slice[..end];
            // Strip trailing punctuation
            let url = url.trim_end_matches(|c: char| ".,;:!?)".contains(c));
            if url.len() >= 8 {
                // Convert byte offsets to char offsets
                let col_start = text[..abs_start].chars().count();
                let col_end = col_start + url.chars().count();
                links.push(LinkRange {
                    col_start,
                    col_end,
                    url: url.to_string(),
                });
            }
            search_start = abs_start + end;
        } else {
            break;
        }
    }
    links
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_simple_url() {
        let links = detect_links("Visit https://example.com for info");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com");
        assert_eq!(links[0].col_start, 6);
    }

    #[test]
    fn test_detect_multiple_urls() {
        let links = detect_links("See https://a.com and http://b.com");
        assert_eq!(links.len(), 2);
    }

    #[test]
    fn test_no_urls() {
        let links = detect_links("No URLs here");
        assert!(links.is_empty());
    }

    #[test]
    fn test_strip_trailing_punctuation() {
        let links = detect_links("Check https://example.com.");
        assert_eq!(links[0].url, "https://example.com");
    }
}
