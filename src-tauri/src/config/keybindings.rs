use serde::Deserialize;
use std::collections::HashMap;

/// Customizable keybindings loaded from `~/.aether/keybindings.toml`.
///
/// Users can override any default binding or add new ones.
/// The TOML format:
/// ```toml
/// [bindings]
/// "ctrl+shift+p" = "command_palette"
/// "f5" = "run_tool_0"
/// ```
#[derive(Debug, Clone, Deserialize)]
pub struct KeybindingsConfig {
    #[serde(default)]
    pub bindings: HashMap<String, String>,
}

fn default_keybindings() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("ctrl+shift+p".into(), "command_palette".into());
    m.insert("ctrl+p".into(), "quick_open".into());
    m.insert("ctrl+b".into(), "toggle_sidebar".into());
    m.insert("ctrl+r".into(), "command_history".into());
    m.insert("ctrl+shift+h".into(), "split_horizontal".into());
    m.insert("ctrl+shift+v".into(), "split_vertical".into());
    m.insert("ctrl+shift+c".into(), "copy".into());
    m.insert("ctrl+v".into(), "paste".into());
    m.insert("ctrl+shift+f".into(), "terminal_search".into());
    m.insert("ctrl+s".into(), "save_file".into());
    m.insert("ctrl+z".into(), "undo".into());
    m.insert("ctrl+shift+z".into(), "redo".into());
    m.insert("ctrl+f".into(), "editor_find".into());
    m.insert("ctrl+h".into(), "editor_replace".into());
    m.insert("alt+tab".into(), "focus_next_pane".into());
    m
}

fn keybindings_path() -> std::path::PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home)
        .join(".aether")
        .join("keybindings.toml")
}

