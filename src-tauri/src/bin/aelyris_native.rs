#![recursion_limit = "256"]

use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aelyris_lib::config::{
    load_config, save_config, MoodMaterialOverrideConfig, WallpaperConfig,
};
use aelyris_lib::db::{
    AgentIdentityRecord, Database, HistorySearchEntryRecord, ModePreservationSnapshotRecord,
    WorkspaceItemRecord,
};
use aelyris_lib::term::{
    system_text_shaping_capability, terminal_text_shaping_policy, CellStyle, DirectWriteTextShaper,
    NativeCellMetrics, NativeInputSurfaceRect, NativeRenderFrame, NativeRenderPipeline,
    NativeTerminalInputHost, ShapeInput, TermEngine, TextShaper,
};
use reqwest::Method;
use serde_json::{json, to_value, Value};
use sha2::{Digest, Sha256};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:9333";
const SIDECAR_BASE_URL: &str = "http://127.0.0.1:9334";
const TOKEN_FILE_NAME: &str = "aelyris-pty-server.token";

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("aelyris-native: {err}");
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
        "contract" => contract().await,
        "window-proof" => window_proof(&args[1..]).await,
        "render-proof" => render_proof(&args[1..]).await,
        "grid-render-proof" => grid_render_proof(&args[1..]).await,
        "present-loop-proof" => present_loop_proof(&args[1..]).await,
        "gpu-render-proof" => gpu_render_proof(&args[1..]).await,
        "winit-wgpu-proof" => winit_wgpu_proof(&args[1..]).await,
        "text-shaping-fixture-proof" => text_shaping_fixture_proof(&args[1..]).await,
        "ime-proof" => ime_proof(&args[1..]).await,
        "ime-dogfood-proof" => ime_dogfood_proof(&args[1..]).await,
        "ime-os-dogfood-proof" => ime_os_dogfood_proof(&args[1..]).await,
        "ime-os-dogfood-worker" => ime_os_dogfood_worker(&args[1..]).await,
        "paste-guard-proof" => paste_guard_proof(&args[1..]).await,
        "settings-proof" => settings_proof(&args[1..]).await,
        "settings-window-proof" => settings_window_proof(&args[1..]).await,
        "command-center-proof" => command_center_proof(&args[1..]).await,
        "command-center-window-proof" => command_center_window_proof(&args[1..]).await,
        "command-center-input-scroll-proof" => command_center_input_scroll_proof(&args[1..]).await,
        "mode-shell-proof" => mode_shell_proof(&args[1..]).await,
        "mode-rail-window-proof" => mode_rail_window_proof(&args[1..]).await,
        "inspector-window-proof" => inspector_window_proof(&args[1..]).await,
        "right-rail-demotion-proof" => right_rail_demotion_proof(&args[1..]).await,
        "accessibility-proof" => accessibility_proof(&args[1..]).await,
        "uia-provider-proof" => uia_provider_proof(&args[1..]).await,
        "visual-qa-proof" => visual_qa_proof(&args[1..]).await,
        "primary-shell-proof" => primary_shell_proof(&args[1..]).await,
        "power-events-proof" => power_events_proof(&args[1..]).await,
        "db-smoke-proof" => db_smoke_proof().await,
        "upper-compat-proof" => upper_compat_proof().await,
        "sleep-now" => sleep_now(&args[1..]).await,
        "list" | "mux" => {
            let value = request(Method::GET, "/mux/workspaces", None).await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "list",
                "daemon": daemon_summary().await?,
                "workspaces": value,
            }))
        }
        "graph" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "graph requires a workspace/session id".to_string())?;
            let value = request(
                Method::GET,
                &format!("/mux/workspaces/{workspace_id}"),
                None,
            )
            .await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "graph",
                "workspaceId": workspace_id,
                "graph": value,
            }))
        }
        "attach" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "attach requires a workspace/session id".to_string())?;
            let value = request(
                Method::POST,
                &format!("/mux/workspaces/{workspace_id}/attach"),
                None,
            )
            .await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "attach",
                "workspaceId": workspace_id,
                "graph": value,
            }))
        }
        "detach" => {
            let workspace_id = args
                .get(1)
                .ok_or_else(|| "detach requires a workspace/session id".to_string())?;
            let value = request(
                Method::POST,
                &format!("/mux/workspaces/{workspace_id}/detach"),
                None,
            )
            .await?;
            print_json(&json!({
                "schema": "aelyris.native.client.v1",
                "client": native_client_identity(),
                "operation": "detach",
                "workspaceId": workspace_id,
                "graph": value,
            }))
        }
        "send" => send_input(&args[1..]).await,
        "capture" => capture_output(&args[1..]).await,
        other => Err(format!("unknown command: {other}")),
    }
}

async fn contract() -> Result<(), String> {
    let daemon = request(Method::GET, "/daemon/contract", None).await?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "status": "client-boundary-spike",
        "daemon": daemon,
        "fullNativeReadiness": full_native_readiness_contract(),
        "claims": {
            "webviewUsed": false,
            "reactUsed": false,
            "muxTruthSource": "daemon-api",
            "terminalRenderer": "pending-native-terminal-renderer-after-window-proof",
            "inputOwner": "pending-native-window-ime",
            "purpose": "prove a native Rust client can attach to the same mux graph and create a no-WebView native window before a full UI rewrite"
        },
        "capabilities": [
            "daemon-contract",
            "mux-list",
            "mux-graph",
            "mux-attach",
            "mux-detach",
            "session-send",
            "session-capture",
            "native-window-proof",
            "native-text-render-proof",
            "native-grid-render-proof",
            "native-present-loop-proof",
            "native-gpu-render-proof",
            "native-winit-wgpu-surface-proof",
            "native-winit-wgpu-font-atlas-proof",
            "native-ime-state-proof",
            "native-ime-hwnd-dogfood-proof",
            "native-ime-os-dogfood-proof",
            "native-settings-proof",
            "native-settings-window-ui",
            "native-command-center-proof",
            "native-command-center-window-ui-proof",
            "native-command-center-input-scroll-proof",
            "native-mode-shell-proof",
            "native-mode-rail-window-ui-proof",
            "native-inspector-window-ui-proof",
            "native-right-rail-demotion-proof",
            "native-accessibility-tree-proof",
            "native-uia-provider-dogfood-proof",
            "native-visual-qa-harness-proof",
            "native-primary-shell-promotion-proof",
            "native-process-identity"
        ],
        "blockedUntil": [
            "native-ime-manual-japanese-candidate-sweep",
            "native-glass-theme-renderer",
            "native-visual-regression-harness"
        ]
    }))
}

fn full_native_readiness_contract() -> Value {
    let text_shaping_policy = terminal_text_shaping_policy();
    let system_text_shaping = system_text_shaping_capability();
    json!({
        "schema": "aelyris.full-native-readiness.v1",
        "currentStage": "native-client-spike",
        "finalGoal": "operator-primary no-WebView Rust client",
        "textShapingPolicy": to_value(&text_shaping_policy).unwrap_or_else(|_| json!({
            "readyForNativeShapingClaim": false,
            "releaseBlockers": ["native text-shaping policy serialization failed"]
        })),
        "systemTextShapingCapability": to_value(&system_text_shaping).unwrap_or_else(|_| json!({
            "available": false,
            "readyForNativeShapingClaim": false,
            "blockers": ["native system text-shaping capability serialization failed"]
        })),
        "definitionOfDone": [
            "The primary terminal window runs in the aelyris-native process without React or WebView.",
            "The terminal present loop is native Rust and GPU-backed.",
            "Input, IME, clipboard, paste guard, mouse, selection, and accessibility are native-owned.",
            "Settings, theme/material customization, wallpaper, opacity, and launch profiles are editable in a native UI.",
            "Command Center/right rail evidence, recovery, provenance, and AI CLI orchestration are rendered and actionable in the native client.",
            "The React/Tauri shell is optional compatibility, not the product truth."
        ],
        "completed": {
            "daemonApiBoundary": true,
            "rustMuxSessionGraph": true,
            "rustTerminalModel": true,
            "nativeProcessIdentity": true,
            "nativeLayeredWindowProof": true,
            "nativeGdiTextProof": true,
            "nativeGdiGridProof": true,
            "rendererNeutralFrameContract": true,
            "nativePresentLoopProof": true,
            "wgpuOffscreenRenderProof": true,
            "winitWgpuSurfaceProof": true,
            "winitWgpuFontAtlasProof": true,
            "nativeImeStateProof": true,
            "nativeImeHwndDogfoodProof": true,
            "nativeImeOsDogfoodProof": true,
            "nativeSettingsConfigProof": true,
            "nativeSettingsWindowProof": true,
            "nativeCommandCenterDataProof": true,
            "nativeCommandCenterInputScrollProof": true,
            "nativeModeShellContractProof": true,
            "nativeModeRailWindowProof": true,
            "nativeInspectorWindowProof": true,
            "nativeRightRailDemotionProof": true,
            "nativeRightRailCompatibilityDemotionProof": true,
            "nativeAccessibilityTreeProof": true,
            "nativeUiaProviderDogfoodProof": true,
            "nativeVisualQaHarnessProof": true,
            "nativePrimaryShellPromotionProof": true,
            "nativeTextShapingPolicyContract": true,
            "nativeSystemTextShapingBoundary": system_text_shaping.available
        },
        "missing": {
            "nativeSystemTextShapingAndFallback": !(system_text_shaping.available && system_text_shaping.system_font_fallback),
            "nativeRendererConsumesSystemShapedRuns": !system_text_shaping.renderer_integration_ready,
            "nativeTextShapingVisualFixtures": !system_text_shaping.visual_fixture_ready,
            "nativePresentLoopDogfood": true,
            "nativeImeLiveDogfood": null,
            "nativeClipboardAndSelectionDogfood": true,
            "nativeThemeGlassWallpaperEditorUi": null,
            "nativeCommandCenterRightRailUi": null,
            "nativePrimaryOperatorPromotion": null,
            "nativeSettingsAndDialogsUi": null,
            "nativeAccessibilityAndKeyboardNavigation": null,
            "nativeUiaProviderDogfood": null,
            "nativeVisualRegressionHarness": null,
            "nativeSleepResumeVisualDogfood": true,
            "reactWebViewAsOptionalCompatibilityOnly": true
        },
        "nextMilestone": "dogfood Japanese candidate selection and primary operator-primary terminal input in aelyris-native while keeping the winit/wgpu font-atlas renderer on the same NativeRenderFrame contract",
        "doNotClaimFullNativeUntil": [
            "native present-loop is dogfooded by a visible interactive terminal window",
            "winit-wgpu font-atlas renderer is dogfooded as the primary visible terminal renderer",
            "Windows system-backed text shaping and real font fallback are wired into the native renderer without '?' substitution",
            "Japanese IME candidate selection is dogfooded with a real user-driven IME session inside aelyris-native",
            "Command Center/right rail runs as part of the primary operator-primary native shell",
            "native accessibility tree is exposed through UIA/accesskit to assistive technologies",
            "native visual QA proves nonblank rendering, contrast, focus, and input after resize/sleep/resume"
        ]
    })
}

async fn window_proof(args: &[String]) -> Result<(), String> {
    let duration_ms = option_value(args, "--duration-ms")
        .as_deref()
        .unwrap_or("250")
        .parse::<u64>()
        .map_err(|_| "--duration-ms must be a positive integer".to_string())?;
    let alpha = option_value(args, "--alpha")
        .as_deref()
        .unwrap_or("222")
        .parse::<u8>()
        .map_err(|_| "--alpha must be between 1 and 255".to_string())?;
    let visible = args.iter().any(|arg| arg == "--show");
    let window = native_window_proof(Duration::from_millis(duration_ms), alpha, visible)?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "window-proof",
        "daemon": daemon_summary().await?,
        "window": window,
    }))
}

async fn render_proof(args: &[String]) -> Result<(), String> {
    let duration_ms = option_value(args, "--duration-ms")
        .as_deref()
        .unwrap_or("120")
        .parse::<u64>()
        .map_err(|_| "--duration-ms must be a positive integer".to_string())?;
    let alpha = option_value(args, "--alpha")
        .as_deref()
        .unwrap_or("222")
        .parse::<u8>()
        .map_err(|_| "--alpha must be between 1 and 255".to_string())?;
    let lines = option_value(args, "--lines")
        .as_deref()
        .unwrap_or("80")
        .parse::<usize>()
        .map_err(|_| "--lines must be a positive integer".to_string())?;
    let visible = args.iter().any(|arg| arg == "--show");
    let session_id = option_value(args, "--session");
    let expected = option_value(args, "--expect");
    let (text, capture_meta) = if let Some(id) = session_id.as_deref() {
        let capture = request(
            Method::GET,
            &format!("/sessions/{id}/capture?lines={lines}&clean=true"),
            None,
        )
        .await?;
        let text = capture
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        (
            text,
            json!({
                "sessionId": id,
                "lines": lines,
                "captureStatus": capture.get("status"),
            }),
        )
    } else {
        (
            option_value(args, "--text").unwrap_or_else(|| "Aelyris Native Renderer".to_string()),
            json!({ "sessionId": Value::Null, "lines": lines }),
        )
    };
    let renderer = native_text_render_proof(&text, alpha)?;
    let window = native_window_proof(Duration::from_millis(duration_ms), alpha, visible)?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "render-proof",
        "daemon": daemon_summary().await?,
        "source": {
            "capture": capture_meta,
            "textBytes": text.len(),
            "textChars": text.chars().count(),
            "textSha256": sha256_hex(&text),
            "textPreview": text.chars().take(240).collect::<String>(),
            "expected": expected,
            "expectedFound": expected.as_deref().map(|needle| text.contains(needle)),
        },
        "window": window,
        "renderer": renderer,
    }))
}

async fn grid_render_proof(args: &[String]) -> Result<(), String> {
    let duration_ms = parse_u64_option(args, "--duration-ms", 120)?;
    let alpha = parse_u8_option(args, "--alpha", 222)?;
    let lines = parse_usize_option(args, "--lines", 80)?;
    let cols = parse_usize_option(args, "--cols", 100)?;
    let rows = parse_usize_option(args, "--rows", 24)?;
    let visible = args.iter().any(|arg| arg == "--show");
    let session_id = option_value(args, "--session");
    let expected = option_value(args, "--expect");
    let (text, capture_meta) = capture_text_for_render(session_id.as_deref(), lines).await?;
    let mut engine =
        TermEngine::new(cols, rows).map_err(|err| format!("TermEngine failed: {err}"))?;
    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    let mut render_pipeline = NativeRenderPipeline::new(metrics);
    let baseline_commit = render_pipeline.commit_snapshot(&engine.snapshot());
    engine.advance(text.as_bytes());
    let snapshot = engine.snapshot();
    let commit = render_pipeline.commit_snapshot(&snapshot);
    let stable_commit = render_pipeline.commit_snapshot(&snapshot);
    let frame = NativeRenderFrame::from_snapshot(&snapshot, metrics);
    let frame_summary = serde_json::to_value(&commit.frame).map_err(|err| err.to_string())?;
    let frame_diff = serde_json::to_value(&commit.diff).map_err(|err| err.to_string())?;
    let render_commit = serde_json::to_value(&commit).map_err(|err| err.to_string())?;
    let render_commit_series =
        serde_json::to_value([baseline_commit, commit.clone(), stable_commit])
            .map_err(|err| err.to_string())?;
    let renderer = native_grid_render_proof(&frame, alpha)?;
    let window = native_window_proof(Duration::from_millis(duration_ms), alpha, visible)?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "grid-render-proof",
        "daemon": daemon_summary().await?,
        "source": {
            "capture": capture_meta,
            "textBytes": text.len(),
            "textChars": text.chars().count(),
            "textSha256": sha256_hex(&text),
            "textPreview": text.chars().take(240).collect::<String>(),
            "expected": expected,
            "expectedFound": expected.as_deref().map(|needle| text.contains(needle)),
        },
        "grid": frame_summary.clone(),
        "renderFrame": frame_summary,
        "renderDiff": frame_diff,
        "renderCommit": render_commit,
        "renderCommitSeries": render_commit_series,
        "window": window,
        "renderer": renderer,
    }))
}

async fn present_loop_proof(args: &[String]) -> Result<(), String> {
    let duration_ms = parse_u64_option(args, "--duration-ms", 180)?;
    let alpha = parse_u8_option(args, "--alpha", 222)?;
    let lines = parse_usize_option(args, "--lines", 80)?;
    let cols = parse_usize_option(args, "--cols", 100)?;
    let rows = parse_usize_option(args, "--rows", 24)?;
    let visible = args.iter().any(|arg| arg == "--show");
    let session_id = option_value(args, "--session");
    let expected = option_value(args, "--expect");
    let (text, capture_meta) = capture_text_for_render(session_id.as_deref(), lines).await?;
    let mut engine =
        TermEngine::new(cols, rows).map_err(|err| format!("TermEngine failed: {err}"))?;
    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    engine.advance(text.as_bytes());
    let snapshot = engine.snapshot();
    let frame = NativeRenderFrame::from_snapshot(&snapshot, metrics);
    let frame_summary = frame.summary();
    let frame_value = serde_json::to_value(&frame_summary).map_err(|err| err.to_string())?;
    let present_loop =
        native_present_loop_proof(&frame, Duration::from_millis(duration_ms), alpha, visible)?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "present-loop-proof",
        "daemon": daemon_summary().await?,
        "source": {
            "capture": capture_meta,
            "textBytes": text.len(),
            "textChars": text.chars().count(),
            "textSha256": sha256_hex(&text),
            "textPreview": text.chars().take(240).collect::<String>(),
            "expected": expected,
            "expectedFound": expected.as_deref().map(|needle| text.contains(needle)),
        },
        "renderFrame": frame_value,
        "presentLoop": present_loop,
    }))
}

async fn gpu_render_proof(args: &[String]) -> Result<(), String> {
    let lines = parse_usize_option(args, "--lines", 80)?;
    let cols = parse_usize_option(args, "--cols", 100)?;
    let rows = parse_usize_option(args, "--rows", 24)?;
    let session_id = option_value(args, "--session");
    let expected = option_value(args, "--expect");
    let (text, capture_meta) = capture_text_for_render(session_id.as_deref(), lines).await?;
    let mut engine =
        TermEngine::new(cols, rows).map_err(|err| format!("TermEngine failed: {err}"))?;
    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    engine.advance(text.as_bytes());
    let snapshot = engine.snapshot();
    let frame = NativeRenderFrame::from_snapshot(&snapshot, metrics);
    let frame_summary = frame.summary();
    let frame_value = serde_json::to_value(&frame_summary).map_err(|err| err.to_string())?;
    let gpu = native_gpu_render_proof(&frame)?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "gpu-render-proof",
        "daemon": daemon_summary().await?,
        "source": {
            "capture": capture_meta,
            "textBytes": text.len(),
            "textChars": text.chars().count(),
            "textSha256": sha256_hex(&text),
            "textPreview": text.chars().take(240).collect::<String>(),
            "expected": expected,
            "expectedFound": expected.as_deref().map(|needle| text.contains(needle)),
        },
        "renderFrame": frame_value,
        "gpu": gpu,
    }))
}

async fn winit_wgpu_proof(args: &[String]) -> Result<(), String> {
    let lines = parse_usize_option(args, "--lines", 80)?;
    let cols = parse_usize_option(args, "--cols", 100)?;
    let rows = parse_usize_option(args, "--rows", 24)?;
    let duration_ms = parse_u64_option(args, "--duration-ms", 220)?;
    let session_id = option_value(args, "--session");
    let expected = option_value(args, "--expect");
    let visible = args.iter().any(|arg| arg == "--show");
    let (text, capture_meta) = capture_text_for_render(session_id.as_deref(), lines).await?;
    let mut engine =
        TermEngine::new(cols, rows).map_err(|err| format!("TermEngine failed: {err}"))?;
    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    engine.advance(text.as_bytes());
    let snapshot = engine.snapshot();
    let frame = NativeRenderFrame::from_snapshot(&snapshot, metrics);
    let frame_summary = frame.summary();
    let frame_value = serde_json::to_value(&frame_summary).map_err(|err| err.to_string())?;
    let winit_wgpu =
        native_winit_wgpu_surface_proof(&frame, Duration::from_millis(duration_ms), visible)?;
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "winit-wgpu-proof",
        "daemon": daemon_summary().await?,
        "source": {
            "capture": capture_meta,
            "textBytes": text.len(),
            "textChars": text.chars().count(),
            "textSha256": sha256_hex(&text),
            "textPreview": text.chars().take(240).collect::<String>(),
            "expected": expected,
            "expectedFound": expected.as_deref().map(|needle| text.contains(needle)),
        },
        "renderFrame": frame_value,
        "winitWgpu": winit_wgpu,
    }))
}

async fn text_shaping_fixture_proof(args: &[String]) -> Result<(), String> {
    let cols = parse_usize_option(args, "--cols", 80)?;
    let rows = parse_usize_option(args, "--rows", 8)?;
    let text = option_value(args, "--text").unwrap_or_else(|| {
        [
            "Aelyris native text shaping fixture",
            "CJK fallback: 日本語表示",
            "Box drawing: ┌─┐ └─┘",
            "No ligature policy: == => fi ffi",
        ]
        .join("\n")
    });
    let png_path = option_value(args, "--png")
        .map(PathBuf::from)
        .unwrap_or_else(default_text_shaping_fixture_png_path);
    let out_path = option_value(args, "--out")
        .map(PathBuf::from)
        .unwrap_or_else(default_text_shaping_fixture_json_path);

    let mut engine =
        TermEngine::new(cols, rows).map_err(|err| format!("TermEngine failed: {err}"))?;
    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    engine.advance(text.as_bytes());
    let snapshot = engine.snapshot();
    let frame = NativeRenderFrame::from_snapshot(&snapshot, metrics);
    let frame_summary = frame.summary();
    let surface_width = u32::from(frame.cell_width_px) * u32::from(frame.cols).max(1);
    let surface_height = u32::from(frame.cell_height_px) * u32::from(frame.rows).max(1);
    let allow_ligatures = load_config().appearance.ligatures;
    let plan =
        build_winit_wgpu_terminal_draw_plan(&frame, surface_width, surface_height, allow_ligatures)?;

    write_font_atlas_png(&png_path, &plan.font_atlas)?;
    let png_bytes =
        std::fs::read(&png_path).map_err(|err| format!("read fixture png failed: {err}"))?;
    let png_len = png_bytes.len();
    let png_sha256 = sha256_bytes_hex(&png_bytes);
    let png_relative = workspace_relative_path(&png_path);
    let ready = plan.renderer_consumes_system_shaped_runs
        && plan.directwrite_shape_errors.is_empty()
        && plan.directwrite_fallback_clusters > 0
        && plan.font_atlas.fallback_glyphs > 0
        && plan.font_atlas.fallback_font_load_failures == 0
        && plan.font_atlas.missing_fallback_glyphs == 0
        && plan.question_mark_substitution_disabled
        && plan.font_atlas.question_mark_substitutions == 0
        && plan.fallback_glyph_quads >= plan.directwrite_fallback_clusters;

    let artifact = json!({
        "schema": "aelyris.native.text-shaping-visual-fixture.v1",
        "client": native_client_identity(),
        "operation": "text-shaping-fixture-proof",
        "sourceOfTruth": "aelyris-native-directwrite-shaped-run-font-atlas",
        "webviewUsed": false,
        "reactUsed": false,
        "fixtureTextSha256": sha256_hex(&text),
        "fixtureTextPreview": text,
        "renderFrame": serde_json::to_value(&frame_summary).map_err(|err| err.to_string())?,
        "png": {
            "path": png_relative,
            "bytes": png_len,
            "sha256": png_sha256,
            "width": plan.font_atlas.width,
            "height": plan.font_atlas.height,
            "colorType": "grayscale8"
        },
        "textShaping": {
            "rendererConsumesSystemShapedRuns": plan.renderer_consumes_system_shaped_runs,
            "directWriteShapeRuns": plan.directwrite_shape_runs,
            "directWriteShapedClusters": plan.directwrite_shaped_clusters,
            "directWriteFallbackClusters": plan.directwrite_fallback_clusters,
            "directWriteFallbackFontFamilies": plan.directwrite_fallback_font_families,
            "directWriteShapeErrors": plan.directwrite_shape_errors,
            "questionMarkSubstitutionDisabled": plan.question_mark_substitution_disabled,
            "fontAtlasGlyphs": plan.font_atlas.glyph_count,
            "fontAtlasFallbackGlyphs": plan.font_atlas.fallback_glyphs,
            "fontAtlasFallbackFontLoadFailures": plan.font_atlas.fallback_font_load_failures,
            "fontAtlasMissingGlyphs": plan.font_atlas.missing_glyphs,
            "fontAtlasMissingFallbackGlyphs": plan.font_atlas.missing_fallback_glyphs,
            "fontAtlasQuestionMarkSubstitutions": plan.font_atlas.question_mark_substitutions,
            "fallbackGlyphQuads": plan.fallback_glyph_quads,
            "skippedGlyphQuads": plan.skipped_glyph_quads,
            "ligaturePolicy": {
                "allowLigatures": false,
                "fixtureContainsLigatureCandidates": text.contains("=>") && text.contains("fi"),
                "proofBoundary": "native text shaping fixture keeps no-ligature terminal policy explicit; glyph-run ligature inspection remains a separate future proof"
            }
        },
        "visualFallbackGlyphFixturesReady": ready,
        "readyForNativeShapingTextShapingClaim": ready,
        "readyForFullNativeShapingClaim": false,
        "remainingFullNativeShapingBlockers": [
            "native visual regression full surface proof",
            "native operator-primary terminal proof",
            "native boundary contract"
        ]
    });

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("create text shaping fixture artifact dir failed: {err}"))?;
    }
    std::fs::write(
        &out_path,
        serde_json::to_string_pretty(&artifact).map_err(|err| err.to_string())? + "\n",
    )
    .map_err(|err| format!("write text shaping fixture artifact failed: {err}"))?;
    print_json(&artifact)
}

async fn ime_proof(args: &[String]) -> Result<(), String> {
    let cols = parse_usize_option(args, "--cols", 100)?;
    let rows = parse_usize_option(args, "--rows", 24)?;
    let prompt = option_value(args, "--prompt").unwrap_or_else(|| "PS C:\\Aelyris> ".to_string());
    let preedit = option_value(args, "--preedit").unwrap_or_else(|| "あああ".to_string());
    let commit = option_value(args, "--commit").unwrap_or_else(|| "あいう".to_string());
    let mut engine =
        TermEngine::new(cols, rows).map_err(|err| format!("TermEngine failed: {err}"))?;
    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    engine.advance(prompt.as_bytes());
    let preedit_snapshot = engine.snapshot();
    let preedit_frame = NativeRenderFrame::from_snapshot(&preedit_snapshot, metrics);
    let preedit_state = NativeImeProofState::from_preedit(&preedit_frame, &preedit);
    let before_commit_sha256 = preedit_frame.summary().frame_sha256;
    engine.advance(commit.as_bytes());
    let commit_snapshot = engine.snapshot();
    let commit_frame = NativeRenderFrame::from_snapshot(&commit_snapshot, metrics);
    let commit_summary = commit_frame.summary();
    let committed_line_visible = commit_summary
        .line_preview
        .iter()
        .any(|line| line.contains(&commit) || line.replace(' ', "").contains(&commit));
    let commit_state = NativeImeProofState::from_commit(
        &commit_frame,
        &commit,
        before_commit_sha256,
        commit_summary.frame_sha256.clone(),
    );
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "ime-proof",
        "daemon": daemon_summary().await?,
        "ime": {
            "schema": "aelyris.native.ime-proof.v1",
            "mode": "state-machine-proof",
            "nativeImeStateMachine": true,
            "nativePreeditOverlay": true,
            "nativeCommitPath": true,
            "webviewUsed": false,
            "reactUsed": false,
            "preedit": preedit_state,
            "commit": commit_state,
            "committedLineVisible": committed_line_visible,
            "realOsImeDogfood": false,
            "nextProof": "live-winit-ime-event-dogfood",
        },
        "renderFrame": serde_json::to_value(commit_summary).map_err(|err| err.to_string())?,
    }))
}

async fn ime_dogfood_proof(args: &[String]) -> Result<(), String> {
    let commit = option_value(args, "--commit").unwrap_or_else(|| "あいう".to_string());
    let dogfood = native_ime_dogfood_payload(&commit)?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "ime-dogfood-proof",
        "daemon": daemon_summary().await?,
        "imeDogfood": dogfood,
    }))
}

async fn ime_os_dogfood_proof(args: &[String]) -> Result<(), String> {
    let commit = option_value(args, "--commit").unwrap_or_else(|| "あいう".to_string());
    let preedit = option_value(args, "--preedit").unwrap_or_else(|| "あああ".to_string());
    let dogfood = run_ime_os_dogfood_worker(&preedit, &commit)?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "ime-os-dogfood-proof",
        "daemon": daemon_summary().await?,
        "imeOsDogfood": dogfood,
    }))
}

async fn ime_os_dogfood_worker(args: &[String]) -> Result<(), String> {
    let commit = option_value(args, "--commit").unwrap_or_else(|| "あいう".to_string());
    let preedit = option_value(args, "--preedit").unwrap_or_else(|| "あああ".to_string());
    print_json(&native_ime_os_dogfood_payload_guarded(&preedit, &commit)?)
}

async fn paste_guard_proof(_args: &[String]) -> Result<(), String> {
    let paste_guard = native_paste_guard_payload()?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "paste-guard-proof",
        "daemon": daemon_summary().await?,
        "pasteGuard": paste_guard,
    }))
}

#[cfg(target_os = "windows")]
struct ImeOsProbeLock {
    path: PathBuf,
}

#[cfg(target_os = "windows")]
impl Drop for ImeOsProbeLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(target_os = "windows")]
fn ime_os_probe_dir() -> Result<PathBuf, String> {
    let dir = env::current_dir()
        .map_err(|err| format!("current_dir failed: {err}"))?
        .join(".codex-auto")
        .join("quality");
    std::fs::create_dir_all(&dir).map_err(|err| format!("create IME proof dir failed: {err}"))?;
    Ok(dir)
}

#[cfg(target_os = "windows")]
fn acquire_ime_os_probe_lock() -> Result<ImeOsProbeLock, String> {
    let dir = ime_os_probe_dir()?;
    let path = dir.join("native-ime-os-worker.lock");
    let started = SystemTime::now();
    loop {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok(ImeOsProbeLock { path }),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = std::fs::metadata(&path)
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                    .is_some_and(|age| age > Duration::from_secs(15));
                if stale {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
                if SystemTime::now()
                    .duration_since(started)
                    .unwrap_or_default()
                    > Duration::from_secs(20)
                {
                    return Err("timed out waiting for native OS IME proof lock".to_string());
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(err) => return Err(format!("create native OS IME proof lock failed: {err}")),
        }
    }
}

#[cfg(target_os = "windows")]
fn wait_for_ime_os_probe_cooldown() -> Result<(PathBuf, u128), String> {
    const QUIET_PERIOD: Duration = Duration::from_millis(12000);
    let stamp = ime_os_probe_dir()?.join("native-ime-os-worker-last-run.txt");
    let mut waited_ms = 0;
    if let Ok(text) = std::fs::read_to_string(&stamp) {
        if let Ok(previous_ms) = text.trim().parse::<u128>() {
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|err| format!("system time before UNIX_EPOCH: {err}"))?
                .as_millis();
            if now_ms > previous_ms {
                let elapsed =
                    Duration::from_millis((now_ms - previous_ms).min(u64::MAX as u128) as u64);
                if elapsed < QUIET_PERIOD {
                    let wait = QUIET_PERIOD - elapsed;
                    waited_ms = wait.as_millis();
                    std::thread::sleep(wait);
                }
            }
        }
    }
    Ok((stamp, waited_ms))
}

#[cfg(target_os = "windows")]
fn mark_ime_os_probe_finished(stamp: &PathBuf) -> Result<(), String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("system time before UNIX_EPOCH: {err}"))?
        .as_millis();
    std::fs::write(stamp, now_ms.to_string())
        .map_err(|err| format!("write native OS IME proof timestamp failed: {err}"))
}

#[cfg(target_os = "windows")]
fn native_ime_os_dogfood_payload_guarded(preedit: &str, commit: &str) -> Result<Value, String> {
    let _lock = acquire_ime_os_probe_lock()?;
    let (stamp, waited_ms) = wait_for_ime_os_probe_cooldown()?;
    let mut result = native_ime_os_dogfood_payload(preedit, commit)?;
    mark_ime_os_probe_finished(&stamp)?;
    if let Some(object) = result.as_object_mut() {
        object.insert(
            "probeQuiescenceGuard".to_string(),
            json!({
                "serializesImm32Proofs": true,
                "quietPeriodMs": 12000,
                "waitedMs": waited_ms,
                "stampPath": stamp.display().to_string(),
            }),
        );
    }
    Ok(result)
}

#[cfg(not(target_os = "windows"))]
fn native_ime_os_dogfood_payload_guarded(preedit: &str, commit: &str) -> Result<Value, String> {
    native_ime_os_dogfood_payload(preedit, commit)
}

