import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function check(id, passed, detail) {
  return { id, status: passed ? "passed" : "failed", detail };
}

const nativeInput = source("src-tauri/src/term/native_input.rs");
const commands = source("src-tauri/src/ipc/commands.rs");
const lib = source("src-tauri/src/lib.rs");
const canvasIme = source("src/features/terminal/hooks/useCanvasIME.ts");
const terminalCanvas = source("src/features/terminal/TerminalCanvas.tsx");

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
      commands.includes("terminal_write_async(&app, &terminal_id, &bytes)"),
    "committed input routes through the Rust terminal write path",
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
      lib.includes("ipc::native_terminal_input_focus") &&
      lib.includes("ipc::native_terminal_input_drain"),
    "native HWND input surface focus/drain IPC is exposed",
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
      canvasIme.includes("native_terminal_input_drain"),
    "frontend has an opt-in native input surface path",
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
  checks,
  blockers: failed.map((item) => item.detail),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
