//! Phase 3D-1 v2b: integration tests for the upgrade-ticket WS auth path.
//!
//! Covered:
//! - `POST /sessions/:id/stream-ticket` mints a ticket for an existing session
//! - `POST /sessions/:id/stream-ticket` 404s for a nonexistent session
//! - `POST /sessions/:id/stream-ticket` 401s without a bearer
//! - Ticket redemption succeeds exactly once
//! - Ticket bound to the wrong session is rejected
//! - Long-lived `?token=` query auth is rejected
//!
//! WS-level redemption tests use the same `spawn_server` pattern as
//! `test_api_3d1.rs` and only run on Windows where ConPTY is available for
//! session creation.

use std::sync::Arc;
use std::time::Duration;

use aelyris_lib::api::{
    self, ApiState, AuthConfig, RateLimiter, StreamControl, StreamControllerLeases, StreamMode,
    TicketRegistry, TICKET_TTL_SECS,
};
use aelyris_lib::pty::PtyManager;
use reqwest::header::AUTHORIZATION;
use reqwest::StatusCode;
use serde_json::json;

const TOKEN: &str = "v2b-secret";

async fn spawn(state: ApiState) -> (String, ApiState, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind 127.0.0.1:0");
    let addr = listener.local_addr().expect("local_addr");
    let serve_state = state.clone();
    let join = tokio::spawn(async move {
        let _ = api::serve_on_listener(serve_state, listener).await;
    });
    tokio::task::yield_now().await;
    (format!("http://{}", addr), state, join)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}

fn base_state() -> ApiState {
    ApiState::new(PtyManager::new(), AuthConfig::with_token(TOKEN))
        .with_rate_limiter(Arc::new(RateLimiter::unlimited()))
}

// ─── Registry unit-ish checks ───────────────────────────────────────────────

#[test]
fn registry_issues_unique_tickets() {
    let reg = TicketRegistry::new();
    let (t1, ttl1) = reg.issue("sess-a");
    let (t2, ttl2) = reg.issue("sess-a");
    assert_ne!(t1, t2, "each issue must produce a fresh uuid");
    assert_eq!(ttl1, Duration::from_secs(TICKET_TTL_SECS));
    assert_eq!(ttl2, Duration::from_secs(TICKET_TTL_SECS));
    assert_eq!(reg.live_count(), 2);
}

#[test]
fn registry_redeem_is_single_use() {
    let reg = TicketRegistry::new();
    let (ticket, _) = reg.issue("sess-a");
    assert!(reg.redeem_for_session(&ticket, "sess-a"));
    assert!(
        !reg.redeem_for_session(&ticket, "sess-a"),
        "ticket must not be redeemable twice"
    );
    assert_eq!(reg.live_count(), 0);
}

#[test]
fn registry_redeem_claim_preserves_stream_mode() {
    let reg = TicketRegistry::new();
    let (ticket, _) = reg.issue_with_mode("sess-a", StreamMode::ReadOnly);
    let claim = reg
        .redeem_claim_for_session(&ticket, "sess-a")
        .expect("read-only ticket should redeem once");
    assert_eq!(claim.session_id, "sess-a");
    assert_eq!(claim.mode, StreamMode::ReadOnly);
    assert!(
        reg.redeem_claim_for_session(&ticket, "sess-a").is_none(),
        "claim redemption must remain single-use"
    );
}

#[test]
fn registry_redeem_claim_preserves_exclusive_control() {
    let reg = TicketRegistry::new();
    let (ticket, _) = reg.issue_with_attach(
        "sess-a",
        StreamMode::ReadWrite,
        StreamControl::Exclusive,
        Some("client-a".to_string()),
    );
    let claim = reg
        .redeem_claim_for_session(&ticket, "sess-a")
        .expect("exclusive ticket should redeem once");
    assert_eq!(claim.session_id, "sess-a");
    assert_eq!(claim.mode, StreamMode::ReadWrite);
    assert_eq!(claim.control, StreamControl::Exclusive);
    assert_eq!(claim.client_id.as_deref(), Some("client-a"));
}

