//! Phase 3D-1: integration tests for the external PTY API.
//!
//! These spin up a real `axum::serve` on an OS-assigned port and hit it with
//! `reqwest`. The session-creating tests require Windows (they spawn `cmd`
//! via ConPTY) and are gated on `target_os`.

use aelyris_lib::api::{self, ApiState, AuthConfig, WS_MAX_INPUT_FRAME_BYTES};
use aelyris_lib::mux::store::FileMuxSnapshotStore;
use aelyris_lib::pty::PtyManager;
use reqwest::header::AUTHORIZATION;
use reqwest::StatusCode;
use serde_json::json;
use std::time::Duration;

/// Spin up a server on an ephemeral port and return (base_url, state, join).
/// Caller signals shutdown by calling `state.trigger_shutdown()` and can
/// `.await` the returned join handle to verify the server exited cleanly.
async fn spawn_server(auth: AuthConfig) -> (String, ApiState, tokio::task::JoinHandle<()>) {
    let state = ApiState::new(PtyManager::new(), auth);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind 127.0.0.1:0");
    let addr = listener.local_addr().expect("local_addr");
    let serve_state = state.clone();
    let join = tokio::spawn(async move {
        let _ = api::serve_on_listener(serve_state, listener).await;
    });
    // One executor yield so `axum::serve` enters its accept loop before we
    // hand the URL back. `reqwest` retries TCP connects internally, so the
    // worst case here is a single retry on the first request.
    tokio::task::yield_now().await;
    (format!("http://{}", addr), state, join)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}