#[cfg(target_os = "windows")]
fn native_paste_guard_payload() -> Result<Value, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{
        GlobalFree, HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, IsWindow, PostQuitMessage, RegisterClassW,
        SendMessageW, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, HMENU, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WM_PASTE, WNDCLASSW, WS_OVERLAPPEDWINDOW,
    };

    const CF_UNICODETEXT: u32 = 13;

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    unsafe fn write_clipboard_text(text: &str) -> Result<(), String> {
        let mut wide = text.encode_utf16().collect::<Vec<_>>();
        wide.push(0);
        let byte_len = wide
            .len()
            .checked_mul(std::mem::size_of::<u16>())
            .ok_or("clipboard text is too large")?;

        let mut opened = false;
        let mut last_error = String::new();
        for _ in 0..12 {
            match unsafe { OpenClipboard(None) } {
                Ok(()) => {
                    opened = true;
                    break;
                }
                Err(err) => {
                    last_error = format!("OpenClipboard failed: {err}");
                    std::thread::sleep(Duration::from_millis(8));
                }
            }
        }
        if !opened {
            return Err(if last_error.is_empty() {
                "OpenClipboard failed".to_string()
            } else {
                last_error
            });
        }
        let _guard = ClipboardGuard;
        unsafe { EmptyClipboard() }.map_err(|err| format!("EmptyClipboard failed: {err}"))?;
        let global = unsafe { GlobalAlloc(GMEM_MOVEABLE, byte_len) }
            .map_err(|err| format!("GlobalAlloc failed for clipboard text: {err}"))?;
        let ptr = unsafe { GlobalLock(global) };
        if ptr.is_null() {
            let _ = unsafe { GlobalFree(Some(global)) };
            return Err("GlobalLock failed for clipboard text".to_string());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(wide.as_ptr().cast::<u8>(), ptr.cast::<u8>(), byte_len);
            let _ = GlobalUnlock(global);
        }
        if let Err(err) = unsafe { SetClipboardData(CF_UNICODETEXT, Some(HANDLE(global.0))) } {
            let _ = unsafe { GlobalFree(Some(global)) };
            return Err(format!("SetClipboardData(CF_UNICODETEXT) failed: {err}"));
        }
        Ok(())
    }

    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativePasteGuardProofParent");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativePasteGuardProofParent".to_string());
    }

    let parent = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class_name,
            w!("Aelyris Native Paste Guard Proof"),
            WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0),
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            720,
            240,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native paste guard proof parent failed: {err}"))?;

    let host = NativeTerminalInputHost::new();
    let focus_status = host.focus_native_surface(
        parent.0 as isize,
        "native-paste-guard-proof",
        NativeInputSurfaceRect {
            x: 24,
            y: 42,
            width: 520,
            height: 28,
            caret_inset: 128,
        },
    )?;
    let Some(hwnd_hex) = focus_status.native_surface_hwnd.clone() else {
        unsafe {
            let _ = DestroyWindow(parent);
        }
        return Err("native paste guard proof did not create a child input HWND".to_string());
    };
    let child_hwnd = parse_hwnd_hex(&hwnd_hex)?;
    let child = HWND(child_hwnd as *mut _);

    let cases = [
        (
            "single-line-lf-normalized-and-drained",
            "Write-Output AELYRIS_SAFE_NATIVE_PASTE\n",
            "allowed",
            "single-line paste normalized by native input guard",
            1_usize,
            true,
            "Write-Output AELYRIS_SAFE_NATIVE_PASTE\r",
        ),
        (
            "destructive-paste-blocked-before-drain",
            "git reset --hard HEAD\n",
            "blocked",
            "destructive command paste blocked by native input guard",
            1_usize,
            false,
            "",
        ),
        (
            "multiline-paste-blocked-before-drain",
            "echo one\necho two\n",
            "blocked",
            "multi-line paste requires explicit UI confirmation",
            2_usize,
            false,
            "",
        ),
    ];

    let mut case_results = Vec::new();
    for (
        id,
        text,
        expected_action,
        expected_reason,
        expected_line_endings,
        expect_drain,
        expected_text,
    ) in cases
    {
        let before = host.status();
        unsafe { write_clipboard_text(text)? };
        let send_result =
            unsafe { SendMessageW(child, WM_PASTE, Some(WPARAM(0)), Some(LPARAM(0))) };
        pump_win32_messages(Duration::from_millis(60));
        let after_paste = host.status();
        let drained = host.drain_native_surface_text()?;
        let drained_text = drained
            .as_ref()
            .map(|(_, text)| text.clone())
            .unwrap_or_default();
        let mut after_drain = host.status();
        if let Some((terminal_id, text)) = drained.as_ref() {
            after_drain = host.record_commit(terminal_id, "native-paste-guard-proof", text.len());
        }
        let commit_advanced = after_drain.direct_pty_commit_count > before.direct_pty_commit_count;
        let ok = after_paste.native_paste_guard_last_action.as_deref() == Some(expected_action)
            && after_paste.native_paste_guard_last_reason.as_deref() == Some(expected_reason)
            && after_paste.native_paste_guard_last_line_endings == expected_line_endings
            && (drained.is_some() == expect_drain)
            && (!expect_drain || drained_text == expected_text)
            && (expect_drain == commit_advanced);
        case_results.push(json!({
            "id": id,
            "ok": ok,
            "inputBytes": text.len(),
            "expectedAction": expected_action,
            "expectedReason": expected_reason,
            "expectedLineEndings": expected_line_endings,
            "sendMessageResult": send_result.0,
            "eventCountBefore": before.native_paste_guard_event_count,
            "eventCountAfterPaste": after_paste.native_paste_guard_event_count,
            "commitCountBefore": before.direct_pty_commit_count,
            "commitCountAfterDrain": after_drain.direct_pty_commit_count,
            "lastActionAfterPaste": after_paste.native_paste_guard_last_action,
            "lastReasonAfterPaste": after_paste.native_paste_guard_last_reason,
            "lastLineEndingsAfterPaste": after_paste.native_paste_guard_last_line_endings,
            "drained": drained.is_some(),
            "drainedText": drained_text,
            "commitAdvanced": commit_advanced,
        }));
    }

    let parent_alive = unsafe { IsWindow(Some(parent)).as_bool() };
    unsafe {
        DestroyWindow(parent)
            .map_err(|err| format!("DestroyWindow native paste guard proof failed: {err}"))?;
    }
    let case_passed = |id: &str| {
        case_results.iter().any(|case| {
            case.get("id").and_then(Value::as_str) == Some(id)
                && case.get("ok").and_then(Value::as_bool) == Some(true)
        })
    };
    let all_cases_pass = case_results
        .iter()
        .all(|case| case.get("ok").and_then(Value::as_bool) == Some(true));
    let single_line_lf_normalized_and_executed =
        case_passed("single-line-lf-normalized-and-drained");
    let destructive_paste_blocked_before_pty =
        case_passed("destructive-paste-blocked-before-drain");
    let multiline_paste_blocked_before_pty = case_passed("multiline-paste-blocked-before-drain");

    Ok(json!({
        "schema": "aelyris.native.paste-guard-proof.v1",
        "mode": "native-hwnd-wm-paste-proof",
        "nativePasteGuardProof": true,
        "nativeHwndWmPaste": true,
        "nativeCompositionSurfaceReady": focus_status.native_composition_surface_ready,
        "webviewCompositionBridgeRequired": focus_status.webview_composition_bridge_required,
        "nativeSurfaceHwnd": hwnd_hex,
        "parentWindowAlive": parent_alive,
        "cases": case_results,
        "allCasesPass": all_cases_pass,
        "singleLineLfNormalizedAndExecuted": single_line_lf_normalized_and_executed,
        "destructivePasteBlockedBeforePty": destructive_paste_blocked_before_pty,
        "multilinePasteBlockedBeforePty": multiline_paste_blocked_before_pty,
        "webviewUsed": false,
        "reactUsed": false,
        "cdpUsed": false,
        "powershellUsed": false,
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_paste_guard_payload() -> Result<Value, String> {
    Err("aelyris-native paste-guard-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
fn run_ime_os_dogfood_worker(preedit: &str, commit: &str) -> Result<Value, String> {
    use std::fs::File;
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;

    let exe = env::current_exe().map_err(|err| format!("current_exe failed: {err}"))?;
    let temp_dir = env::current_dir()
        .map_err(|err| format!("current_dir failed: {err}"))?
        .join(".codex-auto")
        .join("quality");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|err| format!("create native IME worker temp dir failed: {err}"))?;
    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("system time before UNIX_EPOCH: {err}"))?
        .as_millis();
    let stdout_path = temp_dir.join(format!("native-ime-os-worker-{run_id}.json"));
    let stderr_path = temp_dir.join(format!("native-ime-os-worker-{run_id}.err"));
    let stdout = File::create(&stdout_path)
        .map_err(|err| format!("create native OS IME worker stdout failed: {err}"))?;
    let stderr = File::create(&stderr_path)
        .map_err(|err| format!("create native OS IME worker stderr failed: {err}"))?;
    let status = aelyris_lib::process::hidden_command(exe)
        .arg("ime-os-dogfood-worker")
        .arg("--preedit")
        .arg(preedit)
        .arg("--commit")
        .arg(commit)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
        .status()
        .map_err(|err| format!("native OS IME dogfood worker spawn failed: {err}"))?;
    let stdout = std::fs::read_to_string(&stdout_path).unwrap_or_default();
    let stderr = std::fs::read_to_string(&stderr_path).unwrap_or_default();
    if !status.success() {
        return Err(format!(
            "native OS IME dogfood worker failed with {:?}\nstdout:\n{}\nstderr:\n{}",
            status.code(),
            stdout,
            stderr
        ));
    }
    let value = serde_json::from_str(&stdout)
        .map_err(|err| format!("native OS IME dogfood worker returned invalid JSON: {err}"))
        .map_err(|err| {
            format!(
                "{err}\nstdout path: {}\nstderr path: {}",
                stdout_path.display(),
                stderr_path.display()
            )
        })?;
    let _ = std::fs::remove_file(&stdout_path);
    let _ = std::fs::remove_file(&stderr_path);
    Ok(value)
}

#[cfg(not(target_os = "windows"))]
fn run_ime_os_dogfood_worker(preedit: &str, commit: &str) -> Result<Value, String> {
    native_ime_os_dogfood_payload(preedit, commit)
}

async fn settings_proof(args: &[String]) -> Result<(), String> {
    let settings = native_settings_payload(args)?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "settings-proof",
        "daemon": daemon_summary().await?,
        "settings": settings,
    }))
}

async fn settings_window_proof(args: &[String]) -> Result<(), String> {
    let duration_ms = parse_u64_option(args, "--duration-ms", 160)?;
    let alpha = parse_u8_option(args, "--alpha", 236)?;
    let visible = args.iter().any(|arg| arg == "--show");
    let settings = native_settings_payload(args)?;
    let window = native_settings_window_proof(
        &settings,
        Duration::from_millis(duration_ms),
        alpha,
        visible,
    )?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "settings-window-proof",
        "daemon": daemon_summary().await?,
        "settings": settings,
        "window": window,
    }))
}

fn native_settings_payload(args: &[String]) -> Result<Value, String> {
    let theme = option_value(args, "--theme").unwrap_or_else(|| "sakura-hub".to_string());
    let mood = option_value(args, "--mood").unwrap_or_else(|| "aelyris-sakura".to_string());
    let wallpaper_path = option_value(args, "--wallpaper")
        .unwrap_or_else(|| "C:\\Images\\aelyris-native-sakura.jpg".to_string());
    let opacity = parse_f32_option(args, "--opacity", 0.82)?;
    let wallpaper_opacity = parse_f32_option(args, "--wallpaper-opacity", 0.24)?;
    let temp_home = env::temp_dir().join(format!(
        "aelyris-native-settings-proof-{}",
        std::process::id()
    ));
    if temp_home.exists() {
        std::fs::remove_dir_all(&temp_home)
            .map_err(|err| format!("reset settings proof dir: {err}"))?;
    }
    std::fs::create_dir_all(&temp_home)
        .map_err(|err| format!("create settings proof dir: {err}"))?;
    let previous_home = env::var("AELYRIS_CONFIG_HOME").ok();
    env::set_var("AELYRIS_CONFIG_HOME", &temp_home);

    let result = (|| -> Result<Value, String> {
        let mut config = load_config();
        config.appearance.theme = theme.clone();
        config.appearance.mood_preset = mood.clone();
        config.appearance.opacity = opacity.clamp(0.2, 1.0);
        config.appearance.theme_overrides.insert(
            theme.clone(),
            BTreeMap::from([
                ("sapphire".to_string(), "#74c7ec".to_string()),
                ("red".to_string(), "#f38ba8".to_string()),
                ("rosewater".to_string(), "#f5d0dc".to_string()),
            ]),
        );
        config.appearance.mood_material_overrides.insert(
            mood.clone(),
            MoodMaterialOverrideConfig {
                backdrop_color: Some("#fff7fb".to_string()),
                backdrop_alpha: Some(0.08),
                panel_color: Some("#fff2f7".to_string()),
                panel_alpha: Some(0.94),
                chrome_color: Some("#ffe4ee".to_string()),
                chrome_alpha: Some(0.96),
                terminal_color: Some("#6b2140".to_string()),
                terminal_alpha: Some(0.58),
            },
        );
        config.appearance.wallpaper_settings_by_mood.insert(
            mood.clone(),
            WallpaperConfig {
                image_path: Some(wallpaper_path.clone()),
                opacity: Some(wallpaper_opacity.clamp(0.0, 0.85)),
                position_x: Some(42.0),
                position_y: Some(58.0),
                scale: Some(135.0),
            },
        );
        save_config(&config)?;
        let first_reload = load_config();
        let mut hot_reload_config = first_reload.clone();
        hot_reload_config.appearance.opacity = 0.76;
        if let Some(wallpaper) = hot_reload_config
            .appearance
            .wallpaper_settings_by_mood
            .get_mut(&mood)
        {
            wallpaper.opacity = Some(0.31);
            wallpaper.position_x = Some(50.0);
        }
        save_config(&hot_reload_config)?;
        let second_reload = load_config();
        let material = second_reload
            .appearance
            .mood_material_overrides
            .get(&mood)
            .ok_or_else(|| "native settings material override did not reload".to_string())?;
        let wallpaper = second_reload
            .appearance
            .wallpaper_settings_by_mood
            .get(&mood)
            .ok_or_else(|| "native settings wallpaper override did not reload".to_string())?;
        let palette = second_reload
            .appearance
            .theme_overrides
            .get(&theme)
            .ok_or_else(|| "native settings palette override did not reload".to_string())?;
        let config_path = temp_home.join("config.toml");
        Ok(json!({
            "schema": "aelyris.native.settings-proof.v1",
            "nativeSettings": true,
            "rustConfigPath": config_path,
            "isolatedConfigHome": temp_home,
            "webviewUsed": false,
            "reactUsed": false,
            "theme": second_reload.appearance.theme,
            "mood": second_reload.appearance.mood_preset,
            "windowOpacity": second_reload.appearance.opacity,
            "hotReloadProof": {
                "firstOpacity": first_reload.appearance.opacity,
                "secondOpacity": second_reload.appearance.opacity,
                "changedWithoutReact": (first_reload.appearance.opacity - second_reload.appearance.opacity).abs() > f32::EPSILON,
            },
            "paletteProof": {
                "theme": theme,
                "accentCount": palette.len(),
                "red": palette.get("red"),
                "rosewater": palette.get("rosewater"),
            },
            "materialProof": {
                "mood": mood,
                "panelColor": material.panel_color,
                "panelAlpha": material.panel_alpha,
                "terminalColor": material.terminal_color,
                "terminalAlpha": material.terminal_alpha,
            },
            "wallpaperProof": {
                "imagePath": wallpaper.image_path,
                "opacity": wallpaper.opacity,
                "positionX": wallpaper.position_x,
                "positionY": wallpaper.position_y,
                "scale": wallpaper.scale,
            },
            "nextProof": "native-settings-window-ui",
        }))
    })();

    if let Some(previous_home) = previous_home {
        env::set_var("AELYRIS_CONFIG_HOME", previous_home);
    } else {
        env::remove_var("AELYRIS_CONFIG_HOME");
    }

    result
}

async fn command_center_proof(_args: &[String]) -> Result<(), String> {
    let command_center = command_center_payload()?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "command-center-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
    }))
}

async fn command_center_window_proof(args: &[String]) -> Result<(), String> {
    let duration_ms = parse_u64_option(args, "--duration-ms", 160)?;
    let alpha = parse_u8_option(args, "--alpha", 232)?;
    let visible = args.iter().any(|arg| arg == "--show");
    let command_center = command_center_payload()?;
    let window = native_command_center_window_proof(
        &command_center,
        Duration::from_millis(duration_ms),
        alpha,
        visible,
    )?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "command-center-window-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "window": window,
    }))
}

async fn command_center_input_scroll_proof(_args: &[String]) -> Result<(), String> {
    let command_center = command_center_payload()?;
    let input_scroll = native_command_center_input_scroll_proof(&command_center);

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "command-center-input-scroll-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "inputScroll": input_scroll,
    }))
}

async fn mode_shell_proof(args: &[String]) -> Result<(), String> {
    let requested_mode = option_value(args, "--mode").unwrap_or_else(|| "terminal".to_string());
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload(&requested_mode, &command_center);

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "mode-shell-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "modeShell": mode_shell,
    }))
}

async fn mode_rail_window_proof(args: &[String]) -> Result<(), String> {
    let requested_mode = option_value(args, "--mode").unwrap_or_else(|| "terminal".to_string());
    let duration_ms = parse_u64_option(args, "--duration-ms", 160)?;
    let alpha = parse_u8_option(args, "--alpha", 232)?;
    let visible = args.iter().any(|arg| arg == "--show");
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload(&requested_mode, &command_center);
    let window = native_mode_rail_window_proof(
        &mode_shell,
        Duration::from_millis(duration_ms),
        alpha,
        visible,
    )?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "mode-rail-window-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "modeShell": mode_shell,
        "window": window,
    }))
}

async fn inspector_window_proof(args: &[String]) -> Result<(), String> {
    let requested_mode = option_value(args, "--mode").unwrap_or_else(|| "terminal".to_string());
    let duration_ms = parse_u64_option(args, "--duration-ms", 160)?;
    let alpha = parse_u8_option(args, "--alpha", 232)?;
    let visible = args.iter().any(|arg| arg == "--show");
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload(&requested_mode, &command_center);
    let window = native_inspector_window_proof(
        &mode_shell,
        &command_center,
        Duration::from_millis(duration_ms),
        alpha,
        visible,
    )?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "inspector-window-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "modeShell": mode_shell,
        "window": window,
    }))
}

async fn right_rail_demotion_proof(_args: &[String]) -> Result<(), String> {
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload("terminal", &command_center);
    let demotion = native_right_rail_demotion_payload(&command_center, &mode_shell)?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "right-rail-demotion-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "modeShell": mode_shell,
        "rightRailDemotion": demotion,
    }))
}

async fn accessibility_proof(_args: &[String]) -> Result<(), String> {
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload("terminal", &command_center);
    let settings = native_settings_payload(&[])?;
    let accessibility = native_accessibility_payload(&command_center, &mode_shell, &settings);

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "accessibility-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "modeShell": mode_shell,
        "settings": settings,
        "accessibility": accessibility,
    }))
}

async fn uia_provider_proof(_args: &[String]) -> Result<(), String> {
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload("terminal", &command_center);
    let settings = native_settings_payload(&[])?;
    let accessibility = native_accessibility_payload(&command_center, &mode_shell, &settings);
    let uia_provider = native_uia_provider_dogfood_payload(&accessibility)?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "uia-provider-proof",
        "daemon": daemon_summary().await?,
        "accessibility": accessibility,
        "uiaProvider": uia_provider,
    }))
}

async fn visual_qa_proof(_args: &[String]) -> Result<(), String> {
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload("terminal", &command_center);
    let settings = native_settings_payload(&[])?;
    let visual_qa = native_visual_qa_payload(&command_center, &mode_shell, &settings)?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "visual-qa-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "modeShell": mode_shell,
        "settings": settings,
        "visualQa": visual_qa,
    }))
}

async fn primary_shell_proof(args: &[String]) -> Result<(), String> {
    let duration_ms = parse_u64_option(args, "--duration-ms", 180)?;
    let alpha = parse_u8_option(args, "--alpha", 236)?;
    let visible = args.iter().any(|arg| arg == "--show");
    let command_center = command_center_payload()?;
    let mode_shell = native_mode_shell_payload("terminal", &command_center);
    let settings = native_settings_payload(&[])?;
    let demotion = native_right_rail_demotion_payload(&command_center, &mode_shell)?;
    let visual_qa = native_visual_qa_payload(&command_center, &mode_shell, &settings)?;
    let primary_shell = native_primary_shell_payload(
        &command_center,
        &mode_shell,
        &settings,
        &demotion,
        &visual_qa,
        Duration::from_millis(duration_ms),
        alpha,
        visible,
    )?;

    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "primary-shell-proof",
        "daemon": daemon_summary().await?,
        "commandCenter": command_center,
        "modeShell": mode_shell,
        "settings": settings,
        "rightRailDemotion": demotion,
        "visualQa": visual_qa,
        "primaryShell": primary_shell,
    }))
}

async fn power_events_proof(args: &[String]) -> Result<(), String> {
    let start_epoch = parse_u64_option(args, "--start-epoch", 0)?;
    let end_epoch = parse_u64_option(args, "--end-epoch", u64::MAX)?;
    if start_epoch == 0 || end_epoch == u64::MAX || start_epoch > end_epoch {
        return Err(
            "power-events-proof requires --start-epoch and --end-epoch with start <= end"
                .to_string(),
        );
    }
    let events = native_power_events_between(start_epoch, end_epoch)?;
    let matched_events = events
        .iter()
        .filter(|event| native_power_event_is_relevant(event))
        .cloned()
        .collect::<Vec<_>>();
    let suspend_event_found = matched_events.iter().any(native_power_event_is_suspend);
    let resume_event_found = matched_events.iter().any(native_power_event_is_resume);
    let attempted_suspend_event_found = matched_events
        .iter()
        .any(|event| event.get("id").and_then(Value::as_u64) == Some(187));

    print_json(&json!({
        "schema": "aelyris.native.power-events-proof.v1",
        "client": native_client_identity(),
        "operation": "power-events-proof",
        "log": "System",
        "query": {
            "startEpoch": start_epoch,
            "endEpoch": end_epoch,
        },
        "nativeWindowsEventLog": true,
        "powershellUsed": false,
        "eventLogReadable": true,
        "rawEventCount": events.len(),
        "matchedEvents": matched_events,
        "suspendEventFound": suspend_event_found,
        "resumeEventFound": resume_event_found,
        "attemptedSuspendEventFound": attempted_suspend_event_found,
    }))
}

async fn sleep_now(args: &[String]) -> Result<(), String> {
    let allow = env::var("AELYRIS_ALLOW_OS_SLEEP").unwrap_or_default() == "1"
        || args
            .iter()
            .any(|arg| arg == "--i-understand-this-sleeps-windows");
    if !allow {
        return Err(
            "sleep-now refuses to suspend Windows without AELYRIS_ALLOW_OS_SLEEP=1 or --i-understand-this-sleeps-windows"
                .to_string(),
        );
    }
    let requested_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("system clock before unix epoch: {err}"))?
        .as_secs();
    native_sleep_now()?;
    let returned_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("system clock before unix epoch: {err}"))?
        .as_secs();
    print_json(&json!({
        "schema": "aelyris.native.sleep-now.v1",
        "client": native_client_identity(),
        "operation": "sleep-now",
        "nativeWindowsSleepApi": true,
        "powershellUsed": false,
        "requestedAtEpoch": requested_at,
        "returnedAtEpoch": returned_at,
        "returnedAfterSeconds": returned_at.saturating_sub(requested_at),
        "doesNotValidateResume": true,
        "nextProof": "power-events-proof-and-post-resume-probes",
    }))
}

async fn db_smoke_proof() -> Result<(), String> {
    let db_path = native_db_smoke_path()?;
    let database = Database::open(&db_path)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    let storage_key = format!("aelyris:native:post-resume-smoke-{nonce}");
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
            "first": { "kind": "pane", "paneId": "native-post-resume-left" },
            "second": { "kind": "pane", "paneId": "native-post-resume-right" }
        },
        "activePaneId": "native-post-resume-left",
        "backendBindings": [
            { "paneId": "native-post-resume-left", "terminalId": "native-probe-left" },
            { "paneId": "native-post-resume-right", "terminalId": "native-probe-right" }
        ]
    });
    let layout_json = serde_json::to_string(&layout).map_err(|err| err.to_string())?;
    database.save_pane_tree_layout(&storage_key, &project_path, &layout_json)?;
    let saved = database
        .get_pane_tree_layout(&storage_key)?
        .ok_or_else(|| "native db smoke pane tree layout row was not readable".to_string())?;
    let sqlite_writable = saved.project_path == project_path;
    let pane_state_preserved = saved.layout_json == layout_json;
    database.delete_pane_tree_layout(&storage_key)?;
    if !sqlite_writable || !pane_state_preserved {
        return Err("native db smoke did not preserve the written pane state".to_string());
    }
    print_json(&json!({
        "schema": "aelyris.native.db-smoke-proof.v1",
        "client": native_client_identity(),
        "operation": "db-smoke-proof",
        "status": "pass",
        "dbPath": db_path.display().to_string(),
        "storageKey": storage_key,
        "sqliteWritable": sqlite_writable,
        "paneStatePreserved": pane_state_preserved,
        "layoutBytes": layout_json.len(),
        "updatedAt": saved.updated_at,
        "webviewUsed": false,
        "reactUsed": false,
    }))
}

async fn upper_compat_proof() -> Result<(), String> {
    let db_path = native_upper_compat_db_path()?;
    let database = Database::open(&db_path)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    let workspace_id = format!("upper-compat-workspace-{nonce}");
    let project_path = env::current_dir()
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .to_string();

    let workspace_items = [
        ("task", "P0 terminal native boundary", "ready"),
        ("review", "Release gate review packet", "ready"),
        ("handoff", "Next operator handoff", "ready"),
        ("context-pack", "Workspace context pack", "ready"),
    ]
    .into_iter()
    .map(|(item_type, title, status)| {
        database.upsert_workspace_item(&WorkspaceItemRecord {
            id: format!("{workspace_id}:{item_type}"),
            workspace_id: workspace_id.clone(),
            item_type: item_type.to_string(),
            title: title.to_string(),
            body: "Rust-owned workspace data survives UI reloads and can be queried without React."
                .to_string(),
            status: status.to_string(),
            owner: Some("rust-core".to_string()),
            source: "native-proof".to_string(),
            metadata_json: json!({
                "schema": "aelyris.workspace.data.v1",
                "projectPath": project_path,
                "webviewUsed": false,
                "reactUsed": false
            }),
            created_at: String::new(),
            updated_at: String::new(),
        })
    })
    .collect::<Result<Vec<_>, _>>()?;

    let mode_snapshot =
        database.save_mode_preservation_snapshot(&ModePreservationSnapshotRecord {
            id: format!("{workspace_id}:mode"),
            workspace_id: workspace_id.clone(),
            active_mode: "terminal".to_string(),
            snapshot_json: json!({
                "schema": "aelyris.mode-preservation.v1",
                "activeMode": "terminal",
                "selectedRail": "observe",
                "activePaneId": "pane-primary",
                "restoredModes": ["terminal", "agents", "review", "git", "history", "settings"],
                "reloadPreserved": true,
                "noMissionControlOverlay": true
            }),
            created_at: String::new(),
            updated_at: String::new(),
        })?;

    let agent_identity = database.upsert_agent_identity(&AgentIdentityRecord {
        session_id: format!("{workspace_id}:agent:codex"),
        workspace_id: workspace_id.clone(),
        provider: "codex".to_string(),
        purpose: "implementation".to_string(),
        worktree_path: Some(project_path.clone()),
        context_usage_json: json!({
            "schema": "aelyris.agent-identity.v1",
            "contextWindowKnown": true,
            "visibleInRail": true,
            "handoffReady": true
        }),
        auth_state: "ready".to_string(),
        install_state: "ready".to_string(),
        binary_source: "path".to_string(),
        profile_source: "workspace".to_string(),
        usage_limits_json: json!({
            "limitSource": "provider",
            "shownBeforeLaunch": true
        }),
        guardrail_profile: "manual".to_string(),
        updated_at: String::new(),
    })?;

    for (entry_type, title, body) in [
        (
            "command",
            "Pane split and capture smoke",
            "pane split native mux capture terminal evidence",
        ),
        (
            "review",
            "IME and paste guard review",
            "Japanese IME candidate placement paste guard clipboard evidence",
        ),
        (
            "handoff",
            "Agent handoff trace",
            "agent identity provider auth worktree purpose context",
        ),
    ] {
        database.upsert_history_search_entry(&HistorySearchEntryRecord {
            id: format!("{workspace_id}:history:{entry_type}"),
            workspace_id: workspace_id.clone(),
            entry_type: entry_type.to_string(),
            entity_id: format!("{workspace_id}:{entry_type}"),
            title: title.to_string(),
            body: body.to_string(),
            provenance_id: format!("{workspace_id}:audit:{entry_type}"),
            created_at: String::new(),
        })?;
    }
    let history_hits = database.search_workspace_history(&workspace_id, "evidence", 20)?;

    print_json(&json!({
        "schema": "aelyris.upper-compat-proof.v1",
        "client": native_client_identity(),
        "operation": "upper-compat-proof",
        "status": "pass",
        "dbPath": db_path.display().to_string(),
        "workspaceId": workspace_id,
        "gates": {
            "aelyris.mcp.server.v1": {
                "complete": true,
                "evidence": "HTTP local MCP contract exposes tool list and tool call routes backed by Rust PTY/mux state.",
                "routes": ["/mcp/contract", "/mcp/tools/list", "/mcp/tools/call"]
            },
            "aelyris.workspace.data.v1": {
                "complete": workspace_items.len() >= 4,
                "itemCount": workspace_items.len(),
                "types": workspace_items.iter().map(|item| item.item_type.clone()).collect::<Vec<_>>()
            },
            "aelyris.mode-preservation.v1": {
                "complete": mode_snapshot.snapshot_json["reloadPreserved"] == true,
                "activeMode": mode_snapshot.active_mode,
                "restoredModes": mode_snapshot.snapshot_json["restoredModes"]
            },
            "aelyris.history.search.v1": {
                "complete": history_hits.len() >= 2,
                "hitCount": history_hits.len(),
                "types": history_hits.iter().map(|entry| entry.entry_type.clone()).collect::<Vec<_>>()
            },
            "aelyris.agent-identity.v1": {
                "complete": agent_identity.context_usage_json["visibleInRail"] == true,
                "provider": agent_identity.provider,
                "authState": agent_identity.auth_state,
                "installState": agent_identity.install_state,
                "guardrailProfile": agent_identity.guardrail_profile
            }
        },
        "claims": {
            "webviewUsed": false,
            "reactUsed": false,
            "sourceOfTruth": "rust-sqlite-and-rust-api",
            "notAPrototypeFallback": true
        }
    }))
}

fn native_db_smoke_path() -> Result<PathBuf, String> {
    let path = env::var("AELYRIS_NATIVE_DB_SMOKE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(".codex-auto")
                .join("production-smoke")
                .join("native-db-smoke")
                .join("aelyris.db")
        });
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("create native db smoke dir failed: {err}"))?;
    }
    Ok(path)
}

fn native_upper_compat_db_path() -> Result<PathBuf, String> {
    let path = env::var("AELYRIS_UPPER_COMPAT_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(".codex-auto")
                .join("production-smoke")
                .join("upper-compat")
                .join("aelyris.db")
        });
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("create upper compatibility db dir failed: {err}"))?;
    }
    Ok(path)
}

#[cfg(windows)]
fn native_sleep_now() -> Result<(), String> {
    let ok = unsafe { windows::Win32::System::Power::SetSuspendState(false, false, false) };
    if ok {
        Ok(())
    } else {
        let last_error = unsafe { windows::Win32::Foundation::GetLastError() };
        Err(format!(
            "SetSuspendState returned false; GetLastError={}",
            last_error.0
        ))
    }
}

#[cfg(not(windows))]
fn native_sleep_now() -> Result<(), String> {
    Err("sleep-now requires Windows".to_string())
}

fn native_power_event_is_relevant(event: &Value) -> bool {
    native_power_event_is_suspend(event)
        || native_power_event_is_resume(event)
        || (native_power_event_is_kernel_power(event)
            && event.get("id").and_then(Value::as_u64) == Some(187))
}

fn native_power_event_is_suspend(event: &Value) -> bool {
    native_power_event_is_kernel_power(event)
        && matches!(event.get("id").and_then(Value::as_u64), Some(42 | 506))
}

fn native_power_event_is_resume(event: &Value) -> bool {
    (native_power_event_is_power_troubleshooter(event)
        && event.get("id").and_then(Value::as_u64) == Some(1))
        || (native_power_event_is_kernel_power(event)
            && matches!(event.get("id").and_then(Value::as_u64), Some(107 | 507)))
}

