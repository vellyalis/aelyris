#![cfg_attr(windows, windows_subsystem = "windows")]

use aether_terminal_lib::{api, logging, pty::PtyManager};

fn parse_port() -> u16 {
    std::env::var("AETHER_PTY_SERVER_PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(api::DEFAULT_PORT)
}

#[tokio::main]
async fn main() {
    let _log_ring = logging::init();
    let port = parse_port();
    let pty = PtyManager::new();
    let state =
        api::ApiState::new(pty, api::AuthConfig::from_env()).with_process_kind(api::PROCESS_KIND_SIDE_CAR);

    log::info!("aether pty server starting on 127.0.0.1:{port}");
    if let Err(err) = api::serve(state, port).await {
        log::error!("aether pty server failed: {err}");
        std::process::exit(1);
    }
}
