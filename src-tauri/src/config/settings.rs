use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub appearance: AppearanceConfig,
    pub terminal: TerminalConfig,
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
        }
    }
}

fn default_theme() -> String { "catppuccin-mocha".to_string() }
fn default_ui_font() -> String { "Geist, Inter, Source Han Sans JP, sans-serif".to_string() }
fn default_terminal_font() -> String { "Cascadia Code, Cascadia Next JP, monospace".to_string() }
fn default_font_size() -> u32 { 14 }
fn default_line_height() -> f32 { 1.4 }
fn default_true() -> bool { true }
fn default_window_effect() -> String { "mica".to_string() }
fn default_opacity() -> f32 { 0.95 }
fn default_shell() -> String { "pwsh.exe".to_string() }
fn default_scrollback() -> u32 { 10000 }
fn default_cursor_style() -> String { "bar".to_string() }
