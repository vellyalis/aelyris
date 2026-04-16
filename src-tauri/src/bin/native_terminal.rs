//! Aether Terminal — Native Rust GPU renderer (no WebView2).
//!
//! Standalone terminal using winit + wgpu with custom UI chrome.
//!
//! Usage: cargo run --bin native-terminal

use winit::event_loop::EventLoop;
use aether_terminal_lib::native::NativeTerminal;

fn main() {
    env_logger::init();
    let event_loop = EventLoop::new().expect("Failed to create event loop");
    let mut app = NativeTerminal::new();
    event_loop.run_app(&mut app).expect("Event loop error");
}
