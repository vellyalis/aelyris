use std::env;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use aether_terminal_lib::db::{self, Database};
use reqwest::Method;
use serde_json::{json, Value};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:9333";
const SIDECAR_BASE_URL: &str = "http://127.0.0.1:9334";
const TOKEN_FILE_NAME: &str = "aether-pty-server.token";

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("aetherctl: {err}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let Some(command) = args.first().map(String::as_str) else {
        print_help();
        return Ok(());
    };

    match command {
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        "health" => {
            let value = request(Method::GET, "/health", None).await?;
            print_json(&value)
        }
        "daemon" | "contract" => {
            let value = request(Method::GET, "/daemon/contract", None).await?;
            print_json(&value)
        }
        "sessions" | "list" => {
            let value = request(Method::GET, "/sessions", None).await?;
            print_json(&value)
        }
        "db-smoke" => db_smoke(),
        "mux" => {
            let value = request(Method::GET, "/mux/workspaces", None).await?;
            print_json(&value)
        }
        "mux-graph" => {
            let id = args
                .get(1)
                .ok_or_else(|| "mux-graph requires a workspace/session id".to_string())?;
            let value = request(Method::GET, &format!("/mux/workspaces/{id}"), None).await?;
            print_json(&value)
        }
        "mux-split" => mux_split(&args[1..]).await,
        "mux-close-pane" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "mux-close-pane requires a workspace id".to_string())?;
            let pane_id = args
                .get(2)
                .ok_or_else(|| "mux-close-pane requires a pane id".to_string())?;
            let value = request(
                Method::DELETE,
                &format!("/mux/workspaces/{workspace_id}/panes/{pane_id}"),
                None,
            )
            .await?;
            print_json(&value)
        }
        "mux-swap" => mux_swap(&args[1..]).await,
        "mux-move" => mux_move(&args[1..]).await,
        "mux-break-pane" => mux_break_pane(&args[1..]).await,
        "mux-join-pane" => mux_join_pane(&args[1..]).await,
        "mux-sync-panes" => mux_sync_panes(&args[1..]).await,
        "mux-broadcast" => mux_broadcast(&args[1..]).await,
        "mux-zoom" => mux_zoom(&args[1..], true).await,
        "mux-unzoom" => mux_zoom(&args[1..], false).await,
        "mux-even" => mux_even(&args[1..]).await,
        "mux-rotate" => mux_rotate(&args[1..]).await,
        "mux-detach" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "mux-detach requires a workspace id".to_string())?;
            let value = request(
                Method::POST,
                &format!("/mux/workspaces/{workspace_id}/detach"),
                None,
            )
            .await?;
            print_json(&value)
        }
        "mux-attach" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "mux-attach requires a workspace id".to_string())?;
            let value = request(
                Method::POST,
                &format!("/mux/workspaces/{workspace_id}/attach"),
                None,
            )
            .await?;
            print_json(&value)
        }
        "mux-tiled" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "mux-tiled requires a workspace id".to_string())?;
            let value = request(
                Method::POST,
                &format!("/mux/workspaces/{workspace_id}/layout/tiled"),
                None,
            )
            .await?;
            print_json(&value)
        }
        "create" => create_session(&args[1..]).await,
        "send" => send_input(&args[1..]).await,
        "capture" => capture_output(&args[1..]).await,
        "close" => {
            let id = args
                .get(1)
                .ok_or_else(|| "close requires a session id".to_string())?;
            let value = request(Method::DELETE, &format!("/sessions/{id}"), None).await?;
            print_json(&value)
        }
        "resize" => resize_session(&args[1..]).await,
        other => Err(format!("unknown command: {other}")),
    }
}

