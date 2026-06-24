#![cfg_attr(windows, windows_subsystem = "windows")]

use aether_terminal_lib::{api, command_risk, db, logging, pty::PtyManager};

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
    let pty = PtyManager::new().with_env_scrollback_store();
    // P0-4: the sidecar daemon serves the SAME REST/WS/MCP surface as the in-app API, so it
    // MUST carry the command-risk gate too (boundary #1) — otherwise command-carrying writes
    // through the shipped daemon would bypass both the `deny` block and `review` approval. Its
    // own db connection durably audits decisions (WAL-safe); no db fails closed for
    // review-approved writes.
    let command_risk_gate = std::sync::Arc::new(command_risk::gate::CommandRiskGate::new(
        db::Database::open(&db::db_path())
            .ok()
            .map(|d| std::sync::Arc::new(db::ManagedDb::new(d))),
    ));
    let state = api::ApiState::new(pty, api::AuthConfig::from_env())
        .with_process_kind(api::PROCESS_KIND_SIDE_CAR)
        .with_command_risk_gate(Some(command_risk_gate))
        .with_env_mux_store();

    log::info!("aether pty server starting on 127.0.0.1:{port}");
    if let Err(err) = api::serve(state, port).await {
        log::error!("aether pty server failed: {err}");
        std::process::exit(1);
    }
}
