use std::env;
use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use aelyris_lib::db::{self, Database};
use reqwest::Method;
use serde_json::{Value, json};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:9333";
const SIDECAR_BASE_URL: &str = "http://127.0.0.1:9334";
const TOKEN_FILE_NAME: &str = "aelyris-pty-server.token";
const TOOL_ERROR_PREFIX: &str = "tool error: ";

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        let exit_code = if err.starts_with(TOOL_ERROR_PREFIX) {
            2
        } else {
            1
        };
        eprintln!("aelys: {err}");
        std::process::exit(exit_code);
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
        "mux-export" => mux_export(&args[1..]).await,
        "mux-import" => mux_import(&args[1..]).await,
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
        "mcp" => mcp_call(&args[1..]).await,
        "report" => report(&args[1..]).await,
        "search" | "scrollback-search" => search_output(&args[1..]).await,
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
    let storage_key = format!("aelyris:paneTree:post-resume-smoke-{nonce}");
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

async fn mux_export(args: &[String]) -> Result<(), String> {
    let workspace_id = args
        .first()
        .ok_or_else(|| "mux-export requires a workspace id".to_string())?;
    let value = request(
        Method::GET,
        &format!("/mux/workspaces/{workspace_id}/export"),
        None,
    )
    .await?;
    if let Some(path) = option_value(args, "--out") {
        let text = serde_json::to_string_pretty(&value).map_err(|err| err.to_string())?;
        let output_path = PathBuf::from(path);
        std::fs::write(&output_path, format!("{text}\n"))
            .map_err(|err| format!("failed to write export file: {err}"))?;
        return print_json(&json!({
            "status": "exported",
            "workspaceId": workspace_id,
            "path": output_path.display().to_string(),
            "bytes": text.len() + 1,
        }));
    }
    print_json(&value)
}

async fn mux_import(args: &[String]) -> Result<(), String> {
    let source = args
        .first()
        .ok_or_else(|| "mux-import requires a snapshot path or '-'".to_string())?;
    let replace = args.iter().any(|arg| arg == "--replace");
    let text = if source == "-" {
        let mut text = String::new();
        std::io::stdin()
            .read_to_string(&mut text)
            .map_err(|err| format!("failed to read stdin: {err}"))?;
        text
    } else {
        std::fs::read_to_string(source)
            .map_err(|err| format!("failed to read snapshot file: {err}"))?
    };
    let body: Value =
        serde_json::from_str(&text).map_err(|err| format!("snapshot JSON invalid: {err}"))?;
    let value = request(
        Method::POST,
        &format!("/mux/workspaces/import?replace={replace}"),
        Some(body),
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
    let (id, text) = parse_send_input(args, default_terminal_id().ok())?;
    let value = request(
        Method::POST,
        &format!("/sessions/{}/input", query_component(&id)),
        Some(json!({ "text": text })),
    )
    .await?;
    print_json(&value)
}

async fn capture_output(args: &[String]) -> Result<(), String> {
    let (id, lines, clean) = parse_capture_target(args, default_terminal_id().ok())?;
    let value = request(
        Method::GET,
        &format!(
            "/sessions/{}/capture?lines={lines}&clean={clean}",
            query_component(&id)
        ),
        None,
    )
    .await?;
    print_json(&value)
}

async fn mcp_call(args: &[String]) -> Result<(), String> {
    let body = mcp_call_body(args)?;
    let value = request(Method::POST, "/mcp/tools/call", Some(body)).await?;
    print_mcp_response(&value)
}

async fn report(args: &[String]) -> Result<(), String> {
    let body = report_mcp_body(args, &default_terminal_id()?)?;
    let value = request(Method::POST, "/mcp/tools/call", Some(body)).await?;
    print_mcp_response(&value)
}

fn mcp_call_body(args: &[String]) -> Result<Value, String> {
    let verb = args
        .first()
        .ok_or_else(|| "mcp requires a verb".to_string())?;
    if args.len() > 2 {
        return Err("mcp accepts at most one JSON arguments value".to_string());
    }
    let arguments = match args.get(1) {
        Some(raw) => serde_json::from_str::<Value>(raw)
            .map_err(|err| format!("mcp JSON arguments invalid: {err}"))?,
        None => json!({}),
    };
    Ok(json!({
        "name": verb,
        "arguments": arguments,
    }))
}

fn report_mcp_body(args: &[String], terminal_id: &str) -> Result<Value, String> {
    let title = option_value(args, "--title")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "report requires --title".to_string())?;
    Ok(json!({
        "name": "aelyris.pane.rename",
        "arguments": {
            "terminalId": terminal_id,
            "name": title,
        },
    }))
}

fn print_mcp_response(value: &Value) -> Result<(), String> {
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let text = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
        eprintln!("{text}");
        let tool = value
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or("mcp tool");
        return Err(format!("{TOOL_ERROR_PREFIX}{tool} returned ok:false"));
    }
    print_json(value)
}

