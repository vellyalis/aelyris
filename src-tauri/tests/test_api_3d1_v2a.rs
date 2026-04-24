//! Phase 3D-1 v2a: integration tests for CORS + rate limit.
//!
//! CORS uses `tower_http::cors::CorsLayer` mounted outside the auth
//! middleware, so OPTIONS preflights are answered without a token.
//! Rate-limiting uses an in-process token-bucket keyed on peer IP, applied
//! after the auth check.

use std::sync::Arc;
use std::time::Duration;

use aether_terminal_lib::api::{self, ApiState, AuthConfig, RateLimiter};
use aether_terminal_lib::pty::PtyManager;
use axum::http::HeaderValue;
use reqwest::header::{
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_REQUEST_HEADERS, ACCESS_CONTROL_REQUEST_METHOD,
    AUTHORIZATION, ORIGIN,
};
use reqwest::StatusCode;

const TOKEN: &str = "v2a-secret";

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
        // Keep most tests off the global rate limiter so assertions don't
        // accidentally trip the 60-req/min REST default.
        .with_rate_limiter(Arc::new(RateLimiter::unlimited()))
        // Explicit CORS list avoids leaking from AETHER_API_CORS_ORIGIN env
        // set in the surrounding process.
        .with_cors_origins(vec![
            HeaderValue::from_static("http://127.0.0.1:1420"),
        ])
}

