use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub appearance: AppearanceConfig,
    pub terminal: TerminalConfig,
    #[serde(default)]
    pub window: WindowConfig,
    #[serde(default)]
    pub ghost_diff: GhostDiffConfig,
    #[serde(default)]
    pub workspace_profile: WorkspaceProfileConfig,
}

/// Controls for the Ghost Diff Overlay (Phase 3C).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GhostDiffConfig {
    /// When true, inline ghost paint appears for layers still in progress.
    /// Default: false — only agent-completed layers paint (plan 3C-1d).
    #[serde(default)]
    pub live_mode: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceProfileConfig {
    #[serde(default)]
    pub global_defaults: WorkspaceProfileDefaultsConfig,
    #[serde(default)]
    pub workspace_overrides: std::collections::BTreeMap<String, WorkspaceProfileOverrideConfig>,
    #[serde(default)]
    pub thread_run_state: std::collections::BTreeMap<
        String,
        std::collections::BTreeMap<String, ThreadRunStateConfig>,
    >,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceProfileDefaultsConfig {
    #[serde(default = "default_shell")]
    pub default_shell: String,
    #[serde(default = "default_preferred_model")]
    pub preferred_model: String,
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default)]
    pub workflows: Vec<String>,
    #[serde(default)]
    pub watch_rules: Vec<String>,
    #[serde(default)]
    pub safe_paths: Vec<String>,
    #[serde(default)]
    pub dashboard_port_policy: DashboardPortPolicyConfig,
    #[serde(default)]
    pub notification_policy: NotificationPolicyConfig,
    #[serde(default = "default_visual_density")]
    pub visual_density: String,
    #[serde(default)]
    pub pane_layout: PaneLayoutPolicyConfig,
    #[serde(default)]
    pub command_risk_policy: CommandRiskPolicyConfig,
    #[serde(default)]
    pub context_pack_policy: ContextPackPolicyConfig,
}