fn default_terminal_id() -> Result<String, String> {
    env::var("AELYRIS_TERMINAL_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "AELYRIS_TERMINAL_ID is required when target is omitted".to_string())
}

fn parse_send_input(
    args: &[String],
    default_target: Option<String>,
) -> Result<(String, String), String> {
    let mut enter = false;
    let mut values = Vec::new();
    for arg in args {
        if arg == "--enter" {
            enter = true;
        } else {
            values.push(arg.as_str());
        }
    }

    let (target, text_parts): (String, &[&str]) = match values.len() {
        0 => (
            default_target
                .ok_or_else(|| "send requires a session id or AELYRIS_TERMINAL_ID".to_string())?,
            &[],
        ),
        1 => match default_target {
            Some(_) if enter && is_short_terminal_ref(values[0]) => (values[0].to_string(), &[]),
            Some(target) => (target, &values[..]),
            None if enter => (values[0].to_string(), &[]),
            None => return Err("send requires text or --enter".to_string()),
        },
        _ => (values[0].to_string(), &values[1..]),
    };

    if text_parts.is_empty() && !enter {
        return Err("send requires text or --enter".to_string());
    }
    let mut text = text_parts.join(" ");
    if enter {
        text.push('\r');
    }
    Ok((target, text))
}

fn is_short_terminal_ref(value: &str) -> bool {
    value
        .strip_prefix('%')
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_digit()))
}

fn parse_capture_target(
    args: &[String],
    default_target: Option<String>,
) -> Result<(String, usize, bool), String> {
    let lines = option_value(args, "--lines")
        .as_deref()
        .unwrap_or("200")
        .parse::<usize>()
        .map_err(|_| "--lines must be a positive integer".to_string())?;
    let clean = !args.iter().any(|arg| arg == "--raw");
    let target = capture_target_arg(args)
        .map(ToOwned::to_owned)
        .or(default_target)
        .ok_or_else(|| "capture requires a session id or AELYRIS_TERMINAL_ID".to_string())?;
    Ok((target, lines, clean))
}

fn capture_target_arg(args: &[String]) -> Option<&str> {
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--raw" => index += 1,
            "--lines" => index += 2,
            value if value.starts_with("--") => index += 1,
            value => return Some(value),
        }
    }
    None
}

async fn search_output(args: &[String]) -> Result<(), String> {
    let id = args
        .first()
        .ok_or_else(|| "search requires a session id".to_string())?;
    let lines = option_value(args, "--lines")
        .as_deref()
        .unwrap_or("200")
        .parse::<usize>()
        .map_err(|_| "--lines must be a positive integer".to_string())?;
    let limit = option_value(args, "--limit")
        .as_deref()
        .unwrap_or("200")
        .parse::<usize>()
        .map_err(|_| "--limit must be a positive integer".to_string())?;
    let case_sensitive = args.iter().any(|arg| arg == "--case-sensitive");
    let query = search_query(args)?;
    let value = request(
        Method::GET,
        &format!(
            "/sessions/{id}/search?query={}&lines={lines}&limit={limit}&caseSensitive={case_sensitive}",
            query_component(&query)
        ),
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

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|window| window[0] == name)
        .map(|window| window[1].clone())
}

fn search_query(args: &[String]) -> Result<String, String> {
    if args.len() < 2 {
        return Err("search requires query text".to_string());
    }
    let mut values = Vec::new();
    let mut index = 1;
    while index < args.len() {
        let arg = args[index].as_str();
        match arg {
            "--case-sensitive" => {
                index += 1;
            }
            "--lines" | "--limit" => {
                if index + 1 >= args.len() {
                    return Err(format!("{arg} requires a value"));
                }
                index += 2;
            }
            _ if arg.starts_with("--") => {
                return Err(format!("unknown search option: {arg}"));
            }
            _ => {
                values.push(arg);
                index += 1;
            }
        }
    }
    if values.is_empty() {
        Err("search requires query text".to_string())
    } else {
        Ok(values.join(" "))
    }
}