#[test]
fn controller_lease_rejects_competing_client_until_release() {
    let leases = StreamControllerLeases::new();
    leases.acquire("sess-a", "client-a").unwrap();
    assert_eq!(leases.owner("sess-a").as_deref(), Some("client-a"));
    assert!(leases
        .ensure_can_control("sess-a", Some("client-a"))
        .is_ok());
    assert!(leases.ensure_can_control("sess-a", None).is_err());
    assert!(leases
        .ensure_can_control("sess-a", Some("client-b"))
        .is_err());
    assert_eq!(
        leases.acquire("sess-a", "client-b").unwrap_err(),
        "client-a"
    );
    assert!(leases.release("sess-a", "client-a"));
    leases.acquire("sess-a", "client-b").unwrap();
    assert_eq!(leases.owner("sess-a").as_deref(), Some("client-b"));
}

#[test]
fn registry_rejects_session_mismatch() {
    let reg = TicketRegistry::new();
    let (ticket, _) = reg.issue("sess-a");
    assert!(
        !reg.redeem_for_session(&ticket, "sess-b"),
        "ticket minted for sess-a must not redeem against sess-b"
    );
    // And the ticket must still be intact for the right session.
    assert!(reg.redeem_for_session(&ticket, "sess-a"));
}

#[test]
fn registry_rejects_unknown_ticket() {
    let reg = TicketRegistry::new();
    reg.issue("sess-a");
    let bogus = aelyris_lib::api::TicketId::from("unknown-ticket".to_string());
    assert!(!reg.redeem_for_session(&bogus, "sess-a"));
}

// ─── HTTP endpoint ──────────────────────────────────────────────────────────