impl Default for WorkspaceProfileDefaultsConfig {
    fn default() -> Self {
        Self {
            default_shell: default_shell(),
            preferred_model: default_preferred_model(),
            agents: vec!["coder".to_string(), "reviewer".to_string()],
            workflows: Vec::new(),
            watch_rules: Vec::new(),
            safe_paths: Vec::new(),
            dashboard_port_policy: DashboardPortPolicyConfig::default(),
            notification_policy: NotificationPolicyConfig::default(),
            visual_density: default_visual_density(),
            pane_layout: PaneLayoutPolicyConfig::default(),
            command_risk_policy: CommandRiskPolicyConfig::default(),
            context_pack_policy: ContextPackPolicyConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceProfileOverrideConfig {
    #[serde(default)]
    pub default_shell: Option<String>,
    #[serde(default)]
    pub preferred_model: Option<String>,
    #[serde(default)]
    pub agents: Option<Vec<String>>,
    #[serde(default)]
    pub workflows: Option<Vec<String>>,
    #[serde(default)]
    pub watch_rules: Option<Vec<String>>,
    #[serde(default)]
    pub safe_paths: Option<Vec<String>>,
    #[serde(default)]
    pub dashboard_port_policy: Option<DashboardPortPolicyConfig>,
    #[serde(default)]
    pub notification_policy: Option<NotificationPolicyConfig>,
    #[serde(default)]
    pub visual_density: Option<String>,
    #[serde(default)]
    pub pane_layout: Option<PaneLayoutPolicyConfig>,
    #[serde(default)]
    pub command_risk_policy: Option<CommandRiskPolicyConfig>,
    #[serde(default)]
    pub context_pack_policy: Option<ContextPackPolicyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardPortPolicyConfig {
    #[serde(default = "default_dashboard_port_mode")]
    pub mode: String,
    #[serde(default = "default_dashboard_base_port")]
    pub base_port: u16,
    #[serde(default = "default_dashboard_port_span")]
    pub span: u16,
    #[serde(default)]
    pub explicit_port: Option<u16>,
}

impl Default for DashboardPortPolicyConfig {
    fn default() -> Self {
        Self {
            mode: default_dashboard_port_mode(),
            base_port: default_dashboard_base_port(),
            span: default_dashboard_port_span(),
            explicit_port: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPolicyConfig {
    #[serde(default = "default_true")]
    pub browser: bool,
    #[serde(default = "default_true")]
    pub local_json: bool,
    #[serde(default = "default_true")]
    pub jsonl: bool,
    #[serde(default = "default_true")]
    pub true_decision_only: bool,
}

impl Default for NotificationPolicyConfig {
    fn default() -> Self {
        Self {
            browser: true,
            local_json: true,
            jsonl: true,
            true_decision_only: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneLayoutPolicyConfig {
    #[serde(default = "default_visual_density")]
    pub density: String,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    #[serde(default = "default_right_panel_width")]
    pub right_panel_width: u16,
    #[serde(default = "default_right_rail_mode")]
    pub right_rail_mode: String,
}

impl Default for PaneLayoutPolicyConfig {
    fn default() -> Self {
        Self {
            density: default_visual_density(),
            sidebar_collapsed: false,
            sidebar_width: default_sidebar_width(),
            right_panel_width: default_right_panel_width(),
            right_rail_mode: default_right_rail_mode(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandRiskPolicyConfig {
    #[serde(default = "default_true")]
    pub approval_required: bool,
    #[serde(default = "default_true")]
    pub block_unsafe_paths: bool,
    #[serde(default)]
    pub safe_paths: Vec<String>,
}

impl Default for CommandRiskPolicyConfig {
    fn default() -> Self {
        Self {
            approval_required: true,
            block_unsafe_paths: true,
            safe_paths: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackPolicyConfig {
    #[serde(default = "default_true")]
    pub include_audit: bool,
    #[serde(default = "default_true")]
    pub include_diff: bool,
    #[serde(default = "default_context_pack_max_files")]
    pub max_files: u16,
    #[serde(default = "default_context_pack_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_true")]
    pub redact_secrets: bool,
}

impl Default for ContextPackPolicyConfig {
    fn default() -> Self {
        Self {
            include_audit: true,
            include_diff: true,
            max_files: default_context_pack_max_files(),
            max_tokens: default_context_pack_max_tokens(),
            redact_secrets: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadRunStateConfig {
    pub thread_id: String,
    #[serde(default = "default_thread_status")]
    pub status: String,
    #[serde(default)]
    pub active_pane_id: Option<String>,
    #[serde(default)]
    pub active_roadmap_id: Option<String>,
    #[serde(default)]
    pub last_validation_id: Option<String>,
    #[serde(default)]
    pub last_active_at: Option<String>,
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

fn default_tab_count() -> u32 {
    1
}

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
#[serde(rename_all = "camelCase")]
pub struct MoodMaterialOverrideConfig {
    #[serde(default)]
    pub backdrop_color: Option<String>,
    #[serde(default)]
    pub backdrop_alpha: Option<f32>,
    #[serde(default)]
    pub panel_color: Option<String>,
    #[serde(default)]
    pub panel_alpha: Option<f32>,
    #[serde(default)]
    pub chrome_color: Option<String>,
    #[serde(default)]
    pub chrome_alpha: Option<f32>,
    #[serde(default)]
    pub terminal_color: Option<String>,
    #[serde(default)]
    pub terminal_alpha: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperConfig {
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub opacity: Option<f32>,
    #[serde(default)]
    pub position_x: Option<f32>,
    #[serde(default)]
    pub position_y: Option<f32>,
    #[serde(default)]
    pub scale: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_mood_preset")]
    pub mood_preset: String,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub mood_material_overrides: BTreeMap<String, MoodMaterialOverrideConfig>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub wallpaper_settings_by_mood: BTreeMap<String, WallpaperConfig>,
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
                mood_preset: default_mood_preset(),
                ui_font_family: default_ui_font(),
                terminal_font_family: default_terminal_font(),
                font_size: default_font_size(),
                line_height: default_line_height(),
                ligatures: true,
                window_effect: default_window_effect(),
                opacity: default_opacity(),
                mood_material_overrides: BTreeMap::new(),
                wallpaper_settings_by_mood: BTreeMap::new(),
            },
            terminal: TerminalConfig {
                default_shell: default_shell(),
                scrollback: default_scrollback(),
                cursor_style: default_cursor_style(),
                cursor_blink: true,
            },
            window: WindowConfig::default(),
            ghost_diff: GhostDiffConfig::default(),
            workspace_profile: WorkspaceProfileConfig::default(),
        }
    }
}

fn config_path() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home)
        .join(".aether")
        .join("config.toml")
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

fn default_theme() -> String {
    "catppuccin-mocha".to_string()
}
fn default_mood_preset() -> String {
    "aether-sky".to_string()
}
fn default_ui_font() -> String {
    "Geist, Inter, Source Han Sans JP, sans-serif".to_string()
}
fn default_terminal_font() -> String {
    "Cascadia Code, Cascadia Next JP, monospace".to_string()
}
fn default_font_size() -> u32 {
    14
}
fn default_line_height() -> f32 {
    1.4
}
fn default_true() -> bool {
    true
}
fn default_window_effect() -> String {
    "mica".to_string()
}
fn default_opacity() -> f32 {
    0.95
}
fn default_window_width() -> u32 {
    1200
}
fn default_window_height() -> u32 {
    700
}
fn default_shell() -> String {
    "pwsh.exe".to_string()
}
fn default_preferred_model() -> String {
    "claude-sonnet".to_string()
}
fn default_visual_density() -> String {
    "balanced".to_string()
}
fn default_dashboard_port_mode() -> String {
    "workspace-stable".to_string()
}
fn default_dashboard_base_port() -> u16 {
    47820
}
fn default_dashboard_port_span() -> u16 {
    1200
}
fn default_sidebar_width() -> u16 {
    240
}
fn default_right_panel_width() -> u16 {
    320
}
fn default_right_rail_mode() -> String {
    "command".to_string()
}
fn default_context_pack_max_files() -> u16 {
    40
}
fn default_context_pack_max_tokens() -> u32 {
    120_000
}
fn default_thread_status() -> String {
    "idle".to_string()
}
fn default_scrollback() -> u32 {
    10000
}
fn default_cursor_style() -> String {
    "bar".to_string()
}

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
        assert_eq!(cfg.appearance.mood_preset, "aether-sky");
    }

    #[test]
    fn appearance_mood_preset_round_trips() {
        let mut cfg = AppConfig::default();
        cfg.appearance.theme = "sakura-hub".to_string();
        cfg.appearance.mood_preset = "aether-sakura".to_string();
        let serialized = toml::to_string(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&serialized).expect("deserialize");
        assert_eq!(back.appearance.theme, "sakura-hub");
        assert_eq!(back.appearance.mood_preset, "aether-sakura");
    }

    #[test]
    fn appearance_material_and_wallpaper_customization_round_trips() {
        let mut cfg = AppConfig::default();
        cfg.appearance.mood_material_overrides.insert(
            "aether-sakura".to_string(),
            MoodMaterialOverrideConfig {
                backdrop_color: Some("#fff7fb".to_string()),
                backdrop_alpha: Some(0.08),
                panel_color: Some("#fff2f7".to_string()),
                panel_alpha: Some(0.94),
                chrome_color: Some("#ffe4ee".to_string()),
                chrome_alpha: Some(0.96),
                terminal_color: Some("#6b2140".to_string()),
                terminal_alpha: Some(0.58),
            },
        );
        cfg.appearance.wallpaper_settings_by_mood.insert(
            "aether-sakura".to_string(),
            WallpaperConfig {
                image_path: Some("C:\\Images\\sakura.jpg".to_string()),
                opacity: Some(0.24),
                position_x: Some(42.0),
                position_y: Some(58.0),
                scale: Some(135.0),
            },
        );

        let serialized = toml::to_string(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&serialized).expect("deserialize");
        let material = back
            .appearance
            .mood_material_overrides
            .get("aether-sakura")
            .expect("material overrides");
        let wallpaper = back
            .appearance
            .wallpaper_settings_by_mood
            .get("aether-sakura")
            .expect("wallpaper settings");

        assert_eq!(material.panel_color.as_deref(), Some("#fff2f7"));
        assert_eq!(material.terminal_alpha, Some(0.58));
        assert_eq!(wallpaper.image_path.as_deref(), Some("C:\\Images\\sakura.jpg"));
        assert_eq!(wallpaper.scale, Some(135.0));
    }

    #[test]
    fn ghost_diff_live_mode_round_trips() {
        let mut cfg = AppConfig::default();
        cfg.ghost_diff.live_mode = true;
        let serialized = toml::to_string(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&serialized).expect("deserialize");
        assert!(back.ghost_diff.live_mode);
    }

    #[test]
    fn workspace_profile_defaults_cover_scoped_policies() {
        let cfg = AppConfig::default();
        let profile = cfg.workspace_profile.global_defaults;

        assert_eq!(profile.default_shell, "pwsh.exe");
        assert_eq!(profile.preferred_model, "claude-sonnet");
        assert_eq!(profile.dashboard_port_policy.mode, "workspace-stable");
        assert_eq!(profile.dashboard_port_policy.base_port, 47820);
        assert!(profile.notification_policy.true_decision_only);
        assert_eq!(profile.visual_density, "balanced");
        assert_eq!(profile.pane_layout.right_rail_mode, "command");
        assert!(profile.command_risk_policy.block_unsafe_paths);
        assert!(profile.context_pack_policy.redact_secrets);
    }

    #[test]
    fn workspace_profile_override_and_thread_state_round_trip() {
        let mut cfg = AppConfig::default();
        cfg.workspace_profile.workspace_overrides.insert(
            "c:/repo/aether".to_string(),
            WorkspaceProfileOverrideConfig {
                preferred_model: Some("gpt-5.2".to_string()),
                safe_paths: Some(vec!["C:/repo/aether/scripts".to_string()]),
                dashboard_port_policy: Some(DashboardPortPolicyConfig {
                    mode: "explicit".to_string(),
                    base_port: 47820,
                    span: 1200,
                    explicit_port: Some(49231),
                }),
                ..Default::default()
            },
        );
        cfg.workspace_profile.thread_run_state.insert(
            "c:/repo/aether".to_string(),
            std::collections::BTreeMap::from([(
                "thread-a".to_string(),
                ThreadRunStateConfig {
                    thread_id: "thread-a".to_string(),
                    status: "active".to_string(),
                    active_pane_id: Some("pane-1".to_string()),
                    active_roadmap_id: Some("P2-03".to_string()),
                    last_validation_id: None,
                    last_active_at: Some("2026-05-05T00:00:00Z".to_string()),
                },
            )]),
        );

        let serialized = toml::to_string(&cfg).expect("serialize");
        let back: AppConfig = toml::from_str(&serialized).expect("deserialize");
        let override_cfg = back
            .workspace_profile
            .workspace_overrides
            .get("c:/repo/aether")
            .expect("workspace override");
        assert_eq!(override_cfg.preferred_model.as_deref(), Some("gpt-5.2"));
        assert_eq!(
            override_cfg
                .dashboard_port_policy
                .as_ref()
                .and_then(|policy| policy.explicit_port),
            Some(49231),
        );
        assert_eq!(
            back.workspace_profile.thread_run_state["c:/repo/aether"]["thread-a"]
                .active_roadmap_id
                .as_deref(),
            Some("P2-03"),
        );
    }
}