fn db_smoke() -> Result<(), String> {
    let db_path = db::db_path();
    let database = Database::open(&db_path)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    let storage_key = format!("aether:paneTree:post-resume-smoke-{nonce}");
    let project_path = env::current_dir()
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .to_string();
    let layout = json!({
        "layoutId": storage_key,
        "schemaVersion": 1,
        "root": {
            "kind": "split",
            "axis": "horizontal",
            "ratio": 0.5,
            "first": { "kind": "pane", "paneId": "post-resume-left" },
            "second": { "kind": "pane", "paneId": "post-resume-right" }
        },
        "activePaneId": "post-resume-left",
        "backendBindings": [
            { "paneId": "post-resume-left", "terminalId": "probe-left" },
            { "paneId": "post-resume-right", "terminalId": "probe-right" }
        ]
    });
    let layout_json = serde_json::to_string(&layout).map_err(|err| err.to_string())?;
    database.save_pane_tree_layout(&storage_key, &project_path, &layout_json)?;
    let saved = database
        .get_pane_tree_layout(&storage_key)?
        .ok_or_else(|| "pane tree layout smoke row was not readable".to_string())?;
    let sqlite_writable = saved.project_path == project_path;
    let pane_state_preserved = saved.layout_json == layout_json;
    database.delete_pane_tree_layout(&storage_key)?;
    if !sqlite_writable || !pane_state_preserved {
        return Err("pane tree layout smoke did not preserve the written state".to_string());
    }
    print_json(&json!({
        "status": "pass",
        "dbPath": db_path.display().to_string(),
        "storageKey": storage_key,
        "sqliteWritable": sqlite_writable,
        "paneStatePreserved": pane_state_preserved,
        "layoutBytes": layout_json.len(),
        "updatedAt": saved.updated_at,
    }))
}

async fn create_session(args: &[String]) -> Result<(), String> {
    let shell = option_value(args, "--shell").unwrap_or_else(|| "powershell".to_string());
    let cols = option_value(args, "--cols")
        .as_deref()
        .unwrap_or("80")
        .parse::<u16>()
        .map_err(|_| "--cols must be a positive integer".to_string())?;
    let rows = option_value(args, "--rows")
        .as_deref()
        .unwrap_or("24")
        .parse::<u16>()
        .map_err(|_| "--rows must be a positive integer".to_string())?;
    let cwd = option_value(args, "--cwd");
    let mut body = json!({
        "shell": shell,
        "cols": cols,
        "rows": rows,
    });
    if let Some(cwd) = cwd {
        body["cwd"] = Value::String(cwd);
    }
    let value = request(Method::POST, "/sessions", Some(body)).await?;
    print_json(&value)
}

async fn resize_session(args: &[String]) -> Result<(), String> {
    let id = args
        .first()
        .ok_or_else(|| "resize requires a session id".to_string())?;
    let cols = option_value(args, "--cols")
        .ok_or_else(|| "resize requires --cols".to_string())?
        .parse::<u16>()
        .map_err(|_| "--cols must be a positive integer".to_string())?;
    let rows = option_value(args, "--rows")
        .ok_or_else(|| "resize requires --rows".to_string())?
        .parse::<u16>()
        .map_err(|_| "--rows must be a positive integer".to_string())?;
    let value = request(
        Method::POST,
        &format!("/sessions/{id}/resize"),
        Some(json!({ "cols": cols, "rows": rows })),
    )
    .await?;
    print_json(&value)
}

async fn mux_split(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-split requires a workspace id".to_string())?;
    let target_pane_id = args
        .get(1)
        .ok_or_else(|| "mux-split requires a target pane id".to_string())?;
    let axis = option_value(args, "--axis").unwrap_or_else(|| "horizontal".to_string());
    let cols = option_value(args, "--cols")
        .as_deref()
        .unwrap_or("80")
        .parse::<u16>()
        .map_err(|_| "--cols must be a positive integer".to_string())?;
    let rows = option_value(args, "--rows")
        .as_deref()
        .unwrap_or("24")
        .parse::<u16>()
        .map_err(|_| "--rows must be a positive integer".to_string())?;
    let mut body = json!({
        "targetPaneId": target_pane_id,
        "axis": normalize_axis(&axis)?,
        "cols": cols,
        "rows": rows,
    });
    if let Some(shell) = option_value(args, "--shell") {
        body["shell"] = Value::String(shell);
    }
    if let Some(cwd) = option_value(args, "--cwd") {
        body["cwd"] = Value::String(cwd);
    }
    if let Some(title) = option_value(args, "--title") {
        body["title"] = Value::String(title);
    }
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/panes/split"),
        Some(body),
    )
    .await?;
    print_json(&value)
}

