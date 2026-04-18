use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub appearance: AppearanceConfig,
    pub terminal: TerminalConfig,
    #[serde(default)]
    pub window: WindowConfig,
    #[serde(default)]
    pub ghost_diff: GhostDiffConfig,
}

/// Controls for the Ghost Diff Overlay (Phase 3C).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhostDiffConfig {
    /// When true, inline ghost paint appears for layers still in progress.
    /// Default: false — only agent-completed layers paint (plan 3C-1d).
    #[serde(default)]
    pub live_mode: bool,
}

impl Default for GhostDiffConfig {
    fn default() -> Self {
        Self { live_mode: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowConfig {
    #[serde(default = "default_window_width")]
    pub width: u32,
    #[serde(default = "default_window_height")]
    pub height: u32,
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub sidebar_visible: bool,
    #[serde(default)]
    pub last_directory: Option<String>,
    /// Number of terminal tabs to restore on startup.
    #[serde(default = "default_tab_count")]
    pub tab_count: u32,
}

fn default_tab_count() -> u32 { 1 }

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            width: default_window_width(),
            height: default_window_height(),
            x: None,
            y: None,
            maximized: false,
            sidebar_visible: false,
            last_directory: None,
            tab_count: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_ui_font")]
    pub ui_font_family: String,
    #[serde(default = "default_terminal_font")]
    pub terminal_font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default = "default_true")]
    pub ligatures: bool,
    #[serde(default = "default_window_effect")]
    pub window_effect: String,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    #[serde(default = "default_shell")]
    pub default_shell: String,
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            appearance: AppearanceConfig {
                theme: default_theme(),
                ui_font_family: default_ui_font(),
                terminal_font_family: default_terminal_font(),
                font_size: default_font_size(),
                line_height: default_line_height(),
                ligatures: true,
                window_effect: default_window_effect(),
                opacity: default_opacity(),
            },
            terminal: TerminalConfig {
                default_shell: default_shell(),
                scrollback: default_scrollback(),
                cursor_style: default_cursor_style(),
                cursor_blink: true,
            },
            window: WindowConfig::default(),
            ghost_diff: GhostDiffConfig::default(),
        }
    }
}

fn config_path() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".aether").join("config.toml")
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| toml::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        AppConfig::default()
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    let toml_str = toml::to_string_pretty(config).map_err(|e| format!("serialize: {}", e))?;
    std::fs::write(&path, toml_str).map_err(|e| format!("write: {}", e))
}

fn default_theme() -> String { "catppuccin-mocha".to_string() }
fn default_ui_font() -> String { "Geist, Inter, Source Han Sans JP, sans-serif".to_string() }
fn default_terminal_font() -> String { "Cascadia Code, Cascadia Next JP, monospace".to_string() }
fn default_font_size() -> u32 { 14 }
fn default_line_height() -> f32 { 1.4 }
fn default_true() -> bool { true }
fn default_window_effect() -> String { "mica".to_string() }
fn default_opacity() -> f32 { 0.95 }
fn default_window_width() -> u32 { 1200 }
fn default_window_height() -> u32 { 700 }
fn default_shell() -> String { "pwsh.exe".to_string() }
fn default_scrollback() -> u32 { 10000 }
fn default_cursor_style() -> String { "bar".to_string() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_ghost_diff_is_completed_only() {
        let cfg = AppConfig::default();
        assert!(!cfg.ghost_diff.live_mode);
    }

    #[test]
    fn ghost_diff_missing_from_toml_falls_back_to_default() {
        // Simulate an older config.toml that predates Phase 3C-1d.
        let legacy = r#"
[appearance]
theme = "aether-dark"
ui_font_family = "Inter"
terminal_font_family = "Cascadia Code"
font_size = 14
line_height = 1.4
ligatures = true
window_effect = "mica"
opacity = 0.95

[terminal]
default_shell = "pwsh.exe"
scrollback = 10000
cursor_style = "bar"
cursor_blink = true
"#;
        let cfg: AppConfig = toml::from_str(legacy).expect("parse legacy config");
        assert!(!cfg.ghost_diff.live_mode);
    }

    #[test]
    fn ghost_diff_live_mode_round_trips() {
        let mut cfg = AppConfig::default();
        cfg.ghost_diff.live_mode = true;
        let serialized = toml::to_string(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&serialized).expect("deserialize");
        assert!(back.ghost_diff.live_mode);
    }
}
