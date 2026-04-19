//! Phase 3D-1: integration tests for the external PTY API.
//!
//! These spin up a real `axum::serve` on an OS-assigned port and hit it with
//! `reqwest`. The session-creating tests require Windows (they spawn `cmd`
//! via ConPTY) and are gated on `target_os`.

use aether_terminal_lib::api::{self, ApiState, AuthConfig, MAX_PTY_SESSIONS};
use aether_terminal_lib::pty::PtyManager;
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

// ─── Auth ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn missing_bearer_returns_401() {
    let (base, state, join) = spawn_server(AuthConfig::with_token("s3cret")).await;

    let res = client().get(format!("{}/sessions", base)).send().await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn ws_query_string_token_fallback() {
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

    // Without token: handshake must fail.
    let bad_url = format!("{}/sessions/{}/stream", ws_base, id);
    let bad = tokio_tungstenite::connect_async(&bad_url).await;
    assert!(bad.is_err(), "WS without token should be rejected");

    // With wrong token: also fail.
    let wrong_url = format!("{}/sessions/{}/stream?token=wrong", ws_base, id);
    let wrong = tokio_tungstenite::connect_async(&wrong_url).await;
    assert!(wrong.is_err(), "WS with wrong token should be rejected");

    // With right token: handshake succeeds.
    let good_url = format!("{}/sessions/{}/stream?token=ws-secret", ws_base, id);
    let (mut ws, _resp) = tokio_tungstenite::connect_async(&good_url)
        .await
        .expect("WS should connect with valid token");

    // Exchange a message to confirm the socket is actually usable.
    use futures_util::SinkExt;
    ws.send(Message::Text("\r\n".into())).await.ok();

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    // Delete works.
    let del_res = c
        .delete(format!("{}/sessions/{}", base, id))
        .send()
        .await
        .unwrap();
    assert_eq!(del_res.status(), StatusCode::NO_CONTENT);

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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

// ─── Session cap ───────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[tokio::test]
async fn session_cap_returns_400_when_full() {
    // Override the cap to something tiny so the test doesn't spawn 32 PTYs.
    let state = ApiState::new(PtyManager::new(), AuthConfig::disabled())
        .with_max_sessions(2);
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

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
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
