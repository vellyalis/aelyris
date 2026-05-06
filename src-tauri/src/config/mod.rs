pub mod keybindings;
mod settings;

pub use keybindings::KeybindingsConfig;
pub use settings::{load_config, save_config, AppConfig};
