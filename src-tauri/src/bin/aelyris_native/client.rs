use super::*;

pub(super) async fn send_input(args: &[String]) -> Result<(), String> {
    let id = args
        .first()
        .ok_or_else(|| "send requires a session id".to_string())?;
    let text = join_text_args(&args[1..], "send")?;
    let value = request(
        Method::POST,
        &format!("/sessions/{id}/input"),
        Some(json!({ "text": text })),
    )
    .await?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "send",
        "sessionId": id,
        "result": value,
    }))
}

pub(super) async fn capture_output(args: &[String]) -> Result<(), String> {
    let id = args
        .first()
        .ok_or_else(|| "capture requires a session id".to_string())?;
    let lines = option_value(args, "--lines")
        .as_deref()
        .unwrap_or("200")
        .parse::<usize>()
        .map_err(|_| "--lines must be a positive integer".to_string())?;
    let clean = !args.iter().any(|arg| arg == "--raw");
    let value = request(
        Method::GET,
        &format!("/sessions/{id}/capture?lines={lines}&clean={clean}"),
        None,
    )
    .await?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "capture",
        "sessionId": id,
        "capture": value,
    }))
}

pub(super) async fn daemon_summary() -> Result<Value, String> {
    let daemon = request(Method::GET, "/daemon/contract", None).await?;
    Ok(json!({
        "instanceId": daemon.get("instanceId"),
        "contractSchemaVersion": daemon.get("contractSchemaVersion"),
        "muxGraphVersion": daemon.get("muxGraphVersion"),
        "transport": daemon.get("transport"),
        "attachPolicy": daemon.get("attachPolicy"),
    }))
}

pub(super) async fn request(
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let base = api_base_url();
    let token = api_token();
    let client = reqwest::Client::new();
    let url = format!("{}{}", base.trim_end_matches('/'), path);
    let mut request = client.request(method, url);
    if let Some(token) = token.filter(|token| !token.trim().is_empty()) {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("response read failed: {err}"))?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}"));
    }
    if text.trim().is_empty() {
        return Ok(json!({ "ok": true }));
    }
    serde_json::from_str(&text).map_err(|err| format!("response JSON invalid: {err}: {text}"))
}

pub(super) fn native_client_identity() -> Value {
    json!({
        "process": "aelyris-native",
        "kind": "rust-native-client-spike",
        "uiBoundary": "no-webview",
        "muxTransport": "loopback-http",
        "apiUrl": api_base_url(),
    })
}

fn api_base_url() -> String {
    if let Ok(url) = env::var("AELYRIS_API_URL") {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if token_path().is_some_and(|path| path.exists()) {
        SIDECAR_BASE_URL.to_string()
    } else {
        DEFAULT_BASE_URL.to_string()
    }
}

fn api_token() -> Option<String> {
    if let Ok(token) = env::var("AELYRIS_API_TOKEN") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let path = token_path()?;
    let token = std::fs::read_to_string(path).ok()?;
    let trimmed = token.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn token_path() -> Option<PathBuf> {
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        return Some(
            PathBuf::from(local_app_data)
                .join("Aelyris")
                .join(TOKEN_FILE_NAME),
        );
    }
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
        .map(|home| home.join(".aelyris").join(TOKEN_FILE_NAME))
}