async fn shutdown_server(state: &ApiState, join: tokio::task::JoinHandle<()>) {
    state.pty.close_all();
    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

fn collect_layout_pane_ids(node: &serde_json::Value, ids: &mut Vec<String>) {
    if let Some(id) = node
        .get("paneId")
        .or_else(|| node.get("pane_id"))
        .and_then(|value| value.as_str())
    {
        ids.push(id.to_string());
        return;
    }
    match node["kind"].as_str() {
        Some("pane") => {
            if let Some(id) = node["paneId"].as_str().or_else(|| node["pane_id"].as_str()) {
                ids.push(id.to_string());
            }
        }
        Some("split") => {
            collect_layout_pane_ids(&node["first"], ids);
            collect_layout_pane_ids(&node["second"], ids);
        }
        _ => {}
    }
}

// ─── Governance (E1: choke point covers REST, not just MCP) ──────────────────

#[tokio::test]
async fn governance_denies_a_rest_route_with_403() {
    use aelyris_lib::governance::{AccessControl, AccessDecision, Governance};
    use std::sync::Arc;

    struct DenyAll;
    impl AccessControl for DenyAll {
        fn authorize(&self, _actor: &str, _verb: &str) -> AccessDecision {
            AccessDecision::Deny("blocked".to_string())
        }
    }

    // A server whose governance denies every capability.
    let state = ApiState::new(PtyManager::new(), AuthConfig::with_token("s3cret"))
        .with_governance(Arc::new(Governance::with_access(Box::new(DenyAll))));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let serve_state = state.clone();
    let join = tokio::spawn(async move {
        let _ = api::serve_on_listener(serve_state, listener).await;
    });
    tokio::task::yield_now().await;
    let base = format!("http://{addr}");

    // An AUTHENTICATED request to a REST route is blocked at the governance layer
    // (403, not 401) — E1 gates REST/WS/mux, not just the MCP verb surface.
    let resp = client()
        .get(format!("{base}/sessions"))
        .header(AUTHORIZATION, "Bearer s3cret")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    shutdown_server(&state, join).await;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn missing_bearer_returns_401() {
    let (base, state, join) = spawn_server(AuthConfig::with_token("s3cret")).await;

    let res = client()
        .get(format!("{}/sessions", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn wrong_bearer_returns_401() {
    let (base, state, join) = spawn_server(AuthConfig::with_token("s3cret")).await;

    let res = client()
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, "Bearer wrong")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn right_bearer_allows_list() {
    let (base, state, join) = spawn_server(AuthConfig::with_token("s3cret")).await;

    let res = client()
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, "Bearer s3cret")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body.as_array().unwrap().is_empty());

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn daemon_contract_exposes_versioned_capabilities() {
    let temp = tempfile::tempdir().unwrap();
    let pty = PtyManager::new().with_scrollback_dir(temp.path().join("scrollback"));
    let state = ApiState::new(pty, AuthConfig::disabled())
        .with_max_sessions(7)
        .with_mux_snapshot_dir(temp.path().join("mux"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let join = tokio::spawn({
        let st = state.clone();
        async move {
            let _ = api::serve_on_listener(st, listener).await;
        }
    });
    tokio::task::yield_now().await;

    let body: serde_json::Value = client()
        .get(format!("{}/daemon/contract", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["processKind"], "embedded-api");
    assert_eq!(body["contractSchemaVersion"], 1);
    assert_eq!(body["protocolVersion"], api::DAEMON_PROTOCOL_VERSION);
    assert_eq!(
        body["muxGraphVersion"],
        aelyris_lib::mux::graph::MUX_GRAPH_VERSION
    );
    assert_eq!(body["transport"], "loopback-http-websocket");
    assert_eq!(body["authPolicy"], "bearer-token-or-disabled-test-mode");
    assert_eq!(
        body["clientDetachPolicy"],
        "detach-keeps-live-pty-while-daemon-running"
    );
    assert_eq!(
        body["restartRestorePolicy"],
        "snapshot-restores-graph-as-restore-pending-with-durable-scrollback"
    );
    assert_eq!(
        body["attachPolicy"],
        "reattach-respawns-only-missing-or-restore-pending-pty-bindings"
    );
    assert_eq!(
        body["liveProcessPreservationPolicy"],
        "daemon-live-detach-reattach-preserves-existing-pty-process-id"
    );
    assert_eq!(
        body["shutdownPolicy"],
        "explicit-workspace-close-terminates-owned-child-ptys"
    );
    assert_eq!(body["maxSessions"], 7);
    assert_eq!(body["activeSessions"], 0);
    assert_eq!(body["muxSnapshotEnabled"], true);
    assert_eq!(body["durableScrollbackEnabled"], true);
    assert_eq!(
        body["terminalCorePolicy"]["nativeInputOwner"],
        "rust-native-input-host"
    );
    assert_eq!(
        body["terminalCorePolicy"]["rendererTruthSource"],
        "rust-term-engine-render-pipeline"
    );
    assert_eq!(
        body["terminalCorePolicy"]["renderFrameSchema"],
        "aelyris.native.render-frame.v1"
    );
    assert_eq!(
        body["terminalCorePolicy"]["renderDiffSchema"],
        "aelyris.native.render-diff.v1"
    );
    assert_eq!(
        body["terminalCorePolicy"]["renderCommitSchema"],
        "aelyris.native.render-commit.v1"
    );
    assert_eq!(
        body["terminalCorePolicy"]["renderPipelineBoundary"],
        "rust-native-render-pipeline"
    );
    assert_eq!(
        body["terminalCorePolicy"]["webviewTerminalRendererPolicy"],
        "fallback-contained-not-source-of-truth"
    );
    assert_eq!(
        body["terminalCorePolicy"]["reactTerminalRendererPolicy"],
        "control-plane-only-not-terminal-core"
    );
    assert_eq!(body["terminalCorePolicy"]["muxTruthSource"], "daemon-api");
    assert_eq!(
        body["terminalCorePolicy"]["fallbackVisibilityPolicy"],
        "release-blocking-telemetry"
    );
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "command-session"));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "mux-pane-control"));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "mux-layout-rotate"));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "mux-pane-break-join"));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "mux-synchronized-panes"));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "terminal-core-policy"));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "native-render-pipeline-contract"));
    assert!(body["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "mux-live-process-preservation"));

    let health: serde_json::Value = client()
        .get(format!("{}/health", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["protocol_version"], api::DAEMON_PROTOCOL_VERSION);
    assert!(!health["version"].as_str().unwrap().is_empty());

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn command_session_rejects_path_like_programs() {
    let (base, state, join) = spawn_server(AuthConfig::with_token("command-secret")).await;

    let res = client()
        .post(format!("{}/commands", base))
        .header(AUTHORIZATION, format!("Bearer {}", "command-secret"))
        .json(&json!({
            "program": "C:\\\\Windows\\\\System32\\\\cmd.exe",
            "args": ["/C", "echo should-not-run"],
            "cols": 80,
            "rows": 24
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["code"], "bad_request");

    shutdown_server(&state, join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn ws_requires_stream_ticket_and_rejects_query_token() {
    use tokio_tungstenite::tungstenite::Message;

    let (base, state, join) = spawn_server(AuthConfig::with_token("ws-secret")).await;
    let c = client();

    // Create a session so we have something to stream from.
    let create_res = c
        .post(format!("{}/sessions", base))
        .header(AUTHORIZATION, "Bearer ws-secret")
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap();
    let id = create_res.json::<serde_json::Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Build ws:// URL from the http:// base.
    let ws_base = base.replace("http://", "ws://");

    // Without ticket: handshake must fail.
    let bad_url = format!("{}/sessions/{}/stream", ws_base, id);
    let bad = tokio_tungstenite::connect_async(&bad_url).await;
    assert!(bad.is_err(), "WS without ticket should be rejected");

    // Long-lived tokens in query strings must be rejected even when correct.
    let wrong_url = format!("{}/sessions/{}/stream?token=wrong", ws_base, id);
    let wrong = tokio_tungstenite::connect_async(&wrong_url).await;
    assert!(
        wrong.is_err(),
        "WS with wrong query token should be rejected"
    );

    let leaked_url = format!("{}/sessions/{}/stream?token=ws-secret", ws_base, id);
    let leaked = tokio_tungstenite::connect_async(&leaked_url).await;
    assert!(
        leaked.is_err(),
        "WS with correct query token should be rejected"
    );

    let ticket: String = c
        .post(format!("{}/sessions/{}/stream-ticket", base, id))
        .header(AUTHORIZATION, "Bearer ws-secret")
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()["ticket"]
        .as_str()
        .unwrap()
        .to_string();
    let good_url = format!("{}/sessions/{}/stream?ticket={}", ws_base, id, ticket);
    let (mut ws, _resp) = tokio_tungstenite::connect_async(&good_url)
        .await
        .expect("WS should connect with valid stream ticket");

    // Exchange a message to confirm the socket is actually usable.
    use futures_util::SinkExt;
    ws.send(Message::Text("\r\n".into())).await.ok();

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn non_bearer_auth_header_rejected() {
    let (base, state, join) = spawn_server(AuthConfig::with_token("s3cret")).await;

    let res = client()
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, "Basic s3cret")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    shutdown_server(&state, join).await;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn unknown_session_delete_returns_404() {
    let (base, state, join) = spawn_server(AuthConfig::disabled()).await;

    let res = client()
        .delete(format!("{}/sessions/does-not-exist", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["code"], "not_found");

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn resize_zero_cols_returns_400() {
    let (base, state, join) = spawn_server(AuthConfig::disabled()).await;

    let res = client()
        .post(format!("{}/sessions/any-id/resize", base))
        .json(&json!({"cols": 0, "rows": 24}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn input_unknown_session_returns_404() {
    let (base, state, join) = spawn_server(AuthConfig::disabled()).await;

    let res = client()
        .post(format!("{}/sessions/does-not-exist/input", base))
        .json(&json!({"text": "echo hello\r"}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["code"], "not_found");

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn input_oversized_frame_returns_400_before_session_lookup() {
    let (base, state, join) = spawn_server(AuthConfig::disabled()).await;

    let res = client()
        .post(format!("{}/sessions/does-not-exist/input", base))
        .json(&json!({"text": "x".repeat(WS_MAX_INPUT_FRAME_BYTES + 1)}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["code"], "bad_request");

    shutdown_server(&state, join).await;
}

#[tokio::test]
async fn unknown_shell_returns_400() {
    let (base, state, join) = spawn_server(AuthConfig::disabled()).await;

    let res = client()
        .post(format!("{}/sessions", base))
        .json(&json!({"shell": "fish"}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["code"], "bad_request");

    shutdown_server(&state, join).await;
}

// ─── Session CRUD (Windows only — spawns real ConPTY) ───────────────────────

#[cfg(target_os = "windows")]
#[tokio::test]
async fn create_list_resize_delete_roundtrip() {
    let (base, state, join) = spawn_server(AuthConfig::disabled()).await;
    let c = client();

    // Create a `cmd` session — cheapest shell to spawn on Windows.
    let create_res = c
        .post(format!("{}/sessions", base))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::OK);
    let create_body: serde_json::Value = create_res.json().await.unwrap();
    let id = create_body["id"].as_str().unwrap().to_string();
    {
        let mux = state.mux.lock().unwrap();
        assert!(mux.graph(&id).is_some(), "API create should sync mux graph");
    }
    let mux_list: serde_json::Value = c
        .get(format!("{}/mux/workspaces", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(mux_list.as_array().unwrap().len(), 1);
    assert_eq!(mux_list[0]["id"], id);
    assert_eq!(mux_list[0]["windowCount"], 1);
    assert_eq!(mux_list[0]["tabCount"], 1);
    assert_eq!(mux_list[0]["paneCount"], 1);

    let mux_graph: serde_json::Value = c
        .get(format!("{}/mux/workspaces/{}", base, id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(mux_graph["activeWorkspaceId"], id);

    // List shows it.
    let list_res = c.get(format!("{}/sessions", base)).send().await.unwrap();
    let list_body: serde_json::Value = list_res.json().await.unwrap();
    let ids: Vec<&str> = list_body
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap())
        .collect();
    assert!(
        ids.contains(&id.as_str()),
        "created id {} not in list {:?}",
        id,
        ids
    );

    // Resize works.
    let resize_res = c
        .post(format!("{}/sessions/{}/resize", base, id))
        .json(&json!({"cols": 120, "rows": 40}))
        .send()
        .await
        .unwrap();
    assert_eq!(resize_res.status(), StatusCode::NO_CONTENT);
    {
        let mux = state.mux.lock().unwrap();
        let graph = mux.graph(&id).unwrap();
        let pane = graph
            .workspaces
            .get(&id)
            .unwrap()
            .windows
            .get(&format!("{}:window", id))
            .unwrap()
            .tabs
            .get(&format!("{}:tab", id))
            .unwrap()
            .panes
            .get(&id)
            .unwrap();
        assert_eq!(pane.pty.as_ref().unwrap().cols, 120);
        assert_eq!(pane.pty.as_ref().unwrap().rows, 40);
    }

    // REST input works without requiring a WebSocket client, which is the
    // control path used by aelys and future daemon attach/detach flows.
    let input_res = c
        .post(format!("{}/sessions/{}/input", base, id))
        .json(&json!({"text": "echo aelyris-rest-input\r"}))
        .send()
        .await
        .unwrap();
    assert_eq!(input_res.status(), StatusCode::NO_CONTENT);
    let mut captured = String::new();
    for _ in 0..80 {
        let capture_res = c
            .get(format!(
                "{}/sessions/{}/capture?lines=50&clean=true",
                base, id
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(capture_res.status(), StatusCode::OK);
        let capture_body: serde_json::Value = capture_res.json().await.unwrap();
        captured = capture_body["text"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        if captured.contains("aelyris-rest-input") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        captured.contains("aelyris-rest-input"),
        "capture did not include REST input echo: {}",
        captured
    );

    // Split/close exercises the mux-owned pane lifecycle and verifies a
    // child PTY can be disposed without tearing down the root workspace.
    let split_close_res = c
        .post(format!("{}/mux/workspaces/{}/panes/split", base, id))
        .json(&json!({
            "targetPaneId": id,
            "axis": "horizontal",
            "shell": "cmd",
            "cols": 80,
            "rows": 24
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(split_close_res.status(), StatusCode::OK);
    let split_close_body: serde_json::Value = split_close_res.json().await.unwrap();
    let close_pane_id = split_close_body["id"].as_str().unwrap().to_string();
    let close_pane_res = c
        .delete(format!(
            "{}/mux/workspaces/{}/panes/{}",
            base, id, close_pane_id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(close_pane_res.status(), StatusCode::NO_CONTENT);

    // Split again and drive tmux-like layout operations over HTTP. This keeps
    // the Rust mux graph, not React state, as the operation owner.
    let split_res = c
        .post(format!("{}/mux/workspaces/{}/panes/split", base, id))
        .json(&json!({
            "targetPaneId": id,
            "axis": "vertical",
            "shell": "cmd",
            "cols": 80,
            "rows": 24
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(split_res.status(), StatusCode::OK);
    let split_body: serde_json::Value = split_res.json().await.unwrap();
    let child_id = split_body["id"].as_str().unwrap().to_string();

    let sync_res = c
        .post(format!("{}/mux/workspaces/{}/panes/synchronize", base, id))
        .json(&json!({"enabled": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(sync_res.status(), StatusCode::OK);
    let sync_body: serde_json::Value = sync_res.json().await.unwrap();
    let workspace = sync_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let tab = window["tabs"].get(active_tab_id).unwrap();
    assert_eq!(tab["synchronizedPanes"], true);

    let sync_input_res = c
        .post(format!("{}/sessions/{}/input", base, id))
        .json(&json!({"text": "echo aelyris-mux-sync\r"}))
        .send()
        .await
        .unwrap();
    assert_eq!(sync_input_res.status(), StatusCode::NO_CONTENT);
    for pane_id in [&id, &child_id] {
        let mut pane_capture = String::new();
        for _ in 0..80 {
            let capture_res = c
                .get(format!(
                    "{}/sessions/{}/capture?lines=80&clean=true",
                    base, pane_id
                ))
                .send()
                .await
                .unwrap();
            assert_eq!(capture_res.status(), StatusCode::OK);
            let capture_body: serde_json::Value = capture_res.json().await.unwrap();
            pane_capture = capture_body["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if pane_capture.contains("aelyris-mux-sync") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(
            pane_capture.contains("aelyris-mux-sync"),
            "mux synchronized input did not reach pane {}: {}",
            pane_id,
            pane_capture
        );
    }

    let sync_off_res = c
        .post(format!("{}/mux/workspaces/{}/panes/synchronize", base, id))
        .json(&json!({"enabled": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(sync_off_res.status(), StatusCode::OK);

    let broadcast_res = c
        .post(format!("{}/mux/workspaces/{}/input", base, id))
        .json(&json!({"text": "echo aelyris-mux-broadcast\r"}))
        .send()
        .await
        .unwrap();
    assert_eq!(broadcast_res.status(), StatusCode::OK);
    let broadcast_body: serde_json::Value = broadcast_res.json().await.unwrap();
    assert_eq!(broadcast_body["targets"], 2);
    assert_eq!(broadcast_body["accepted"], 2);
    for pane_id in [&id, &child_id] {
        let mut pane_capture = String::new();
        for _ in 0..80 {
            let capture_res = c
                .get(format!(
                    "{}/sessions/{}/capture?lines=80&clean=true",
                    base, pane_id
                ))
                .send()
                .await
                .unwrap();
            assert_eq!(capture_res.status(), StatusCode::OK);
            let capture_body: serde_json::Value = capture_res.json().await.unwrap();
            pane_capture = capture_body["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if pane_capture.contains("aelyris-mux-broadcast") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(
            pane_capture.contains("aelyris-mux-broadcast"),
            "mux broadcast did not reach pane {}: {}",
            pane_id,
            pane_capture
        );
    }

    let zoom_res = c
        .post(format!(
            "{}/mux/workspaces/{}/panes/{}/zoom",
            base, id, child_id
        ))
        .json(&json!({"zoomed": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(zoom_res.status(), StatusCode::OK);
    let zoom_body: serde_json::Value = zoom_res.json().await.unwrap();
    let workspace = zoom_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let tab = window["tabs"].get(active_tab_id).unwrap();
    assert_eq!(tab["layout"]["zoomedPaneId"], child_id);

    let unzoom_res = c
        .post(format!(
            "{}/mux/workspaces/{}/panes/{}/zoom",
            base, id, child_id
        ))
        .json(&json!({"zoomed": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(unzoom_res.status(), StatusCode::OK);
    let unzoom_body: serde_json::Value = unzoom_res.json().await.unwrap();
    let workspace = unzoom_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let tab = window["tabs"].get(active_tab_id).unwrap();
    assert_eq!(tab["layout"]["zoomedPaneId"], serde_json::Value::Null);

    let swap_res = c
        .post(format!("{}/mux/workspaces/{}/panes/swap", base, id))
        .json(&json!({"firstPaneId": id, "secondPaneId": child_id}))
        .send()
        .await
        .unwrap();
    assert_eq!(swap_res.status(), StatusCode::OK);

    let move_res = c
        .post(format!("{}/mux/workspaces/{}/panes/move", base, id))
        .json(&json!({
            "sourcePaneId": child_id,
            "targetPaneId": id,
            "axis": "horizontal"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(move_res.status(), StatusCode::OK);

    let even_res = c
        .post(format!("{}/mux/workspaces/{}/layout/even", base, id))
        .json(&json!({"axis": "vertical"}))
        .send()
        .await
        .unwrap();
    assert_eq!(even_res.status(), StatusCode::OK);

    let tiled_res = c
        .post(format!("{}/mux/workspaces/{}/layout/tiled", base, id))
        .send()
        .await
        .unwrap();
    assert_eq!(tiled_res.status(), StatusCode::OK);

    let tiled_body: serde_json::Value = tiled_res.json().await.unwrap();
    let workspace = tiled_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let tab = window["tabs"].get(active_tab_id).unwrap();
    let mut before_rotate_ids = Vec::new();
    collect_layout_pane_ids(&tab["layout"]["root"], &mut before_rotate_ids);

    let rotate_res = c
        .post(format!("{}/mux/workspaces/{}/layout/rotate", base, id))
        .json(&json!({"direction": "next"}))
        .send()
        .await
        .unwrap();
    assert_eq!(rotate_res.status(), StatusCode::OK);
    let rotate_body: serde_json::Value = rotate_res.json().await.unwrap();
    let workspace = rotate_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let tab = window["tabs"].get(active_tab_id).unwrap();
    let mut after_rotate_ids = Vec::new();
    collect_layout_pane_ids(&tab["layout"]["root"], &mut after_rotate_ids);
    let mut before_set = before_rotate_ids.clone();
    let mut after_set = after_rotate_ids.clone();
    before_set.sort();
    after_set.sort();
    assert_eq!(after_set, before_set);
    assert_ne!(after_rotate_ids, before_rotate_ids);

    let break_res = c
        .post(format!(
            "{}/mux/workspaces/{}/panes/{}/break",
            base, id, child_id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(break_res.status(), StatusCode::OK);
    let break_body: serde_json::Value = break_res.json().await.unwrap();
    let workspace = break_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    assert_eq!(window["tabs"].as_object().unwrap().len(), 2);
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let active_tab = window["tabs"].get(active_tab_id).unwrap();
    let mut break_active_ids = Vec::new();
    collect_layout_pane_ids(&active_tab["layout"]["root"], &mut break_active_ids);
    assert_eq!(break_active_ids, vec![child_id.clone()]);

    let join_res = c
        .post(format!("{}/mux/workspaces/{}/panes/join", base, id))
        .json(&json!({
            "sourcePaneId": id,
            "targetPaneId": child_id,
            "axis": "horizontal"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(join_res.status(), StatusCode::OK);
    let join_body: serde_json::Value = join_res.json().await.unwrap();
    let workspace = join_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let active_tab = window["tabs"].get(active_tab_id).unwrap();
    let mut join_active_ids = Vec::new();
    collect_layout_pane_ids(&active_tab["layout"]["root"], &mut join_active_ids);
    let mut joined_set = join_active_ids.clone();
    joined_set.sort();
    assert_eq!(joined_set, {
        let mut expected = vec![id.clone(), child_id.clone()];
        expected.sort();
        expected
    });

    // Detach keeps the mux graph durable while preserving the live ConPTY
    // instances. Attach should therefore be a cheap graph state transition,
    // not a respawn, which is the daemon-side contract tmux-style clients need.
    let detach_res = c
        .post(format!("{}/mux/workspaces/{}/detach", base, id))
        .send()
        .await
        .unwrap();
    assert_eq!(detach_res.status(), StatusCode::OK);
    let detach_body: serde_json::Value = detach_res.json().await.unwrap();
    let workspace = detach_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let tab = window["tabs"].get(active_tab_id).unwrap();
    let panes = tab["panes"].as_object().unwrap();
    let mut detached_process_ids = Vec::new();
    for pane_id in [&id, &child_id] {
        let pane = panes.get(pane_id).unwrap();
        assert_eq!(pane["lifecycle"], "detached");
        assert_eq!(pane["pty"]["terminalId"], pane_id.as_str());
        let process_id = pane["pty"]["processId"]
            .as_u64()
            .unwrap_or_else(|| panic!("detached pane {pane_id} should expose a live process id"));
        detached_process_ids.push((pane_id.clone(), process_id));
    }

    let detached_sessions: serde_json::Value = c
        .get(format!("{}/sessions", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let detached_ids: Vec<&str> = detached_sessions
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value["id"].as_str().unwrap())
        .collect();
    assert!(detached_ids.contains(&id.as_str()));
    assert!(detached_ids.contains(&child_id.as_str()));

    let detached_input_res = c
        .post(format!("{}/sessions/{}/input", base, id))
        .json(&json!({"text": "echo aelyris-detached-live\r"}))
        .send()
        .await
        .unwrap();
    assert_eq!(detached_input_res.status(), StatusCode::NO_CONTENT);
    let mut detached_capture = String::new();
    for _ in 0..80 {
        let capture_res = c
            .get(format!(
                "{}/sessions/{}/capture?lines=80&clean=true",
                base, id
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(capture_res.status(), StatusCode::OK);
        let capture_body: serde_json::Value = capture_res.json().await.unwrap();
        detached_capture = capture_body["text"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        if detached_capture.contains("aelyris-detached-live") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        detached_capture.contains("aelyris-detached-live"),
        "detached live PTY did not keep processing input: {}",
        detached_capture
    );

    let attach_res = c
        .post(format!("{}/mux/workspaces/{}/attach", base, id))
        .send()
        .await
        .unwrap();
    assert_eq!(attach_res.status(), StatusCode::OK);
    let attach_body: serde_json::Value = attach_res.json().await.unwrap();
    let workspace = attach_body["workspaces"].get(&id).unwrap();
    let active_window_id = workspace["activeWindowId"].as_str().unwrap();
    let window = workspace["windows"].get(active_window_id).unwrap();
    let active_tab_id = window["activeTabId"].as_str().unwrap();
    let tab = window["tabs"].get(active_tab_id).unwrap();
    let panes = tab["panes"].as_object().unwrap();
    for pane_id in [&id, &child_id] {
        let pane = panes.get(pane_id).unwrap();
        assert_eq!(pane["lifecycle"], "active");
        assert_eq!(pane["pty"]["terminalId"], pane_id.as_str());
        let attached_process_id = pane["pty"]["processId"]
            .as_u64()
            .unwrap_or_else(|| panic!("attached pane {pane_id} should expose a live process id"));
        let detached_process_id = detached_process_ids
            .iter()
            .find_map(|(id, process_id)| (id == pane_id).then_some(*process_id))
            .expect("detached process id should be recorded");
        assert_eq!(
            attached_process_id, detached_process_id,
            "mux attach must preserve the existing OS process for pane {pane_id}"
        );
    }
    let attached_sessions: serde_json::Value = c
        .get(format!("{}/sessions", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let attached_ids: Vec<&str> = attached_sessions
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value["id"].as_str().unwrap())
        .collect();
    assert!(attached_ids.contains(&id.as_str()));
    assert!(attached_ids.contains(&child_id.as_str()));

    // Delete works.
    let del_res = c
        .delete(format!("{}/sessions/{}", base, id))
        .send()
        .await
        .unwrap();
    assert_eq!(del_res.status(), StatusCode::NO_CONTENT);
    {
        let mux = state.mux.lock().unwrap();
        assert!(
            mux.graph(&id).is_none(),
            "API delete should remove mux graph"
        );
    }
    let mux_after_delete: serde_json::Value = c
        .get(format!("{}/mux/workspaces", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(mux_after_delete.as_array().unwrap().is_empty());

    // List is empty again.
    let list2: serde_json::Value = c
        .get(format!("{}/sessions", base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(list2.as_array().unwrap().is_empty());

    shutdown_server(&state, join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn mux_snapshot_store_persists_and_restores_api_graphs() {
    let temp = tempfile::tempdir().unwrap();
    let store = FileMuxSnapshotStore::new(temp.path());
    let state =
        ApiState::new(PtyManager::new(), AuthConfig::disabled()).with_mux_snapshot_dir(temp.path());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let join = tokio::spawn({
        let st = state.clone();
        async move {
            let _ = api::serve_on_listener(st, listener).await;
        }
    });
    tokio::task::yield_now().await;
    let c = client();

    let create_res = c
        .post(format!("{}/sessions", base))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::OK);
    let id = create_res.json::<serde_json::Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(store.load_all_graphs().unwrap().len(), 1);

    let split_res = c
        .post(format!("{}/mux/workspaces/{}/panes/split", base, id))
        .json(&json!({
            "targetPaneId": id,
            "axis": "horizontal",
            "shell": "cmd"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(split_res.status(), StatusCode::OK);
    let graph = store.load_graph(&id).unwrap();
    let pane_count: usize = graph
        .workspaces
        .values()
        .flat_map(|workspace| workspace.windows.values())
        .flat_map(|window| window.tabs.values())
        .map(|tab| tab.panes.len())
        .sum();
    assert_eq!(pane_count, 2);

    let exported: serde_json::Value = c
        .get(format!("{}/mux/workspaces/{}/export", base, id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(exported["schema"], "aelyris.mux.v1");
    assert_eq!(exported["graph"]["activeWorkspaceId"], id);

    let duplicate_import = c
        .post(format!("{}/mux/workspaces/import", base))
        .json(&exported)
        .send()
        .await
        .unwrap();
    assert_eq!(duplicate_import.status(), StatusCode::CONFLICT);

    let imported: serde_json::Value = c
        .post(format!("{}/mux/workspaces/import?replace=true", base))
        .json(&exported)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(imported["activeWorkspaceId"], id);
    let imported_panes = imported["workspaces"][&id]["windows"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|window| window["tabs"].as_object().unwrap().values())
        .flat_map(|tab| tab["panes"].as_object().unwrap().values())
        .collect::<Vec<_>>();
    assert_eq!(imported_panes.len(), 2);
    assert!(imported_panes.iter().all(|pane| {
        pane["lifecycle"] == "detached"
            && pane["pty"]["terminalId"]
                .as_str()
                .is_some_and(|terminal_id| terminal_id.starts_with("restore-pending:"))
            && pane["pty"]["processId"].is_null()
    }));
    assert!(
        state.pty.list_info().is_empty(),
        "replace import should close stale live PTYs before exposing restore-pending panes"
    );

    let restored_state =
        ApiState::new(PtyManager::new(), AuthConfig::disabled()).with_mux_snapshot_dir(temp.path());
    let restored_graph = restored_state
        .mux
        .lock()
        .unwrap()
        .graph(&id)
        .cloned()
        .unwrap();
    let restored_pane = restored_graph
        .workspaces
        .values()
        .flat_map(|workspace| workspace.windows.values())
        .flat_map(|window| window.tabs.values())
        .flat_map(|tab| tab.panes.values())
        .next()
        .unwrap();
    assert_eq!(
        restored_pane.pty.as_ref().unwrap().terminal_id,
        format!("restore-pending:{}", restored_pane.id)
    );

    let del_res = c
        .delete(format!("{}/sessions/{}", base, id))
        .send()
        .await
        .unwrap();
    assert_eq!(del_res.status(), StatusCode::NO_CONTENT);
    assert!(store.load_all_graphs().unwrap().is_empty());

    shutdown_server(&state, join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn durable_scrollback_survives_session_close() {
    let temp = tempfile::tempdir().unwrap();
    let pty = PtyManager::new().with_scrollback_dir(temp.path());
    let (base, state, join) = {
        let state = ApiState::new(pty, AuthConfig::disabled());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let join = tokio::spawn({
            let st = state.clone();
            async move {
                let _ = api::serve_on_listener(st, listener).await;
            }
        });
        tokio::task::yield_now().await;
        (base, state, join)
    };
    let c = client();

    let create_res = c
        .post(format!("{}/sessions", base))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::OK);
    let id = create_res.json::<serde_json::Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let marker = "aelyris-durable-scrollback";
    let input_res = c
        .post(format!("{}/sessions/{}/input", base, id))
        .json(&json!({"text": format!("echo {marker}\r")}))
        .send()
        .await
        .unwrap();
    assert_eq!(input_res.status(), StatusCode::NO_CONTENT);

    let mut captured = String::new();
    for _ in 0..80 {
        let capture_res = c
            .get(format!(
                "{}/sessions/{}/capture?lines=50&clean=true",
                base, id
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(capture_res.status(), StatusCode::OK);
        captured = capture_res.json::<serde_json::Value>().await.unwrap()["text"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        if captured.contains(marker) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(captured.contains(marker), "live capture missing marker");

    let close_res = c
        .delete(format!("{}/sessions/{}", base, id))
        .send()
        .await
        .unwrap();
    assert_eq!(close_res.status(), StatusCode::NO_CONTENT);

    let durable_res = c
        .get(format!(
            "{}/sessions/{}/capture?lines=50&clean=true",
            base, id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(durable_res.status(), StatusCode::OK);
    let durable = durable_res.json::<serde_json::Value>().await.unwrap()["text"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(durable.contains(marker), "durable capture missing marker");

    shutdown_server(&state, join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn resize_unknown_session_returns_404() {
    let (base, state, join) = spawn_server(AuthConfig::disabled()).await;

    let res = client()
        .post(format!("{}/sessions/nope/resize", base))
        .json(&json!({"cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    shutdown_server(&state, join).await;
}

// ─── Session cap ───────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[tokio::test]
async fn session_cap_returns_400_when_full() {
    // Override the cap to something tiny so the test doesn't spawn 32 PTYs.
    let state = ApiState::new(PtyManager::new(), AuthConfig::disabled()).with_max_sessions(2);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let join = tokio::spawn({
        let st = state.clone();
        async move {
            let _ = api::serve_on_listener(st, listener).await;
        }
    });
    tokio::task::yield_now().await;
    let c = client();

    // Fill the cap.
    for _ in 0..2 {
        let res = c
            .post(format!("{}/sessions", base))
            .json(&json!({"shell": "cmd"}))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    // Third create hits the cap.
    let res = c
        .post(format!("{}/sessions", base))
        .json(&json!({"shell": "cmd"}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["code"], "bad_request");
    assert!(
        body["error"].as_str().unwrap().contains("session limit"),
        "unexpected body: {}",
        body
    );

    shutdown_server(&state, join).await;
}

// ─── Shutdown ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn shutdown_notify_stops_server() {
    let (_base, state, join) = spawn_server(AuthConfig::disabled()).await;
    state.trigger_shutdown();

    // The join handle should complete quickly — axum's graceful shutdown
    // future fires as soon as Notify is signaled.
    let result = tokio::time::timeout(Duration::from_secs(2), join).await;
    assert!(result.is_ok(), "server did not stop after trigger_shutdown");
}