#[tokio::test]
async fn stream_ticket_without_auth_returns_401() {
    let (base, state, join) = spawn(base_state()).await;

    let res = client()
        .post(format!("{}/sessions/abc/stream-ticket", base))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn stream_ticket_for_nonexistent_session_returns_404() {
    let (base, state, join) = spawn(base_state()).await;

    let res = client()
        .post(format!("{}/sessions/nonexistent/stream-ticket", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn stream_ticket_for_existing_session_returns_uuid_and_ttl() {
    let (base, state, join) = spawn(base_state()).await;
    let c = client();

    let create_res = c
        .post(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::OK);
    let id: String = create_res
        .json::<serde_json::Value>()
        .await
        .unwrap()
        .get("id")
        .and_then(|v| v.as_str().map(ToString::to_string))
        .expect("id in response");

    let ticket_res = c
        .post(format!("{}/sessions/{}/stream-ticket", base, id))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(ticket_res.status(), StatusCode::OK);
    let body: serde_json::Value = ticket_res.json().await.unwrap();
    let ticket = body
        .get("ticket")
        .and_then(|v| v.as_str())
        .expect("ticket string");
    // UUIDv4 string length = 36 (8-4-4-4-12).
    assert_eq!(ticket.len(), 36);
    let expires_in_ms = body
        .get("expires_in_ms")
        .and_then(|v| v.as_u64())
        .expect("expires_in_ms number");
    assert_eq!(expires_in_ms, TICKET_TTL_SECS * 1000);
    assert_eq!(
        body.get("mode").and_then(|v| v.as_str()),
        Some("read-write")
    );
    assert_eq!(body.get("control").and_then(|v| v.as_str()), Some("shared"));
    assert_eq!(body.get("writable").and_then(|v| v.as_bool()), Some(true));

    // Cleanup — close the session so the PtyManager Drop path doesn't have
    // to leak on shutdown.
    let _ = c
        .delete(format!("{}/sessions/{}", base, id))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await;

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn read_only_stream_ticket_reports_non_writable_mode() {
    let (base, state, join) = spawn(base_state()).await;
    let c = client();

    let id: String = c
        .post(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()
        .get("id")
        .and_then(|v| v.as_str().map(ToString::to_string))
        .unwrap();

    let ticket_res = c
        .post(format!(
            "{}/sessions/{}/stream-ticket?mode=read-only",
            base, id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(ticket_res.status(), StatusCode::OK);
    let body: serde_json::Value = ticket_res.json().await.unwrap();
    assert_eq!(body.get("mode").and_then(|v| v.as_str()), Some("read-only"));
    assert_eq!(body.get("control").and_then(|v| v.as_str()), Some("shared"));
    assert_eq!(body.get("writable").and_then(|v| v.as_bool()), Some(false));

    let _ = c
        .delete(format!("{}/sessions/{}", base, id))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await;

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn exclusive_stream_ticket_returns_controller_client_id() {
    let (base, state, join) = spawn(base_state()).await;
    let c = client();

    let id: String = c
        .post(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()
        .get("id")
        .and_then(|v| v.as_str().map(ToString::to_string))
        .unwrap();

    let ticket_res = c
        .post(format!(
            "{}/sessions/{}/stream-ticket?control=exclusive",
            base, id
        ))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(ticket_res.status(), StatusCode::OK);
    let body: serde_json::Value = ticket_res.json().await.unwrap();
    assert_eq!(
        body.get("mode").and_then(|v| v.as_str()),
        Some("read-write")
    );
    assert_eq!(
        body.get("control").and_then(|v| v.as_str()),
        Some("exclusive")
    );
    let client_id = body
        .get("clientId")
        .and_then(|v| v.as_str())
        .expect("exclusive ticket response includes controller clientId");
    assert!(client_id.starts_with("client-"));

    let _ = c
        .delete(format!("{}/sessions/{}", base, id))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await;

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

// ─── WS redemption via ticket ───────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[tokio::test]
async fn ws_accepts_ticket_query_param() {
    use futures_util::SinkExt;
    use tokio_tungstenite::tungstenite::Message;

    let (base, state, join) = spawn(base_state()).await;
    let c = client();

    // Create session.
    let id: String = c
        .post(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()
        .get("id")
        .and_then(|v| v.as_str().map(ToString::to_string))
        .unwrap();

    // Mint a ticket.
    let ticket: String = c
        .post(format!("{}/sessions/{}/stream-ticket", base, id))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()
        .get("ticket")
        .and_then(|v| v.as_str().map(ToString::to_string))
        .unwrap();

    // WS connect using the ticket (no Authorization header).
    let ws_url = base.replacen("http://", "ws://", 1);
    let url = format!("{}/sessions/{}/stream?ticket={}", ws_url, id, ticket);
    let (mut ws, _resp) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("ws connect with ticket");
    // Hidden ConPTY startup is intentionally quiet on some Windows shells, so
    // prove the authenticated socket is usable by writing to the PTY instead
    // of depending on a startup banner.
    ws.send(Message::Text("\r\n".into()))
        .await
        .expect("ws write with ticket");

    // Redeeming the same ticket again must fail.
    let url2 = format!("{}/sessions/{}/stream?ticket={}", ws_url, id, ticket);
    let second = tokio_tungstenite::connect_async(&url2).await;
    assert!(
        second.is_err(),
        "second redemption of the same ticket must fail"
    );

    // Cleanup.
    let _ = c
        .delete(format!("{}/sessions/{}", base, id))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await;

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[cfg(target_os = "windows")]
#[tokio::test]
async fn ws_rejects_legacy_token_query_param() {
    let (base, state, join) = spawn(base_state()).await;
    let c = client();

    let id: String = c
        .post(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .json(&json!({"shell": "cmd", "cols": 80, "rows": 24}))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap()
        .get("id")
        .and_then(|v| v.as_str().map(ToString::to_string))
        .unwrap();

    let ws_url = base.replacen("http://", "ws://", 1);
    let url = format!("{}/sessions/{}/stream?token={}", ws_url, id, TOKEN);
    let connect_res = tokio_tungstenite::connect_async(&url).await;
    assert!(connect_res.is_err(), "legacy ?token= must not authenticate");

    let _ = c
        .delete(format!("{}/sessions/{}", base, id))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await;

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn ws_rejects_unknown_ticket() {
    let (base, state, join) = spawn(base_state()).await;

    let ws_url = base.replacen("http://", "ws://", 1);
    let url = format!(
        "{}/sessions/any/stream?ticket=00000000-0000-0000-0000-000000000000",
        ws_url
    );
    let connect_res = tokio_tungstenite::connect_async(&url).await;
    assert!(connect_res.is_err(), "unknown ticket must not authenticate");

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn ticket_bound_to_different_session_is_rejected_on_ws() {
    // Even if the ticket exists in the registry, redemption must fail when
    // the path session_id doesn't match what the ticket was minted for.
    let reg = Arc::new(TicketRegistry::new());
    let (ticket, _) = reg.issue("sess-a");
    let state = ApiState::new(PtyManager::new(), AuthConfig::with_token(TOKEN))
        .with_rate_limiter(Arc::new(RateLimiter::unlimited()))
        .with_tickets(reg);
    let (base, state, join) = spawn(state).await;

    let ws_url = base.replacen("http://", "ws://", 1);
    let url = format!(
        "{}/sessions/sess-b/stream?ticket={}",
        ws_url,
        ticket.as_str()
    );
    let connect_res = tokio_tungstenite::connect_async(&url).await;
    assert!(
        connect_res.is_err(),
        "ticket minted for sess-a must not unlock sess-b"
    );

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}