async fn mux_swap(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-swap requires a workspace id".to_string())?;
    let first_pane_id = args
        .get(1)
        .ok_or_else(|| "mux-swap requires the first pane id".to_string())?;
    let second_pane_id = args
        .get(2)
        .ok_or_else(|| "mux-swap requires the second pane id".to_string())?;
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/panes/swap"),
        Some(json!({
            "firstPaneId": first_pane_id,
            "secondPaneId": second_pane_id,
        })),
    )
    .await?;
    print_json(&value)
}

async fn mux_move(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-move requires a workspace id".to_string())?;
    let source_pane_id = args
        .get(1)
        .ok_or_else(|| "mux-move requires a source pane id".to_string())?;
    let target_pane_id = args
        .get(2)
        .ok_or_else(|| "mux-move requires a target pane id".to_string())?;
    let axis = option_value(args, "--axis").unwrap_or_else(|| "horizontal".to_string());
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/panes/move"),
        Some(json!({
            "sourcePaneId": source_pane_id,
            "targetPaneId": target_pane_id,
            "axis": normalize_axis(&axis)?,
        })),
    )
    .await?;
    print_json(&value)
}

async fn mux_break_pane(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-break-pane requires a workspace id".to_string())?;
    let pane_id = args
        .get(1)
        .ok_or_else(|| "mux-break-pane requires a pane id".to_string())?;
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/panes/{pane_id}/break"),
        None,
    )
    .await?;
    print_json(&value)
}

async fn mux_join_pane(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-join-pane requires a workspace id".to_string())?;
    let source_pane_id = args
        .get(1)
        .ok_or_else(|| "mux-join-pane requires a source pane id".to_string())?;
    let target_pane_id = args
        .get(2)
        .ok_or_else(|| "mux-join-pane requires a target pane id".to_string())?;
    let axis = option_value(args, "--axis").unwrap_or_else(|| "horizontal".to_string());
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/panes/join"),
        Some(json!({
            "sourcePaneId": source_pane_id,
            "targetPaneId": target_pane_id,
            "axis": normalize_axis(&axis)?,
        })),
    )
    .await?;
    print_json(&value)
}

async fn mux_sync_panes(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-sync-panes requires a workspace id".to_string())?;
    let enabled = if args.iter().any(|arg| arg == "--off") {
        false
    } else if args.iter().any(|arg| arg == "--on") {
        true
    } else {
        return Err("mux-sync-panes requires --on or --off".to_string());
    };
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/panes/synchronize"),
        Some(json!({ "enabled": enabled })),
    )
    .await?;
    print_json(&value)
}

async fn mux_even(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-even requires a workspace id".to_string())?;
    let axis = option_value(args, "--axis").unwrap_or_else(|| "horizontal".to_string());
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/layout/even"),
        Some(json!({ "axis": normalize_axis(&axis)? })),
    )
    .await?;
    print_json(&value)
}

async fn mux_rotate(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-rotate requires a workspace id".to_string())?;
    let direction = option_value(args, "--direction").unwrap_or_else(|| "next".to_string());
    let direction = match direction.as_str() {
        "next" => "next",
        "previous" | "prev" => "previous",
        other => return Err(format!("unknown mux-rotate direction: {other}")),
    };
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/layout/rotate"),
        Some(json!({ "direction": direction })),
    )
    .await?;
    print_json(&value)
}

async fn mux_broadcast(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-broadcast requires a workspace id".to_string())?;
    let mut enter = false;
    let mut text_parts = Vec::new();
    for arg in &args[1..] {
        if arg == "--enter" {
            enter = true;
        } else {
            text_parts.push(arg.as_str());
        }
    }
    if text_parts.is_empty() && !enter {
        return Err("mux-broadcast requires text or --enter".to_string());
    }
    let mut text = text_parts.join(" ");
    if enter {
        text.push('\r');
    }
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/input"),
        Some(json!({ "text": text })),
    )
    .await?;
    print_json(&value)
}