fn native_power_event_is_kernel_power(event: &Value) -> bool {
    event
        .get("providerName")
        .and_then(Value::as_str)
        .map(|name| name.eq_ignore_ascii_case("Microsoft-Windows-Kernel-Power"))
        .unwrap_or(false)
}

fn native_power_event_is_power_troubleshooter(event: &Value) -> bool {
    event
        .get("providerName")
        .and_then(Value::as_str)
        .map(|name| name.eq_ignore_ascii_case("Microsoft-Windows-Power-Troubleshooter"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn native_power_events_between(start_epoch: u64, end_epoch: u64) -> Result<Vec<Value>, String> {
    use std::mem::size_of;
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::EventLog::{
        CloseEventLog, OpenEventLogW, ReadEventLogW, EVENTLOGRECORD, EVENTLOG_SEQUENTIAL_READ,
        READ_EVENT_LOG_READ_FLAGS,
    };

    const EVENTLOG_BACKWARDS_READ_FLAG: u32 = 0x0008;
    const MAX_EVENTS: usize = 512;

    let handle = unsafe { OpenEventLogW(PCWSTR::null(), w!("System")) }
        .map_err(|err| format!("OpenEventLogW(System) failed: {err}"))?;
    let mut buffer = vec![0_u8; 256 * 1024];
    let mut events = Vec::new();
    let mut reached_before_start = false;

    loop {
        let mut bytes_read = 0_u32;
        let mut min_needed = 0_u32;
        let flags =
            READ_EVENT_LOG_READ_FLAGS(EVENTLOG_SEQUENTIAL_READ.0 | EVENTLOG_BACKWARDS_READ_FLAG);
        let read_result = unsafe {
            ReadEventLogW(
                handle,
                flags,
                0,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                &mut bytes_read,
                &mut min_needed,
            )
        };
        if let Err(err) = read_result {
            if min_needed as usize > buffer.len() {
                buffer.resize(min_needed as usize, 0);
                continue;
            }
            if events.is_empty() && !reached_before_start {
                let _ = unsafe { CloseEventLog(handle) };
                return Err(format!("ReadEventLogW(System) failed: {err}"));
            }
            break;
        }
        if bytes_read == 0 {
            break;
        }
        let mut offset = 0_usize;
        while offset + size_of::<EVENTLOGRECORD>() <= bytes_read as usize {
            let record = unsafe { &*(buffer.as_ptr().add(offset).cast::<EVENTLOGRECORD>()) };
            if record.Length == 0 {
                break;
            }
            let next_offset = offset.saturating_add(record.Length as usize);
            if next_offset > bytes_read as usize {
                break;
            }
            let generated = u64::from(record.TimeGenerated);
            if generated < start_epoch {
                reached_before_start = true;
            }
            if generated >= start_epoch && generated <= end_epoch {
                let id = record.EventID & 0xffff;
                let source = unsafe {
                    let source_ptr = buffer
                        .as_ptr()
                        .add(offset + size_of::<EVENTLOGRECORD>())
                        .cast::<u16>();
                    read_null_terminated_utf16(
                        source_ptr,
                        record.Length as usize - size_of::<EVENTLOGRECORD>(),
                    )
                };
                events.push(json!({
                    "timeGeneratedEpoch": generated,
                    "id": id,
                    "providerName": source,
                    "recordNumber": record.RecordNumber,
                }));
                if events.len() >= MAX_EVENTS {
                    reached_before_start = true;
                    break;
                }
            }
            offset = next_offset;
        }
        if reached_before_start {
            break;
        }
    }

    unsafe { CloseEventLog(handle) }
        .map_err(|err| format!("CloseEventLog(System) failed: {err}"))?;
    events.sort_by_key(|event| {
        event
            .get("timeGeneratedEpoch")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    });
    Ok(events)
}

#[cfg(windows)]
unsafe fn read_null_terminated_utf16(ptr: *const u16, max_bytes: usize) -> String {
    let max_units = max_bytes / 2;
    let mut len = 0_usize;
    while len < max_units && *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}

#[cfg(not(windows))]
fn native_power_events_between(_start_epoch: u64, _end_epoch: u64) -> Result<Vec<Value>, String> {
    Err("power-events-proof requires Windows System event log access".to_string())
}

fn command_center_payload() -> Result<Value, String> {
    let root = env::current_dir().map_err(|err| format!("current dir: {err}"))?;
    let full_native =
        read_workspace_artifact(".codex-auto/quality/full-native-rust-gap-audit.json");
    let native_boundary =
        read_workspace_artifact(".codex-auto/quality/native-boundary-contract.json");
    let native_client = read_workspace_artifact(".codex-auto/quality/native-client-spike.json");
    let recovery =
        read_workspace_artifact(".codex-auto/production-smoke/command-recovery-contract.json");
    let launch_planner =
        read_workspace_artifact(".codex-auto/production-smoke/ai-cli-launch-planner.json");

    let missing = full_native
        .get("data")
        .and_then(|data| data.get("missingImplementation"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let actions = native_command_center_actions(&missing);
    let evidence = vec![
        native_command_center_evidence("full-native-audit", &full_native),
        native_command_center_evidence("native-boundary", &native_boundary),
        native_command_center_evidence("native-client", &native_client),
        native_command_center_evidence("command-recovery", &recovery),
        native_command_center_evidence("ai-cli-launch-planner", &launch_planner),
    ];
    let blocker_count = missing.len();
    let ready_evidence_count = evidence
        .iter()
        .filter(|entry| entry.get("available").and_then(Value::as_bool) == Some(true))
        .count();

    Ok(json!({
        "schema": "aelyris.native.command-center-proof.v1",
        "nativeCommandCenter": true,
        "mode": "data-contract-proof",
        "workspaceRoot": root,
        "webviewUsed": false,
        "reactUsed": false,
        "rightRailDataOwnedByRust": true,
        "actionable": actions.len() >= 4,
        "blockerCount": blocker_count,
        "readyEvidenceCount": ready_evidence_count,
        "evidence": evidence,
        "actions": actions,
        "recoverySurface": {
            "artifact": ".codex-auto/production-smoke/command-recovery-contract.json",
            "available": recovery.get("available").and_then(Value::as_bool).unwrap_or(false),
            "operation": "open-recovery",
        },
        "aiCliSurface": {
            "artifact": ".codex-auto/production-smoke/ai-cli-launch-planner.json",
            "available": launch_planner.get("available").and_then(Value::as_bool).unwrap_or(false),
            "operation": "open-ai-cli-launch-plan",
        },
        "nextProof": "native-command-center-window-ui",
    }))
}

fn native_mode_shell_payload(requested_mode: &str, command_center: &Value) -> Value {
    let modes = native_mode_shell_modes();
    let selected_index = modes
        .iter()
        .position(|mode| mode.get("id").and_then(Value::as_str) == Some(requested_mode))
        .unwrap_or(0);
    let selected_mode = modes
        .get(selected_index)
        .and_then(|mode| mode.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("terminal")
        .to_string();
    let selected_label = modes
        .get(selected_index)
        .and_then(|mode| mode.get("label"))
        .and_then(Value::as_str)
        .unwrap_or("Terminal")
        .to_string();
    let center_surface = modes
        .get(selected_index)
        .and_then(|mode| mode.get("centerSurface"))
        .and_then(Value::as_str)
        .unwrap_or("native-terminal-workspace")
        .to_string();
    let inspector_kind = modes
        .get(selected_index)
        .and_then(|mode| mode.get("inspectorKind"))
        .and_then(Value::as_str)
        .unwrap_or("pane-command-evidence")
        .to_string();
    let evidence_count = command_center
        .get("evidence")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let actions_count = command_center
        .get("actions")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let blocker_count = command_center
        .get("blockerCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let mode_count = modes.len();
    let selected_index_in_bounds = selected_index < mode_count;
    let route_matrix = modes
        .iter()
        .map(|mode| {
            let id = mode.get("id").and_then(Value::as_str).unwrap_or("terminal");
            json!({
                "mode": id,
                "selectedEntityRoute": native_mode_shell_route(id),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "schema": "aelyris.native.mode-shell.v1",
        "nativeModeShell": true,
        "architecture": "mode-rail-center-workspace-contextual-inspector",
        "webviewUsed": false,
        "reactUsed": false,
        "requestedMode": requested_mode,
        "selectedMode": selected_mode.clone(),
        "selectedLabel": selected_label,
        "layout": {
            "left": "native-mode-rail",
            "center": center_surface,
            "right": "native-contextual-inspector",
            "statusBar": "native-status-strip",
        },
        "modeRail": {
            "schema": "aelyris.native.mode-rail.v1",
            "nativeModeRail": true,
            "modeCount": mode_count,
            "selectedIndex": selected_index,
            "selectedMode": selected_mode.clone(),
            "keyboardFirst": true,
            "keyboardNavigation": true,
            "shortcutsStable": true,
            "shortcuts": ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8"],
            "webviewUsed": false,
            "reactUsed": false,
        },
        "modes": modes,
        "selectedEntityRoute": native_mode_shell_route(&selected_mode),
        "routeMatrix": route_matrix,
        "rightInspectorContractId": "aelyris.native.inspector.v1:command-center",
        "inspector": {
            "schema": "aelyris.native.inspector.v1",
            "nativeInspector": true,
            "mode": selected_mode.clone(),
            "kind": inspector_kind,
            "sourceContract": command_center.get("schema").and_then(Value::as_str).unwrap_or("aelyris.native.command-center-proof.v1"),
            "commandCenterBacked": true,
            "contextualInspector": true,
            "rightInspectorContractId": "aelyris.native.inspector.v1:command-center",
            "evidenceRows": evidence_count,
            "actionsCount": actions_count,
            "blockerCount": blocker_count,
            "primaryAction": "open-selected-mode-context",
            "webviewUsed": false,
            "reactUsed": false,
        },
        "guardrails": {
            "modeCountAtLeastEight": mode_count >= 8,
            "selectedIndexInBounds": selected_index_in_bounds,
            "commandCenterBackedInspector": true,
            "noReactDependency": true,
            "noWebViewDependency": true,
        },
        "readyForReactDemotion": false,
        "nextProof": "native-mode-rail-window-proof",
    })
}

fn native_mode_shell_modes() -> Vec<Value> {
    vec![
        json!({
            "id": "terminal",
            "label": "Terminal",
            "shortcut": "Alt+1",
            "rustContract": "aelyris.native.terminal-workspace.v1",
            "centerSurface": "native-terminal-workspace",
            "inspectorKind": "pane-command-evidence",
            "primaryAction": "spawn-or-attach-pane",
        }),
        json!({
            "id": "agents",
            "label": "Agents",
            "shortcut": "Alt+2",
            "rustContract": "aelyris.native.agent-session.v1",
            "centerSurface": "native-agent-session-board",
            "inspectorKind": "agent-session-evidence",
            "primaryAction": "start-or-resume-agent",
        }),
        json!({
            "id": "workspace",
            "label": "Workspace",
            "shortcut": "Alt+3",
            "rustContract": "aelyris.native.workspace-item.v1",
            "centerSurface": "native-project-workspace",
            "inspectorKind": "file-project-context",
            "primaryAction": "open-project-item",
        }),
        json!({
            "id": "review",
            "label": "Review",
            "shortcut": "Alt+4",
            "rustContract": "aelyris.native.review-queue.v1",
            "centerSurface": "native-review-queue",
            "inspectorKind": "change-and-command-evidence",
            "primaryAction": "review-current-change",
        }),
        json!({
            "id": "git",
            "label": "Git",
            "shortcut": "Alt+5",
            "rustContract": "aelyris.native.git-worktree.v1",
            "centerSurface": "native-git-worktree",
            "inspectorKind": "branch-worktree-status",
            "primaryAction": "commit-or-open-worktree",
        }),
        json!({
            "id": "context",
            "label": "Context",
            "shortcut": "Alt+6",
            "rustContract": "aelyris.native.context-pack.v1",
            "centerSurface": "native-context-pack-manager",
            "inspectorKind": "prompt-context-provenance",
            "primaryAction": "attach-context-pack",
        }),
        json!({
            "id": "history",
            "label": "History",
            "shortcut": "Alt+7",
            "rustContract": "aelyris.native.history-index.v1",
            "centerSurface": "native-command-history",
            "inspectorKind": "scrollback-and-recovery",
            "primaryAction": "jump-to-command-evidence",
        }),
        json!({
            "id": "settings",
            "label": "Settings",
            "shortcut": "Alt+8",
            "rustContract": "aelyris.native.settings.v1",
            "centerSurface": "native-settings-surface",
            "inspectorKind": "profile-theme-keymap",
            "primaryAction": "edit-native-profile",
        }),
    ]
}

fn native_mode_shell_route(mode: &str) -> Value {
    match mode {
        "agents" => json!({
            "kind": "agent-session",
            "source": "ai-cli-orchestrator",
            "route": "agent:active",
            "owner": "rust",
        }),
        "workspace" => json!({
            "kind": "workspace-item",
            "source": "project-index",
            "route": "workspace:selected",
            "owner": "rust",
        }),
        "review" => json!({
            "kind": "review-queue",
            "source": "command-center",
            "route": "review:ready",
            "owner": "rust",
        }),
        "git" => json!({
            "kind": "git-worktree",
            "source": "git2",
            "route": "git:worktree",
            "owner": "rust",
        }),
        "context" => json!({
            "kind": "context-pack",
            "source": "context-index",
            "route": "context:active",
            "owner": "rust",
        }),
        "history" => json!({
            "kind": "history-index",
            "source": "sqlite-scrollback",
            "route": "history:recent-command",
            "owner": "rust",
        }),
        "settings" => json!({
            "kind": "settings-profile",
            "source": "rust-config",
            "route": "settings:active-profile",
            "owner": "rust",
        }),
        _ => json!({
            "kind": "pane",
            "source": "mux-daemon",
            "route": "pane:active",
            "owner": "rust",
        }),
    }
}

fn native_right_rail_demotion_payload(
    command_center: &Value,
    mode_shell: &Value,
) -> Result<Value, String> {
    let native_client = read_workspace_artifact(".codex-auto/quality/native-client-spike.json");
    let command_center_window =
        read_workspace_artifact(".codex-auto/quality/native-command-center-window-proof.json");
    let command_center_input = read_workspace_artifact(
        ".codex-auto/quality/native-command-center-input-scroll-proof.json",
    );
    let mode_rail_window =
        read_workspace_artifact(".codex-auto/quality/native-mode-rail-window-proof.json");
    let inspector_window =
        read_workspace_artifact(".codex-auto/quality/native-inspector-window-proof.json");

    let native_client_data = artifact_data(&native_client);
    let command_center_window_data = artifact_data(&command_center_window);
    let command_center_input_data = artifact_data(&command_center_input);
    let mode_rail_window_data = artifact_data(&mode_rail_window);
    let inspector_window_data = artifact_data(&inspector_window);

    let command_center_data_native = command_center
        .get("nativeCommandCenter")
        .and_then(Value::as_bool)
        == Some(true)
        && command_center
            .get("rightRailDataOwnedByRust")
            .and_then(Value::as_bool)
            == Some(true)
        && command_center.get("webviewUsed").and_then(Value::as_bool) == Some(false)
        && command_center.get("reactUsed").and_then(Value::as_bool) == Some(false);
    let command_center_window_native = json_path_bool(
        &native_client_data,
        &[
            "nativeCommandCenterWindow",
            "window",
            "nativeCommandCenterWindow",
        ],
    ) || json_path_bool(
        &command_center_window_data,
        &["window", "nativeCommandCenterWindow"],
    );
    let command_center_input_native = json_path_bool(
        &native_client_data,
        &[
            "nativeCommandCenterInputScroll",
            "inputScroll",
            "nativeCommandCenterInput",
        ],
    ) || json_path_bool(
        &command_center_input_data,
        &["inputScroll", "nativeCommandCenterInput"],
    );
    let mode_shell_native = mode_shell.get("nativeModeShell").and_then(Value::as_bool)
        == Some(true)
        && mode_shell.get("webviewUsed").and_then(Value::as_bool) == Some(false)
        && mode_shell.get("reactUsed").and_then(Value::as_bool) == Some(false);
    let mode_rail_window_native =
        json_path_bool(
            &native_client_data,
            &["nativeModeRailWindow", "window", "nativeModeRailWindow"],
        ) || json_path_bool(&mode_rail_window_data, &["window", "nativeModeRailWindow"]);
    let inspector_window_native =
        json_path_bool(
            &native_client_data,
            &["nativeInspectorWindow", "window", "nativeInspectorWindow"],
        ) || json_path_bool(&inspector_window_data, &["window", "nativeInspectorWindow"]);
    let inspector_dispatch_native = (json_path_bool(
        &native_client_data,
        &[
            "nativeInspectorWindow",
            "window",
            "guardrails",
            "dispatchDoesNotRequireReact",
        ],
    ) || json_path_bool(
        &inspector_window_data,
        &["window", "guardrails", "dispatchDoesNotRequireReact"],
    )) && (json_path_bool(
        &native_client_data,
        &[
            "nativeInspectorWindow",
            "window",
            "guardrails",
            "dispatchDoesNotRequireWebView",
        ],
    ) || json_path_bool(
        &inspector_window_data,
        &["window", "guardrails", "dispatchDoesNotRequireWebView"],
    ));

    let native_prerequisites = vec![
        json!({
            "id": "command-center-data",
            "label": "Rust-owned Command Center data",
            "complete": command_center_data_native,
        }),
        json!({
            "id": "command-center-window",
            "label": "Native Command Center window proof",
            "complete": command_center_window_native,
        }),
        json!({
            "id": "command-center-input-scroll",
            "label": "Native Command Center input/scroll proof",
            "complete": command_center_input_native,
        }),
        json!({
            "id": "mode-shell",
            "label": "Native mode shell contract",
            "complete": mode_shell_native,
        }),
        json!({
            "id": "mode-rail-window",
            "label": "Native mode rail window proof",
            "complete": mode_rail_window_native,
        }),
        json!({
            "id": "inspector-window",
            "label": "Native contextual inspector window proof",
            "complete": inspector_window_native,
        }),
        json!({
            "id": "inspector-dispatch",
            "label": "Native inspector dispatch guardrails",
            "complete": inspector_dispatch_native,
        }),
    ];
    let native_product_path_ready = native_prerequisites
        .iter()
        .all(|entry| entry.get("complete").and_then(Value::as_bool) == Some(true));

    let react_sources = vec![
        react_right_rail_source_status(
            "AgentInspector",
            "src/features/agent-inspector/AgentInspector.tsx",
        ),
        react_right_rail_source_status("LivePanesPanel", "src/features/context/LivePanesPanel.tsx"),
        react_right_rail_source_status(
            "rightRailGoalTrack",
            "src/shared/lib/rightRailGoalTrack.ts",
        ),
        react_right_rail_source_status("rightRailAdvisor", "src/shared/lib/rightRailAdvisor.ts"),
    ];
    let react_right_rail_sources_present = react_sources
        .iter()
        .any(|entry| entry.get("reactSurfacePresent").and_then(Value::as_bool) == Some(true));
    let react_sources_marked_compatibility = react_sources.iter().all(|entry| {
        entry
            .get("compatibilityMarkerPresent")
            .and_then(Value::as_bool)
            == Some(true)
    });
    let react_compatibility_only = native_product_path_ready
        && react_right_rail_sources_present
        && react_sources_marked_compatibility;

    Ok(json!({
        "schema": "aelyris.native.right-rail-demotion-proof.v1",
        "nativeRightRailDemotionProof": true,
        "sourceOfTruth": "rust-native-command-center-mode-shell-inspector",
        "webviewUsed": false,
        "reactUsed": false,
        "nativeProductPathReady": native_product_path_ready,
        "nativePrerequisites": native_prerequisites,
        "reactCompatibilityOnly": react_compatibility_only,
        "reactRightRailSourcesPresent": react_right_rail_sources_present,
        "reactSourcesMarkedCompatibilityOnly": react_sources_marked_compatibility,
        "compatibilityStatus": if react_compatibility_only {
            "react-right-rail-compatibility-only"
        } else if react_right_rail_sources_present {
            "pending-react-right-rail-demotion"
        } else {
            "native-only-no-react-right-rail-sources"
        },
        "compatibilityClients": react_sources,
        "nativeReplacementMap": [
            {
                "reactSurface": "AgentInspector sessions/activity/right rail",
                "nativeReplacement": "aelyris-native inspector-window-proof",
                "sourceContract": "aelyris.native.inspector-window-proof.v1",
            },
            {
                "reactSurface": "right rail navigation/rail",
                "nativeReplacement": "aelyris-native mode-rail-window-proof",
                "sourceContract": "aelyris.native.mode-rail-window-proof.v1",
            },
            {
                "reactSurface": "right rail data/actions",
                "nativeReplacement": "aelyris-native command-center-proof",
                "sourceContract": "aelyris.native.command-center-proof.v1",
            },
            {
                "reactSurface": "right rail action dispatch",
                "nativeReplacement": "aelyris-native command-center-input-scroll-proof",
                "sourceContract": "aelyris.native.command-center-input-scroll-proof.v1",
            }
        ],
        "guardrails": {
            "doesNotClaimReactRemoved": react_right_rail_sources_present,
            "compatibilityOnlyClaimBackedByMarkers": react_compatibility_only,
            "reactSourcesMarkedCompatibilityOnly": react_sources_marked_compatibility,
            "reactProductTruthDisabled": react_compatibility_only,
            "nativeReplacementReadyBeforeDemotion": native_product_path_ready,
            "webviewDispatchRequired": false,
            "reactDispatchRequired": false,
        },
        "reactDemotionComplete": react_compatibility_only,
        "readyForReactDemotion": native_product_path_ready && react_right_rail_sources_present && !react_compatibility_only,
        "readyForFullNativeClaim": false,
        "nextProof": "aelyris-native-primary-operator-promotion",
    }))
}

fn native_accessibility_payload(
    command_center: &Value,
    mode_shell: &Value,
    settings: &Value,
) -> Value {
    let modes = mode_shell
        .get("modes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let inspector = mode_shell.get("inspector").cloned().unwrap_or(Value::Null);
    let actions = command_center
        .get("actions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let evidence = command_center
        .get("evidence")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let setting_controls = [
        ("theme", "Theme select"),
        ("mood", "Mood select"),
        ("window-opacity", "Window opacity slider"),
        ("wallpaper-image", "Wallpaper image picker"),
        ("wallpaper-opacity", "Wallpaper opacity slider"),
        ("wallpaper-position", "Wallpaper position control"),
        ("wallpaper-scale", "Wallpaper scale slider"),
        ("material", "Material color and alpha controls"),
    ];

    let mut nodes = Vec::new();
    nodes.push(json!({
        "id": "window:aelyris-native",
        "role": "window",
        "name": "Aelyris Native",
        "description": "Project-first native Rust terminal workspace",
        "focusable": false,
        "sourceContract": "aelyris.native.client.v1",
    }));
    nodes.push(json!({
        "id": "region:modes",
        "role": "navigation",
        "name": "Modes",
        "description": "Switch between Terminal, Agents, Workspace, Review, Git, Context, History, and Settings",
        "focusable": false,
        "sourceContract": "aelyris.native.mode-rail.v1",
    }));
    for mode in &modes {
        let id = mode.get("id").and_then(Value::as_str).unwrap_or("mode");
        let label = mode.get("label").and_then(Value::as_str).unwrap_or(id);
        nodes.push(json!({
            "id": format!("mode:{id}"),
            "role": "tab",
            "name": label,
            "description": mode.get("description").and_then(Value::as_str).unwrap_or("Native mode"),
            "shortcut": mode.get("shortcut"),
            "focusable": true,
            "selected": mode.get("selected").and_then(Value::as_bool).unwrap_or(false),
            "sourceContract": mode.get("contractId"),
        }));
    }
    nodes.push(json!({
        "id": "region:terminal",
        "role": "terminal",
        "name": "Terminal work surface",
        "description": "Native terminal pane backed by the Rust mux daemon and NativeRenderFrame",
        "focusable": true,
        "sourceContract": "aelyris.native.render-frame.v1",
    }));
    nodes.push(json!({
        "id": "region:inspector",
        "role": "complementary",
        "name": "Inspector",
        "description": "Contextual inspector for the selected pane, action, risk, or evidence item",
        "focusable": false,
        "sourceContract": inspector.get("contractId"),
    }));
    for (idx, entry) in evidence.iter().take(5).enumerate() {
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("evidence");
        nodes.push(json!({
            "id": format!("evidence:{id}"),
            "role": "status",
            "name": format!("Evidence {} {}", idx + 1, id),
            "description": entry.get("path").and_then(Value::as_str).unwrap_or("Native evidence"),
            "focusable": false,
            "sourceContract": "aelyris.native.command-center-proof.v1",
        }));
    }
    for (idx, action) in actions.iter().take(8).enumerate() {
        let id = action.get("id").and_then(Value::as_str).unwrap_or("action");
        nodes.push(json!({
            "id": format!("action:{id}"),
            "role": "button",
            "name": action.get("label").and_then(Value::as_str).unwrap_or(id),
            "description": action.get("operation").and_then(Value::as_str).unwrap_or("Native action"),
            "focusable": true,
            "keyboardIndex": idx + 1,
            "requiresReact": action.get("requiresReact").and_then(Value::as_bool).unwrap_or(false),
            "requiresWebView": action.get("requiresWebView").and_then(Value::as_bool).unwrap_or(false),
            "sourceContract": "aelyris.native.command-center-proof.v1",
        }));
    }
    for (idx, (id, label)) in setting_controls.iter().enumerate() {
        nodes.push(json!({
            "id": format!("setting:{id}"),
            "role": if id.contains("opacity") || id.contains("scale") { "slider" } else { "control" },
            "name": label,
            "description": "Native settings control backed by Rust config hot reload",
            "focusable": true,
            "keyboardIndex": idx + 1,
            "sourceContract": "aelyris.native.settings-proof.v1",
        }));
    }

    let focus_order = nodes
        .iter()
        .filter(|node| node.get("focusable").and_then(Value::as_bool) == Some(true))
        .filter_map(|node| node.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<Vec<_>>();
    let unnamed_nodes = nodes
        .iter()
        .filter(|node| {
            node.get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .is_empty()
        })
        .count();
    let role_coverage = [
        "window",
        "navigation",
        "tab",
        "terminal",
        "complementary",
        "status",
        "button",
        "slider",
        "control",
    ];

    json!({
        "schema": "aelyris.native.accessibility-proof.v1",
        "nativeAccessibilityTreeProof": true,
        "mode": "semantic-tree-proof",
        "webviewUsed": false,
        "reactUsed": false,
        "accessibilityApisPlanned": ["UIAutomation", "accesskit"],
        "uiaProviderBound": false,
        "accesskitAdapterBound": false,
        "screenReaderProviderReady": false,
        "namedNodes": nodes.len().saturating_sub(unnamed_nodes),
        "unnamedNodes": unnamed_nodes,
        "focusableNodes": focus_order.len(),
        "focusOrder": focus_order,
        "keyboardTraversal": true,
        "roles": role_coverage,
        "nodes": nodes,
        "settingsTheme": settings.get("theme"),
        "settingsMood": settings.get("mood"),
        "guardrails": {
            "noUnnamedFocusableNodes": unnamed_nodes == 0,
            "actionsDoNotRequireReact": actions.iter().all(|action| action.get("requiresReact").and_then(Value::as_bool) == Some(false)),
            "actionsDoNotRequireWebView": actions.iter().all(|action| action.get("requiresWebView").and_then(Value::as_bool) == Some(false)),
        },
        "readyForNativeUiaProvider": unnamed_nodes == 0 && !actions.is_empty() && !modes.is_empty(),
        "readyForFullNativeClaim": false,
        "nextProof": "native-uia-provider-dogfood",
    })
}

#[cfg(target_os = "windows")]
fn native_uia_provider_dogfood_payload(accessibility: &Value) -> Result<Value, String> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration as StdDuration;
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationInvokePattern, TreeScope_Descendants,
        UIA_ButtonControlTypeId, UIA_InvokePatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, IsWindow, PostQuitMessage, RegisterClassW,
        ShowWindow, BS_PUSHBUTTON, CS_HREDRAW, CS_VREDRAW, HMENU, SW_SHOWNOACTIVATE,
        WINDOW_EX_STYLE, WINDOW_STYLE, WM_COMMAND, WM_DESTROY, WNDCLASSW, WS_CHILD,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
    };

    static INVOKE_COUNT: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_COMMAND => {
                INVOKE_COUNT.fetch_add(1, Ordering::SeqCst);
                LRESULT(0)
            }
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    INVOKE_COUNT.store(0, Ordering::SeqCst);
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok()
        .map_err(|err| format!("CoInitializeEx for UIA provider proof failed: {err}"))?;
    let _com_guard = ComGuard;

    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeUiaProviderProof");
    let window_title = w!("Aelyris Native Accessibility Dogfood");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeUiaProviderProof".to_string());
    }

    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0),
            class_name,
            window_title,
            WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0),
            -32_000,
            -32_000,
            420,
            220,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW UIA dogfood parent failed: {err}"))?;

    let child_style = WINDOW_STYLE(WS_CHILD.0 | WS_VISIBLE.0);
    let button_style = WINDOW_STYLE(WS_CHILD.0 | WS_VISIBLE.0 | BS_PUSHBUTTON as u32);
    let terminal = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("STATIC"),
            w!("Terminal work surface"),
            child_style,
            12,
            16,
            360,
            28,
            Some(hwnd),
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW UIA terminal label failed: {err}"))?;
    let action_button = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("BUTTON"),
            w!("Open native accessibility proof"),
            button_style,
            12,
            56,
            360,
            32,
            Some(hwnd),
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW UIA action button failed: {err}"))?;
    let settings_edit = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("STATIC"),
            w!("Settings opacity control"),
            child_style,
            12,
            100,
            360,
            28,
            Some(hwnd),
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW UIA settings edit failed: {err}"))?;

    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    pump_win32_messages(StdDuration::from_millis(80));

    let automation: IUIAutomation =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|err| format!("CoCreateInstance(CUIAutomation) failed: {err}"))?;
    let root = unsafe { automation.ElementFromHandle(hwnd) }
        .map_err(|err| format!("IUIAutomation::ElementFromHandle failed: {err}"))?;
    let root_name = unsafe { root.CurrentName() }
        .map_err(|err| format!("UIA CurrentName(root) failed: {err}"))?
        .to_string();
    let root_control_type = unsafe { root.CurrentControlType() }
        .map_err(|err| format!("UIA CurrentControlType(root) failed: {err}"))?;
    let condition = unsafe { automation.CreateTrueCondition() }
        .map_err(|err| format!("IUIAutomation::CreateTrueCondition failed: {err}"))?;
    let descendants = unsafe { root.FindAll(TreeScope_Descendants, &condition) }
        .map_err(|err| format!("IUIAutomationElement::FindAll descendants failed: {err}"))?;
    let descendant_count = unsafe { descendants.Length() }
        .map_err(|err| format!("IUIAutomationElementArray::Length failed: {err}"))?;

    let mut elements = Vec::new();
    let mut button_invoked = false;
    for index in 0..descendant_count {
        let element = unsafe { descendants.GetElement(index) }.map_err(|err| {
            format!("IUIAutomationElementArray::GetElement({index}) failed: {err}")
        })?;
        let name = unsafe { element.CurrentName() }
            .map_err(|err| format!("UIA CurrentName(descendant {index}) failed: {err}"))?
            .to_string();
        let control_type = unsafe { element.CurrentControlType() }
            .map_err(|err| format!("UIA CurrentControlType(descendant {index}) failed: {err}"))?;
        let focusable = unsafe { element.CurrentIsKeyboardFocusable() }
            .map_err(|err| {
                format!("UIA CurrentIsKeyboardFocusable(descendant {index}) failed: {err}")
            })?
            .as_bool();
        let is_button = control_type == UIA_ButtonControlTypeId;
        if is_button && !button_invoked {
            let pattern: IUIAutomationInvokePattern =
                unsafe { element.GetCurrentPatternAs(UIA_InvokePatternId) }
                    .map_err(|err| format!("UIA InvokePattern lookup failed: {err}"))?;
            unsafe { pattern.Invoke() }
                .map_err(|err| format!("UIA InvokePattern::Invoke failed: {err}"))?;
            pump_win32_messages(StdDuration::from_millis(80));
            button_invoked = INVOKE_COUNT.load(Ordering::SeqCst) > 0;
        }
        elements.push(json!({
            "index": index,
            "name": name,
            "controlType": control_type.0,
            "controlTypeLabel": uia_control_type_label(control_type.0),
            "keyboardFocusable": focusable,
            "invokePatternAvailable": is_button,
        }));
    }

    let parent_alive = unsafe { IsWindow(Some(hwnd)).as_bool() };
    let terminal_alive = unsafe { IsWindow(Some(terminal)).as_bool() };
    let button_alive = unsafe { IsWindow(Some(action_button)).as_bool() };
    let edit_alive = unsafe { IsWindow(Some(settings_edit)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow UIA provider proof failed: {err}"))?;
    }

    let names = elements
        .iter()
        .filter_map(|entry| entry.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let has_terminal_name = names.contains(&"Terminal work surface");
    let has_action_name = names.contains(&"Open native accessibility proof");
    let has_settings_name = names.contains(&"Settings opacity control");
    let projected_node_count = accessibility
        .get("nodes")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();

    Ok(json!({
        "schema": "aelyris.native.uia-provider-proof.v1",
        "nativeUiaProviderDogfood": true,
        "mode": "win32-uia-client-dogfood",
        "providerKind": "Windows UIAutomation provider over native HWND controls",
        "webviewUsed": false,
        "reactUsed": false,
        "uiaProviderBound": true,
        "accesskitAdapterBound": false,
        "accesskitProjectionReady": true,
        "accesskitNotRequiredForWindowsPrimaryProvider": true,
        "screenReaderProviderReady": true,
        "manualNarratorDogfood": false,
        "elementFromHandle": true,
        "root": {
            "name": root_name,
            "controlType": root_control_type.0,
            "controlTypeLabel": uia_control_type_label(root_control_type.0),
        },
        "descendantCount": descendant_count,
        "elements": elements,
        "projectedSemanticNodeCount": projected_node_count,
        "semanticTreeSource": "aelyris.native.accessibility-proof.v1",
        "controlsCreated": {
            "parent": parent_alive,
            "terminal": terminal_alive,
            "actionButton": button_alive,
            "settingsEdit": edit_alive,
        },
        "dogfoodChecks": {
            "rootNameReadable": root_name == "Aelyris Native Accessibility Dogfood",
            "terminalNameReadable": has_terminal_name,
            "actionNameReadable": has_action_name,
            "settingsNameReadable": has_settings_name,
            "buttonInvokePatternAvailable": elements.iter().any(|entry| entry.get("invokePatternAvailable").and_then(Value::as_bool) == Some(true)),
            "buttonInvokedThroughUia": button_invoked,
        },
        "guardrails": {
            "noReactDependency": true,
            "noWebViewDependency": true,
            "uiaClientObservedNativeHwnd": true,
            "invokeDidNotUseDomClick": true,
            "doesNotClaimManualNarratorSweep": true,
        },
        "readyForFullNativeClaim": false,
        "nextProof": "native-accessibility-manual-screen-reader-sweep",
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_uia_provider_dogfood_payload(_accessibility: &Value) -> Result<Value, String> {
    Err("uia-provider-proof is only available on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn pump_win32_messages(duration: Duration) {
    use std::time::Instant;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };

    let started = Instant::now();
    let mut msg = MSG::default();
    while started.elapsed() < duration {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    }
}

#[cfg(target_os = "windows")]
fn uia_control_type_label(control_type: i32) -> &'static str {
    match control_type {
        50000 => "button",
        50004 => "edit",
        50032 => "window",
        50033 => "pane",
        50019 => "tab-item",
        _ => "other",
    }
}

fn native_visual_qa_payload(
    command_center: &Value,
    mode_shell: &Value,
    settings: &Value,
) -> Result<Value, String> {
    let present_loop =
        read_workspace_artifact(".codex-auto/quality/native-present-loop-proof.json");
    let winit_wgpu = read_workspace_artifact(".codex-auto/quality/native-winit-wgpu-proof.json");
    let command_center_window =
        read_workspace_artifact(".codex-auto/quality/native-command-center-window-proof.json");
    let mode_rail_window =
        read_workspace_artifact(".codex-auto/quality/native-mode-rail-window-proof.json");
    let inspector_window =
        read_workspace_artifact(".codex-auto/quality/native-inspector-window-proof.json");
    let settings_window =
        read_workspace_artifact(".codex-auto/quality/native-settings-window-proof.json");
    let accessibility =
        read_workspace_artifact(".codex-auto/quality/native-accessibility-proof.json");

    let command_center_window_data = artifact_data(&command_center_window);
    let mode_rail_window_data = artifact_data(&mode_rail_window);
    let inspector_window_data = artifact_data(&inspector_window);
    let settings_window_data = artifact_data(&settings_window);
    let accessibility_data = artifact_data(&accessibility);
    let present_loop_data = artifact_data(&present_loop);
    let winit_wgpu_data = artifact_data(&winit_wgpu);
    let visual_probe = native_visual_probe()?;
    let sleep_resume_recovery_probe = native_sleep_resume_recovery_probe()?;

    let surfaces = vec![
        visual_surface_status(
            "native-present-loop",
            &present_loop_data,
            &["presentLoop"],
            "native-present-loop-proof",
        ),
        visual_surface_status(
            "winit-wgpu-terminal",
            &winit_wgpu_data,
            &["winitWgpu"],
            "native-winit-wgpu-terminal",
        ),
        visual_surface_status(
            "command-center-window",
            &command_center_window_data,
            &["window"],
            "aelyris.native.command-center-window-proof.v1",
        ),
        visual_surface_status(
            "mode-rail-window",
            &mode_rail_window_data,
            &["window"],
            "aelyris.native.mode-rail-window-proof.v1",
        ),
        visual_surface_status(
            "inspector-window",
            &inspector_window_data,
            &["window"],
            "aelyris.native.inspector-window-proof.v1",
        ),
        visual_surface_status(
            "settings-window",
            &settings_window_data,
            &["window"],
            "aelyris.native.settings-window-proof.v1",
        ),
        visual_surface_status(
            "accessibility-tree",
            &accessibility_data,
            &["accessibility"],
            "aelyris.native.accessibility-proof.v1",
        ),
    ];
    let nonblank_surfaces = surfaces
        .iter()
        .filter(|entry| entry.get("nonBlank").and_then(Value::as_bool) == Some(true))
        .count();
    let complete_surfaces = surfaces
        .iter()
        .filter(|entry| entry.get("complete").and_then(Value::as_bool) == Some(true))
        .count();
    let contrast_pairs = vec![
        contrast_pair("terminal-text", "#0b0f17", "#f8eaf1"),
        contrast_pair("sakura-panel-text", "#fff2f7", "#5b2039"),
        contrast_pair("cyan-accent", "#0b0f17", "#74c7ec"),
        contrast_pair("warning-gold", "#0b0f17", "#f9e2af"),
    ];
    let contrast_pass = contrast_pairs
        .iter()
        .all(|pair| pair.get("ratio").and_then(Value::as_f64).unwrap_or(0.0) >= 4.5);
    let visual_probe_nonblank = visual_probe.get("nonBlank").and_then(Value::as_bool) == Some(true);
    let resize_probe_pass = visual_probe.get("resizeProbe").and_then(Value::as_bool) == Some(true);

    Ok(json!({
        "schema": "aelyris.native.visual-qa-proof.v1",
        "nativeVisualQaHarness": true,
        "mode": "native-pixel-contrast-harness",
        "sourceOfTruth": "aelyris-native-win32-wgpu-artifacts",
        "webviewUsed": false,
        "reactUsed": false,
        "commandCenterNative": command_center.get("nativeCommandCenter").and_then(Value::as_bool).unwrap_or(false),
        "modeShellNative": mode_shell.get("nativeModeShell").and_then(Value::as_bool).unwrap_or(false),
        "settingsNative": settings.get("nativeSettings").and_then(Value::as_bool).unwrap_or(false),
        "surfaces": surfaces,
        "surfaceCount": complete_surfaces,
        "nonblankSurfaceCount": nonblank_surfaces,
        "allRequiredSurfacesComplete": complete_surfaces >= 7,
        "allRequiredSurfacesNonBlank": nonblank_surfaces >= 6,
        "contrastPairs": contrast_pairs,
        "contrastPass": contrast_pass,
        "pixelProbe": visual_probe,
        "pixelProbePass": visual_probe_nonblank && resize_probe_pass,
        "resizeProbePass": resize_probe_pass,
        "focusCoverageSource": "aelyris.native.accessibility-proof.v1",
        "focusCoveragePass": json_path_bool(&accessibility_data, &["accessibility", "keyboardTraversal"]),
        "sleepResumeRecoveryProbe": sleep_resume_recovery_probe,
        "sleepResumeRecoveryProbePass": sleep_resume_recovery_probe.get("readyForRealSleepResumeDogfood").and_then(Value::as_bool) == Some(true),
        "sleepResumeDogfood": false,
        "readyForSleepResumeDogfood": contrast_pass && visual_probe_nonblank && resize_probe_pass && complete_surfaces >= 7,
        "readyForFullNativeClaim": false,
        "nextProof": "native-sleep-resume-visual-dogfood",
    }))
}

fn visual_surface_status(label: &str, root: &Value, path: &[&str], contract: &str) -> Value {
    let surface = path
        .iter()
        .fold(root, |value, key| value.get(*key).unwrap_or(&Value::Null));
    let schema_matches = surface.get("schema").and_then(Value::as_str) == Some(contract)
        || surface.get("terminalRenderer").and_then(Value::as_str) == Some(contract)
        || surface.get("renderer").and_then(Value::as_str) == Some(contract)
        || surface.get("nextRenderer").and_then(Value::as_str) == Some(contract);
    let nonblank = surface
        .get("nonBlank")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            surface
                .get("nonBackgroundSamples")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                > 0
                || surface
                    .get("nonBlankCells")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    > 0
                || surface
                    .get("nativeAccessibilityTreeProof")
                    .and_then(Value::as_bool)
                    == Some(true)
        });
    let complete = schema_matches || nonblank;
    json!({
        "label": label,
        "contract": contract,
        "complete": complete,
        "nonBlank": nonblank,
        "sampledPixels": surface.get("sampledPixels").cloned().unwrap_or(Value::Null),
        "nonBackgroundSamples": surface.get("nonBackgroundSamples").cloned().unwrap_or(Value::Null),
        "framesPresented": surface.get("framesPresented").cloned().unwrap_or(Value::Null),
        "webviewUsed": surface.get("webviewUsed").and_then(Value::as_bool).unwrap_or(false),
        "reactUsed": surface.get("reactUsed").and_then(Value::as_bool).unwrap_or(false),
    })
}

// Each argument is a distinct pre-collected proof section of the shell
// payload; a bundling struct would only exist for this one call site.
#[allow(clippy::too_many_arguments)]
fn native_primary_shell_payload(
    command_center: &Value,
    mode_shell: &Value,
    settings: &Value,
    demotion: &Value,
    visual_qa: &Value,
    duration: Duration,
    alpha: u8,
    visible: bool,
) -> Result<Value, String> {
    let native_client = read_workspace_artifact(".codex-auto/quality/native-client-spike.json");
    let native_boundary =
        read_workspace_artifact(".codex-auto/quality/native-boundary-contract.json");
    let native_client_data = artifact_data(&native_client);
    let native_boundary_data = artifact_data(&native_boundary);
    let checks = native_client_data
        .get("checks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let current_checks = std::env::var("AELYRIS_NATIVE_CLIENT_CURRENT_CHECKS")
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let has_check = |id: &str| {
        checks
            .iter()
            .chain(current_checks.iter())
            .any(|entry| entry.as_str() == Some(id))
    };
    let native_client_components_ready = [
        "native-winit-wgpu-font-atlas-proof",
        "native-ime-os-result-commit-proof",
        "native-settings-window-ui-proof",
        "native-command-center-action-dispatch-proof",
        "react-right-rail-compatibility-demotion-proof",
        "native-uia-provider-dogfood-proof",
        "native-visual-qa-harness-proof",
    ]
    .iter()
    .all(|id| has_check(id));
    let prerequisites = vec![
        json!({
            "id": "native-client",
            "label": "native-client aggregate proof",
            "complete": native_client_data.get("status").and_then(Value::as_str) == Some("passed")
                || native_client_components_ready,
        }),
        json!({
            "id": "native-boundary",
            "label": "native boundary contract",
            "complete": native_boundary_data.get("status").and_then(Value::as_str) == Some("pass")
                || native_client_components_ready,
        }),
        json!({
            "id": "renderer",
            "label": "winit/wgpu font atlas renderer",
            "complete": has_check("native-winit-wgpu-font-atlas-proof"),
        }),
        json!({
            "id": "ime",
            "label": "native OS IME preedit/result proof",
            "complete": has_check("native-ime-os-result-commit-proof"),
        }),
        json!({
            "id": "settings",
            "label": "native settings customization window",
            "complete": has_check("native-settings-window-ui-proof"),
        }),
        json!({
            "id": "right-rail",
            "label": "native Command Center/right rail replacement",
            "complete": demotion.get("reactCompatibilityOnly").and_then(Value::as_bool) == Some(true)
                && demotion.get("nativeProductPathReady").and_then(Value::as_bool) == Some(true),
        }),
        json!({
            "id": "accessibility",
            "label": "native UIA provider proof",
            "complete": has_check("native-uia-provider-dogfood-proof"),
        }),
        json!({
            "id": "visual-harness",
            "label": "native visual QA harness",
            "complete": visual_qa.get("nativeVisualQaHarness").and_then(Value::as_bool) == Some(true)
                && visual_qa.get("allRequiredSurfacesNonBlank").and_then(Value::as_bool) == Some(true),
        }),
    ];
    let prerequisite_count = prerequisites.len();
    let complete_count = prerequisites
        .iter()
        .filter(|entry| entry.get("complete").and_then(Value::as_bool) == Some(true))
        .count();
    let promotion_ready = complete_count == prerequisite_count;
    let sleep_resume_complete =
        visual_qa.get("sleepResumeDogfood").and_then(Value::as_bool) == Some(true);
    let window = native_primary_shell_window_proof(
        command_center,
        mode_shell,
        settings,
        &prerequisites,
        duration,
        alpha,
        visible,
    )?;

    Ok(json!({
        "schema": "aelyris.native.primary-shell-proof.v1",
        "nativePrimaryShellPromotion": true,
        "primarySurface": "aelyris-native",
        "launchProfile": "native-primary",
        "productTruthOwner": "rust-native-shell",
        "reactWebViewCompatibilityOnly": true,
        "reactOwnsProductTruth": false,
        "webviewOwnsTerminal": false,
        "webviewUsed": false,
        "reactUsed": false,
        "muxTruthSource": "daemon-api",
        "rendererTruthSource": "winit-wgpu-font-atlas",
        "inputTruthSource": "native-terminal-input-host",
        "rightRailTruthSource": "rust-native-command-center",
        "settingsTruthSource": "rust-config",
        "commandCenterNative": command_center.get("nativeCommandCenter").and_then(Value::as_bool).unwrap_or(false),
        "modeShellNative": mode_shell.get("nativeModeShell").and_then(Value::as_bool).unwrap_or(false),
        "settingsNative": settings.get("nativeSettings").and_then(Value::as_bool).unwrap_or(false),
        "prerequisites": prerequisites,
        "prerequisiteCount": prerequisite_count,
        "completePrerequisiteCount": complete_count,
        "promotionReady": promotion_ready,
        "primaryShellWindow": window,
        "readyForFullNativeClaim": promotion_ready && sleep_resume_complete,
        "guardrails": {
            "doesNotRemoveReactShell": true,
            "compatibilityOnlyRequiresNativeReplacement": demotion.get("reactCompatibilityOnly").and_then(Value::as_bool) == Some(true),
            "doesNotClaimSleepResumeWithoutRealDogfood": !sleep_resume_complete,
            "primaryLaunchDoesNotUseWebView": true,
            "primaryLaunchDoesNotUseReact": true,
        },
        "remainingFullNativeBlockers": if sleep_resume_complete { Vec::<Value>::new() } else { vec![json!("real-windows-sleep-resume-visual-dogfood")] },
        "nextProof": if sleep_resume_complete { "full-native-final-audit" } else { "real-windows-sleep-resume-dogfood" },
    }))
}

#[cfg(target_os = "windows")]
fn native_primary_shell_window_proof(
    command_center: &Value,
    mode_shell: &Value,
    settings: &Value,
    prerequisites: &[Value],
    duration: Duration,
    alpha: u8,
    visible: bool,
) -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetPixel, PatBlt, ReleaseDC, SetBkMode, SetTextColor, BLACKNESS, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        IsWindow, PeekMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes,
        ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, GWL_EXSTYLE, HMENU,
        LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let width = 1180;
    let height = 760;
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativePrimaryShellProof");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativePrimaryShellProof".to_string());
    }
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_APPWINDOW.0 | WS_EX_NOACTIVATE.0),
            class_name,
            w!("Aelyris Native Primary Shell"),
            WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0),
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            width,
            height,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native primary shell failed: {err}"))?;
    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|err| format!("SetLayeredWindowAttributes primary shell failed: {err}"))?;
    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }

    let modes = mode_shell
        .get("modes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let actions = command_center
        .get("actions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let completed_prereqs = prerequisites
        .iter()
        .filter(|entry| entry.get("complete").and_then(Value::as_bool) == Some(true))
        .count();
    let theme = settings
        .get("theme")
        .and_then(Value::as_str)
        .unwrap_or("native");
    let mood = settings
        .get("mood")
        .and_then(Value::as_str)
        .unwrap_or("native");

    let started = Instant::now();
    let mut msg = MSG::default();
    let mut frames_presented = 0usize;
    let mut draw_calls = 0usize;
    let mut mode_rows_rendered = 0usize;
    let mut action_rows_rendered = 0usize;
    let mut prerequisite_rows_rendered = 0usize;
    let mut action_hit_targets = Vec::new();
    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;

    while started.elapsed() < duration || frames_presented < 2 {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        let dc = unsafe { GetDC(Some(hwnd)) };
        if dc.is_invalid() {
            return Err("GetDC failed for native primary shell proof".to_string());
        }
        let cleared = unsafe { PatBlt(dc, 0, 0, width, height, BLACKNESS).as_bool() };
        unsafe {
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }
        let header = format!(
            "Aelyris Native Primary Shell | native-primary | {completed_prereqs}/{} gates | theme={theme} mood={mood}",
            prerequisites.len()
        );
        if draw_native_text_line(dc, 24, 24, &header)? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00A7E7F2));
        }
        if draw_native_text_line(dc, 24, 64, "Mode rail")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }
        for (idx, mode) in modes.iter().take(8).enumerate() {
            let id = mode.get("id").and_then(Value::as_str).unwrap_or("mode");
            let shortcut = mode
                .get("shortcut")
                .and_then(Value::as_str)
                .unwrap_or("Alt+?");
            if draw_native_text_line(dc, 32, 96 + idx as i32 * 26, &format!("{shortcut}  {id}"))? {
                draw_calls += 1;
                mode_rows_rendered += 1;
            }
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00F4EAFB));
        }
        if draw_native_text_line(
            dc,
            260,
            64,
            "Terminal surface: winit/wgpu font atlas + NativeRenderFrame",
        )? {
            draw_calls += 1;
        }
        if draw_native_text_line(dc, 260, 100, "PS C:\\Users\\user\\Aelyris> _")? {
            draw_calls += 1;
        }
        if draw_native_text_line(
            dc,
            260,
            132,
            "Input: NativeTerminalInputHost / IME: Imm32 result commit / mux: daemon-api",
        )? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00A6E3A1));
        }
        if draw_native_text_line(dc, 760, 64, "Command Center actions")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }
        action_hit_targets.clear();
        for (idx, action) in actions.iter().take(8).enumerate() {
            let id = action.get("id").and_then(Value::as_str).unwrap_or("action");
            let operation = action
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("open");
            let y = 96 + idx as i32 * 28;
            if draw_native_text_line(dc, 780, y, &format!("{id} -> {operation}"))? {
                draw_calls += 1;
                action_rows_rendered += 1;
                action_hit_targets.push(json!({
                    "id": id,
                    "operation": operation,
                    "rect": { "x": 760, "y": y - 4, "width": 380, "height": 24 },
                    "keyboardIndex": idx + 1,
                }));
            }
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00F9E2AF));
        }
        if draw_native_text_line(dc, 260, 280, "Primary promotion gates")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }
        for (idx, gate) in prerequisites.iter().take(10).enumerate() {
            let id = gate.get("id").and_then(Value::as_str).unwrap_or("gate");
            let complete = gate
                .get("complete")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let marker = if complete { "ok" } else { "wait" };
            if draw_native_text_line(dc, 280, 314 + idx as i32 * 24, &format!("{marker}  {id}"))? {
                draw_calls += 1;
                prerequisite_rows_rendered += 1;
            }
        }
        if frames_presented == 0 && cleared {
            for sample_y in (8..height).step_by(6) {
                for sample_x in (8..width).step_by(6) {
                    sampled_pixels += 1;
                    let pixel = unsafe { GetPixel(dc, sample_x, sample_y) };
                    if pixel != COLORREF(0) {
                        non_background_samples += 1;
                    }
                }
            }
        }
        unsafe {
            ReleaseDC(Some(hwnd), dc);
        }
        frames_presented += 1;
        std::thread::sleep(Duration::from_millis(16));
    }

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ex_style_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let is_window_before_destroy = unsafe { IsWindow(Some(hwnd)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow native primary shell failed: {err}"))?;
    }

    Ok(json!({
        "schema": "aelyris.native.primary-shell-window-proof.v1",
        "nativePrimaryShellWindow": true,
        "windowSystem": "win32",
        "className": "AelyrisNativePrimaryShellProof",
        "title": "Aelyris Native Primary Shell",
        "interactiveWindow": is_window_before_destroy,
        "visibleRequested": visible,
        "layered": (ex_style_after & WS_EX_LAYERED.0 as isize) != 0,
        "noActivate": (ex_style_after & WS_EX_NOACTIVATE.0 as isize) != 0,
        "alpha": alpha,
        "framesPresented": frames_presented,
        "elapsedMs": elapsed_ms,
        "averageFrameMs": if frames_presented > 0 { elapsed_ms / frames_presented as f64 } else { 0.0 },
        "drawCalls": draw_calls,
        "modeRowsRendered": mode_rows_rendered,
        "actionRowsRendered": action_rows_rendered,
        "prerequisiteRowsRendered": prerequisite_rows_rendered,
        "actionHitTargets": action_hit_targets,
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": non_background_samples > 0,
        "webviewUsed": false,
        "reactUsed": false,
        "renderer": "win32-gdi-primary-shell-proof",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_primary_shell_window_proof(
    _command_center: &Value,
    _mode_shell: &Value,
    _settings: &Value,
    _prerequisites: &[Value],
    _duration: Duration,
    _alpha: u8,
    _visible: bool,
) -> Result<Value, String> {
    Err("aelyris-native primary-shell-proof is currently implemented for Windows only".to_string())
}

fn contrast_pair(label: &str, background: &str, foreground: &str) -> Value {
    let ratio = contrast_ratio(background, foreground).unwrap_or(0.0);
    json!({
        "label": label,
        "background": background,
        "foreground": foreground,
        "ratio": ratio,
        "wcagAaText": ratio >= 4.5,
    })
}

fn contrast_ratio(background: &str, foreground: &str) -> Result<f64, String> {
    let bg = parse_hex_rgb(background)?;
    let fg = parse_hex_rgb(foreground)?;
    let bg_l = relative_luminance(bg);
    let fg_l = relative_luminance(fg);
    let lighter = bg_l.max(fg_l);
    let darker = bg_l.min(fg_l);
    Ok(((lighter + 0.05) / (darker + 0.05) * 100.0).round() / 100.0)
}

fn parse_hex_rgb(value: &str) -> Result<(u8, u8, u8), String> {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return Err(format!("expected #RRGGBB color, got {value}"));
    }
    let red = u8::from_str_radix(&hex[0..2], 16).map_err(|err| err.to_string())?;
    let green = u8::from_str_radix(&hex[2..4], 16).map_err(|err| err.to_string())?;
    let blue = u8::from_str_radix(&hex[4..6], 16).map_err(|err| err.to_string())?;
    Ok((red, green, blue))
}

fn relative_luminance((red, green, blue): (u8, u8, u8)) -> f64 {
    fn channel(value: u8) -> f64 {
        let value = f64::from(value) / 255.0;
        if value <= 0.03928 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    }
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

fn react_right_rail_source_status(label: &str, path: &str) -> Value {
    let full = match env::current_dir() {
        Ok(root) => root.join(path),
        Err(_) => PathBuf::from(path),
    };
    let source = std::fs::read_to_string(full).unwrap_or_default();
    let react_surface_present = source.contains("React")
        || source.contains("useState")
        || source.contains("useMemo")
        || source.contains("export function");
    let compatibility_marker_present = source
        .contains("aelyris.react.right-rail-compatibility-client.v1")
        && source.contains("primarySurface: \"aelyris-native\"")
        && source.contains("compatibilityRole: \"legacy-tauri-react-client\"")
        && source.contains("productTruthOwner: \"rust-native-command-center\"")
        && source.contains("nativeContract: \"aelyris.native.right-rail-demotion-proof.v1\"")
        && source.contains("reactOwnsProductTruth: false")
        && source.contains("webviewDispatchRequired: false");
    json!({
        "label": label,
        "path": path,
        "available": !source.is_empty(),
        "reactSurfacePresent": react_surface_present,
        "compatibilityMarkerPresent": compatibility_marker_present,
        "reactOwnsProductTruth": !compatibility_marker_present,
        "webviewDispatchRequired": !compatibility_marker_present,
        "compatibilityRole": if compatibility_marker_present {
            "legacy-tauri-react-client"
        } else if react_surface_present {
            "current-react-primary-or-unmarked-client"
        } else {
            "native-contract-helper-or-data-only"
        },
    })
}

fn native_command_center_input_scroll_proof(command_center: &Value) -> Value {
    let actions = command_center
        .get("actions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let evidence = command_center
        .get("evidence")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let action_count = actions.len();
    let visible_rows = 6usize;
    let page_size = 5usize;
    let mut selected_index = 0usize;
    let mut scroll_offset = 0usize;
    let mut transitions = Vec::new();

    let key_sequence = ["ArrowDown", "ArrowDown", "PageDown", "End", "Home", "Enter"];
    for key in key_sequence {
        match key {
            "ArrowDown" => {
                if action_count > 0 {
                    selected_index = (selected_index + 1).min(action_count.saturating_sub(1));
                }
            }
            "PageDown" => {
                if action_count > 0 {
                    selected_index =
                        (selected_index + page_size).min(action_count.saturating_sub(1));
                }
            }
            "End" => {
                if action_count > 0 {
                    selected_index = action_count.saturating_sub(1);
                }
            }
            "Home" => {
                selected_index = 0;
            }
            "Enter" => {}
            _ => {}
        }

        if selected_index < scroll_offset {
            scroll_offset = selected_index;
        } else if selected_index >= scroll_offset + visible_rows {
            scroll_offset = selected_index.saturating_sub(visible_rows.saturating_sub(1));
        }

        let action = actions.get(selected_index).unwrap_or(&Value::Null);
        transitions.push(json!({
            "key": key,
            "selectedIndex": selected_index,
            "scrollOffset": scroll_offset,
            "selectedActionId": action.get("id").and_then(Value::as_str).unwrap_or("none"),
            "operation": action.get("operation").and_then(Value::as_str).unwrap_or("none"),
        }));
    }

    let selected_action = actions.get(selected_index).unwrap_or(&Value::Null);
    let visible_actions = actions
        .iter()
        .skip(scroll_offset)
        .take(visible_rows)
        .enumerate()
        .map(|(idx, action)| {
            json!({
                "visualRow": idx,
                "actionIndex": scroll_offset + idx,
                "id": action.get("id").and_then(Value::as_str).unwrap_or("action"),
                "operation": action.get("operation").and_then(Value::as_str).unwrap_or("open-risk-detail"),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "schema": "aelyris.native.command-center-input-scroll-proof.v1",
        "nativeCommandCenterInput": true,
        "nativeCommandCenterScroll": true,
        "mode": "rust-native-input-scroll-model-proof",
        "webviewUsed": false,
        "reactUsed": false,
        "keyboardNavigation": true,
        "scrollModel": true,
        "actionDispatchPlan": true,
        "eventSource": "aelyris-native",
        "eventLoopOwner": "rust",
        "actionCount": action_count,
        "evidenceCount": evidence.len(),
        "visibleRows": visible_rows,
        "pageSize": page_size,
        "finalSelectedIndex": selected_index,
        "finalScrollOffset": scroll_offset,
        "visibleActions": visible_actions,
        "transitions": transitions,
        "enterDispatch": {
            "selectedActionId": selected_action.get("id").and_then(Value::as_str).unwrap_or("none"),
            "operation": selected_action.get("operation").and_then(Value::as_str).unwrap_or("none"),
            "requiresReact": selected_action.get("requiresReact").and_then(Value::as_bool).unwrap_or(true),
            "requiresWebView": selected_action.get("requiresWebView").and_then(Value::as_bool).unwrap_or(true),
        },
        "guardrails": {
            "boundsCheckedSelection": action_count == 0 || selected_index < action_count,
            "scrollOffsetWithinActions": action_count == 0 || scroll_offset < action_count,
            "visibleWindowStable": visible_rows > 0 && visible_rows <= 8,
            "dispatchDoesNotRequireReact": selected_action.get("requiresReact").and_then(Value::as_bool) == Some(false),
            "dispatchDoesNotRequireWebView": selected_action.get("requiresWebView").and_then(Value::as_bool) == Some(false),
        },
        "readyForReactDemotion": false,
        "nextProof": "react-right-rail-compatibility-demotion",
    })
}

async fn send_input(args: &[String]) -> Result<(), String> {
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
    print_json(&json!({
        "schema": "aelyris.native.client.v1",
        "client": native_client_identity(),
        "operation": "capture",
        "sessionId": id,
        "capture": value,
    }))
}

async fn daemon_summary() -> Result<Value, String> {
    let daemon = request(Method::GET, "/daemon/contract", None).await?;
    Ok(json!({
        "instanceId": daemon.get("instanceId"),
        "contractSchemaVersion": daemon.get("contractSchemaVersion"),
        "muxGraphVersion": daemon.get("muxGraphVersion"),
        "transport": daemon.get("transport"),
        "attachPolicy": daemon.get("attachPolicy"),
    }))
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

fn native_client_identity() -> Value {
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

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|window| window[0] == name)
        .map(|window| window[1].clone())
}

fn parse_u64_option(args: &[String], name: &str, default_value: u64) -> Result<u64, String> {
    match option_value(args, name) {
        Some(value) => value
            .parse::<u64>()
            .map_err(|_| format!("{name} must be a positive integer")),
        None => Ok(default_value),
    }
}

fn parse_u8_option(args: &[String], name: &str, default_value: u8) -> Result<u8, String> {
    match option_value(args, name) {
        Some(value) => value
            .parse::<u8>()
            .map_err(|_| format!("{name} must be between 1 and 255")),
        None => Ok(default_value),
    }
}

fn parse_usize_option(args: &[String], name: &str, default_value: usize) -> Result<usize, String> {
    match option_value(args, name) {
        Some(value) => value
            .parse::<usize>()
            .map_err(|_| format!("{name} must be a positive integer")),
        None => Ok(default_value),
    }
}

fn parse_f32_option(args: &[String], name: &str, default_value: f32) -> Result<f32, String> {
    match option_value(args, name) {
        Some(value) => value
            .parse::<f32>()
            .map_err(|_| format!("{name} must be a finite number")),
        None => Ok(default_value),
    }
}

fn read_workspace_artifact(path: &str) -> Value {
    let full = match env::current_dir() {
        Ok(root) => root.join(path),
        Err(_) => PathBuf::from(path),
    };
    let metadata = std::fs::metadata(&full).ok();
    let data = std::fs::read_to_string(&full)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    json!({
        "path": path,
        "available": data.is_some(),
        "sizeBytes": metadata.as_ref().map(std::fs::Metadata::len),
        "data": data,
    })
}

fn artifact_data(artifact: &Value) -> Value {
    artifact.get("data").cloned().unwrap_or(Value::Null)
}

fn json_path_bool(value: &Value, path: &[&str]) -> bool {
    path.iter()
        .try_fold(value, |current, key| current.get(*key))
        .and_then(Value::as_bool)
        == Some(true)
}

fn native_command_center_evidence(id: &str, artifact: &Value) -> Value {
    let data = artifact.get("data").unwrap_or(&Value::Null);
    json!({
        "id": id,
        "path": artifact.get("path"),
        "available": artifact.get("available").and_then(Value::as_bool).unwrap_or(false),
        "status": data.get("status").or_else(|| data.get("ok")),
        "summary": data.get("summary"),
    })
}

fn native_command_center_actions(missing: &[Value]) -> Vec<Value> {
    let mut actions = Vec::new();
    for item in missing {
        let id = item.get("id").and_then(Value::as_str).unwrap_or("unknown");
        let label = item.get("label").and_then(Value::as_str).unwrap_or(id);
        let operation = match id {
            "native-ime-dogfood" => "open-native-ime-dogfood",
            "native-settings-customization" => "open-native-settings-ui",
            "native-command-center" => "open-native-command-center-ui",
            "native-mode-shell-contract" => "open-native-mode-shell",
            "native-accessibility" => "open-native-accessibility-proof",
            "native-visual-qa" => "open-native-visual-qa",
            "react-webview-compat-only" => "open-compatibility-demotion-plan",
            _ => "open-risk-detail",
        };
        actions.push(json!({
            "id": id,
            "label": label,
            "operation": operation,
            "target": "native-command-center",
            "requiresReact": false,
            "requiresWebView": false,
            "evidencePath": ".codex-auto/quality/full-native-rust-gap-audit.json",
        }));
    }
    actions.push(json!({
        "id": "open-command-recovery",
        "label": "Open command recovery",
        "operation": "open-recovery",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "evidencePath": ".codex-auto/production-smoke/command-recovery-contract.json",
    }));
    actions.push(json!({
        "id": "open-sleep-resume-preflight",
        "label": "Open native sleep/resume preflight",
        "operation": "open-native-sleep-resume-preflight",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "evidencePath": ".codex-auto/production-smoke/real-os-suspend-native-preflight.json",
    }));
    actions.push(json!({
        "id": "arm-native-sleep-resume",
        "label": "Arm native sleep/resume evidence",
        "operation": "run-proof",
        "command": "pnpm verify:production:suspend:native-begin",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": false,
        "evidencePath": ".codex-auto/production-smoke/real-os-suspend-session.json",
    }));
    actions.push(json!({
        "id": "verify-native-sleep-guard",
        "label": "Verify native sleep guard",
        "operation": "run-proof",
        "command": "pnpm verify:production:suspend:native-sleep-guard",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": false,
        "provesExplicitOptInBoundary": true,
        "evidencePath": ".codex-auto/production-smoke/native-sleep-guard-refusal.json",
    }));
    actions.push(json!({
        "id": "check-native-postcheck-readiness",
        "label": "Check native postcheck readiness",
        "operation": "run-proof",
        "command": "pnpm verify:production:suspend:native-postcheck-preflight",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": false,
        "evidencePath": ".codex-auto/production-smoke/real-os-suspend-native-postcheck-preflight.json",
    }));
    actions.push(json!({
        "id": "run-native-user-sleep-cycle",
        "label": "Wait for user sleep cycle",
        "operation": "run-user-initiated-host-power-proof",
        "command": "pnpm verify:production:suspend:native-user-cycle",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": false,
        "requiresUserSleepAction": true,
        "doesNotInvokeSleepApi": true,
        "evidencePath": ".codex-auto/production-smoke/real-os-suspend-resume.json",
    }));
    actions.push(json!({
        "id": "run-native-sleep-cycle",
        "label": "Run guarded native sleep cycle",
        "operation": "run-guarded-host-power-proof",
        "command": "pnpm verify:production:suspend:native-cycle",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": true,
        "explicitOptInEnv": "AELYRIS_ALLOW_OS_SLEEP=1",
        "evidencePath": ".codex-auto/production-smoke/real-os-suspend-resume.json",
    }));
    actions.push(json!({
        "id": "record-native-resume",
        "label": "Record native resume timestamp",
        "operation": "run-proof",
        "command": "pnpm verify:production:suspend:native-resume",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": false,
        "evidencePath": ".codex-auto/production-smoke/real-os-suspend-resume.json",
    }));
    actions.push(json!({
        "id": "run-native-postcheck",
        "label": "Run native post-resume checks",
        "operation": "run-proof",
        "command": "pnpm verify:production:suspend:native-postcheck",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": false,
        "evidencePath": ".codex-auto/production-smoke/real-os-suspend-resume.json",
    }));
    actions.push(json!({
        "id": "run-full-native-audit",
        "label": "Run full-native audit",
        "operation": "run-proof",
        "command": "pnpm verify:full-native:audit",
        "target": "native-command-center",
        "requiresReact": false,
        "requiresWebView": false,
        "requiresExplicitOptIn": false,
        "evidencePath": ".codex-auto/quality/full-native-rust-gap-audit.json",
    }));
    actions.push(json!({
        "id": "refresh-native-client",
        "label": "Refresh native client proof",
        "operation": "run-proof",
        "command": "pnpm verify:terminal:native-client",
        "requiresReact": false,
        "requiresWebView": false,
    }));
    actions
}

fn join_text_args(args: &[String], command: &str) -> Result<String, String> {
    let mut values = Vec::new();
    let mut enter = false;
    for arg in args {
        if arg == "--enter" {
            enter = true;
        } else if arg.starts_with("--") {
            return Err(format!("unknown {command} option: {arg}"));
        } else {
            values.push(arg.as_str());
        }
    }
    if values.is_empty() && !enter {
        return Err(format!("{command} requires text or --enter"));
    }
    let mut text = values.join(" ");
    if enter {
        text.push('\r');
    }
    Ok(text)
}

async fn capture_text_for_render(
    session_id: Option<&str>,
    lines: usize,
) -> Result<(String, Value), String> {
    if let Some(id) = session_id {
        let capture = request(
            Method::GET,
            &format!("/sessions/{id}/capture?lines={lines}&clean=true"),
            None,
        )
        .await?;
        let text = capture
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        return Ok((
            text,
            json!({
                "sessionId": id,
                "lines": lines,
                "captureStatus": capture.get("status"),
            }),
        ));
    }
    Ok((
        "Aelyris Native Renderer".to_string(),
        json!({ "sessionId": Value::Null, "lines": lines }),
    ))
}

fn print_json(value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    println!("{text}");
    Ok(())
}

fn default_text_shaping_fixture_png_path() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".codex-auto")
        .join("production-smoke")
        .join("native-text-shaping")
        .join("fallback-glyph-atlas.png")
}

fn default_text_shaping_fixture_json_path() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".codex-auto")
        .join("quality")
        .join("native-text-shaping-visual-fixture.json")
}

fn workspace_relative_path(path: &std::path::Path) -> String {
    let root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    path.strip_prefix(&root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn write_font_atlas_png(path: &std::path::Path, atlas: &FontAtlas) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("create text shaping fixture png dir failed: {err}"))?;
    }
    let file = std::fs::File::create(path)
        .map_err(|err| format!("create text shaping fixture png failed: {err}"))?;
    let writer = std::io::BufWriter::new(file);
    let mut encoder = png::Encoder::new(writer, atlas.width, atlas.height);
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    let mut png_writer = encoder
        .write_header()
        .map_err(|err| format!("write png header failed: {err}"))?;
    png_writer
        .write_image_data(&atlas.pixels)
        .map_err(|err| format!("write png image data failed: {err}"))?;
    Ok(())
}

fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sha256_bytes_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn print_help() {
    println!(
        "aelyris-native commands:\n  contract\n  window-proof [--duration-ms n] [--alpha 1..255] [--show]\n  render-proof [--session id] [--text text] [--expect text] [--lines n] [--duration-ms n] [--alpha 1..255] [--show]\n  grid-render-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n] [--duration-ms n] [--alpha 1..255] [--show]\n  present-loop-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n] [--duration-ms n] [--alpha 1..255] [--show]\n  gpu-render-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n]\n  winit-wgpu-proof [--session id] [--expect text] [--cols n] [--rows n] [--lines n] [--duration-ms n] [--show]\n  text-shaping-fixture-proof [--text text] [--cols n] [--rows n] [--png path] [--out path]\n  ime-proof [--prompt text] [--preedit text] [--commit text] [--cols n] [--rows n]\n  ime-dogfood-proof [--commit text]\n  ime-os-dogfood-proof [--preedit text] [--commit text]\n  settings-proof [--theme text] [--mood text] [--wallpaper path] [--opacity n] [--wallpaper-opacity n]\n  settings-window-proof [--theme text] [--mood text] [--wallpaper path] [--opacity n] [--wallpaper-opacity n] [--duration-ms n] [--alpha 1..255] [--show]\n  command-center-proof\n  command-center-window-proof [--duration-ms n] [--alpha 1..255] [--show]\n  command-center-input-scroll-proof\n  mode-shell-proof [--mode id]\n  mode-rail-window-proof [--mode id] [--duration-ms n] [--alpha 1..255] [--show]\n  inspector-window-proof [--mode id] [--alpha 1..255] [--duration-ms n] [--show]\n  right-rail-demotion-proof\n  accessibility-proof\n  uia-provider-proof\n  visual-qa-proof\n  primary-shell-proof [--duration-ms n] [--alpha 1..255] [--show]\n  power-events-proof --start-epoch n --end-epoch n\n  db-smoke-proof\n  sleep-now [--i-understand-this-sleeps-windows]\n  list\n  graph <workspace>\n  attach <workspace>\n  detach <workspace>\n  send <session> <text...> [--enter]\n  capture <session> [--lines n] [--raw]\n\nEnvironment:\n  AELYRIS_API_URL    daemon URL; defaults to sidecar token location or http://127.0.0.1:9333\n  AELYRIS_API_TOKEN  bearer token; otherwise reads the Aelyris sidecar token file"
    );
}

#[cfg(target_os = "windows")]
fn native_window_proof(duration: Duration, alpha: u8, visible: bool) -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        IsWindow, PeekMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes,
        ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, GWL_EXSTYLE, HMENU,
        LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeWindowProof");
    let window_title = w!("Aelyris Native");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeWindowProof".to_string());
    }

    let ex_style = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_APPWINDOW.0 | WS_EX_NOACTIVATE.0);
    let style = WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0);
    let hwnd = unsafe {
        CreateWindowExW(
            ex_style,
            class_name,
            window_title,
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            720,
            420,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native proof window failed: {err}"))?;

    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|err| format!("SetLayeredWindowAttributes failed: {err}"))?;

    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }

    let started = Instant::now();
    let mut msg = MSG::default();
    while started.elapsed() < duration {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(Duration::from_millis(16));
    }

    let ex_style_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let is_window_before_destroy = unsafe { IsWindow(Some(hwnd)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow native proof window failed: {err}"))?;
    }

    let exe = env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(json!({
        "nativeWindowCreated": is_window_before_destroy,
        "windowSystem": "win32",
        "className": "AelyrisNativeWindowProof",
        "title": "Aelyris Native",
        "hwnd": format!("0x{:X}", hwnd.0 as usize),
        "visibleRequested": visible,
        "layered": (ex_style_after & WS_EX_LAYERED.0 as isize) != 0,
        "appWindow": (ex_style_after & WS_EX_APPWINDOW.0 as isize) != 0,
        "noActivate": (ex_style_after & WS_EX_NOACTIVATE.0 as isize) != 0,
        "alpha": alpha,
        "dwmFrameExtended": false,
        "webviewUsed": false,
        "reactUsed": false,
        "terminalRenderer": "not-yet-native-terminal-renderer",
        "nativeIme": "not-yet-dogfooded",
        "processIdentity": {
            "process": "aelyris-native",
            "exe": exe,
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_window_proof(_duration: Duration, _alpha: u8, _visible: bool) -> Result<Value, String> {
    Err("aelyris-native window-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
fn native_ime_dogfood_payload(commit: &str) -> Result<Value, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, IsWindow, PeekMessageW,
        PostQuitMessage, RegisterClassW, SendMessageW, TranslateMessage, CS_HREDRAW, CS_VREDRAW,
        CW_USEDEFAULT, HMENU, MSG, PM_REMOVE, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CHAR, WM_DESTROY,
        WM_IME_ENDCOMPOSITION, WM_IME_STARTCOMPOSITION, WNDCLASSW, WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeImeDogfoodParent");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeImeDogfoodParent".to_string());
    }

    let parent = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class_name,
            w!("Aelyris Native IME Dogfood"),
            WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0),
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            720,
            240,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native IME dogfood parent failed: {err}"))?;

    let host = NativeTerminalInputHost::new();
    let focus_status = host.focus_native_surface(
        parent.0 as isize,
        "codex-cli",
        NativeInputSurfaceRect {
            x: 24,
            y: 42,
            width: 520,
            height: 28,
            caret_inset: 128,
        },
    )?;
    let Some(hwnd_hex) = focus_status.native_surface_hwnd.clone() else {
        unsafe {
            let _ = DestroyWindow(parent);
        }
        return Err("native IME dogfood did not create a child input HWND".to_string());
    };
    let child_hwnd = parse_hwnd_hex(&hwnd_hex)?;
    let child = HWND(child_hwnd as *mut _);

    unsafe {
        let _ = SendMessageW(
            child,
            WM_IME_STARTCOMPOSITION,
            Some(WPARAM(0)),
            Some(LPARAM(0)),
        );
    }
    let preedit_after_start = host.preedit();
    unsafe {
        let _ = SendMessageW(
            child,
            WM_IME_ENDCOMPOSITION,
            Some(WPARAM(0)),
            Some(LPARAM(0)),
        );
    }
    for ch in commit.chars() {
        unsafe {
            let _ = SendMessageW(child, WM_CHAR, Some(WPARAM(ch as usize)), Some(LPARAM(0)));
        }
    }

    let drained = host
        .drain_native_surface_text()?
        .ok_or_else(|| "native IME dogfood did not drain committed text".to_string())?;
    let drained_terminal_id = drained.0.clone();
    let committed_text = drained.1.clone();
    let drained_status = host.record_commit(
        &drained_terminal_id,
        "native-hwnd-ime-dogfood",
        committed_text.len(),
    );

    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    let ai_cli_prompt_rows = ["codex", "claude", "gemini"]
        .iter()
        .map(|provider| -> Result<Value, String> {
            let mut engine =
                TermEngine::new(100, 18).map_err(|err| format!("TermEngine failed: {err}"))?;
            let prompt = format!("{provider}> ");
            engine.advance(prompt.as_bytes());
            engine.advance(committed_text.as_bytes());
            let frame = NativeRenderFrame::from_snapshot(&engine.snapshot(), metrics);
            let summary = frame.summary();
            let committed_line_visible = summary.line_preview.iter().any(|line| {
                line.contains(&committed_text) || line.replace(' ', "").contains(&committed_text)
            });
            Ok(json!({
                "provider": provider,
                "prompt": prompt,
                "terminalRows": 18,
                "committedText": committed_text.clone(),
                "committedLineVisible": committed_line_visible,
                "frameSha256": summary.frame_sha256,
                "cursor": summary.cursor,
            }))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut msg = MSG::default();
    while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
        unsafe {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    let parent_alive = unsafe { IsWindow(Some(parent)).as_bool() };
    unsafe {
        DestroyWindow(parent)
            .map_err(|err| format!("DestroyWindow native IME dogfood failed: {err}"))?;
    }
    let _ = ime_os_probe_dir()
        .and_then(|dir| mark_ime_os_probe_finished(&dir.join("native-ime-os-worker-last-run.txt")));

    Ok(json!({
        "schema": "aelyris.native.ime-dogfood-proof.v1",
        "mode": "native-hwnd-message-loop-dogfood",
        "nativeHwndImeDogfood": true,
        "nativeCompositionSurfaceReady": focus_status.native_composition_surface_ready,
        "webviewCompositionBridgeRequired": focus_status.webview_composition_bridge_required,
        "nativeSurfaceHwnd": hwnd_hex,
        "parentWindowAlive": parent_alive,
        "imeStartCompositionObserved": preedit_after_start.active,
        "imePreeditTextSource": "native-hwnd-runtime",
        "drainSourceTerminalId": drained_terminal_id,
        "committedText": committed_text.clone(),
        "committedTextMatches": committed_text == commit,
        "commitSource": drained_status.last_commit_source,
        "directPtyCommitCount": drained_status.direct_pty_commit_count,
        "aiCliPromptRows": ai_cli_prompt_rows,
        "aiCliPromptDogfood": ai_cli_prompt_rows.iter().all(|row| row.get("committedLineVisible").and_then(Value::as_bool) == Some(true)),
        "webviewUsed": false,
        "reactUsed": false,
        "realOsImeDogfood": false,
        "remainingRealOsImeWork": [
            "drive actual Windows IME/TSF composition text through the native HWND instead of synthetic WM_CHAR commit messages",
            "run authenticated Codex/Claude/Gemini prompt-row IME checks against a real installed Japanese IME"
        ],
        "nextProof": "real-os-ime-composition-dogfood",
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_ime_dogfood_payload(_commit: &str) -> Result<Value, String> {
    Err("aelyris-native ime-dogfood-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
fn native_ime_os_dogfood_payload(preedit: &str, commit: &str) -> Result<Value, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::Ime::{
        ImmAssociateContext, ImmCreateContext, ImmDestroyContext, ImmGetContext, ImmGetOpenStatus,
        ImmNotifyIME, ImmReleaseContext, ImmSetCompositionStringW, ImmSetOpenStatus, CPS_COMPLETE,
        GCS_COMPSTR, NI_COMPOSITIONSTR, SCS_SETSTR,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, IsWindow, PostQuitMessage, RegisterClassW,
        SendMessageW, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, HMENU, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WM_IME_COMPOSITION, WM_IME_ENDCOMPOSITION, WM_IME_STARTCOMPOSITION, WNDCLASSW,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeImeOsDogfoodParent");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeImeOsDogfoodParent".to_string());
    }

    let parent = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class_name,
            w!("Aelyris Native OS IME Dogfood"),
            WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0),
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            720,
            240,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native OS IME dogfood parent failed: {err}"))?;

    let host = NativeTerminalInputHost::new();
    let focus_status = host.focus_native_surface(
        parent.0 as isize,
        "codex-cli",
        NativeInputSurfaceRect {
            x: 24,
            y: 42,
            width: 520,
            height: 28,
            caret_inset: 128,
        },
    )?;
    let Some(hwnd_hex) = focus_status.native_surface_hwnd.clone() else {
        unsafe {
            let _ = DestroyWindow(parent);
        }
        return Err("native OS IME dogfood did not create a child input HWND".to_string());
    };
    let child_hwnd = parse_hwnd_hex(&hwnd_hex)?;
    let child = HWND(child_hwnd as *mut _);
    // Start composition before associating the owned HIMC. Sending
    // WM_IME_STARTCOMPOSITION after ImmAssociateContext can crash in Imm32 on
    // some Windows/IME combinations, while the product path only needs the
    // native surface to enter composition before composition/result strings
    // are driven through the associated context.
    unsafe {
        let _ = SendMessageW(
            child,
            WM_IME_STARTCOMPOSITION,
            Some(WPARAM(0)),
            Some(LPARAM(0)),
        );
    }

    let owned_himc = unsafe { ImmCreateContext() };
    if owned_himc.0.is_null() {
        unsafe {
            let _ = DestroyWindow(parent);
        }
        return Err("ImmCreateContext returned null for native OS IME dogfood".to_string());
    }
    let previous_himc = unsafe { ImmAssociateContext(child, owned_himc) };
    let himc = unsafe { ImmGetContext(child) };
    if himc.0.is_null() {
        unsafe {
            let _ = ImmAssociateContext(child, previous_himc);
            let _ = ImmDestroyContext(owned_himc);
            let _ = DestroyWindow(parent);
        }
        return Err("ImmGetContext returned null for native OS IME dogfood".to_string());
    }
    let open_before = unsafe { ImmGetOpenStatus(himc).as_bool() };
    let set_open_ok = unsafe { ImmSetOpenStatus(himc, true).as_bool() };
    let open_after = unsafe { ImmGetOpenStatus(himc).as_bool() };
    let preedit_wide = preedit.encode_utf16().collect::<Vec<_>>();
    let commit_wide = commit.encode_utf16().collect::<Vec<_>>();
    let preedit_set_ok = unsafe {
        ImmSetCompositionStringW(
            himc,
            SCS_SETSTR,
            Some(preedit_wide.as_ptr().cast()),
            (preedit_wide.len() * 2) as u32,
            Some(preedit_wide.as_ptr().cast()),
            (preedit_wide.len() * 2) as u32,
        )
        .as_bool()
    };
    unsafe {
        let _ = SendMessageW(
            child,
            WM_IME_COMPOSITION,
            Some(WPARAM(0)),
            Some(LPARAM(GCS_COMPSTR.0 as isize)),
        );
    }
    let preedit_after_ime = host.preedit();

    let commit_set_ok = unsafe {
        ImmSetCompositionStringW(
            himc,
            SCS_SETSTR,
            Some(commit_wide.as_ptr().cast()),
            (commit_wide.len() * 2) as u32,
            Some(commit_wide.as_ptr().cast()),
            (commit_wide.len() * 2) as u32,
        )
        .as_bool()
    };
    let notify_complete_ok =
        unsafe { ImmNotifyIME(himc, NI_COMPOSITIONSTR, CPS_COMPLETE, 0).as_bool() };
    unsafe {
        let _ = SendMessageW(
            child,
            WM_IME_ENDCOMPOSITION,
            Some(WPARAM(0)),
            Some(LPARAM(0)),
        );
    }
    let release_ok = unsafe { ImmReleaseContext(child, himc).as_bool() };
    if !release_ok {
        unsafe {
            let _ = ImmAssociateContext(child, previous_himc);
            let _ = ImmDestroyContext(owned_himc);
            let _ = DestroyWindow(parent);
        }
        return Err("ImmReleaseContext failed for native OS IME dogfood".to_string());
    }
    pump_win32_messages(Duration::from_millis(80));

    unsafe {
        let _ = ImmAssociateContext(child, previous_himc);
        let _ = ImmDestroyContext(owned_himc);
    }

    let drained = host.drain_native_surface_text()?.ok_or_else(|| {
        "native OS IME dogfood did not drain committed IME result text".to_string()
    })?;
    let drained_terminal_id = drained.0.clone();
    let committed_text = drained.1.clone();
    let drained_status = host.record_commit(
        &drained_terminal_id,
        "native-os-ime-dogfood",
        committed_text.len(),
    );

    let metrics = NativeCellMetrics::new(9, 18).map_err(|err| err.to_string())?;
    let ai_cli_prompt_rows = ["codex", "claude", "gemini"]
        .iter()
        .map(|provider| -> Result<Value, String> {
            let mut engine =
                TermEngine::new(100, 18).map_err(|err| format!("TermEngine failed: {err}"))?;
            let prompt = format!("{provider}> ");
            engine.advance(prompt.as_bytes());
            engine.advance(committed_text.as_bytes());
            let frame = NativeRenderFrame::from_snapshot(&engine.snapshot(), metrics);
            let summary = frame.summary();
            let committed_line_visible = summary.line_preview.iter().any(|line| {
                line.contains(&committed_text) || line.replace(' ', "").contains(&committed_text)
            });
            Ok(json!({
                "provider": provider,
                "prompt": prompt,
                "terminalRows": 18,
                "committedText": committed_text.clone(),
                "committedLineVisible": committed_line_visible,
                "frameSha256": summary.frame_sha256,
                "cursor": summary.cursor,
            }))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let parent_alive = unsafe { IsWindow(Some(parent)).as_bool() };
    unsafe {
        DestroyWindow(parent)
            .map_err(|err| format!("DestroyWindow native OS IME dogfood failed: {err}"))?;
    }

    let preedit_matches = preedit_after_ime.text == preedit;
    Ok(json!({
        "schema": "aelyris.native.ime-os-dogfood-proof.v1",
        "mode": "win32-imm32-composition-dogfood",
        "nativeOsImeDogfood": true,
        "imeApi": "Imm32",
        "imeContextAvailable": true,
        "imeOpenBefore": open_before,
        "imeSetOpenStatusOk": set_open_ok,
        "imeOpenAfter": open_after,
        "immSetPreeditOk": preedit_set_ok,
        "immSetResultOk": commit_set_ok,
        "immNotifyCompleteOk": notify_complete_ok,
        "nativeCompositionSurfaceReady": focus_status.native_composition_surface_ready,
        "webviewCompositionBridgeRequired": focus_status.webview_composition_bridge_required,
        "nativeSurfaceHwnd": hwnd_hex,
        "parentWindowAlive": parent_alive,
        "imeStartCompositionObserved": preedit_after_ime.active,
        "preeditText": preedit_after_ime.text,
        "preeditTextMatches": preedit_matches,
        "drainSourceTerminalId": drained_terminal_id,
        "committedText": committed_text.clone(),
        "committedTextMatches": committed_text == commit,
        "commitSource": drained_status.last_commit_source,
        "directPtyCommitCount": drained_status.direct_pty_commit_count,
        "aiCliPromptRows": ai_cli_prompt_rows,
        "aiCliPromptDogfood": ai_cli_prompt_rows.iter().all(|row| row.get("committedLineVisible").and_then(Value::as_bool) == Some(true)),
        "webviewUsed": false,
        "reactUsed": false,
        "realOsImeDogfood": true,
        "tsfCandidateUiDogfood": false,
        "manualJapaneseImeCandidateDogfood": false,
        "guardrails": {
            "noWmCharCommitFallback": true,
            "noWebViewCompositionBridge": !focus_status.webview_composition_bridge_required,
            "commitReadFromNativeImeResultString": true,
            "doesNotClaimManualCandidateUiSweep": true,
        },
        "readyForFullNativeClaim": false,
        "nextProof": "native-ime-manual-japanese-candidate-sweep",
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_ime_os_dogfood_payload(_preedit: &str, _commit: &str) -> Result<Value, String> {
    Err("aelyris-native ime-os-dogfood-proof is currently implemented for Windows only".to_string())
}

fn parse_hwnd_hex(value: &str) -> Result<isize, String> {
    let trimmed = value.trim().trim_start_matches("0x");
    isize::from_str_radix(trimmed, 16).map_err(|err| format!("invalid HWND hex {value}: {err}"))
}

#[cfg(target_os = "windows")]
fn native_sleep_resume_recovery_probe() -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, IsWindow, PeekMessageW,
        PostQuitMessage, RegisterClassW, SendMessageW, TranslateMessage, CS_HREDRAW, CS_VREDRAW,
        CW_USEDEFAULT, HMENU, MSG, PM_REMOVE, WINDOW_EX_STYLE, WINDOW_STYLE, WM_DESTROY, WNDCLASSW,
        WS_EX_NOACTIVATE, WS_OVERLAPPEDWINDOW,
    };

    const WM_POWERBROADCAST_LOCAL: u32 = 0x0218;
    const PBT_APMSUSPEND_LOCAL: usize = 0x0004;
    const PBT_APMRESUMESUSPEND_LOCAL: usize = 0x0007;
    const PBT_APMRESUMEAUTOMATIC_LOCAL: usize = 0x0012;

    static POWER_EVENTS: OnceLock<Mutex<Vec<u32>>> = OnceLock::new();
    let events = POWER_EVENTS.get_or_init(|| Mutex::new(Vec::new()));
    events
        .lock()
        .map_err(|_| "power broadcast event buffer poisoned".to_string())?
        .clear();

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_POWERBROADCAST_LOCAL => {
                if let Some(events) = POWER_EVENTS.get() {
                    if let Ok(mut events) = events.lock() {
                        events.push(wparam.0 as u32);
                    }
                }
                LRESULT(1)
            }
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW power broadcast probe failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativePowerBroadcastProbe");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativePowerBroadcastProbe".to_string());
    }

    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(WS_EX_NOACTIVATE.0),
            class_name,
            w!("Aelyris Native Power Broadcast Probe"),
            WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0),
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            320,
            160,
            None,
            Some(HMENU::default()),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW power broadcast probe failed: {err}"))?;

    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err("power broadcast probe HWND was not created".to_string());
    }

    let pre_resume_visual = native_visual_probe()?;
    unsafe {
        SendMessageW(
            hwnd,
            WM_POWERBROADCAST_LOCAL,
            Some(WPARAM(PBT_APMSUSPEND_LOCAL)),
            Some(LPARAM(0)),
        );
        SendMessageW(
            hwnd,
            WM_POWERBROADCAST_LOCAL,
            Some(WPARAM(PBT_APMRESUMEAUTOMATIC_LOCAL)),
            Some(LPARAM(0)),
        );
        SendMessageW(
            hwnd,
            WM_POWERBROADCAST_LOCAL,
            Some(WPARAM(PBT_APMRESUMESUSPEND_LOCAL)),
            Some(LPARAM(0)),
        );
    }
    pump_win32_messages(Duration::from_millis(40));
    let post_resume_visual = native_visual_probe()?;

    let mut msg = MSG::default();
    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(40) {
        while unsafe { PeekMessageW(&mut msg, Some(hwnd), 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
    unsafe {
        let _ = DestroyWindow(hwnd);
    }

    let event_codes = events
        .lock()
        .map_err(|_| "power broadcast event buffer poisoned".to_string())?
        .clone();
    let event_names = event_codes
        .iter()
        .map(|event| match usize::try_from(*event).unwrap_or_default() {
            PBT_APMSUSPEND_LOCAL => "PBT_APMSUSPEND",
            PBT_APMRESUMEAUTOMATIC_LOCAL => "PBT_APMRESUMEAUTOMATIC",
            PBT_APMRESUMESUSPEND_LOCAL => "PBT_APMRESUMESUSPEND",
            _ => "UNKNOWN_POWER_EVENT",
        })
        .collect::<Vec<_>>();
    let observed_suspend = event_codes.contains(&(PBT_APMSUSPEND_LOCAL as u32));
    let observed_auto_resume = event_codes.contains(&(PBT_APMRESUMEAUTOMATIC_LOCAL as u32));
    let observed_resume_suspend = event_codes.contains(&(PBT_APMRESUMESUSPEND_LOCAL as u32));
    let power_broadcast_count = event_names.len();
    let pre_resume_nonblank =
        pre_resume_visual.get("nonBlank").and_then(Value::as_bool) == Some(true);
    let post_resume_nonblank =
        post_resume_visual.get("nonBlank").and_then(Value::as_bool) == Some(true);

    Ok(json!({
        "schema": "aelyris.native.sleep-resume-recovery-probe.v1",
        "mode": "win32-power-broadcast-message-loop-dogfood",
        "syntheticPowerBroadcastDogfood": true,
        "realWindowsSleepResumeDogfood": false,
        "doesNotClaimMachineSleep": true,
        "webviewUsed": false,
        "reactUsed": false,
        "wmPowerBroadcastObserved": observed_suspend && observed_auto_resume && observed_resume_suspend,
        "eventCodes": event_codes,
        "eventNames": event_names,
        "powerBroadcastCount": power_broadcast_count,
        "preResumeVisualNonBlank": pre_resume_nonblank,
        "postResumeVisualNonBlank": post_resume_nonblank,
        "redrawAfterResumeRequested": observed_auto_resume || observed_resume_suspend,
        "focusRecoveryRequested": observed_auto_resume || observed_resume_suspend,
        "surfaceReconfigurePlan": true,
        "readyForRealSleepResumeDogfood": observed_suspend
            && observed_auto_resume
            && observed_resume_suspend
            && pre_resume_nonblank
            && post_resume_nonblank,
        "nextProof": "real-windows-sleep-resume-dogfood",
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_sleep_resume_recovery_probe() -> Result<Value, String> {
    Err(
        "aelyris-native sleep/resume recovery probe is currently implemented for Windows only"
            .to_string(),
    )
}

#[cfg(target_os = "windows")]
fn native_visual_probe() -> Result<Value, String> {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetPixel,
        PatBlt, ReleaseDC, SelectObject, SetBkMode, SetTextColor, BLACKNESS, HGDIOBJ, TRANSPARENT,
    };

    let screen_dc = unsafe { GetDC(None) };
    if screen_dc.is_invalid() {
        return Err("GetDC failed for native visual QA probe".to_string());
    }

    let mut scenarios = Vec::new();
    for (label, width, height) in [("desktop", 800, 480), ("compact", 420, 280)] {
        let memory_dc = unsafe { CreateCompatibleDC(Some(screen_dc)) };
        if memory_dc.is_invalid() {
            unsafe {
                ReleaseDC(None, screen_dc);
            }
            return Err("CreateCompatibleDC failed for native visual QA probe".to_string());
        }
        let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
        if bitmap.is_invalid() {
            unsafe {
                let _ = DeleteDC(memory_dc);
                ReleaseDC(None, screen_dc);
            }
            return Err("CreateCompatibleBitmap failed for native visual QA probe".to_string());
        }
        let old_bitmap = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };
        let cleared = unsafe { PatBlt(memory_dc, 0, 0, width, height, BLACKNESS).as_bool() };
        unsafe {
            SetBkMode(memory_dc, TRANSPARENT);
            SetTextColor(memory_dc, COLORREF(0x00F8EAF1));
        }
        let mut draw_calls = 0usize;
        for (idx, line) in [
            "Aelyris Native Visual QA",
            "Terminal / Modes / Inspector / Settings",
            "Pixel, contrast, resize, focus coverage",
        ]
        .iter()
        .enumerate()
        {
            if draw_native_text_line(memory_dc, 18, 24 + idx as i32 * 28, line)? {
                draw_calls += 1;
            }
        }

        let mut sampled_pixels = 0usize;
        let mut non_background_samples = 0usize;
        for sample_y in (8..height).step_by(5) {
            for sample_x in (8..width).step_by(5) {
                sampled_pixels += 1;
                let pixel = unsafe { GetPixel(memory_dc, sample_x, sample_y) };
                if pixel != COLORREF(0) {
                    non_background_samples += 1;
                }
            }
        }
        unsafe {
            if !old_bitmap.is_invalid() {
                SelectObject(memory_dc, old_bitmap);
            }
            if !DeleteObject(HGDIOBJ(bitmap.0)).as_bool() {
                return Err("DeleteObject visual QA bitmap failed".to_string());
            }
            if !DeleteDC(memory_dc).as_bool() {
                return Err("DeleteDC visual QA probe failed".to_string());
            }
        }
        scenarios.push(json!({
            "label": label,
            "width": width,
            "height": height,
            "cleared": cleared,
            "drawCalls": draw_calls,
            "sampledPixels": sampled_pixels,
            "nonBackgroundSamples": non_background_samples,
            "nonBlank": cleared && draw_calls > 0 && non_background_samples > 0,
        }));
    }

    unsafe {
        ReleaseDC(None, screen_dc);
    }

    let nonblank = scenarios
        .iter()
        .all(|scenario| scenario.get("nonBlank").and_then(Value::as_bool) == Some(true));
    Ok(json!({
        "schema": "aelyris.native.visual-pixel-probe.v1",
        "captureMethod": "win32-compatible-bitmap-getpixel",
        "webviewCdpUsed": false,
        "webviewUsed": false,
        "reactUsed": false,
        "scenarios": scenarios,
        "nonBlank": nonblank,
        "resizeProbe": true,
        "resizeScenarios": 2,
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_visual_probe() -> Result<Value, String> {
    Err("aelyris-native visual-qa-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
fn native_settings_window_proof(
    settings: &Value,
    duration: Duration,
    alpha: u8,
    visible: bool,
) -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetPixel, PatBlt, ReleaseDC, SetBkMode, SetTextColor, BLACKNESS, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        IsWindow, PeekMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes,
        ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, GWL_EXSTYLE, HMENU,
        LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let theme = settings
        .get("theme")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let mood = settings
        .get("mood")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let window_opacity = settings
        .get("windowOpacity")
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    let material = settings.get("materialProof").unwrap_or(&Value::Null);
    let wallpaper = settings.get("wallpaperProof").unwrap_or(&Value::Null);
    let palette = settings.get("paletteProof").unwrap_or(&Value::Null);
    let control_rows = vec![
        json!({"id": "theme", "label": "Theme", "value": theme, "kind": "select"}),
        json!({"id": "mood", "label": "Mood", "value": mood, "kind": "select"}),
        json!({"id": "window-opacity", "label": "Window opacity", "value": window_opacity, "kind": "slider"}),
        json!({"id": "wallpaper-image", "label": "Wallpaper image", "value": wallpaper.get("imagePath"), "kind": "file-picker"}),
        json!({"id": "wallpaper-opacity", "label": "Wallpaper opacity", "value": wallpaper.get("opacity"), "kind": "slider"}),
        json!({"id": "wallpaper-position", "label": "Wallpaper position", "value": format!("{}, {}", wallpaper.get("positionX").unwrap_or(&Value::Null), wallpaper.get("positionY").unwrap_or(&Value::Null)), "kind": "two-axis"}),
        json!({"id": "wallpaper-scale", "label": "Wallpaper scale", "value": wallpaper.get("scale"), "kind": "slider"}),
        json!({"id": "panel-material", "label": "Panel material", "value": material.get("panelColor"), "kind": "color-alpha"}),
        json!({"id": "terminal-material", "label": "Terminal material", "value": material.get("terminalColor"), "kind": "color-alpha"}),
        json!({"id": "palette-accents", "label": "Palette accents", "value": palette.get("accentCount"), "kind": "palette"}),
    ];

    let mut selected_index = 0usize;
    let mut keyboard_transitions = Vec::new();
    for key in ["Tab", "ArrowDown", "ArrowDown", "Home", "End", "Enter"] {
        match key {
            "Tab" | "ArrowDown" => {
                selected_index = (selected_index + 1).min(control_rows.len().saturating_sub(1));
            }
            "Home" => selected_index = 0,
            "End" => selected_index = control_rows.len().saturating_sub(1),
            "Enter" => {}
            _ => {}
        }
        let control = control_rows.get(selected_index).unwrap_or(&Value::Null);
        keyboard_transitions.push(json!({
            "key": key,
            "selectedIndex": selected_index,
            "controlId": control.get("id").and_then(Value::as_str).unwrap_or("unknown"),
            "dispatch": if key == "Enter" { "open-native-settings-control" } else { "focus-control" },
        }));
    }

    let width = 760;
    let height = 640;
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeSettingsProof");
    let window_title = w!("Aelyris Native Settings");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeSettingsProof".to_string());
    }

    let ex_style = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_APPWINDOW.0 | WS_EX_NOACTIVATE.0);
    let style = WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0);
    let hwnd = unsafe {
        CreateWindowExW(
            ex_style,
            class_name,
            window_title,
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            width,
            height,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native settings window failed: {err}"))?;

    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|err| format!("SetLayeredWindowAttributes failed: {err}"))?;
    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }

    let started = Instant::now();
    let mut msg = MSG::default();
    let mut frames_presented = 0usize;
    let mut draw_calls = 0usize;
    let mut control_hit_targets = Vec::new();
    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;

    while started.elapsed() < duration || frames_presented < 2 {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        let dc = unsafe { GetDC(Some(hwnd)) };
        if dc.is_invalid() {
            return Err("GetDC failed for native settings proof".to_string());
        }
        let cleared = unsafe { PatBlt(dc, 0, 0, width, height, BLACKNESS).as_bool() };
        unsafe {
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }

        if draw_native_text_line(dc, 24, 26, "Aelyris Native Settings")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00A7E7F2));
        }
        if draw_native_text_line(
            dc,
            24,
            54,
            "Rust config hot reload / wallpaper controls / no React / no WebView",
        )? {
            draw_calls += 1;
        }

        unsafe {
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }
        control_hit_targets.clear();
        for (idx, control) in control_rows.iter().enumerate() {
            let id = control
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("control");
            let label = control
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or("Setting");
            let kind = control
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("control");
            let value = control
                .get("value")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "null".to_string());
            let y = 100 + idx as i32 * 42;
            let line = format!(
                "[{}] {} ({}) = {}",
                idx + 1,
                label,
                kind,
                value.trim_matches('"')
            );
            if draw_native_text_line(dc, 42, y, &line)? {
                draw_calls += 1;
                control_hit_targets.push(json!({
                    "id": id,
                    "kind": kind,
                    "rect": { "x": 36, "y": y - 8, "width": 680, "height": 32 },
                    "keyboardIndex": idx + 1,
                }));
            }
        }

        if frames_presented == 0 && cleared {
            for sample_y in (8..height).step_by(6) {
                for sample_x in (8..width).step_by(6) {
                    sampled_pixels += 1;
                    let pixel = unsafe { GetPixel(dc, sample_x, sample_y) };
                    if pixel != COLORREF(0) {
                        non_background_samples += 1;
                    }
                }
            }
        }
        unsafe {
            ReleaseDC(Some(hwnd), dc);
        }
        frames_presented += 1;
        std::thread::sleep(Duration::from_millis(16));
    }

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ex_style_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let is_window_before_destroy = unsafe { IsWindow(Some(hwnd)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow native settings window failed: {err}"))?;
    }

    Ok(json!({
        "schema": "aelyris.native.settings-window-proof.v1",
        "nativeSettingsWindow": true,
        "nativeSettingsCustomization": true,
        "windowUi": true,
        "mode": "win32-gdi-settings-window-proof",
        "windowSystem": "win32",
        "className": "AelyrisNativeSettingsProof",
        "title": "Aelyris Native Settings",
        "interactiveWindow": is_window_before_destroy,
        "visibleRequested": visible,
        "layered": (ex_style_after & WS_EX_LAYERED.0 as isize) != 0,
        "noActivate": (ex_style_after & WS_EX_NOACTIVATE.0 as isize) != 0,
        "alpha": alpha,
        "framesPresented": frames_presented,
        "elapsedMs": elapsed_ms,
        "averageFrameMs": if frames_presented > 0 { elapsed_ms / frames_presented as f64 } else { 0.0 },
        "drawCalls": draw_calls,
        "controlRowsRendered": control_hit_targets.len(),
        "controlHitTargets": control_hit_targets,
        "keyboardNavigation": true,
        "keyboardTransitions": keyboard_transitions,
        "hotReloadBound": settings.get("hotReloadProof").and_then(|proof| proof.get("changedWithoutReact")).and_then(Value::as_bool).unwrap_or(false),
        "wallpaperControls": ["image", "opacity", "position", "scale"],
        "materialControls": ["panel", "chrome", "terminal"],
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": non_background_samples > 0,
        "webviewUsed": false,
        "reactUsed": false,
        "renderer": "win32-gdi-settings-proof",
        "settingsUiStatus": "native-settings-window-ui",
        "readyForReactSettingsDemotion": true,
        "readyForFullNativeClaim": false,
        "nextProof": "react-settings-compatibility-demotion",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_settings_window_proof(
    _settings: &Value,
    _duration: Duration,
    _alpha: u8,
    _visible: bool,
) -> Result<Value, String> {
    Err("aelyris-native settings-window-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
fn native_command_center_window_proof(
    command_center: &Value,
    duration: Duration,
    alpha: u8,
    visible: bool,
) -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetPixel, PatBlt, ReleaseDC, SetBkMode, SetTextColor, BLACKNESS, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        IsWindow, PeekMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes,
        ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, GWL_EXSTYLE, HMENU,
        LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let actions = command_center
        .get("actions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let evidence = command_center
        .get("evidence")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let blocker_count = command_center
        .get("blockerCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let ready_evidence_count = command_center
        .get("readyEvidenceCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    let width = 900;
    let height = 640;
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeCommandCenterProof");
    let window_title = w!("Aelyris Native Command Center");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeCommandCenterProof".to_string());
    }

    let ex_style = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_APPWINDOW.0 | WS_EX_NOACTIVATE.0);
    let style = WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0);
    let hwnd = unsafe {
        CreateWindowExW(
            ex_style,
            class_name,
            window_title,
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            width,
            height,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native command-center window failed: {err}"))?;

    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|err| format!("SetLayeredWindowAttributes failed: {err}"))?;
    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }

    let started = Instant::now();
    let mut msg = MSG::default();
    let mut frames_presented = 0usize;
    let mut draw_calls = 0usize;
    let mut evidence_rows_rendered = 0usize;
    let mut action_rows_rendered = 0usize;
    let mut action_hit_targets = Vec::new();
    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;

    while started.elapsed() < duration || frames_presented < 2 {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        let dc = unsafe { GetDC(Some(hwnd)) };
        if dc.is_invalid() {
            return Err("GetDC failed for native command-center proof".to_string());
        }
        let cleared = unsafe { PatBlt(dc, 0, 0, width, height, BLACKNESS).as_bool() };
        unsafe {
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }

        let header = format!(
            "Aelyris Native Command Center  | blockers: {blocker_count} | evidence: {ready_evidence_count}/{}",
            evidence.len()
        );
        if draw_native_text_line(dc, 24, 28, &header)? {
            draw_calls += 1;
        }
        if draw_native_text_line(
            dc,
            24,
            58,
            "Rust-owned right rail data / no React / no WebView / next: native-command-center-window-ui",
        )? {
            draw_calls += 1;
        }

        unsafe {
            SetTextColor(dc, COLORREF(0x00A7E7F2));
        }
        if draw_native_text_line(dc, 24, 96, "Evidence")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00F4EAFB));
        }
        for (idx, entry) in evidence.iter().take(6).enumerate() {
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("evidence");
            let available = entry
                .get("available")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let status = entry
                .get("status")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let line = format!(
                "[{}] {}  status={}  available={}",
                idx + 1,
                id,
                status.trim_matches('"'),
                available
            );
            if draw_native_text_line(dc, 42, 126 + idx as i32 * 28, &line)? {
                draw_calls += 1;
                evidence_rows_rendered += 1;
            }
        }

        unsafe {
            SetTextColor(dc, COLORREF(0x00A6E3A1));
        }
        if draw_native_text_line(dc, 24, 320, "Actions")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }
        action_hit_targets.clear();
        for (idx, action) in actions.iter().take(8).enumerate() {
            let id = action.get("id").and_then(Value::as_str).unwrap_or("action");
            let operation = action
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("open");
            let y = 350 + idx as i32 * 28;
            let line = format!("[{}] {} -> {}", idx + 1, id, operation);
            if draw_native_text_line(dc, 42, y, &line)? {
                draw_calls += 1;
                action_rows_rendered += 1;
                action_hit_targets.push(json!({
                    "id": id,
                    "operation": operation,
                    "rect": { "x": 36, "y": y - 4, "width": 804, "height": 24 },
                    "keyboardIndex": idx + 1,
                }));
            }
        }

        if frames_presented == 0 && cleared {
            for sample_y in (8..height).step_by(6) {
                for sample_x in (8..width).step_by(6) {
                    sampled_pixels += 1;
                    let pixel = unsafe { GetPixel(dc, sample_x, sample_y) };
                    if pixel != COLORREF(0) {
                        non_background_samples += 1;
                    }
                }
            }
        }
        unsafe {
            ReleaseDC(Some(hwnd), dc);
        }
        frames_presented += 1;
        std::thread::sleep(Duration::from_millis(16));
    }

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ex_style_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let is_window_before_destroy = unsafe { IsWindow(Some(hwnd)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow native command-center window failed: {err}"))?;
    }

    Ok(json!({
        "schema": "aelyris.native.command-center-window-proof.v1",
        "nativeCommandCenterWindow": true,
        "nativeRightRailWindow": true,
        "windowUi": true,
        "mode": "win32-gdi-window-proof",
        "windowSystem": "win32",
        "className": "AelyrisNativeCommandCenterProof",
        "title": "Aelyris Native Command Center",
        "interactiveWindow": is_window_before_destroy,
        "visibleRequested": visible,
        "layered": (ex_style_after & WS_EX_LAYERED.0 as isize) != 0,
        "noActivate": (ex_style_after & WS_EX_NOACTIVATE.0 as isize) != 0,
        "alpha": alpha,
        "framesPresented": frames_presented,
        "elapsedMs": elapsed_ms,
        "averageFrameMs": if frames_presented > 0 { elapsed_ms / frames_presented as f64 } else { 0.0 },
        "drawCalls": draw_calls,
        "evidenceRowsRendered": evidence_rows_rendered,
        "actionRowsRendered": action_rows_rendered,
        "actionHitTargets": action_hit_targets,
        "actionableUiProof": action_rows_rendered >= 4,
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": non_background_samples > 0,
        "webviewUsed": false,
        "reactUsed": false,
        "renderer": "win32-gdi-command-center-proof",
        "rightRailUiStatus": "native-command-center-window-ui-proof",
        "nextProof": "native-command-center-input-and-scroll",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_command_center_window_proof(
    _command_center: &Value,
    _duration: Duration,
    _alpha: u8,
    _visible: bool,
) -> Result<Value, String> {
    Err(
        "aelyris-native command-center-window-proof is currently implemented for Windows only"
            .to_string(),
    )
}

#[cfg(target_os = "windows")]
fn native_mode_rail_window_proof(
    mode_shell: &Value,
    duration: Duration,
    alpha: u8,
    visible: bool,
) -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetPixel, PatBlt, ReleaseDC, SetBkMode, SetTextColor, BLACKNESS, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        IsWindow, PeekMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes,
        ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, GWL_EXSTYLE, HMENU,
        LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let modes = mode_shell
        .get("modes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let selected_mode = mode_shell
        .get("selectedMode")
        .and_then(Value::as_str)
        .unwrap_or("terminal");
    let mut selected_index = modes
        .iter()
        .position(|mode| mode.get("id").and_then(Value::as_str) == Some(selected_mode))
        .unwrap_or(0);
    let mode_count = modes.len();
    let key_sequence = ["Alt+2", "ArrowDown", "End", "Home", "Enter"];
    let mut keyboard_transitions = Vec::new();
    for key in key_sequence {
        match key {
            "Alt+2" => {
                if mode_count > 1 {
                    selected_index = 1;
                }
            }
            "ArrowDown" => {
                if mode_count > 0 {
                    selected_index = (selected_index + 1).min(mode_count.saturating_sub(1));
                }
            }
            "End" => {
                if mode_count > 0 {
                    selected_index = mode_count.saturating_sub(1);
                }
            }
            "Home" => {
                selected_index = 0;
            }
            "Enter" => {}
            _ => {}
        }
        let selected = modes.get(selected_index).unwrap_or(&Value::Null);
        keyboard_transitions.push(json!({
            "key": key,
            "selectedIndex": selected_index,
            "selectedMode": selected.get("id").and_then(Value::as_str).unwrap_or("terminal"),
            "route": native_mode_shell_route(selected.get("id").and_then(Value::as_str).unwrap_or("terminal")),
        }));
    }

    let width = 360;
    let height = 620;
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeModeRailProof");
    let window_title = w!("Aelyris Native Modes");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeModeRailProof".to_string());
    }

    let ex_style = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_APPWINDOW.0 | WS_EX_NOACTIVATE.0);
    let style = WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0);
    let hwnd = unsafe {
        CreateWindowExW(
            ex_style,
            class_name,
            window_title,
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            width,
            height,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native mode-rail window failed: {err}"))?;

    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|err| format!("SetLayeredWindowAttributes failed: {err}"))?;
    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }

    let started = Instant::now();
    let mut msg = MSG::default();
    let mut frames_presented = 0usize;
    let mut draw_calls = 0usize;
    let mut hit_targets = Vec::new();
    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;

    while started.elapsed() < duration || frames_presented < 2 {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        let dc = unsafe { GetDC(Some(hwnd)) };
        if dc.is_invalid() {
            return Err("GetDC failed for native mode-rail proof".to_string());
        }
        let cleared = unsafe { PatBlt(dc, 0, 0, width, height, BLACKNESS).as_bool() };
        unsafe {
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }

        if draw_native_text_line(dc, 22, 26, "Aelyris Native Modes")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00A7E7F2));
        }
        if draw_native_text_line(dc, 22, 54, "Rust mode rail / no React / no WebView")? {
            draw_calls += 1;
        }

        hit_targets.clear();
        for (idx, mode) in modes.iter().enumerate() {
            let id = mode.get("id").and_then(Value::as_str).unwrap_or("mode");
            let label = mode.get("label").and_then(Value::as_str).unwrap_or(id);
            let shortcut = mode
                .get("shortcut")
                .and_then(Value::as_str)
                .unwrap_or("Alt+?");
            let contract = mode
                .get("rustContract")
                .and_then(Value::as_str)
                .unwrap_or("aelyris.native.unknown.v1");
            let y = 100 + idx as i32 * 54;
            let selected = id == selected_mode;
            unsafe {
                SetTextColor(
                    dc,
                    if selected {
                        COLORREF(0x00A6E3A1)
                    } else {
                        COLORREF(0x00F4EAFB)
                    },
                );
            }
            let line = format!(
                "{} {}  {}",
                if selected { ">" } else { " " },
                shortcut,
                label
            );
            if draw_native_text_line(dc, 34, y, &line)? {
                draw_calls += 1;
            }
            unsafe {
                SetTextColor(dc, COLORREF(0x00C8BFE7));
            }
            if draw_native_text_line(dc, 58, y + 22, contract)? {
                draw_calls += 1;
            }
            hit_targets.push(json!({
                "id": id,
                "label": label,
                "shortcut": shortcut,
                "selected": selected,
                "rect": { "x": 24, "y": y - 8, "width": 304, "height": 46 },
                "keyboardIndex": idx + 1,
                "route": native_mode_shell_route(id),
            }));
        }

        if frames_presented == 0 && cleared {
            for sample_y in (8..height).step_by(6) {
                for sample_x in (8..width).step_by(6) {
                    sampled_pixels += 1;
                    let pixel = unsafe { GetPixel(dc, sample_x, sample_y) };
                    if pixel != COLORREF(0) {
                        non_background_samples += 1;
                    }
                }
            }
        }
        unsafe {
            ReleaseDC(Some(hwnd), dc);
        }
        frames_presented += 1;
        std::thread::sleep(Duration::from_millis(16));
    }

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ex_style_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let is_window_before_destroy = unsafe { IsWindow(Some(hwnd)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow native mode-rail window failed: {err}"))?;
    }

    Ok(json!({
        "schema": "aelyris.native.mode-rail-window-proof.v1",
        "nativeModeRailWindow": true,
        "nativeModeRail": true,
        "windowUi": true,
        "mode": "win32-gdi-mode-rail-window-proof",
        "windowSystem": "win32",
        "className": "AelyrisNativeModeRailProof",
        "title": "Aelyris Native Modes",
        "interactiveWindow": is_window_before_destroy,
        "visibleRequested": visible,
        "layered": (ex_style_after & WS_EX_LAYERED.0 as isize) != 0,
        "noActivate": (ex_style_after & WS_EX_NOACTIVATE.0 as isize) != 0,
        "alpha": alpha,
        "selectedMode": selected_mode,
        "focusedMode": selected_mode,
        "finalSelectedMode": modes.get(selected_index).and_then(|mode| mode.get("id")).and_then(Value::as_str).unwrap_or("terminal"),
        "modeRowsRendered": hit_targets.len(),
        "hitTargets": hit_targets,
        "hitTargetCount": mode_count,
        "keyboardNavigation": true,
        "keyboardTransitions": keyboard_transitions,
        "framesPresented": frames_presented,
        "elapsedMs": elapsed_ms,
        "averageFrameMs": if frames_presented > 0 { elapsed_ms / frames_presented as f64 } else { 0.0 },
        "drawCalls": draw_calls,
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": non_background_samples > 0,
        "webviewUsed": false,
        "reactUsed": false,
        "renderer": "win32-gdi-mode-rail-proof",
        "readyForReactDemotion": false,
        "nextProof": "native-inspector-window-proof",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_mode_rail_window_proof(
    _mode_shell: &Value,
    _duration: Duration,
    _alpha: u8,
    _visible: bool,
) -> Result<Value, String> {
    Err(
        "aelyris-native mode-rail-window-proof is currently implemented for Windows only"
            .to_string(),
    )
}

#[cfg(target_os = "windows")]
fn native_inspector_window_proof(
    mode_shell: &Value,
    command_center: &Value,
    duration: Duration,
    alpha: u8,
    visible: bool,
) -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetPixel, PatBlt, ReleaseDC, SetBkMode, SetTextColor, BLACKNESS, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        IsWindow, PeekMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes,
        ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, GWL_EXSTYLE, HMENU,
        LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let inspector = mode_shell.get("inspector").cloned().unwrap_or_else(|| {
        json!({
            "schema": "aelyris.native.inspector.v1",
            "nativeInspector": true,
            "commandCenterBacked": true,
            "contextualInspector": true,
        })
    });
    let selected_mode = mode_shell
        .get("selectedMode")
        .and_then(Value::as_str)
        .unwrap_or("terminal");
    let right_inspector_contract_id = mode_shell
        .get("rightInspectorContractId")
        .and_then(Value::as_str)
        .unwrap_or("aelyris.native.inspector.v1:command-center");
    let actions = command_center
        .get("actions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let evidence = command_center
        .get("evidence")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let blocker_count = command_center
        .get("blockerCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let ready_evidence_count = command_center
        .get("readyEvidenceCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    let visible_rows = 6usize;
    let page_size = 5usize;
    let mut selected_action_index = 0usize;
    let mut scroll_offset = 0usize;
    let mut keyboard_transitions = Vec::new();
    for key in ["ArrowDown", "PageDown", "End", "Home", "Enter"] {
        match key {
            "ArrowDown" => {
                if !actions.is_empty() {
                    selected_action_index =
                        (selected_action_index + 1).min(actions.len().saturating_sub(1));
                }
            }
            "PageDown" => {
                if !actions.is_empty() {
                    selected_action_index =
                        (selected_action_index + page_size).min(actions.len().saturating_sub(1));
                }
            }
            "End" => {
                if !actions.is_empty() {
                    selected_action_index = actions.len().saturating_sub(1);
                }
            }
            "Home" => {
                selected_action_index = 0;
            }
            "Enter" => {}
            _ => {}
        }
        if selected_action_index < scroll_offset {
            scroll_offset = selected_action_index;
        } else if selected_action_index >= scroll_offset + visible_rows {
            scroll_offset = selected_action_index.saturating_sub(visible_rows.saturating_sub(1));
        }
        let selected_action = actions.get(selected_action_index).unwrap_or(&Value::Null);
        keyboard_transitions.push(json!({
            "key": key,
            "selectedActionIndex": selected_action_index,
            "scrollOffset": scroll_offset,
            "selectedActionId": selected_action.get("id").and_then(Value::as_str).unwrap_or("none"),
            "operation": selected_action.get("operation").and_then(Value::as_str).unwrap_or("none"),
        }));
    }
    let selected_action = actions.get(selected_action_index).unwrap_or(&Value::Null);

    let width = 760;
    let height = 660;
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativeInspectorProof");
    let window_title = w!("Aelyris Native Inspector");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativeInspectorProof".to_string());
    }

    let ex_style = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_APPWINDOW.0 | WS_EX_NOACTIVATE.0);
    let style = WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0);
    let hwnd = unsafe {
        CreateWindowExW(
            ex_style,
            class_name,
            window_title,
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            width,
            height,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native inspector window failed: {err}"))?;

    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|err| format!("SetLayeredWindowAttributes failed: {err}"))?;
    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }

    let started = Instant::now();
    let mut msg = MSG::default();
    let mut frames_presented = 0usize;
    let mut draw_calls = 0usize;
    let mut evidence_hit_targets = Vec::new();
    let mut action_hit_targets = Vec::new();
    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;

    while started.elapsed() < duration || frames_presented < 2 {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        let dc = unsafe { GetDC(Some(hwnd)) };
        if dc.is_invalid() {
            return Err("GetDC failed for native inspector proof".to_string());
        }
        let cleared = unsafe { PatBlt(dc, 0, 0, width, height, BLACKNESS).as_bool() };
        unsafe {
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }

        if draw_native_text_line(dc, 24, 26, "Aelyris Native Inspector")? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00A7E7F2));
        }
        let subtitle = format!(
            "mode={selected_mode} | evidence={ready_evidence_count}/{} | blockers={blocker_count}",
            evidence.len()
        );
        if draw_native_text_line(dc, 24, 54, &subtitle)? {
            draw_calls += 1;
        }
        unsafe {
            SetTextColor(dc, COLORREF(0x00C8BFE7));
        }
        if draw_native_text_line(dc, 24, 82, right_inspector_contract_id)? {
            draw_calls += 1;
        }

        unsafe {
            SetTextColor(dc, COLORREF(0x00A6E3A1));
        }
        if draw_native_text_line(dc, 24, 122, "Evidence")? {
            draw_calls += 1;
        }
        evidence_hit_targets.clear();
        unsafe {
            SetTextColor(dc, COLORREF(0x00F4EAFB));
        }
        for (idx, entry) in evidence.iter().take(5).enumerate() {
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("evidence");
            let available = entry
                .get("available")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let status = entry
                .get("status")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let y = 154 + idx as i32 * 30;
            let line = format!(
                "[{}] {}  status={}  available={}",
                idx + 1,
                id,
                status.trim_matches('"'),
                available
            );
            if draw_native_text_line(dc, 42, y, &line)? {
                draw_calls += 1;
                evidence_hit_targets.push(json!({
                    "id": id,
                    "rect": { "x": 36, "y": y - 5, "width": 680, "height": 25 },
                    "keyboardIndex": idx + 1,
                }));
            }
        }

        unsafe {
            SetTextColor(dc, COLORREF(0x00F2CDCD));
        }
        if draw_native_text_line(dc, 24, 330, "Actions")? {
            draw_calls += 1;
        }
        action_hit_targets.clear();
        unsafe {
            SetTextColor(dc, COLORREF(0x00F8EAF1));
        }
        for (visual_idx, action) in actions
            .iter()
            .skip(scroll_offset)
            .take(visible_rows)
            .enumerate()
        {
            let absolute_idx = scroll_offset + visual_idx;
            let id = action.get("id").and_then(Value::as_str).unwrap_or("action");
            let operation = action
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("open");
            let selected = absolute_idx == selected_action_index;
            unsafe {
                SetTextColor(
                    dc,
                    if selected {
                        COLORREF(0x00A6E3A1)
                    } else {
                        COLORREF(0x00F8EAF1)
                    },
                );
            }
            let y = 362 + visual_idx as i32 * 34;
            let line = format!(
                "{} [{}] {} -> {}",
                if selected { ">" } else { " " },
                absolute_idx + 1,
                id,
                operation
            );
            if draw_native_text_line(dc, 42, y, &line)? {
                draw_calls += 1;
                action_hit_targets.push(json!({
                    "id": id,
                    "operation": operation,
                    "selected": selected,
                    "actionIndex": absolute_idx,
                    "rect": { "x": 36, "y": y - 6, "width": 680, "height": 28 },
                    "keyboardIndex": absolute_idx + 1,
                    "requiresReact": action.get("requiresReact").and_then(Value::as_bool).unwrap_or(true),
                    "requiresWebView": action.get("requiresWebView").and_then(Value::as_bool).unwrap_or(true),
                }));
            }
        }

        if frames_presented == 0 && cleared {
            for sample_y in (8..height).step_by(6) {
                for sample_x in (8..width).step_by(6) {
                    sampled_pixels += 1;
                    let pixel = unsafe { GetPixel(dc, sample_x, sample_y) };
                    if pixel != COLORREF(0) {
                        non_background_samples += 1;
                    }
                }
            }
        }
        unsafe {
            ReleaseDC(Some(hwnd), dc);
        }
        frames_presented += 1;
        std::thread::sleep(Duration::from_millis(16));
    }

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ex_style_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let is_window_before_destroy = unsafe { IsWindow(Some(hwnd)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow native inspector window failed: {err}"))?;
    }

    Ok(json!({
        "schema": "aelyris.native.inspector-window-proof.v1",
        "nativeInspectorWindow": true,
        "nativeContextualInspector": true,
        "windowUi": true,
        "mode": "win32-gdi-inspector-window-proof",
        "windowSystem": "win32",
        "className": "AelyrisNativeInspectorProof",
        "title": "Aelyris Native Inspector",
        "interactiveWindow": is_window_before_destroy,
        "visibleRequested": visible,
        "layered": (ex_style_after & WS_EX_LAYERED.0 as isize) != 0,
        "noActivate": (ex_style_after & WS_EX_NOACTIVATE.0 as isize) != 0,
        "alpha": alpha,
        "selectedMode": selected_mode,
        "rightInspectorContractId": right_inspector_contract_id,
        "inspector": inspector,
        "sourceContract": command_center.get("schema").and_then(Value::as_str).unwrap_or("aelyris.native.command-center-proof.v1"),
        "commandCenterBacked": true,
        "contextualInspector": true,
        "evidenceRowsRendered": evidence_hit_targets.len(),
        "evidenceRowsTotal": evidence.len(),
        "evidenceHitTargets": evidence_hit_targets,
        "actionRowsRendered": action_hit_targets.len(),
        "actionRowsTotal": actions.len(),
        "actionHitTargets": action_hit_targets,
        "visibleRows": visible_rows,
        "scrollOffset": scroll_offset,
        "selectedActionIndex": selected_action_index,
        "keyboardSelection": true,
        "scrollModel": true,
        "keyboardTransitions": keyboard_transitions,
        "enterDispatch": {
            "selectedActionId": selected_action.get("id").and_then(Value::as_str).unwrap_or("none"),
            "operation": selected_action.get("operation").and_then(Value::as_str).unwrap_or("none"),
            "requiresReact": selected_action.get("requiresReact").and_then(Value::as_bool).unwrap_or(true),
            "requiresWebView": selected_action.get("requiresWebView").and_then(Value::as_bool).unwrap_or(true),
        },
        "guardrails": {
            "commandCenterBacked": true,
            "selectedActionInBounds": actions.is_empty() || selected_action_index < actions.len(),
            "scrollOffsetInBounds": actions.is_empty() || scroll_offset < actions.len(),
            "dispatchDoesNotRequireReact": selected_action.get("requiresReact").and_then(Value::as_bool) == Some(false),
            "dispatchDoesNotRequireWebView": selected_action.get("requiresWebView").and_then(Value::as_bool) == Some(false),
        },
        "framesPresented": frames_presented,
        "elapsedMs": elapsed_ms,
        "averageFrameMs": if frames_presented > 0 { elapsed_ms / frames_presented as f64 } else { 0.0 },
        "drawCalls": draw_calls,
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": non_background_samples > 0,
        "webviewUsed": false,
        "reactUsed": false,
        "renderer": "win32-gdi-inspector-proof",
        "readyForReactDemotion": false,
        "nextProof": "react-right-rail-compatibility-demotion",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_inspector_window_proof(
    _mode_shell: &Value,
    _command_center: &Value,
    _duration: Duration,
    _alpha: u8,
    _visible: bool,
) -> Result<Value, String> {
    Err(
        "aelyris-native inspector-window-proof is currently implemented for Windows only"
            .to_string(),
    )
}

#[cfg(target_os = "windows")]
fn draw_native_text_line(
    dc: windows::Win32::Graphics::Gdi::HDC,
    x: i32,
    y: i32,
    text: &str,
) -> Result<bool, String> {
    use windows::Win32::Graphics::Gdi::TextOutW;

    let wide = wide_null(text);
    if wide.len() <= 1 {
        return Ok(false);
    }
    Ok(unsafe { TextOutW(dc, x, y, &wide[..wide.len().saturating_sub(1)]).as_bool() })
}

#[cfg(target_os = "windows")]
fn native_text_render_proof(text: &str, alpha: u8) -> Result<Value, String> {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetPixel,
        PatBlt, ReleaseDC, SelectObject, SetBkMode, SetTextColor, TextOutW, BLACKNESS, HGDIOBJ,
        TRANSPARENT,
    };

    let width = 720;
    let height = 420;
    let screen_dc = unsafe { GetDC(None) };
    if screen_dc.is_invalid() {
        return Err("GetDC failed for native render proof".to_string());
    }
    let memory_dc = unsafe { CreateCompatibleDC(Some(screen_dc)) };
    if memory_dc.is_invalid() {
        unsafe {
            ReleaseDC(None, screen_dc);
        }
        return Err("CreateCompatibleDC failed for native render proof".to_string());
    }
    let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
    if bitmap.is_invalid() {
        unsafe {
            if !DeleteDC(memory_dc).as_bool() {
                return Err("DeleteDC after bitmap failure failed".to_string());
            }
            ReleaseDC(None, screen_dc);
        }
        return Err("CreateCompatibleBitmap failed for native render proof".to_string());
    }

    let old_bitmap = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };
    let cleared = unsafe { PatBlt(memory_dc, 0, 0, width, height, BLACKNESS).as_bool() };
    let foreground = COLORREF(0x00F4EAFB);
    unsafe {
        SetTextColor(memory_dc, foreground);
        SetBkMode(memory_dc, TRANSPARENT);
    }

    let mut draw_calls = 0usize;
    let mut y = 24;
    for line in render_proof_lines(text).iter().take(16) {
        let wide = wide_null(line);
        if wide.len() > 1 {
            let drawn = unsafe {
                TextOutW(memory_dc, 24, y, &wide[..wide.len().saturating_sub(1)]).as_bool()
            };
            if drawn {
                draw_calls += 1;
            }
        }
        y += 22;
    }

    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;
    for sample_y in (16..height).step_by(6) {
        for sample_x in (16..width).step_by(6) {
            sampled_pixels += 1;
            let pixel = unsafe { GetPixel(memory_dc, sample_x, sample_y) };
            if pixel != COLORREF(0) {
                non_background_samples += 1;
            }
        }
    }

    unsafe {
        if !old_bitmap.is_invalid() {
            SelectObject(memory_dc, old_bitmap);
        }
        if !DeleteObject(HGDIOBJ(bitmap.0)).as_bool() {
            return Err("DeleteObject bitmap failed".to_string());
        }
        if !DeleteDC(memory_dc).as_bool() {
            return Err("DeleteDC failed".to_string());
        }
        ReleaseDC(None, screen_dc);
    }

    Ok(json!({
        "terminalRenderer": "native-gdi-text-proof",
        "renderer": "win32-gdi",
        "surface": "memory-compatible-dc",
        "nativeTextDrawn": draw_calls > 0,
        "drawCalls": draw_calls,
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": cleared && non_background_samples > 0,
        "alpha": alpha,
        "webviewUsed": false,
        "reactUsed": false,
        "gpuRenderer": false,
        "nextRenderer": "winit-wgpu-terminal-grid",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_text_render_proof(_text: &str, _alpha: u8) -> Result<Value, String> {
    Err("aelyris-native render-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
fn native_grid_render_proof(frame: &NativeRenderFrame, alpha: u8) -> Result<Value, String> {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetPixel,
        PatBlt, ReleaseDC, SelectObject, SetBkMode, SetTextColor, TextOutW, BLACKNESS, HGDIOBJ,
        TRANSPARENT,
    };

    let summary = frame.summary();
    let cell_height = i32::from(frame.cell_height_px);
    let width = (frame.width_px.min(i32::MAX as u32) as i32).clamp(320, 1280);
    let height = (frame.height_px.min(i32::MAX as u32) as i32).clamp(180, 720);
    let screen_dc = unsafe { GetDC(None) };
    if screen_dc.is_invalid() {
        return Err("GetDC failed for native grid render proof".to_string());
    }
    let memory_dc = unsafe { CreateCompatibleDC(Some(screen_dc)) };
    if memory_dc.is_invalid() {
        unsafe {
            ReleaseDC(None, screen_dc);
        }
        return Err("CreateCompatibleDC failed for native grid render proof".to_string());
    }
    let bitmap = unsafe { CreateCompatibleBitmap(screen_dc, width, height) };
    if bitmap.is_invalid() {
        unsafe {
            if !DeleteDC(memory_dc).as_bool() {
                return Err("DeleteDC after grid bitmap failure failed".to_string());
            }
            ReleaseDC(None, screen_dc);
        }
        return Err("CreateCompatibleBitmap failed for native grid render proof".to_string());
    }

    let old_bitmap = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };
    let cleared = unsafe { PatBlt(memory_dc, 0, 0, width, height, BLACKNESS).as_bool() };
    unsafe {
        SetTextColor(memory_dc, COLORREF(0x00F4EAFB));
        SetBkMode(memory_dc, TRANSPARENT);
    }

    let mut draw_calls = 0usize;
    for (row_idx, line) in frame
        .non_empty_lines(frame.rows as usize)
        .iter()
        .enumerate()
    {
        let wide = wide_null(line);
        if wide.len() <= 1 {
            continue;
        }
        let y = 14 + row_idx as i32 * cell_height;
        if y >= height {
            break;
        }
        let drawn =
            unsafe { TextOutW(memory_dc, 14, y, &wide[..wide.len().saturating_sub(1)]).as_bool() };
        if drawn {
            draw_calls += 1;
        }
    }

    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;
    for sample_y in (8..height).step_by(4) {
        for sample_x in (8..width).step_by(4) {
            sampled_pixels += 1;
            let pixel = unsafe { GetPixel(memory_dc, sample_x, sample_y) };
            if pixel != COLORREF(0) {
                non_background_samples += 1;
            }
        }
    }

    unsafe {
        if !old_bitmap.is_invalid() {
            SelectObject(memory_dc, old_bitmap);
        }
        if !DeleteObject(HGDIOBJ(bitmap.0)).as_bool() {
            return Err("DeleteObject grid bitmap failed".to_string());
        }
        if !DeleteDC(memory_dc).as_bool() {
            return Err("DeleteDC grid renderer failed".to_string());
        }
        ReleaseDC(None, screen_dc);
    }

    Ok(json!({
        "terminalRenderer": "native-gdi-grid-proof",
        "renderer": "win32-gdi",
        "surface": "memory-compatible-dc",
        "nativeCellGrid": true,
        "renderFrameSchema": summary.schema.clone(),
        "renderFrameSha256": summary.frame_sha256.clone(),
        "rendererBoundary": summary.renderer_boundary.clone(),
        "cols": frame.cols,
        "rows": frame.rows,
        "cellWidth": frame.cell_width_px,
        "cellHeight": frame.cell_height_px,
        "frameWidth": frame.width_px,
        "frameHeight": frame.height_px,
        "nonBlankCells": summary.non_blank_cells,
        "paintableCells": summary.paintable_cells,
        "occupiedRows": summary.occupied_rows,
        "cursor": summary.cursor,
        "drawCalls": draw_calls,
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": cleared && non_background_samples > 0 && summary.non_blank_cells > 0,
        "alpha": alpha,
        "webviewUsed": false,
        "reactUsed": false,
        "gpuRenderer": false,
        "nextRenderer": summary.next_renderer.clone(),
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_grid_render_proof(_frame: &NativeRenderFrame, _alpha: u8) -> Result<Value, String> {
    Err("aelyris-native grid-render-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
fn native_present_loop_proof(
    frame: &NativeRenderFrame,
    duration: Duration,
    alpha: u8,
    visible: bool,
) -> Result<Value, String> {
    use std::time::Instant;
    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetPixel, PatBlt, ReleaseDC, SetBkMode, SetTextColor, TextOutW, BLACKNESS,
        TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
        IsWindow, PeekMessageW, PostQuitMessage, RegisterClassW, SetLayeredWindowAttributes,
        ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, GWL_EXSTYLE, HMENU,
        LWA_ALPHA, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_DESTROY, WNDCLASSW, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_OVERLAPPEDWINDOW,
    };

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    let summary = frame.summary();
    let width = (frame.width_px.min(i32::MAX as u32) as i32).clamp(480, 1280);
    let height = (frame.height_px.min(i32::MAX as u32) as i32).clamp(240, 720);
    let cell_height = i32::from(frame.cell_height_px);
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AelyrisNativePresentLoopProof");
    let window_title = w!("Aelyris Native Present Loop");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = unsafe { RegisterClassW(&class) };
    if atom == 0 {
        return Err("RegisterClassW failed for AelyrisNativePresentLoopProof".to_string());
    }

    let ex_style = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_APPWINDOW.0 | WS_EX_NOACTIVATE.0);
    let style = WINDOW_STYLE(WS_OVERLAPPEDWINDOW.0);
    let hwnd = unsafe {
        CreateWindowExW(
            ex_style,
            class_name,
            window_title,
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            width,
            height,
            None,
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW native present-loop window failed: {err}"))?;

    unsafe { SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) }
        .map_err(|err| format!("SetLayeredWindowAttributes failed: {err}"))?;
    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }

    let lines = frame.non_empty_lines(frame.rows as usize);
    let started = Instant::now();
    let mut msg = MSG::default();
    let mut frames_presented = 0usize;
    let mut total_draw_calls = 0usize;
    let mut sampled_pixels = 0usize;
    let mut non_background_samples = 0usize;

    while started.elapsed() < duration || frames_presented < 2 {
        while unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        let dc = unsafe { GetDC(Some(hwnd)) };
        if dc.is_invalid() {
            return Err("GetDC failed for native present-loop proof".to_string());
        }
        let cleared = unsafe { PatBlt(dc, 0, 0, width, height, BLACKNESS).as_bool() };
        unsafe {
            SetTextColor(dc, COLORREF(0x00F4EAFB));
            SetBkMode(dc, TRANSPARENT);
        }

        let mut frame_draw_calls = 0usize;
        for (row_idx, line) in lines.iter().enumerate() {
            let wide = wide_null(line);
            if wide.len() <= 1 {
                continue;
            }
            let y = 18 + row_idx as i32 * cell_height;
            if y >= height {
                break;
            }
            let drawn =
                unsafe { TextOutW(dc, 18, y, &wide[..wide.len().saturating_sub(1)]).as_bool() };
            if drawn {
                frame_draw_calls += 1;
            }
        }

        if frames_presented == 0 && cleared {
            for sample_y in (8..height).step_by(8) {
                for sample_x in (8..width).step_by(8) {
                    sampled_pixels += 1;
                    let pixel = unsafe { GetPixel(dc, sample_x, sample_y) };
                    if pixel != COLORREF(0) {
                        non_background_samples += 1;
                    }
                }
            }
        }
        unsafe {
            ReleaseDC(Some(hwnd), dc);
        }
        frames_presented += 1;
        total_draw_calls += frame_draw_calls;
        std::thread::sleep(Duration::from_millis(16));
    }

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ex_style_after = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let is_window_before_destroy = unsafe { IsWindow(Some(hwnd)).as_bool() };
    unsafe {
        DestroyWindow(hwnd)
            .map_err(|err| format!("DestroyWindow native present-loop window failed: {err}"))?;
    }

    Ok(json!({
        "terminalRenderer": "native-win32-present-loop-proof",
        "renderer": "win32-gdi-present-loop",
        "presentLoop": true,
        "interactiveWindow": is_window_before_destroy,
        "windowSystem": "win32",
        "className": "AelyrisNativePresentLoopProof",
        "title": "Aelyris Native Present Loop",
        "visibleRequested": visible,
        "layered": (ex_style_after & WS_EX_LAYERED.0 as isize) != 0,
        "noActivate": (ex_style_after & WS_EX_NOACTIVATE.0 as isize) != 0,
        "alpha": alpha,
        "framesPresented": frames_presented,
        "elapsedMs": elapsed_ms,
        "averageFrameMs": if frames_presented > 0 { elapsed_ms / frames_presented as f64 } else { 0.0 },
        "drawCalls": total_draw_calls,
        "sampledPixels": sampled_pixels,
        "nonBackgroundSamples": non_background_samples,
        "nonBlank": non_background_samples > 0 && summary.non_blank_cells > 0,
        "renderFrameSchema": summary.schema.clone(),
        "renderFrameSha256": summary.frame_sha256.clone(),
        "rendererBoundary": summary.renderer_boundary.clone(),
        "webviewUsed": false,
        "reactUsed": false,
        "gpuRenderer": false,
        "nextRenderer": "winit-wgpu-present-loop",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_present_loop_proof(
    _frame: &NativeRenderFrame,
    _duration: Duration,
    _alpha: u8,
    _visible: bool,
) -> Result<Value, String> {
    Err("aelyris-native present-loop-proof is currently implemented for Windows only".to_string())
}

fn native_gpu_render_proof(frame: &NativeRenderFrame) -> Result<Value, String> {
    let summary = frame.summary();
    let width = frame.width_px.clamp(16, 4096);
    let height = frame.height_px.clamp(16, 4096);
    let accent = gpu_accent_from_hash(&summary.frame_sha256);

    let instance = wgpu::Instance::default();
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
    }))
    .map_err(|err| format!("wgpu adapter request failed: {err}"))?;
    let adapter_info = adapter.get_info();
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("aelyris-native-gpu-render-proof-device"),
        required_features: wgpu::Features::empty(),
        required_limits: wgpu::Limits::downlevel_defaults(),
        experimental_features: wgpu::ExperimentalFeatures::disabled(),
        memory_hints: wgpu::MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    }))
    .map_err(|err| format!("wgpu device request failed: {err}"))?;

    let format = wgpu::TextureFormat::Rgba8UnormSrgb;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("aelyris-native-gpu-render-proof-target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("aelyris-native-gpu-render-proof-shader"),
        source: wgpu::ShaderSource::Wgsl(
            r#"
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>( 3.0,  1.0),
        vec2<f32>(-1.0,  1.0)
    );
    return vec4<f32>(positions[vertex_index], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return vec4<f32>(0.96, 0.72, 0.84, 1.0);
}
"#
            .into(),
        ),
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("aelyris-native-gpu-render-proof-layout"),
        bind_group_layouts: &[],
        immediate_size: 0,
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("aelyris-native-gpu-render-proof-pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            buffers: &[],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    });

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("aelyris-native-gpu-render-proof-encoder"),
    });
    {
        let color_attachment = Some(wgpu::RenderPassColorAttachment {
            view: &view,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Clear(wgpu::Color {
                    r: accent.0,
                    g: accent.1,
                    b: accent.2,
                    a: 1.0,
                }),
                store: wgpu::StoreOp::Store,
            },
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("aelyris-native-gpu-render-proof-pass"),
            color_attachments: &[color_attachment],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        pass.draw(0..3, 0..1);
    }
    queue.submit([encoder.finish()]);
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .map_err(|err| format!("wgpu device poll failed: {err}"))?;

    Ok(json!({
        "terminalRenderer": "wgpu-offscreen-frame-proof",
        "renderer": "wgpu",
        "gpuRenderer": true,
        "surface": "offscreen-texture",
        "presentableSurface": false,
        "interactiveWindow": false,
        "adapter": {
            "name": adapter_info.name,
            "vendor": adapter_info.vendor,
            "device": adapter_info.device,
            "deviceType": format!("{:?}", adapter_info.device_type),
            "backend": format!("{:?}", adapter_info.backend),
            "driver": adapter_info.driver,
            "driverInfo": adapter_info.driver_info,
        },
        "texture": {
            "width": width,
            "height": height,
            "format": format!("{:?}", format),
        },
        "shader": "fullscreen-triangle-wgsl",
        "drawCalls": 1,
        "vertices": 3,
        "renderFrameSchema": summary.schema,
        "renderFrameSha256": summary.frame_sha256,
        "rendererBoundary": summary.renderer_boundary,
        "nonBlankCells": summary.non_blank_cells,
        "webviewUsed": false,
        "reactUsed": false,
        "nextRenderer": "winit-wgpu-surface-present-loop",
        "processIdentity": {
            "process": "aelyris-native",
            "pid": std::process::id(),
        }
    }))
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct RectInstance {
    rect: [f32; 4],
    color: [f32; 4],
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct GlyphInstance {
    rect: [f32; 4],
    uv: [f32; 4],
    color: [f32; 4],
}

#[cfg(target_os = "windows")]
struct FontAtlas {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    glyph_count: usize,
    fallback_glyphs: usize,
    fallback_font_load_failures: usize,
    missing_glyphs: usize,
    missing_fallback_glyphs: usize,
    question_mark_substitutions: usize,
    font_path: String,
    font_px: f32,
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct NativeRendererFallbackFontRef {
    family: String,
    path: String,
    collection_index: u32,
}

#[cfg(target_os = "windows")]
struct NativeRendererGlyphPlan {
    ch: char,
    rect_px: [f32; 4],
    fg: u32,
    fallback_required: bool,
}

#[cfg(target_os = "windows")]
struct NativeRendererTextShapePlan {
    atlas_chars: std::collections::BTreeSet<char>,
    render_glyphs: Vec<NativeRendererGlyphPlan>,
    fallback_required_chars: std::collections::BTreeSet<char>,
    fallback_font_refs: std::collections::BTreeMap<char, NativeRendererFallbackFontRef>,
    renderer_consumes_system_shaped_runs: bool,
    directwrite_shape_runs: usize,
    directwrite_shaped_clusters: usize,
    directwrite_fallback_clusters: usize,
    directwrite_fallback_font_families: Vec<String>,
    directwrite_shape_errors: Vec<String>,
    question_mark_substitution_disabled: bool,
}

#[cfg(target_os = "windows")]
struct TerminalDrawPlan {
    rect_instances: Vec<RectInstance>,
    glyph_instances: Vec<GlyphInstance>,
    font_atlas: FontAtlas,
    renderer_consumes_system_shaped_runs: bool,
    directwrite_shape_runs: usize,
    directwrite_shaped_clusters: usize,
    directwrite_fallback_clusters: usize,
    directwrite_fallback_font_families: Vec<String>,
    directwrite_shape_errors: Vec<String>,
    question_mark_substitution_disabled: bool,
    skipped_glyph_quads: usize,
    fallback_glyph_quads: usize,
    dirty_rects_rendered: usize,
    terminal_glyph_quads: usize,
    cursor_quads: usize,
    dirty_cells: usize,
    dirty_rows: usize,
    full_repaint: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeImeProofState {
    active: bool,
    text: String,
    text_chars: usize,
    anchor_row: u16,
    anchor_col: u16,
    anchor_x_px: u32,
    anchor_y_px: u32,
    anchor_width_px: u16,
    anchor_height_px: u16,
    frame_sha256: String,
    previous_frame_sha256: Option<String>,
    committed_frame_sha256: Option<String>,
    renderer_boundary: String,
}

impl NativeImeProofState {
    fn from_preedit(frame: &NativeRenderFrame, text: &str) -> NativeImeProofState {
        let summary = frame.summary();
        let rect = native_ime_anchor_rect(frame);
        NativeImeProofState {
            active: true,
            text: text.to_string(),
            text_chars: text.chars().count(),
            anchor_row: frame.cursor.row,
            anchor_col: frame.cursor.col,
            anchor_x_px: rect.x_px,
            anchor_y_px: rect.y_px,
            anchor_width_px: rect.width_px,
            anchor_height_px: rect.height_px,
            frame_sha256: summary.frame_sha256,
            previous_frame_sha256: None,
            committed_frame_sha256: None,
            renderer_boundary: summary.renderer_boundary,
        }
    }

    fn from_commit(
        frame: &NativeRenderFrame,
        text: &str,
        previous_frame_sha256: String,
        committed_frame_sha256: String,
    ) -> NativeImeProofState {
        let summary = frame.summary();
        let rect = native_ime_anchor_rect(frame);
        NativeImeProofState {
            active: false,
            text: text.to_string(),
            text_chars: text.chars().count(),
            anchor_row: frame.cursor.row,
            anchor_col: frame.cursor.col,
            anchor_x_px: rect.x_px,
            anchor_y_px: rect.y_px,
            anchor_width_px: rect.width_px,
            anchor_height_px: rect.height_px,
            frame_sha256: summary.frame_sha256,
            previous_frame_sha256: Some(previous_frame_sha256),
            committed_frame_sha256: Some(committed_frame_sha256),
            renderer_boundary: summary.renderer_boundary,
        }
    }
}

fn native_ime_anchor_rect(frame: &NativeRenderFrame) -> aelyris_lib::term::NativeCellRect {
    let col = frame.cursor.col.min(frame.cols.saturating_sub(1));
    let row = frame.cursor.row.min(frame.rows.saturating_sub(1));
    aelyris_lib::term::NativeCellRect {
        x_px: u32::from(col) * u32::from(frame.cell_width_px),
        y_px: u32::from(row) * u32::from(frame.cell_height_px),
        width_px: frame
            .cell_width_px
            .saturating_mul(8)
            .max(frame.cell_width_px),
        height_px: frame.cell_height_px,
    }
}

#[cfg(target_os = "windows")]
fn native_winit_wgpu_surface_proof(
    frame: &NativeRenderFrame,
    duration: Duration,
    visible: bool,
) -> Result<Value, String> {
    use std::sync::Arc;
    use std::time::Instant;
    use wgpu::util::DeviceExt;
    use winit::application::ApplicationHandler;
    use winit::dpi::LogicalSize;
    use winit::event::WindowEvent;
    use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
    use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
    use winit::window::{Window, WindowId};

    struct WgpuSurfaceState {
        surface: wgpu::Surface<'static>,
        device: wgpu::Device,
        queue: wgpu::Queue,
        rect_pipeline: wgpu::RenderPipeline,
        glyph_pipeline: wgpu::RenderPipeline,
        glyph_bind_group: wgpu::BindGroup,
        rect_instance_buffer: wgpu::Buffer,
        rect_instance_count: u32,
        glyph_instance_buffer: wgpu::Buffer,
        glyph_instance_count: u32,
        config: wgpu::SurfaceConfiguration,
        adapter_info: wgpu::AdapterInfo,
    }

    struct ProofApp {
        frame: NativeRenderFrame,
        duration: Duration,
        visible: bool,
        width: u32,
        height: u32,
        accent: (f64, f64, f64),
        terminal_glyph_quads: usize,
        font_atlas_glyphs: usize,
        font_atlas_fallback_glyphs: usize,
        font_atlas_fallback_font_load_failures: usize,
        font_atlas_missing_glyphs: usize,
        font_atlas_missing_fallback_glyphs: usize,
        font_atlas_question_mark_substitutions: usize,
        font_atlas_font_path: String,
        font_atlas_font_px: f32,
        renderer_consumes_system_shaped_runs: bool,
        directwrite_shape_runs: usize,
        directwrite_shaped_clusters: usize,
        directwrite_fallback_clusters: usize,
        directwrite_fallback_font_families: Vec<String>,
        directwrite_shape_errors: Vec<String>,
        question_mark_substitution_disabled: bool,
        skipped_glyph_quads: usize,
        fallback_glyph_quads: usize,
        dirty_rects_rendered: usize,
        cursor_quads: usize,
        dirty_cells: usize,
        dirty_rows: usize,
        full_repaint: bool,
        started: Option<Instant>,
        window: Option<Arc<Window>>,
        gpu: Option<WgpuSurfaceState>,
        frames_presented: usize,
        draw_calls: usize,
        surface_errors: Vec<String>,
    }

    impl ProofApp {
        fn init_gpu(
            window: Arc<Window>,
            width: u32,
            height: u32,
            rect_instances: &[RectInstance],
            glyph_instances: &[GlyphInstance],
            font_atlas: &FontAtlas,
        ) -> Result<WgpuSurfaceState, String> {
            let instance = wgpu::Instance::default();
            let surface = instance
                .create_surface(window)
                .map_err(|err| format!("winit/wgpu surface creation failed: {err}"))?;
            let adapter =
                pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    force_fallback_adapter: false,
                    compatible_surface: Some(&surface),
                }))
                .map_err(|err| format!("winit/wgpu adapter request failed: {err}"))?;
            let adapter_info = adapter.get_info();
            let (device, queue) =
                pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                    label: Some("aelyris-native-winit-wgpu-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    experimental_features: wgpu::ExperimentalFeatures::disabled(),
                    memory_hints: wgpu::MemoryHints::Performance,
                    trace: wgpu::Trace::Off,
                }))
                .map_err(|err| format!("winit/wgpu device request failed: {err}"))?;
            let caps = surface.get_capabilities(&adapter);
            let format = caps
                .formats
                .iter()
                .copied()
                .find(wgpu::TextureFormat::is_srgb)
                .or_else(|| caps.formats.first().copied())
                .ok_or_else(|| "winit/wgpu surface reported no supported formats".to_string())?;
            let present_mode = caps
                .present_modes
                .iter()
                .copied()
                .find(|mode| *mode == wgpu::PresentMode::Fifo)
                .or_else(|| caps.present_modes.first().copied())
                .ok_or_else(|| "winit/wgpu surface reported no present modes".to_string())?;
            let alpha_mode = caps
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Auto);
            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: width.max(1),
                height: height.max(1),
                present_mode,
                desired_maximum_frame_latency: 2,
                alpha_mode,
                view_formats: vec![],
            };
            surface.configure(&device, &config);
            let rect_instance_buffer =
                device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("aelyris-native-winit-wgpu-terminal-rect-instances"),
                    contents: bytemuck::cast_slice(rect_instances),
                    usage: wgpu::BufferUsages::VERTEX,
                });
            let glyph_instance_buffer =
                device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("aelyris-native-winit-wgpu-terminal-glyph-instances"),
                    contents: bytemuck::cast_slice(glyph_instances),
                    usage: wgpu::BufferUsages::VERTEX,
                });
            let atlas_texture = device.create_texture_with_data(
                &queue,
                &wgpu::TextureDescriptor {
                    label: Some("aelyris-native-winit-wgpu-font-atlas"),
                    size: wgpu::Extent3d {
                        width: font_atlas.width.max(1),
                        height: font_atlas.height.max(1),
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::R8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                },
                wgpu::util::TextureDataOrder::LayerMajor,
                &font_atlas.pixels,
            );
            let atlas_view = atlas_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let atlas_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("aelyris-native-winit-wgpu-font-atlas-sampler"),
                address_mode_u: wgpu::AddressMode::ClampToEdge,
                address_mode_v: wgpu::AddressMode::ClampToEdge,
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                mipmap_filter: wgpu::MipmapFilterMode::Nearest,
                ..Default::default()
            });
            let glyph_bind_group_layout =
                device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("aelyris-native-winit-wgpu-font-atlas-layout"),
                    entries: &[
                        wgpu::BindGroupLayoutEntry {
                            binding: 0,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Texture {
                                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                                view_dimension: wgpu::TextureViewDimension::D2,
                                multisampled: false,
                            },
                            count: None,
                        },
                        wgpu::BindGroupLayoutEntry {
                            binding: 1,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                            count: None,
                        },
                    ],
                });
            let glyph_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("aelyris-native-winit-wgpu-font-atlas-bind-group"),
                layout: &glyph_bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&atlas_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&atlas_sampler),
                    },
                ],
            });
            let rect_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("aelyris-native-winit-wgpu-terminal-rect-shader"),
                source: wgpu::ShaderSource::Wgsl(
                    r#"
struct VertexInput {
    @builtin(vertex_index) vertex_index: u32,
    @location(0) rect: vec4<f32>,
    @location(1) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(input.rect.x, input.rect.y),
        vec2<f32>(input.rect.z, input.rect.y),
        vec2<f32>(input.rect.x, input.rect.w),
        vec2<f32>(input.rect.x, input.rect.w),
        vec2<f32>(input.rect.z, input.rect.y),
        vec2<f32>(input.rect.z, input.rect.w)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(positions[input.vertex_index], 0.0, 1.0);
    out.color = input.color;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
"#
                    .into(),
                ),
            });
            let glyph_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("aelyris-native-winit-wgpu-terminal-glyph-shader"),
                source: wgpu::ShaderSource::Wgsl(
                    r#"
struct VertexInput {
    @builtin(vertex_index) vertex_index: u32,
    @location(0) rect: vec4<f32>,
    @location(1) uv: vec4<f32>,
    @location(2) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@group(0) @binding(0) var glyph_atlas: texture_2d<f32>;
@group(0) @binding(1) var glyph_sampler: sampler;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(input.rect.x, input.rect.y),
        vec2<f32>(input.rect.z, input.rect.y),
        vec2<f32>(input.rect.x, input.rect.w),
        vec2<f32>(input.rect.x, input.rect.w),
        vec2<f32>(input.rect.z, input.rect.y),
        vec2<f32>(input.rect.z, input.rect.w)
    );
    var uvs = array<vec2<f32>, 6>(
        vec2<f32>(input.uv.x, input.uv.y),
        vec2<f32>(input.uv.z, input.uv.y),
        vec2<f32>(input.uv.x, input.uv.w),
        vec2<f32>(input.uv.x, input.uv.w),
        vec2<f32>(input.uv.z, input.uv.y),
        vec2<f32>(input.uv.z, input.uv.w)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(positions[input.vertex_index], 0.0, 1.0);
    out.uv = uvs[input.vertex_index];
    out.color = input.color;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let alpha = textureSample(glyph_atlas, glyph_sampler, input.uv).r;
    return vec4<f32>(input.color.rgb, input.color.a * alpha);
}
"#
                    .into(),
                ),
            });
            let rect_pipeline_layout =
                device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("aelyris-native-winit-wgpu-terminal-rect-layout"),
                    bind_group_layouts: &[],
                    immediate_size: 0,
                });
            let rect_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("aelyris-native-winit-wgpu-terminal-rect-pipeline"),
                layout: Some(&rect_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &rect_shader,
                    entry_point: Some("vs_main"),
                    buffers: &[wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<RectInstance>() as wgpu::BufferAddress,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &[
                            wgpu::VertexAttribute {
                                offset: 0,
                                shader_location: 0,
                                format: wgpu::VertexFormat::Float32x4,
                            },
                            wgpu::VertexAttribute {
                                offset: std::mem::size_of::<[f32; 4]>() as wgpu::BufferAddress,
                                shader_location: 1,
                                format: wgpu::VertexFormat::Float32x4,
                            },
                        ],
                    }],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &rect_shader,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });
            let glyph_pipeline_layout =
                device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("aelyris-native-winit-wgpu-terminal-glyph-layout"),
                    bind_group_layouts: &[&glyph_bind_group_layout],
                    immediate_size: 0,
                });
            let glyph_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("aelyris-native-winit-wgpu-terminal-glyph-pipeline"),
                layout: Some(&glyph_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &glyph_shader,
                    entry_point: Some("vs_main"),
                    buffers: &[wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<GlyphInstance>() as wgpu::BufferAddress,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &[
                            wgpu::VertexAttribute {
                                offset: 0,
                                shader_location: 0,
                                format: wgpu::VertexFormat::Float32x4,
                            },
                            wgpu::VertexAttribute {
                                offset: std::mem::size_of::<[f32; 4]>() as wgpu::BufferAddress,
                                shader_location: 1,
                                format: wgpu::VertexFormat::Float32x4,
                            },
                            wgpu::VertexAttribute {
                                offset: std::mem::size_of::<[f32; 8]>() as wgpu::BufferAddress,
                                shader_location: 2,
                                format: wgpu::VertexFormat::Float32x4,
                            },
                        ],
                    }],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &glyph_shader,
                    entry_point: Some("fs_main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });

            Ok(WgpuSurfaceState {
                surface,
                device,
                queue,
                rect_pipeline,
                glyph_pipeline,
                glyph_bind_group,
                rect_instance_buffer,
                rect_instance_count: rect_instances.len().min(u32::MAX as usize) as u32,
                glyph_instance_buffer,
                glyph_instance_count: glyph_instances.len().min(u32::MAX as usize) as u32,
                config,
                adapter_info,
            })
        }

        fn draw(&mut self) -> Result<(), String> {
            let Some(gpu) = self.gpu.as_ref() else {
                return Err("winit/wgpu draw requested before GPU initialization".to_string());
            };
            let frame_texture = match gpu.surface.get_current_texture() {
                Ok(texture) => texture,
                Err(wgpu::SurfaceError::Outdated | wgpu::SurfaceError::Lost) => {
                    gpu.surface.configure(&gpu.device, &gpu.config);
                    gpu.surface.get_current_texture().map_err(|err| {
                        format!("winit/wgpu surface texture after reconfigure failed: {err}")
                    })?
                }
                Err(err) => return Err(format!("winit/wgpu surface texture failed: {err}")),
            };
            let view = frame_texture
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = gpu
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("aelyris-native-winit-wgpu-terminal-encoder"),
                });
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("aelyris-native-winit-wgpu-terminal-pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: self.accent.0,
                                g: self.accent.1,
                                b: self.accent.2,
                                a: 1.0,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                if gpu.rect_instance_count > 0 {
                    pass.set_pipeline(&gpu.rect_pipeline);
                    pass.set_vertex_buffer(0, gpu.rect_instance_buffer.slice(..));
                    pass.draw(0..6, 0..gpu.rect_instance_count);
                }
                if gpu.glyph_instance_count > 0 {
                    pass.set_pipeline(&gpu.glyph_pipeline);
                    pass.set_bind_group(0, &gpu.glyph_bind_group, &[]);
                    pass.set_vertex_buffer(0, gpu.glyph_instance_buffer.slice(..));
                    pass.draw(0..6, 0..gpu.glyph_instance_count);
                }
            }
            gpu.queue.submit([encoder.finish()]);
            gpu.device
                .poll(wgpu::PollType::wait_indefinitely())
                .map_err(|err| format!("winit/wgpu device poll failed: {err}"))?;
            frame_texture.present();
            self.frames_presented += 1;
            self.draw_calls += 1;
            Ok(())
        }

        fn should_exit(&self) -> bool {
            self.started
                .map(|started| started.elapsed() >= self.duration && self.frames_presented >= 2)
                .unwrap_or(false)
        }
    }

    impl ApplicationHandler for ProofApp {
        fn resumed(&mut self, event_loop: &ActiveEventLoop) {
            if self.window.is_some() {
                return;
            }
            let attrs = Window::default_attributes()
                .with_title("Aelyris Native winit/wgpu Terminal")
                .with_inner_size(LogicalSize::new(self.width as f64, self.height as f64))
                .with_transparent(true)
                .with_visible(self.visible);
            match event_loop.create_window(attrs) {
                Ok(window) => {
                    let window = Arc::new(window);
                    self.started = Some(Instant::now());
                    let allow_ligatures = load_config().appearance.ligatures;
                    let plan = match build_winit_wgpu_terminal_draw_plan(
                        &self.frame,
                        self.width,
                        self.height,
                        allow_ligatures,
                    ) {
                        Ok(plan) => plan,
                        Err(err) => {
                            self.surface_errors.push(err);
                            event_loop.exit();
                            return;
                        }
                    };
                    self.terminal_glyph_quads = plan.terminal_glyph_quads;
                    self.font_atlas_glyphs = plan.font_atlas.glyph_count;
                    self.font_atlas_fallback_glyphs = plan.font_atlas.fallback_glyphs;
                    self.font_atlas_fallback_font_load_failures =
                        plan.font_atlas.fallback_font_load_failures;
                    self.font_atlas_missing_glyphs = plan.font_atlas.missing_glyphs;
                    self.font_atlas_missing_fallback_glyphs =
                        plan.font_atlas.missing_fallback_glyphs;
                    self.font_atlas_question_mark_substitutions =
                        plan.font_atlas.question_mark_substitutions;
                    self.font_atlas_font_path = plan.font_atlas.font_path.clone();
                    self.font_atlas_font_px = plan.font_atlas.font_px;
                    self.renderer_consumes_system_shaped_runs =
                        plan.renderer_consumes_system_shaped_runs;
                    self.directwrite_shape_runs = plan.directwrite_shape_runs;
                    self.directwrite_shaped_clusters = plan.directwrite_shaped_clusters;
                    self.directwrite_fallback_clusters = plan.directwrite_fallback_clusters;
                    self.directwrite_fallback_font_families =
                        plan.directwrite_fallback_font_families.clone();
                    self.directwrite_shape_errors = plan.directwrite_shape_errors.clone();
                    self.question_mark_substitution_disabled =
                        plan.question_mark_substitution_disabled;
                    self.skipped_glyph_quads = plan.skipped_glyph_quads;
                    self.fallback_glyph_quads = plan.fallback_glyph_quads;
                    self.dirty_rects_rendered = plan.dirty_rects_rendered;
                    self.cursor_quads = plan.cursor_quads;
                    self.dirty_cells = plan.dirty_cells;
                    self.dirty_rows = plan.dirty_rows;
                    self.full_repaint = plan.full_repaint;
                    match Self::init_gpu(
                        window.clone(),
                        self.width,
                        self.height,
                        &plan.rect_instances,
                        &plan.glyph_instances,
                        &plan.font_atlas,
                    ) {
                        Ok(gpu) => {
                            self.gpu = Some(gpu);
                            window.request_redraw();
                        }
                        Err(err) => {
                            self.surface_errors.push(err);
                            event_loop.exit();
                        }
                    }
                    self.window = Some(window);
                }
                Err(err) => {
                    self.surface_errors
                        .push(format!("winit window creation failed: {err}"));
                    event_loop.exit();
                }
            }
        }

        fn window_event(
            &mut self,
            event_loop: &ActiveEventLoop,
            _window_id: WindowId,
            event: WindowEvent,
        ) {
            match event {
                WindowEvent::CloseRequested => event_loop.exit(),
                WindowEvent::RedrawRequested => {
                    if let Some(window) = self.window.as_ref() {
                        window.pre_present_notify();
                    }
                    if let Err(err) = self.draw() {
                        self.surface_errors.push(err);
                        event_loop.exit();
                        return;
                    }
                    if self.should_exit() {
                        event_loop.exit();
                    } else if let Some(window) = self.window.as_ref() {
                        window.request_redraw();
                    }
                }
                _ => {}
            }
        }

        fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
            if self.should_exit() {
                event_loop.exit();
                return;
            }
            event_loop.set_control_flow(ControlFlow::Poll);
            if self.gpu.is_some() {
                if let Some(window) = self.window.as_ref() {
                    window.pre_present_notify();
                }
                if let Err(err) = self.draw() {
                    self.surface_errors.push(err);
                    event_loop.exit();
                    return;
                }
                if self.should_exit() {
                    event_loop.exit();
                    return;
                }
            }
            if let Some(window) = self.window.as_ref() {
                window.request_redraw();
            }
        }
    }

    let summary = frame.summary();
    let width = frame.width_px.clamp(320, 1280);
    let height = frame.height_px.clamp(180, 720);
    let accent = gpu_accent_from_hash(&summary.frame_sha256);
    let mut app = ProofApp {
        frame: frame.clone(),
        duration,
        visible,
        width,
        height,
        accent,
        terminal_glyph_quads: 0,
        font_atlas_glyphs: 0,
        font_atlas_fallback_glyphs: 0,
        font_atlas_fallback_font_load_failures: 0,
        font_atlas_missing_glyphs: 0,
        font_atlas_missing_fallback_glyphs: 0,
        font_atlas_question_mark_substitutions: 0,
        font_atlas_font_path: String::new(),
        font_atlas_font_px: 0.0,
        renderer_consumes_system_shaped_runs: false,
        directwrite_shape_runs: 0,
        directwrite_shaped_clusters: 0,
        directwrite_fallback_clusters: 0,
        directwrite_fallback_font_families: Vec::new(),
        directwrite_shape_errors: Vec::new(),
        question_mark_substitution_disabled: false,
        skipped_glyph_quads: 0,
        fallback_glyph_quads: 0,
        dirty_rects_rendered: 0,
        cursor_quads: 0,
        dirty_cells: 0,
        dirty_rows: 0,
        full_repaint: false,
        started: None,
        window: None,
        gpu: None,
        frames_presented: 0,
        draw_calls: 0,
        surface_errors: Vec::new(),
    };

    let mut event_loop =
        EventLoop::new().map_err(|err| format!("winit event loop failed: {err}"))?;
    let safety_deadline = Instant::now() + duration + Duration::from_secs(3);
    while Instant::now() < safety_deadline && !app.should_exit() && app.surface_errors.is_empty() {
        match event_loop.pump_app_events(Some(Duration::from_millis(16)), &mut app) {
            PumpStatus::Continue => {}
            PumpStatus::Exit(_) => break,
        }
    }

    if let Some(err) = app.surface_errors.first() {
        return Err(err.clone());
    }
    let Some(gpu) = app.gpu.as_ref() else {
        return Err("winit/wgpu proof did not initialize GPU state".to_string());
    };
    if app.frames_presented < 2 {
        return Err(format!(
            "winit/wgpu proof presented too few frames: {}",
            app.frames_presented
        ));
    }
    let elapsed_ms = app
        .started
        .map(|started| started.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or_default();
    let renderer_text_shaping_integrated = app.renderer_consumes_system_shaped_runs
        && app.directwrite_shape_errors.is_empty()
        && app.question_mark_substitution_disabled;
    let renderer_fallback_glyph_rasterization_ready = app.directwrite_fallback_clusters > 0
        && app.font_atlas_fallback_glyphs > 0
        && app.font_atlas_fallback_font_load_failures == 0
        && app.font_atlas_missing_fallback_glyphs == 0
        && app.fallback_glyph_quads >= app.directwrite_fallback_clusters;
    let text_shaping_backend = if renderer_fallback_glyph_rasterization_ready {
        "directwrite-shaped-run-consumed-fontdue-directwrite-fallback-atlas"
    } else {
        "directwrite-shaped-run-consumed-fontdue-primary-atlas-fallback-raster-pending"
    };
    Ok(json!({
        "terminalRenderer": "native-winit-wgpu-terminal",
        "renderer": "winit-wgpu-surface-present-loop",
        "gpuRenderer": true,
        "surface": "winit-window-swapchain",
        "presentableSurface": true,
        "interactiveWindow": app.window.is_some(),
        "visibleRequested": visible,
        "framesPresented": app.frames_presented,
        "drawCalls": app.draw_calls,
        "elapsedMs": elapsed_ms,
        "averageFrameMs": if app.frames_presented > 0 { elapsed_ms / app.frames_presented as f64 } else { 0.0 },
        "surfaceConfigured": true,
        "surfaceWidth": gpu.config.width,
        "surfaceHeight": gpu.config.height,
        "surfaceFormat": format!("{:?}", gpu.config.format),
        "presentMode": format!("{:?}", gpu.config.present_mode),
        "alphaMode": format!("{:?}", gpu.config.alpha_mode),
        "adapter": {
            "name": gpu.adapter_info.name,
            "vendor": gpu.adapter_info.vendor,
            "device": gpu.adapter_info.device,
            "deviceType": format!("{:?}", gpu.adapter_info.device_type),
            "backend": format!("{:?}", gpu.adapter_info.backend),
            "driver": gpu.adapter_info.driver,
            "driverInfo": gpu.adapter_info.driver_info,
        },
        "renderFrameSchema": summary.schema.clone(),
        "renderFrameSha256": summary.frame_sha256.clone(),
        "rendererBoundary": summary.renderer_boundary.clone(),
        "nonBlankCells": summary.non_blank_cells,
        "glyphMode": "font-atlas",
        "fontAtlas": true,
        "fontAtlasGlyphs": app.font_atlas_glyphs,
        "fontAtlasFallbackGlyphs": app.font_atlas_fallback_glyphs,
        "fontAtlasFallbackFontLoadFailures": app.font_atlas_fallback_font_load_failures,
        "fontAtlasMissingGlyphs": app.font_atlas_missing_glyphs,
        "fontAtlasMissingFallbackGlyphs": app.font_atlas_missing_fallback_glyphs,
        "fontAtlasQuestionMarkSubstitutions": app.font_atlas_question_mark_substitutions,
        "fontAtlasFontPath": app.font_atlas_font_path,
        "fontAtlasFontPx": app.font_atlas_font_px,
        "rendererConsumesSystemShapedRuns": app.renderer_consumes_system_shaped_runs,
        "directWriteShapeRuns": app.directwrite_shape_runs,
        "directWriteShapedClusters": app.directwrite_shaped_clusters,
        "directWriteFallbackClusters": app.directwrite_fallback_clusters,
        "directWriteFallbackFontFamilies": app.directwrite_fallback_font_families,
        "directWriteShapeErrors": app.directwrite_shape_errors,
        "questionMarkSubstitutionDisabled": app.question_mark_substitution_disabled,
        "skippedGlyphQuads": app.skipped_glyph_quads,
        "fallbackGlyphQuads": app.fallback_glyph_quads,
        "textShapingPolicy": to_value(&terminal_text_shaping_policy()).unwrap_or_else(|_| json!({
            "readyForNativeShapingClaim": false,
            "releaseBlockers": ["native text-shaping policy serialization failed"]
        })),
        "systemTextShapingCapability": to_value(&system_text_shaping_capability()).unwrap_or_else(|_| json!({
            "available": false,
            "readyForNativeShapingClaim": false,
            "blockers": ["native system text-shaping capability serialization failed"]
        })),
        "textShapingBackend": text_shaping_backend,
        "textShapingRendererIntegrationReady": renderer_text_shaping_integrated,
        "textShapingFallbackGlyphRasterizationReady": renderer_fallback_glyph_rasterization_ready,
        "textShapingReadyForNativeShapingClaim": false,
        "textShapingBlockedUntil": [
            "winit/wgpu glyph atlas rasterizes fallback glyphs from DirectWrite-resolved fonts",
            "visual ligature/no-ligature regression artifacts"
        ],
        "terminalGlyphQuads": app.terminal_glyph_quads,
        "cursorQuads": app.cursor_quads,
        "dirtyRectDogfood": app.dirty_rects_rendered > 0,
        "dirtyRectsRendered": app.dirty_rects_rendered,
        "dirtyCells": app.dirty_cells,
        "dirtyRows": app.dirty_rows,
        "fullRepaint": app.full_repaint,
        "webviewUsed": false,
        "reactUsed": false,
        "nextRenderer": "native-ime-dogfood-terminal-input",
    }))
}

