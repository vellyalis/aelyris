use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

use super::interactive::AgentCli;
use crate::term::GridSnapshot;

pub const DEFAULT_CONTEXT_WARN_USED_PCT: f64 = 85.0;
pub const DEFAULT_CONTEXT_HARD_USED_PCT: f64 = 95.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryConfidence {
    Exact,
    Parsed,
    Estimated,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContextPressureThresholds {
    pub warn_used_pct: f64,
    pub hard_used_pct: f64,
}

impl Default for ContextPressureThresholds {
    fn default() -> Self {
        Self {
            warn_used_pct: DEFAULT_CONTEXT_WARN_USED_PCT,
            hard_used_pct: DEFAULT_CONTEXT_HARD_USED_PCT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextRemaining {
    /// Remaining context percentage reported by the CLI. `None` means the runtime
    /// only has status/time/turn proxies, not a CLI-reported window reading.
    pub pct: Option<f64>,
    /// Used context percentage. This is derived from `pct` when present so UI
    /// surfaces can keep using the existing ContextGauge usage thresholds.
    pub used_pct: Option<f64>,
    pub confidence: TelemetryConfidence,
    pub source: String,
    pub updated_at: u64,
    pub warn: bool,
    pub hard: bool,
}

impl ContextRemaining {
    pub fn unknown_proxy(cli: &AgentCli, updated_at: u64) -> Self {
        let confidence = match cli {
            AgentCli::Claude => TelemetryConfidence::Estimated,
            AgentCli::Gemini | AgentCli::Codex | AgentCli::Custom(_) => {
                TelemetryConfidence::Unknown
            }
        };
        Self {
            pct: None,
            used_pct: None,
            confidence,
            source: "status_time_turn_proxy".to_string(),
            updated_at,
            warn: false,
            hard: false,
        }
    }

    pub fn parsed_claude_grid(remaining_pct: f64, updated_at: u64) -> Self {
        let thresholds = ContextPressureThresholds::default();
        let used_pct = used_pct_from_remaining(remaining_pct);
        Self {
            pct: Some(remaining_pct),
            used_pct: Some(used_pct),
            confidence: TelemetryConfidence::Parsed,
            source: "claude_grid_context_left".to_string(),
            updated_at,
            warn: used_pct >= thresholds.warn_used_pct,
            hard: used_pct >= thresholds.hard_used_pct,
        }
    }
}

static CLAUDE_CONTEXT_LEFT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(100|[1-9]?\d(?:\.\d+)?)\s*%\s+context\s+left(?:\s+until\s+auto-compact)?\b")
        .unwrap()
});

pub fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn used_pct_from_remaining(remaining_pct: f64) -> f64 {
    (100.0 - remaining_pct.clamp(0.0, 100.0)).clamp(0.0, 100.0)
}

pub fn parse_claude_context_remaining_from_text(
    text: &str,
    updated_at: u64,
) -> Option<ContextRemaining> {
    let cap = CLAUDE_CONTEXT_LEFT_RE.captures(text)?;
    let pct = cap.get(1)?.as_str().parse::<f64>().ok()?;
    Some(ContextRemaining::parsed_claude_grid(
        pct.clamp(0.0, 100.0),
        updated_at,
    ))
}

pub fn grid_text(snapshot: &GridSnapshot) -> String {
    snapshot
        .cells
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| cell.ch)
                .collect::<String>()
                .trim_end()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn parse_claude_context_remaining_from_grid(
    snapshot: &GridSnapshot,
    updated_at: u64,
) -> Option<ContextRemaining> {
    parse_claude_context_remaining_from_text(&grid_text(snapshot), updated_at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::term::{CellSnapshot, CursorShapeSnapshot, CursorSnapshot, GridSnapshot};

    fn grid_from_rows(rows: &[&str]) -> GridSnapshot {
        let cols = rows
            .iter()
            .map(|row| row.chars().count())
            .max()
            .unwrap_or(0) as u16;
        let cells = rows
            .iter()
            .map(|row| {
                let mut cells: Vec<CellSnapshot> = row
                    .chars()
                    .map(|ch| CellSnapshot {
                        ch,
                        fg: 0,
                        bg: 0,
                        attrs: 0,
                        hyperlink: None,
                    })
                    .collect();
                while cells.len() < cols as usize {
                    cells.push(CellSnapshot::blank());
                }
                cells
            })
            .collect();
        GridSnapshot {
            cols,
            rows: rows.len() as u16,
            cells,
            cursor: CursorSnapshot {
                row: 0,
                col: 0,
                shape: CursorShapeSnapshot::Block,
                blinking: false,
                visible: true,
            },
            images: Vec::new(),
        }
    }

    #[test]
    fn parses_claude_context_left_line_from_grid() {
        let grid = grid_from_rows(&[
            "Claude Code",
            "You've used 78% of your weekly limit",
            "12% context left until auto-compact",
        ]);
        let remaining = parse_claude_context_remaining_from_grid(&grid, 123).unwrap();
        assert_eq!(remaining.pct, Some(12.0));
        assert_eq!(remaining.used_pct, Some(88.0));
        assert_eq!(remaining.confidence, TelemetryConfidence::Parsed);
        assert!(remaining.warn);
        assert!(!remaining.hard);
        assert_eq!(remaining.updated_at, 123);
    }

    #[test]
    fn hard_pressure_uses_existing_usage_threshold_shape() {
        let remaining = parse_claude_context_remaining_from_text("4% context left", 10).unwrap();
        assert_eq!(remaining.used_pct, Some(96.0));
        assert!(remaining.warn);
        assert!(remaining.hard);
    }

    #[test]
    fn ignores_non_context_percent_lines() {
        assert!(parse_claude_context_remaining_from_text(
            "You've used 78% of your weekly limit",
            10,
        )
        .is_none());
    }

    #[test]
    fn non_claude_proxy_is_confidence_unknown() {
        let proxy = ContextRemaining::unknown_proxy(&AgentCli::Codex, 99);
        assert_eq!(proxy.pct, None);
        assert_eq!(proxy.used_pct, None);
        assert_eq!(proxy.confidence, TelemetryConfidence::Unknown);
        assert_eq!(proxy.source, "status_time_turn_proxy");
        assert_eq!(proxy.updated_at, 99);
    }

    #[test]
    fn claude_proxy_is_estimated_until_grid_line_is_seen() {
        let proxy = ContextRemaining::unknown_proxy(&AgentCli::Claude, 99);
        assert_eq!(proxy.confidence, TelemetryConfidence::Estimated);
        assert_eq!(proxy.pct, None);
    }
}