fn query_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
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
        "aelys commands:\n  health\n  daemon\n  sessions\n  mux\n  mux-graph <id>\n  mux-export <workspace> [--out path]\n  mux-import <snapshot-path|-> [--replace]\n  mux-split <workspace> <target-pane> [--axis horizontal|vertical] [--shell cmd|powershell|gitbash|wsl] [--cwd path] [--title name] [--cols n] [--rows n]\n  mux-close-pane <workspace> <pane>\n  mux-swap <workspace> <first-pane> <second-pane>\n  mux-move <workspace> <source-pane> <target-pane> [--axis horizontal|vertical]\n  mux-break-pane <workspace> <pane>\n  mux-join-pane <workspace> <source-pane> <target-pane> [--axis horizontal|vertical]\n  mux-sync-panes <workspace> --on|--off\n  mux-broadcast <workspace> <text...> [--enter]\n  mux-zoom <workspace> <pane>\n  mux-unzoom <workspace> <pane>\n  mux-even <workspace> [--axis horizontal|vertical]\n  mux-rotate <workspace> [--direction next|previous]\n  mux-tiled <workspace>\n  mux-detach <workspace>\n  mux-attach <workspace>\n  create [--shell cmd|powershell|gitbash|wsl] [--cwd path] [--cols n] [--rows n]\n  resize <id> --cols n --rows n\n  send [<target>] <text...> [--enter]\n  capture [<target>] [--lines n] [--raw]\n  mcp <verb> [json-arguments]\n  report --title <text>\n  search <id> <query...> [--lines n] [--limit n] [--case-sensitive]\n  close <id>\n\nEnvironment:\n  AELYRIS_API_URL    overrides API URL; otherwise sidecar token file selects http://127.0.0.1:9334, falling back to http://127.0.0.1:9333\n  AELYRIS_API_TOKEN  overrides bearer token; otherwise reads the Aelyris sidecar token file\n  AELYRIS_TERMINAL_ID default target for in-pane send/capture/report"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn query_component_encodes_spaces_symbols_and_unicode() {
        assert_eq!(query_component("hello world"), "hello%20world");
        assert_eq!(query_component("a+b&c"), "a%2Bb%26c");
        assert_eq!(query_component("日本語"), "%E6%97%A5%E6%9C%AC%E8%AA%9E");
    }

    #[test]
    fn search_query_ignores_supported_options_and_preserves_terms() {
        let args = strings(&[
            "pane-1",
            "aelyris",
            "marker",
            "--lines",
            "500",
            "--limit",
            "3",
            "--case-sensitive",
        ]);
        assert_eq!(search_query(&args).unwrap(), "aelyris marker");
    }

    #[test]
    fn search_query_rejects_missing_values_and_unknown_options() {
        assert!(search_query(&strings(&["pane-1"])).is_err());
        assert!(search_query(&strings(&["pane-1", "--lines"])).is_err());
        assert!(search_query(&strings(&["pane-1", "--unknown", "needle"])).is_err());
    }

    #[test]
    fn mcp_call_body_builds_tools_call_payload() {
        let body = mcp_call_body(&strings(&[
            "aelyris.pane.rename",
            r#"{"terminalId":"%2","name":"ready"}"#,
        ]))
        .unwrap();

        assert_eq!(body["name"], "aelyris.pane.rename");
        assert_eq!(body["arguments"]["terminalId"], "%2");
        assert_eq!(body["arguments"]["name"], "ready");

        let empty = mcp_call_body(&strings(&["aelyris.fleet_status"])).unwrap();
        assert_eq!(empty["arguments"], json!({}));
        assert!(mcp_call_body(&strings(&["verb", "{bad json"])).is_err());
    }

    #[test]
    fn report_builds_pane_rename_payload_for_current_terminal() {
        let body = report_mcp_body(&strings(&["--title", "Phase F7 done"]), "%3").unwrap();

        assert_eq!(body["name"], "aelyris.pane.rename");
        assert_eq!(body["arguments"]["terminalId"], "%3");
        assert_eq!(body["arguments"]["name"], "Phase F7 done");
        assert!(report_mcp_body(&strings(&[]), "%3").is_err());
    }

    #[test]
    fn send_input_parses_optional_in_pane_target_and_encodes_short_refs() {
        let (target, text) =
            parse_send_input(&strings(&["hello", "--enter"]), Some("%2".to_string())).unwrap();
        assert_eq!(target, "%2");
        assert_eq!(text, "hello\r");

        let (target, text) = parse_send_input(
            &strings(&["%3", "status", "--enter"]),
            Some("%2".to_string()),
        )
        .unwrap();
        assert_eq!(target, "%3");
        assert_eq!(text, "status\r");

        let (target, text) =
            parse_send_input(&strings(&["%3", "--enter"]), Some("%2".to_string())).unwrap();
        assert_eq!(target, "%3");
        assert_eq!(text, "\r");
        assert_eq!(query_component("%3"), "%253");
    }

    #[test]
    fn capture_parses_optional_target_and_options() {
        let (target, lines, clean) = parse_capture_target(
            &strings(&["--lines", "40", "--raw"]),
            Some("%5".to_string()),
        )
        .unwrap();
        assert_eq!(target, "%5");
        assert_eq!(lines, 40);
        assert!(!clean);

        let (target, lines, clean) =
            parse_capture_target(&strings(&["%6", "--lines", "12"]), Some("%5".to_string()))
                .unwrap();
        assert_eq!(target, "%6");
        assert_eq!(lines, 12);
        assert!(clean);
    }
}