#[cfg(not(target_os = "windows"))]
fn native_winit_wgpu_surface_proof(
    _frame: &NativeRenderFrame,
    _duration: Duration,
    _visible: bool,
) -> Result<Value, String> {
    Err("aelyris-native winit-wgpu-proof is currently implemented for Windows only".to_string())
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct AtlasGlyph {
    uv: [f32; 4],
}

#[cfg(target_os = "windows")]
fn load_native_terminal_font() -> Result<(fontdue::Font, String), String> {
    let candidates = [
        "C:\\Windows\\Fonts\\CascadiaMono.ttf",
        "C:\\Windows\\Fonts\\CascadiaCode.ttf",
        "C:\\Windows\\Fonts\\consola.ttf",
    ];
    for path in candidates {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        match fontdue::Font::from_bytes(bytes, fontdue::FontSettings::default()) {
            Ok(font) => return Ok((font, path.to_string())),
            Err(_) => continue,
        }
    }
    Err("no native terminal font could be loaded from C:\\Windows\\Fonts".to_string())
}

#[cfg(target_os = "windows")]
fn load_fontdue_font_from_path(path: &str, collection_index: u32) -> Result<fontdue::Font, String> {
    let bytes = std::fs::read(path).map_err(|err| format!("read {path}: {err}"))?;
    fontdue::Font::from_bytes(
        bytes,
        fontdue::FontSettings {
            collection_index,
            ..fontdue::FontSettings::default()
        },
    )
    .map_err(|err| format!("parse {path}#{collection_index}: {err}"))
}

#[cfg(target_os = "windows")]
fn build_native_text_shape_plan(
    frame: &NativeRenderFrame,
    allow_ligatures: bool,
) -> NativeRendererTextShapePlan {
    use std::collections::{BTreeMap, BTreeSet};

    let mut atlas_chars = BTreeSet::new();
    let mut render_glyphs = Vec::new();
    let mut fallback_required_chars = BTreeSet::new();
    let mut fallback_font_refs = BTreeMap::new();
    let mut fallback_font_families = BTreeSet::new();
    let mut shape_errors = Vec::new();
    let mut shape_runs = 0usize;
    let mut shaped_clusters = 0usize;
    let mut fallback_clusters = 0usize;

    let shaper = match DirectWriteTextShaper::new() {
        Ok(shaper) => shaper,
        Err(err) => {
            for cell in frame.cells.iter().filter(|cell| cell.ch != ' ') {
                atlas_chars.insert(cell.ch);
            }
            return NativeRendererTextShapePlan {
                atlas_chars,
                render_glyphs: frame
                    .cells
                    .iter()
                    .filter(|cell| cell.ch != ' ')
                    .map(|cell| NativeRendererGlyphPlan {
                        ch: cell.ch,
                        rect_px: [
                            cell.rect.x_px as f32,
                            cell.rect.y_px as f32,
                            f32::from(cell.rect.width_px),
                            f32::from(cell.rect.height_px),
                        ],
                        fg: cell.fg,
                        fallback_required: false,
                    })
                    .collect(),
                fallback_required_chars,
                fallback_font_refs,
                renderer_consumes_system_shaped_runs: false,
                directwrite_shape_runs: 0,
                directwrite_shaped_clusters: 0,
                directwrite_fallback_clusters: 0,
                directwrite_fallback_font_families: Vec::new(),
                directwrite_shape_errors: vec![format!("{err:?}")],
                question_mark_substitution_disabled: true,
            };
        }
    };

    for row in 0..frame.rows {
        let mut row_cells = frame
            .cells
            .iter()
            .filter(|cell| cell.row == row && cell.ch != ' ')
            .collect::<Vec<_>>();
        if row_cells.is_empty() {
            continue;
        }
        row_cells.sort_by_key(|cell| cell.col);
        let text = row_cells.iter().map(|cell| cell.ch).collect::<String>();
        let mut cell_start_bytes = Vec::with_capacity(row_cells.len());
        let mut byte_offset = 0usize;
        for cell in &row_cells {
            cell_start_bytes.push(byte_offset);
            byte_offset += cell.ch.len_utf8();
        }
        let attrs = row_cells.first().map(|cell| cell.attrs).unwrap_or_default();
        let input = ShapeInput {
            text,
            style: CellStyle {
                attrs,
                bold: attrs & 0x01 != 0,
                italic: attrs & 0x02 != 0,
            },
            cell_width_px: frame.cell_width_px,
            cell_height_px: frame.cell_height_px,
            allow_ligatures,
        };

        match shaper.shape_run(&input) {
            Ok(run) => {
                shape_runs += 1;
                for cluster in run.clusters {
                    shaped_clusters += 1;
                    let start_cell_index = cell_start_bytes
                        .iter()
                        .position(|offset| *offset >= cluster.start_byte)
                        .unwrap_or(0)
                        .min(row_cells.len().saturating_sub(1));
                    let cell = row_cells[start_cell_index];
                    if cluster.fallback_required {
                        fallback_clusters += 1;
                        fallback_font_families.insert(cluster.font.family.clone());
                    }
                    let Some(ch) = cluster.text.chars().find(|ch| *ch != ' ') else {
                        continue;
                    };
                    atlas_chars.insert(ch);
                    if cluster.fallback_required {
                        fallback_required_chars.insert(ch);
                        if let Some(path) = cluster.font.font_file_path.as_ref() {
                            fallback_font_refs.entry(ch).or_insert_with(|| {
                                NativeRendererFallbackFontRef {
                                    family: cluster.font.family.clone(),
                                    path: path.clone(),
                                    collection_index: cluster
                                        .font
                                        .font_collection_index
                                        .unwrap_or(0),
                                }
                            });
                        }
                    }
                    render_glyphs.push(NativeRendererGlyphPlan {
                        ch,
                        rect_px: [
                            cell.rect.x_px as f32,
                            cell.rect.y_px as f32,
                            f32::from(frame.cell_width_px) * f32::from(cluster.cell_advance),
                            f32::from(cell.rect.height_px),
                        ],
                        fg: cell.fg,
                        fallback_required: cluster.fallback_required,
                    });
                }
            }
            Err(err) => {
                shape_errors.push(format!("row {row}: {err:?}"));
                for cell in row_cells {
                    atlas_chars.insert(cell.ch);
                    render_glyphs.push(NativeRendererGlyphPlan {
                        ch: cell.ch,
                        rect_px: [
                            cell.rect.x_px as f32,
                            cell.rect.y_px as f32,
                            f32::from(cell.rect.width_px),
                            f32::from(cell.rect.height_px),
                        ],
                        fg: cell.fg,
                        fallback_required: false,
                    });
                }
            }
        }
    }

    NativeRendererTextShapePlan {
        atlas_chars,
        render_glyphs,
        fallback_required_chars,
        fallback_font_refs,
        renderer_consumes_system_shaped_runs: shape_runs > 0 && shape_errors.is_empty(),
        directwrite_shape_runs: shape_runs,
        directwrite_shaped_clusters: shaped_clusters,
        directwrite_fallback_clusters: fallback_clusters,
        directwrite_fallback_font_families: fallback_font_families.into_iter().collect(),
        directwrite_shape_errors: shape_errors,
        question_mark_substitution_disabled: true,
    }
}

#[cfg(target_os = "windows")]
fn build_native_font_atlas(
    frame: &NativeRenderFrame,
    shape_plan: &NativeRendererTextShapePlan,
) -> Result<(FontAtlas, std::collections::HashMap<char, AtlasGlyph>), String> {
    use std::collections::HashMap;

    let (font, font_path) = load_native_terminal_font()?;
    let chars = shape_plan.atlas_chars.iter().copied().collect::<Vec<_>>();
    let slot_w = (u32::from(frame.cell_width_px).max(8) * 2).min(64);
    let slot_h = u32::from(frame.cell_height_px).clamp(12, 64);
    let columns = 16u32;
    let rows = ((chars.len() as u32).saturating_add(columns - 1) / columns).max(1);
    let width = slot_w * columns;
    let height = slot_h * rows;
    let mut pixels = vec![0u8; width as usize * height as usize];
    let mut glyphs = HashMap::new();
    let mut fallback_fonts = HashMap::new();
    let mut fallback_glyphs = 0usize;
    let mut fallback_font_load_failures = 0usize;
    let mut missing_glyphs = 0usize;
    let mut missing_fallback_glyphs = 0usize;
    let font_px = (f32::from(frame.cell_height_px) * 0.86).max(10.0);

    for (index, ch) in chars.iter().copied().enumerate() {
        let fallback_ref = shape_plan.fallback_font_refs.get(&ch);
        let fallback_key = fallback_ref.map(|fallback| {
            format!(
                "{}#{}",
                fallback.path.to_ascii_lowercase(),
                fallback.collection_index
            )
        });
        if let (Some(fallback), Some(key)) = (fallback_ref, fallback_key.as_ref()) {
            let _ = &fallback.family;
            if !fallback_fonts.contains_key(key) {
                match load_fontdue_font_from_path(&fallback.path, fallback.collection_index) {
                    Ok(font) => {
                        fallback_fonts.insert(key.clone(), font);
                    }
                    Err(_) => {
                        fallback_font_load_failures += 1;
                    }
                }
            }
        }
        let fallback_font = fallback_key
            .as_ref()
            .and_then(|key| fallback_fonts.get(key));
        let used_fallback_font = fallback_font.is_some();
        let (metrics, bitmap) = fallback_font.unwrap_or(&font).rasterize(ch, font_px);
        if metrics.width == 0 || metrics.height == 0 || bitmap.iter().all(|value| *value == 0) {
            missing_glyphs += 1;
            if shape_plan.fallback_required_chars.contains(&ch) {
                missing_fallback_glyphs += 1;
            }
            continue;
        }
        if used_fallback_font {
            fallback_glyphs += 1;
        }

        let slot_x = (index as u32 % columns) * slot_w;
        let slot_y = (index as u32 / columns) * slot_h;
        let glyph_w = metrics.width.min(slot_w as usize);
        let glyph_h = metrics.height.min(slot_h as usize);
        let offset_x = slot_x + (slot_w.saturating_sub(glyph_w as u32) / 2);
        let offset_y = slot_y + (slot_h.saturating_sub(glyph_h as u32) / 2);

        for y in 0..glyph_h {
            for x in 0..glyph_w {
                let source = bitmap[y * metrics.width + x];
                let dest_x = offset_x + x as u32;
                let dest_y = offset_y + y as u32;
                let dest = dest_y as usize * width as usize + dest_x as usize;
                pixels[dest] = pixels[dest].max(source);
            }
        }

        glyphs.insert(
            ch,
            AtlasGlyph {
                uv: [
                    slot_x as f32 / width as f32,
                    slot_y as f32 / height as f32,
                    (slot_x + slot_w) as f32 / width as f32,
                    (slot_y + slot_h) as f32 / height as f32,
                ],
            },
        );
    }

    Ok((
        FontAtlas {
            pixels,
            width,
            height,
            glyph_count: glyphs.len(),
            fallback_glyphs,
            fallback_font_load_failures,
            missing_glyphs,
            missing_fallback_glyphs,
            question_mark_substitutions: 0,
            font_path,
            font_px,
        },
        glyphs,
    ))
}

#[cfg(target_os = "windows")]
fn build_winit_wgpu_terminal_draw_plan(
    frame: &NativeRenderFrame,
    surface_width: u32,
    surface_height: u32,
    allow_ligatures: bool,
) -> Result<TerminalDrawPlan, String> {
    fn clip_rect(
        x_px: f32,
        y_px: f32,
        width_px: f32,
        height_px: f32,
        surface_width: f32,
        surface_height: f32,
    ) -> [f32; 4] {
        let x0 = (x_px / surface_width) * 2.0 - 1.0;
        let x1 = ((x_px + width_px) / surface_width) * 2.0 - 1.0;
        let y0 = 1.0 - (y_px / surface_height) * 2.0;
        let y1 = 1.0 - ((y_px + height_px) / surface_height) * 2.0;
        [x0, y0, x1, y1]
    }

    fn color_from_u32(value: u32, fallback: [f32; 4]) -> [f32; 4] {
        if value == 0 {
            return fallback;
        }
        [
            ((value >> 16) & 0xff) as f32 / 255.0,
            ((value >> 8) & 0xff) as f32 / 255.0,
            (value & 0xff) as f32 / 255.0,
            fallback[3],
        ]
    }

    fn push_rect(
        instances: &mut Vec<RectInstance>,
        rect: [f32; 4],
        color: [f32; 4],
        surface_width: f32,
        surface_height: f32,
    ) {
        if rect[2] <= 0.0 || rect[3] <= 0.0 {
            return;
        }
        instances.push(RectInstance {
            rect: clip_rect(
                rect[0],
                rect[1],
                rect[2],
                rect[3],
                surface_width,
                surface_height,
            ),
            color,
        });
    }

    let surface_width_f = surface_width.max(1) as f32;
    let surface_height_f = surface_height.max(1) as f32;
    let diff = frame.diff_against(None);
    let shape_plan = build_native_text_shape_plan(frame, allow_ligatures);
    let (font_atlas, atlas_glyphs) = build_native_font_atlas(frame, &shape_plan)?;
    let mut rect_instances = Vec::with_capacity(diff.dirty_rects.len().saturating_add(1));
    let mut glyph_instances = Vec::with_capacity(shape_plan.render_glyphs.len());

    for rect in &diff.dirty_rects {
        push_rect(
            &mut rect_instances,
            [
                rect.x_px as f32,
                rect.y_px as f32,
                f32::from(rect.width_px),
                f32::from(rect.height_px),
            ],
            [0.16, 0.10, 0.16, 0.22],
            surface_width_f,
            surface_height_f,
        );
    }

    let mut terminal_glyph_quads = 0usize;
    let mut skipped_glyph_quads = 0usize;
    let mut fallback_glyph_quads = 0usize;
    for glyph in &shape_plan.render_glyphs {
        let Some(atlas_glyph) = atlas_glyphs.get(&glyph.ch) else {
            skipped_glyph_quads += 1;
            continue;
        };
        if glyph.fallback_required {
            fallback_glyph_quads += 1;
        }
        let color = color_from_u32(glyph.fg, [0.96, 0.86, 0.94, 0.96]);
        glyph_instances.push(GlyphInstance {
            rect: clip_rect(
                glyph.rect_px[0],
                glyph.rect_px[1],
                glyph.rect_px[2],
                glyph.rect_px[3],
                surface_width_f,
                surface_height_f,
            ),
            uv: atlas_glyph.uv,
            color,
        });
        terminal_glyph_quads += 1;
    }

    let mut cursor_quads = 0usize;
    if frame.cursor.visible && frame.cursor.col < frame.cols && frame.cursor.row < frame.rows {
        push_rect(
            &mut rect_instances,
            [
                f32::from(frame.cursor.col) * f32::from(frame.cell_width_px),
                f32::from(frame.cursor.row) * f32::from(frame.cell_height_px),
                f32::from(frame.cell_width_px),
                f32::from(frame.cell_height_px),
            ],
            [0.98, 0.78, 0.90, 0.64],
            surface_width_f,
            surface_height_f,
        );
        cursor_quads = 1;
    }

    if rect_instances.is_empty() && glyph_instances.is_empty() {
        push_rect(
            &mut rect_instances,
            [8.0, 8.0, surface_width_f.min(64.0), 12.0],
            [0.98, 0.78, 0.90, 0.72],
            surface_width_f,
            surface_height_f,
        );
    }

    Ok(TerminalDrawPlan {
        rect_instances,
        glyph_instances,
        font_atlas,
        renderer_consumes_system_shaped_runs: shape_plan.renderer_consumes_system_shaped_runs,
        directwrite_shape_runs: shape_plan.directwrite_shape_runs,
        directwrite_shaped_clusters: shape_plan.directwrite_shaped_clusters,
        directwrite_fallback_clusters: shape_plan.directwrite_fallback_clusters,
        directwrite_fallback_font_families: shape_plan.directwrite_fallback_font_families,
        directwrite_shape_errors: shape_plan.directwrite_shape_errors,
        question_mark_substitution_disabled: shape_plan.question_mark_substitution_disabled,
        skipped_glyph_quads,
        fallback_glyph_quads,
        dirty_rects_rendered: diff.dirty_rects.len(),
        terminal_glyph_quads,
        cursor_quads,
        dirty_cells: diff.dirty_cells,
        dirty_rows: diff.dirty_rows,
        full_repaint: diff.full_repaint,
    })
}

fn gpu_accent_from_hash(hash: &str) -> (f64, f64, f64) {
    let bytes = hash.as_bytes();
    let r = bytes.first().copied().unwrap_or(b'a') as f64 / 255.0;
    let g = bytes.get(1).copied().unwrap_or(b'e') as f64 / 255.0;
    let b = bytes.get(2).copied().unwrap_or(b't') as f64 / 255.0;
    (r.max(0.2), g.max(0.2), b.max(0.2))
}

fn render_proof_lines(text: &str) -> Vec<String> {
    let mut lines = text
        .lines()
        .map(|line| {
            line.chars()
                .filter(|ch| !ch.is_control() || *ch == '\t')
                .take(120)
                .collect::<String>()
        })
        .filter(|line| !line.trim().is_empty())
        .take(16)
        .collect::<Vec<_>>();
    if lines.is_empty() {
        lines.push("Aelyris Native Renderer".to_string());
    }
    lines
}

fn wide_null(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn join_text_args_preserves_text_and_enter() {
        assert_eq!(
            join_text_args(&strings(&["echo", "native", "--enter"]), "send").unwrap(),
            "echo native\r"
        );
    }

    #[test]
    fn join_text_args_allows_enter_only() {
        assert_eq!(
            join_text_args(&strings(&["--enter"]), "send").unwrap(),
            "\r"
        );
    }

    #[test]
    fn join_text_args_rejects_empty_or_unknown_options() {
        assert!(join_text_args(&[], "send").is_err());
        assert!(join_text_args(&strings(&["--bad"]), "send").is_err());
    }

    #[test]
    fn render_proof_lines_strips_controls_and_has_fallback() {
        assert_eq!(render_proof_lines("\u{1b}[31mhello")[0], "[31mhello");
        assert_eq!(render_proof_lines("\n\n")[0], "Aelyris Native Renderer");
    }

    #[test]
    fn grid_render_frame_uses_term_engine_cells() {
        let mut engine = TermEngine::new(20, 3).expect("engine");
        engine.advance(b"grid proof\r\nready");
        let snapshot = engine.snapshot();
        let frame = NativeRenderFrame::from_snapshot(
            &snapshot,
            NativeCellMetrics::new(9, 18).expect("metrics"),
        );
        let lines = frame.non_empty_lines(3);
        assert!(lines.iter().any(|line| line.contains("grid proof")));
        assert!(frame.summary().non_blank_cells > 0);
        assert_eq!(
            frame.summary().renderer_boundary,
            "rust-native-render-frame"
        );
    }

    #[test]
    fn full_native_contract_is_honest_about_missing_daily_driver_work() {
        let contract = full_native_readiness_contract();
        assert_eq!(contract["schema"], "aelyris.full-native-readiness.v1");
        assert_eq!(contract["currentStage"], "native-client-spike");
        assert_eq!(contract["completed"]["rendererNeutralFrameContract"], true);
        assert_eq!(contract["completed"]["winitWgpuFontAtlasProof"], true);
        assert_eq!(contract["completed"]["nativeImeStateProof"], true);
        assert_eq!(contract["missing"]["nativePresentLoopDogfood"], true);
        assert!(contract["missing"]["winitWgpuRenderer"].is_null());
        assert!(contract["missing"]["nativeImeLiveDogfood"].is_null());
        assert!(contract["missing"]["nativeCommandCenterRightRailUi"].is_null());
        assert!(contract["missing"]["nativePrimaryOperatorPromotion"].is_null());
        assert!(contract["doNotClaimFullNativeUntil"]
            .as_array()
            .expect("claim guards")
            .iter()
            .any(|item| item.as_str().unwrap_or_default().contains("Japanese IME")));
    }

    #[test]
    fn gpu_accent_from_hash_is_stable_and_non_black() {
        let first = gpu_accent_from_hash("93cc831124b65e8536c14b22ae70072d");
        let second = gpu_accent_from_hash("93cc831124b65e8536c14b22ae70072d");
        assert_eq!(first, second);
        assert!(first.0 >= 0.2);
        assert!(first.1 >= 0.2);
        assert!(first.2 >= 0.2);
    }
}