impl KeybindingsConfig {
    /// Load keybindings from `~/.aether/keybindings.toml`.
    ///
    /// User-defined bindings are merged on top of the built-in defaults,
    /// so users only need to specify the bindings they want to override or add.
    pub fn load() -> Self {
        let defaults = default_keybindings();

        let path = keybindings_path();
        let user: Option<KeybindingsConfig> = if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| toml::from_str(&s).ok())
        } else {
            None
        };

        let mut merged = defaults;
        if let Some(user_config) = user {
            for (key, action) in user_config.bindings {
                merged.insert(key, action);
            }
        }

        Self { bindings: merged }
    }

    /// Look up what action a key combo triggers.
    ///
    /// Key combos are normalized to lowercase for matching.
    pub fn action_for(&self, key_combo: &str) -> Option<&str> {
        self.bindings
            .get(&key_combo.to_lowercase())
            .map(|s| s.as_str())
    }

    /// Reverse lookup: find the key combo bound to a given action.
    ///
    /// Useful for displaying shortcut hints in the command palette.
    /// If multiple combos map to the same action, returns an arbitrary one.
    pub fn key_combo_for(&self, action: &str) -> Option<&str> {
        self.bindings
            .iter()
            .find(|(_, v)| v.as_str() == action)
            .map(|(k, _)| k.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_keybindings_command_palette() {
        let config = KeybindingsConfig {
            bindings: default_keybindings(),
        };
        assert_eq!(config.action_for("ctrl+shift+p"), Some("command_palette"));
    }

    #[test]
    fn test_default_keybindings_all_present() {
        let config = KeybindingsConfig {
            bindings: default_keybindings(),
        };
        assert_eq!(config.action_for("ctrl+p"), Some("quick_open"));
        assert_eq!(config.action_for("ctrl+b"), Some("toggle_sidebar"));
        assert_eq!(config.action_for("ctrl+r"), Some("command_history"));
        assert_eq!(config.action_for("ctrl+shift+h"), Some("split_horizontal"));
        assert_eq!(config.action_for("ctrl+shift+v"), Some("split_vertical"));
        assert_eq!(config.action_for("ctrl+shift+c"), Some("copy"));
        assert_eq!(config.action_for("ctrl+v"), Some("paste"));
        assert_eq!(config.action_for("ctrl+shift+f"), Some("terminal_search"));
        assert_eq!(config.action_for("ctrl+s"), Some("save_file"));
        assert_eq!(config.action_for("ctrl+z"), Some("undo"));
        assert_eq!(config.action_for("ctrl+shift+z"), Some("redo"));
        assert_eq!(config.action_for("ctrl+f"), Some("editor_find"));
        assert_eq!(config.action_for("ctrl+h"), Some("editor_replace"));
        assert_eq!(config.action_for("alt+tab"), Some("focus_next_pane"));
    }

    #[test]
    fn test_override_binding() {
        let mut bindings = default_keybindings();
        // User overrides ctrl+b to a custom action
        bindings.insert("ctrl+b".into(), "toggle_panel".into());
        // User adds a new binding
        bindings.insert("f5".into(), "run_tool_0".into());

        let config = KeybindingsConfig { bindings };

        assert_eq!(config.action_for("ctrl+b"), Some("toggle_panel"));
        assert_eq!(config.action_for("f5"), Some("run_tool_0"));
        // Non-overridden bindings remain intact
        assert_eq!(config.action_for("ctrl+shift+p"), Some("command_palette"));
    }

    #[test]
    fn test_unknown_key_returns_none() {
        let config = KeybindingsConfig {
            bindings: default_keybindings(),
        };
        assert_eq!(config.action_for("ctrl+shift+x"), None);
        assert_eq!(config.action_for("f12"), None);
        assert_eq!(config.action_for(""), None);
    }

    #[test]
    fn test_action_for_case_insensitive() {
        let config = KeybindingsConfig {
            bindings: default_keybindings(),
        };
        assert_eq!(config.action_for("Ctrl+Shift+P"), Some("command_palette"));
        assert_eq!(config.action_for("CTRL+B"), Some("toggle_sidebar"));
    }

    #[test]
    fn test_reverse_lookup() {
        let config = KeybindingsConfig {
            bindings: default_keybindings(),
        };
        assert_eq!(
            config.key_combo_for("command_palette"),
            Some("ctrl+shift+p")
        );
        assert_eq!(config.key_combo_for("toggle_sidebar"), Some("ctrl+b"));
        assert_eq!(config.key_combo_for("nonexistent_action"), None);
    }

    #[test]
    fn test_reverse_lookup_with_override() {
        let mut bindings = default_keybindings();
        bindings.insert("ctrl+b".into(), "toggle_panel".into());

        let config = KeybindingsConfig { bindings };

        // Old action should no longer have a binding
        assert_eq!(config.key_combo_for("toggle_sidebar"), None);
        // New action should map to the key
        assert_eq!(config.key_combo_for("toggle_panel"), Some("ctrl+b"));
    }

    #[test]
    fn test_load_falls_back_to_defaults() {
        // When no config file exists, load() should return defaults.
        // We rely on the fact that the test environment likely doesn't have
        // ~/.aether/keybindings.toml (or if it does, we still get at least defaults).
        let config = KeybindingsConfig::load();
        assert_eq!(config.action_for("ctrl+shift+p"), Some("command_palette"));
        assert!(config.bindings.len() >= 15);
    }

    #[test]
    fn test_toml_deserialization() {
        let toml_str = r#"
[bindings]
"ctrl+shift+p" = "command_palette"
"f5" = "run_tool_0"
"ctrl+b" = "custom_toggle"
"#;
        let config: KeybindingsConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.bindings.len(), 3);
        assert_eq!(
            config.bindings.get("ctrl+shift+p").map(|s| s.as_str()),
            Some("command_palette")
        );
        assert_eq!(
            config.bindings.get("f5").map(|s| s.as_str()),
            Some("run_tool_0")
        );
        assert_eq!(
            config.bindings.get("ctrl+b").map(|s| s.as_str()),
            Some("custom_toggle")
        );
    }

    #[test]
    fn test_empty_toml_gives_empty_bindings() {
        let toml_str = "";
        let config: KeybindingsConfig = toml::from_str(toml_str).unwrap();
        assert!(config.bindings.is_empty());
    }
}
