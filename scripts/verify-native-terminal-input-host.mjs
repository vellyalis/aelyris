import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT =
  process.env.AETHER_NATIVE_INPUT_OUT ??
  join(ROOT, ".codex-auto", "production-smoke", "native-terminal-input-host.json");

function source(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function mtime(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function check(id, passed, detail) {
  return { id, status: passed ? "passed" : "failed", detail };
}

const nativeInput = source("src-tauri/src/term/native_input.rs");
const commands = source("src-tauri/src/ipc/commands.rs");
const lib = source("src-tauri/src/lib.rs");
const canvasIme = source("src/features/terminal/hooks/useCanvasIME.ts");
const terminalCanvas = source("src/features/terminal/TerminalCanvas.tsx");
const nativeClientArtifactPath = ".codex-auto/quality/native-client-spike.json";
const nativeClient = readJson(nativeClientArtifactPath);
const nativeClientFresh =
  nativeClient?.status === "passed" &&
  mtime(nativeClientArtifactPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-native-client-spike.mjs"),
      mtime("src-tauri/src/bin/aether_native.rs"),
      mtime("src-tauri/src/term/native_input.rs"),
      mtime("src-tauri/src/ipc/commands.rs"),
    );
const nativePasteGuard = nativeClient?.nativePasteGuard?.pasteGuard;
const nativePasteGuardFresh =
  nativeClientFresh &&
  nativePasteGuard?.schema === "aether.native.paste-guard-proof.v1" &&
  nativePasteGuard?.nativePasteGuardProof === true &&
  nativePasteGuard?.nativeHwndWmPaste === true &&
  nativePasteGuard?.nativeSurfaceHwnd &&
  nativePasteGuard?.allCasesPass === true &&
  nativePasteGuard?.singleLineLfNormalizedAndExecuted === true &&
  nativePasteGuard?.destructivePasteBlockedBeforePty === true &&
  nativePasteGuard?.multilinePasteBlockedBeforePty === true &&
  nativePasteGuard?.webviewUsed === false &&
  nativePasteGuard?.reactUsed === false &&
  nativePasteGuard?.cdpUsed === false &&
  nativePasteGuard?.powershellUsed === false;
const nativeHwndPasteLiveArtifactPath = ".codex-auto/production-smoke/native-hwnd-paste-live.json";
const nativeHwndPasteLive = readJson(nativeHwndPasteLiveArtifactPath);
const nativeHwndPasteLiveFresh =
  nativeHwndPasteLive?.ok === true &&
  nativeHwndPasteLive?.status === "pass-current-native-hwnd-paste-contract" &&
  mtime(nativeHwndPasteLiveArtifactPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-native-hwnd-paste-live.mjs"),
      mtime("src-tauri/src/term/native_input.rs"),
      mtime("src-tauri/src/ipc/commands.rs"),
    );

const frontendNativeDefault =
  canvasIme.includes("NATIVE_INPUT_SURFACE_DEFAULT_ENABLED = true") &&
  canvasIme.includes("__TAURI_INTERNALS__") &&
  terminalCanvas.includes("useNativeInputSurface") &&
  terminalCanvas.includes("data-native-input-surface");
const webviewFallbackConditional =
  terminalCanvas.includes("!useNativeInputSurface") &&
  terminalCanvas.includes("WEBVIEW_IME_FALLBACK_TEST_ID") &&
  !terminalCanvas.includes('data-testid="terminal-ime-textarea"');

const checks = [
  check("rust-host", nativeInput.includes("pub struct NativeTerminalInputHost"), "Rust native input host exists"),
  check(
    "commit-command",
    commands.includes("native_terminal_input_commit") &&
      commands.includes("commit_native_terminal_input(&app, host, terminal_id, data, source).await") &&
      commands.includes("terminal_write_async(app, &terminal_id, &bytes)"),
    "committed input routes through the shared Rust terminal write path",
  ),
  check(
    "surface-drain-shared-commit",
    commands.includes("commit_native_terminal_input(") &&
      commands.includes('"native-input-surface".to_string()') &&
      commands.includes("native_input_rejected") &&
      commands.includes("validate_keys_payload(&data)"),
    "native HWND drain shares validation, audit rejection, command history, and PTY write semantics with explicit commits",
  ),
  check(
    "surface-drain-no-precommit-metadata",
    !nativeInput.includes('state.last_commit_source = Some("native-input-surface".to_string())') &&
      !nativeInput.includes("state.last_commit_bytes = text.len();") &&
      nativeInput.includes("Commit counters and last") &&
      nativeInput.includes("shared IPC commit path"),
    "native HWND drain does not report commit metadata until the shared validation/write path succeeds",
  ),
  check(
    "status-command",
    commands.includes("native_terminal_input_status") && lib.includes("ipc::native_terminal_input_status"),
    "native input status IPC is exposed",
  ),
  check(
    "surface-command",
    commands.includes("native_terminal_input_focus") &&
      commands.includes("native_terminal_input_drain") &&
      commands.includes("native_terminal_input_preedit") &&
      lib.includes("ipc::native_terminal_input_focus") &&
      lib.includes("ipc::native_terminal_input_drain") &&
      lib.includes("ipc::native_terminal_input_preedit"),
    "native HWND input surface focus/drain/preedit IPC is exposed",
  ),
  check(
    "frontend-commit-path",
    canvasIme.includes("native_terminal_input_commit") && canvasIme.includes("webview-ime-bridge"),
    "frontend IME commits are tagged and routed through the native input command",
  ),
  check(
    "frontend-surface-opt-in",
    canvasIme.includes("NATIVE_INPUT_SURFACE_STORAGE_KEY") &&
      canvasIme.includes("native_terminal_input_focus") &&
      canvasIme.includes("native_terminal_input_drain") &&
      canvasIme.includes("caretInset: nativeCaretInset") &&
      canvasIme.includes("width: nativeAnchorWidth"),
    "frontend has an opt-in native input surface path and gives the native IME host a wide cursor runway",
  ),
  check(
    "frontend-native-default",
    frontendNativeDefault && webviewFallbackConditional,
    "Tauri runtime defaults to the native HWND input surface and keeps WebView IME as conditional fallback only",
  ),
  check(
    "surface-key-routing",
    nativeInput.includes("WM_KEYDOWN") &&
      nativeInput.includes("terminal_bytes_for_native_key") &&
      nativeInput.includes("VK_RETURN") &&
      nativeInput.includes("\\x1b[3~"),
    "native surface maps terminal control keys before draining",
  ),
  check(
    "surface-custom-hwnd-runway",
    nativeInput.includes("caret_inset") &&
      nativeInput.includes("AetherNativeTerminalInputSurface") &&
      nativeInput.includes("RegisterClassW") &&
      nativeInput.includes("native_input_surface_paint_rect") &&
      nativeInput.includes("apply_native_surface_ime_position") &&
      nativeInput.includes("CFS_RECT") &&
      nativeInput.includes("WM_ERASEBKGND") &&
      nativeInput.includes("ValidateRect") &&
      nativeInput.includes("sanitize_native_input_rect") &&
      !nativeInput.includes('w!("EDIT")'),
    "native input uses an Aether-owned no-paint HWND with a full-width IME runway, preventing the white vertical Japanese preedit strip without relying on EDIT painting",
  ),
  check(
    "surface-ime-preedit-hidden",
    nativeInput.includes("WM_IME_SETCONTEXT") &&
      nativeInput.includes("ISC_SHOWUICOMPOSITIONWINDOW") &&
      nativeInput.includes("ISC_SHOWUIGUIDELINE") &&
      nativeInput.includes("WM_IME_COMPOSITION") &&
      nativeInput.includes("GCS_RESULTSTR") &&
      nativeInput.includes("GCS_COMPSTR") &&
      nativeInput.includes("composition_text") &&
      nativeInput.includes("read_native_ime_composition_text") &&
      nativeInput.includes("terminal_text_for_native_char") &&
      nativeInput.includes("OS paint path") &&
      nativeInput.includes("frontend mirrors composition_text") &&
      canvasIme.includes("native_terminal_input_preedit"),
    "native input suppresses the IME composition UI, mirrors preedit text into the terminal overlay, captures committed IME result text in Rust, and blocks OS preedit painting that caused the vertical Japanese strip",
  ),
  check(
    "surface-window-lifetime",
    nativeInput.includes("WM_NCCREATE") &&
      nativeInput.includes("GWLP_USERDATA") &&
      nativeInput.includes("WM_NCDESTROY") &&
      nativeInput.includes("drop(Box::from_raw(ptr))") &&
      nativeInput.includes("DefWindowProcW") &&
      !nativeInput.includes("SetWindowSubclass") &&
      !nativeInput.includes("DefSubclassProc") &&
      !nativeInput.includes("GWLP_WNDPROC"),
    "native input HWND owns its window proc and releases context from WM_NCDESTROY without subclass teardown hazards",
  ),
  check(
    "surface-paste-guard",
    nativeInput.includes("WM_PASTE") &&
      nativeInput.includes("read_native_clipboard_text_for_paste") &&
      nativeInput.includes("classify_native_terminal_paste_input") &&
      nativeInput.includes("normalize_native_terminal_paste_input") &&
      nativeInput.includes("multi-line paste requires explicit UI confirmation") &&
      nativeInput.includes("destructive command paste blocked by native input guard") &&
    nativeInput.includes("native_paste_guard_event_count"),
    "native HWND paste is intercepted before window text insertion can bypass paste guard, then blocked or normalized in Rust",
  ),
  check(
    "surface-paste-guard-bounded-clipboard-retry",
    nativeInput.includes("CLIPBOARD_OPEN_RETRY_COUNT") &&
      nativeInput.includes("CLIPBOARD_OPEN_RETRY_DELAY_MS") &&
      nativeInput.includes("read_native_clipboard_text_with_attempts(") &&
      nativeInput.includes("CLIPBOARD_OPEN_RETRY_COUNT,\n            CLIPBOARD_OPEN_RETRY_DELAY_MS") &&
      nativeInput.includes("for attempt in 0..attempts") &&
      nativeInput.includes("std::thread::sleep(std::time::Duration::from_millis(delay_ms))") &&
      nativeInput.includes("CLIPBOARD_OPEN_RETRY_DELAY_MS") &&
      !nativeInput.includes("for _ in 0..12") &&
      !nativeInput.includes("from_millis(16)"),
    "native HWND paste tolerates transient Windows clipboard contention with a bounded retry instead of a long UI-thread stall",
  ),
  check(
    "behavioral-native-hwnd-paste-live",
    (nativeHwndPasteLiveFresh &&
      nativeHwndPasteLive?.checks?.nativeSurfaceHwndAvailable === true &&
      nativeHwndPasteLive?.checks?.singleLineLfNormalizedAndExecuted === true &&
      nativeHwndPasteLive?.checks?.destructivePasteBlockedBeforePty === true &&
      nativeHwndPasteLive?.checks?.multilinePasteBlockedBeforePty === true) ||
      nativePasteGuardFresh,
    "live Windows WM_PASTE proof behaviorally verifies native HWND focus, allowed paste execution, and blocked paste no-PTY-write paths through either the CDP smoke or the Rust aether-native paste-guard proof",
  ),
  check(
    "composition-surface",
    frontendNativeDefault &&
      webviewFallbackConditional &&
      nativeInput.includes("state.native_composition_surface_ready = true") &&
      nativeInput.includes("state.webview_composition_bridge_required = false"),
    "terminal composition is owned by a native input surface",
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? "pass" : "blocked",
  evidence: {
    nativeClientArtifactPath,
    nativeClientFresh,
    nativePasteGuardFresh,
    nativeHwndPasteLiveArtifactPath,
    nativeHwndPasteLiveFresh,
  },
  checks,
  blockers: failed.map((item) => item.detail),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