async fn mux_zoom(args: &[String], zoomed: bool) -> Result<(), String> {
    let workspace_id = args.first().ok_or_else(|| {
        if zoomed {
            "mux-zoom requires a workspace id".to_string()
        } else {
            "mux-unzoom requires a workspace id".to_string()
        }
    })?;
    let pane_id = args.get(1).ok_or_else(|| {
        if zoomed {
            "mux-zoom requires a pane id".to_string()
        } else {
            "mux-unzoom requires a pane id".to_string()
        }
    })?;
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/{workspace_id}/panes/{pane_id}/zoom"),
        Some(json!({ "zoomed": zoomed })),
    )
    .await?;
    print_json(&value)
}

async fn send_input(args: &[String]) -> Result<(), String> {
    let id = args
        .first()
        .ok_or_else(|| "send requires a session id".to_string())?;
    let mut enter = false;
    let mut text_parts = Vec::new();
    for arg in &args[1..] {
        if arg == "--enter" {
            enter = true;
        } else {
            text_parts.push(arg.as_str());
        }
    }
    if text_parts.is_empty() && !enter {
        return Err("send requires text or --enter".to_string());
    }
    let mut text = text_parts.join(" ");
    if enter {
        text.push('\r');
    }
    let value = request(
        Method::POST,
        &format!("/sessions/{id}/input"),
        Some(json!({ "text": text })),
    )
    .await?;
    print_json(&value)
}

async fn capture_output(args: &[String]) -> Result<(), String> {
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
    print_json(&value)
}

async fn request(method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
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

fn api_base_url() -> String {
    if let Ok(url) = env::var("AETHER_API_URL") {
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
    if let Ok(token) = env::var("AETHER_API_TOKEN") {
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
                .join("Aether Terminal")
                .join(TOKEN_FILE_NAME),
        );
    }
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
        .map(|home| home.join(".aether").join(TOKEN_FILE_NAME))
}

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|window| window[0] == name)
        .map(|window| window[1].clone())
}

fn normalize_axis(axis: &str) -> Result<&'static str, String> {
    match axis.to_ascii_lowercase().as_str() {
        "h" | "horizontal" => Ok("horizontal"),
        "v" | "vertical" => Ok("vertical"),
        other => Err(format!("unknown axis: {other}")),
    }
}

fn print_json(value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    println!("{text}");
    Ok(())
}

fn print_help() {
    println!(
        "aetherctl commands:\n  health\n  daemon\n  sessions\n  mux\n  mux-graph <id>\n  mux-split <workspace> <target-pane> [--axis horizontal|vertical] [--shell cmd|powershell|gitbash|wsl] [--cwd path] [--title name] [--cols n] [--rows n]\n  mux-close-pane <workspace> <pane>\n  mux-swap <workspace> <first-pane> <second-pane>\n  mux-move <workspace> <source-pane> <target-pane> [--axis horizontal|vertical]\n  mux-break-pane <workspace> <pane>\n  mux-join-pane <workspace> <source-pane> <target-pane> [--axis horizontal|vertical]\n  mux-sync-panes <workspace> --on|--off\n  mux-broadcast <workspace> <text...> [--enter]\n  mux-zoom <workspace> <pane>\n  mux-unzoom <workspace> <pane>\n  mux-even <workspace> [--axis horizontal|vertical]\n  mux-rotate <workspace> [--direction next|previous]\n  mux-tiled <workspace>\n  mux-detach <workspace>\n  mux-attach <workspace>\n  create [--shell cmd|powershell|gitbash|wsl] [--cwd path] [--cols n] [--rows n]\n  resize <id> --cols n --rows n\n  send <id> <text...> [--enter]\n  capture <id> [--lines n] [--raw]\n  close <id>\n\nEnvironment:\n  AETHER_API_URL    overrides API URL; otherwise sidecar token file selects http://127.0.0.1:9334, falling back to http://127.0.0.1:9333\n  AETHER_API_TOKEN  overrides bearer token; otherwise reads the Aether sidecar token file"
    );
}
