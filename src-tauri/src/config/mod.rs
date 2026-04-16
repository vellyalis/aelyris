mod settings;
pub mod keybindings;

pub use settings::{AppConfig, load_config, save_config};
pub use keybindings::KeybindingsConfig;