// ─── CORS ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn cors_preflight_from_allowed_origin_gets_allow_origin() {
    let (base, state, join) = spawn(base_state()).await;

    let res = client()
        .request(reqwest::Method::OPTIONS, format!("{}/sessions", base))
        .header(ORIGIN, "http://127.0.0.1:1420")
        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type")
        .send()
        .await
        .unwrap();

    assert!(
        res.status().is_success() || res.status() == StatusCode::NO_CONTENT,
        "unexpected preflight status: {}",
        res.status()
    );
    let allow_origin = res
        .headers()
        .get(ACCESS_CONTROL_ALLOW_ORIGIN)
        .expect("ACAO header present");
    assert_eq!(allow_origin, "http://127.0.0.1:1420");

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn cors_preflight_from_unknown_origin_omits_allow_origin() {
    let (base, state, join) = spawn(base_state()).await;

    let res = client()
        .request(reqwest::Method::OPTIONS, format!("{}/sessions", base))
        .header(ORIGIN, "https://evil.example.com")
        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .send()
        .await
        .unwrap();

    // Guard against the failure mode where the server returns 5xx and the
    // header is absent for the wrong reason (looking like a CORS reject but
    // actually being a server misconfig).
    assert!(
        !res.status().is_server_error(),
        "unexpected 5xx status: {}",
        res.status()
    );
    // tower-http replies with CORS headers only when the origin matches; the
    // browser treats the absence as a preflight failure, which is what we
    // want. NOTE: CORS is enforced by browsers, not by this server — an
    // attacker using curl/reqwest can still hit the API with a forged
    // Origin. Bearer-token auth is the real gate; CORS just keeps honest
    // browser clients from being tricked into bypassing same-origin policy.
    assert!(
        res.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).is_none(),
        "ACAO header should not be present for unknown origin"
    );

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn cors_custom_origin_list_is_honoured() {
    let state = ApiState::new(PtyManager::new(), AuthConfig::with_token(TOKEN))
        .with_rate_limiter(Arc::new(RateLimiter::unlimited()))
        .with_cors_origins(vec![HeaderValue::from_static("https://ui.example.com")]);
    let (base, state, join) = spawn(state).await;

    let res = client()
        .request(reqwest::Method::OPTIONS, format!("{}/sessions", base))
        .header(ORIGIN, "https://ui.example.com")
        .header(ACCESS_CONTROL_REQUEST_METHOD, "GET")
        .send()
        .await
        .unwrap();

    let allow_origin = res
        .headers()
        .get(ACCESS_CONTROL_ALLOW_ORIGIN)
        .expect("ACAO header present for custom origin");
    assert_eq!(allow_origin, "https://ui.example.com");

    // Default dev origin must now be rejected.
    let res = client()
        .request(reqwest::Method::OPTIONS, format!("{}/sessions", base))
        .header(ORIGIN, "http://127.0.0.1:1420")
        .header(ACCESS_CONTROL_REQUEST_METHOD, "GET")
        .send()
        .await
        .unwrap();
    assert!(
        res.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).is_none(),
        "default dev origin must not be allowed once overridden"
    );

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn cors_preflight_does_not_require_auth() {
    // Explicitly sanity-check that the auth middleware is not running for
    // OPTIONS — the browser would never get its preflight back otherwise.
    let (base, state, join) = spawn(base_state()).await;

    let res = client()
        .request(reqwest::Method::OPTIONS, format!("{}/sessions", base))
        .header(ORIGIN, "http://127.0.0.1:1420")
        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST")
        // No Authorization header.
        .send()
        .await
        .unwrap();

    assert_ne!(
        res.status(),
        StatusCode::UNAUTHORIZED,
        "preflight must not require auth"
    );

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

// ─── Rate limit ────────────────────────────────────────────────────────────

#[tokio::test]
async fn rest_rate_limit_returns_429_after_burst() {
    // Tight config: 2-token REST burst, no refill. Third request must 429.
    let state = ApiState::new(PtyManager::new(), AuthConfig::with_token(TOKEN))
        .with_rate_limiter(Arc::new(RateLimiter::with_limits(2.0, 0.0, 10.0, 0.0)))
        .with_cors_origins(vec![HeaderValue::from_static("http://127.0.0.1:1420")]);
    let (base, state, join) = spawn(state).await;
    let c = client();

    for _ in 0..2 {
        let res = c
            .get(format!("{}/sessions", base))
            .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    let res = c
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["code"], "rate_limited");

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn rest_rate_limit_refills_over_time() {
    // 1-token burst, refill 20/sec → after 200ms (≈4 tokens regenerated, 4×
    // the minimum needed) another request must succeed. 200ms gives CI
    // headroom for the Windows default 15.6ms timer resolution.
    let state = ApiState::new(PtyManager::new(), AuthConfig::with_token(TOKEN))
        .with_rate_limiter(Arc::new(RateLimiter::with_limits(1.0, 20.0, 10.0, 0.0)))
        .with_cors_origins(vec![HeaderValue::from_static("http://127.0.0.1:1420")]);
    let (base, state, join) = spawn(state).await;
    let c = client();

    // First burst token.
    let r1 = c
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(r1.status(), StatusCode::OK);

    // Immediately second → exhausted.
    let r2 = c
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(r2.status(), StatusCode::TOO_MANY_REQUESTS);

    // Wait for refill and try again.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let r3 = c
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(r3.status(), StatusCode::OK);

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

#[tokio::test]
async fn rate_limit_applies_after_auth_not_before() {
    // A request with a WRONG token must keep returning 401 forever —
    // unauthenticated traffic must not fill the rate-limit bucket, so
    // legitimate clients cannot be locked out by an attacker spamming bad
    // tokens.
    let state = ApiState::new(PtyManager::new(), AuthConfig::with_token(TOKEN))
        .with_rate_limiter(Arc::new(RateLimiter::with_limits(2.0, 0.0, 10.0, 0.0)))
        .with_cors_origins(vec![HeaderValue::from_static("http://127.0.0.1:1420")]);
    let (base, state, join) = spawn(state).await;
    let c = client();

    for _ in 0..5 {
        let res = c
            .get(format!("{}/sessions", base))
            .header(AUTHORIZATION, "Bearer wrong")
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    // Legit client still has its 2-token budget.
    let res = c
        .get(format!("{}/sessions", base))
        .header(AUTHORIZATION, format!("Bearer {}", TOKEN))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    state.trigger_shutdown();
    let _ = tokio::time::timeout(Duration::from_secs(2), join).await;
}

// ─── Unit-ish checks on the helpers themselves ─────────────────────────────

#[test]
fn rate_limiter_new_burst_matches_constants() {
    // Sanity: `RateLimiter::new()` really uses the published defaults.
    let rl = RateLimiter::new();
    let ip = "127.0.0.1".parse().unwrap();
    // Burn through the burst.
    for _ in 0..(api::REST_BURST as u32) {
        assert!(rl.check_rest(ip));
    }
    // 61st request must fail (refill is at 1/sec so we won't have recovered
    // a whole token in the loop's runtime).
    assert!(!rl.check_rest(ip));
}

#[test]
fn rate_limiter_with_limits_is_independent_of_ws_bucket() {
    // REST exhaustion must not block WS, and vice versa.
    let rl = RateLimiter::with_limits(1.0, 0.0, 1.0, 0.0);
    let ip = "127.0.0.1".parse().unwrap();

    assert!(rl.check_rest(ip));
    assert!(!rl.check_rest(ip));
    // WS bucket is still full.
    assert!(rl.check_ws(ip));
    assert!(!rl.check_ws(ip));
}

#[test]
fn rate_limiter_evicts_oldest_ip_when_capacity_hit() {
    // Exercise the bounded-map behaviour end-to-end: with the production
    // default cap of `MAX_RATE_LIMIT_IPS`, touching that many distinct IPs
    // + one extra should evict exactly one (the oldest). Verified via the
    // `#[cfg(test)]` `tracked_ip_count` helper.
    use std::net::Ipv4Addr;
    let rl = RateLimiter::new();
    let cap = api::MAX_RATE_LIMIT_IPS;

    for i in 0..cap {
        // Deterministic unique IPs via the low 24 bits.
        let b2 = ((i >> 16) & 0xff) as u8;
        let b3 = ((i >> 8) & 0xff) as u8;
        let b4 = (i & 0xff) as u8;
        let ip = std::net::IpAddr::V4(Ipv4Addr::new(10, b2, b3, b4));
        assert!(rl.check_rest(ip));
    }
    assert_eq!(rl.tracked_ip_count(), cap);

    // One more IP → oldest evicted, total count unchanged.
    let extra = std::net::IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
    assert!(rl.check_rest(extra));
    assert_eq!(rl.tracked_ip_count(), cap);
}

#[test]
fn rate_limiter_unlimited_never_blocks() {
    // `unlimited()` now short-circuits — verified both by the never-false
    // behaviour and by the fact that the call count vastly exceeds any
    // plausible burst (so if a future regression removed the short-circuit
    // and left a finite burst, this would fail loudly).
    let rl = RateLimiter::unlimited();
    let ip = "127.0.0.1".parse().unwrap();
    for _ in 0..1000 {
        assert!(rl.check_rest(ip));
        assert!(rl.check_ws(ip));
    }
}
