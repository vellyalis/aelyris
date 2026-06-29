import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = process.platform === "win32" ? ".exe" : "";
const bundledSidecar = join(
  root,
  "src-tauri",
  "binaries",
  process.platform === "win32" ? "aelyris-pty-server-x86_64-pc-windows-msvc.exe" : "aelyris-pty-server",
);
const releaseSidecar = join(root, "src-tauri", "pty-server", "target", "release", `aelyris-pty-server${extension}`);
const sidecar =
  process.env.AELYRIS_NATIVE_CLIENT_SIDECAR ??
  (existsSync(bundledSidecar) ? bundledSidecar : releaseSidecar);
const out =
  process.env.AELYRIS_NATIVE_CLIENT_OUT ??
  join(root, ".codex-auto", "quality", "native-client-spike.json");
const token = process.env.AELYRIS_NATIVE_CLIENT_TOKEN ?? "native-client-spike-token";
const cargoManifest = join(root, "src-tauri", "Cargo.toml");
const nativeBin = join(root, "src-tauri", "target", "debug", `aelyris-native${extension}`);

if (!existsSync(sidecar)) {
  throw new Error(`PTY sidecar not found: ${sidecar}\nRun "node scripts/build-pty-sidecar.mjs" first.`);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => (port ? resolve(port) : reject(new Error("no port assigned"))));
    });
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${body}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

async function waitForReady(base) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 7_500) {
    try {
      return await request(base, "/daemon/contract");
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`sidecar did not become ready: ${lastError?.message ?? "unknown"}`);
}

function startSidecar(port, muxDir, scrollbackDir) {
  if (process.platform === "win32" && process.env.AELYRIS_NATIVE_CLIENT_USE_POWERSHELL_START === "1") {
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const command = [
      `$env:AELYRIS_API_TOKEN=${quote(token)};`,
      `$env:AELYRIS_PTY_SERVER_PORT=${quote(port)};`,
      `$env:AELYRIS_MUX_SNAPSHOT_DIR=${quote(muxDir)};`,
      `$env:AELYRIS_PTY_SCROLLBACK_DIR=${quote(scrollbackDir)};`,
      `$p=Start-Process -FilePath ${quote(sidecar)} -PassThru -WindowStyle Hidden;`,
      "Write-Output $p.Id",
    ].join(" ");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `PowerShell sidecar start failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    const pid = Number(result.stdout.match(/\d+/)?.[0]);
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error(`PowerShell sidecar start did not return a PID: ${result.stdout}`);
    }
    return {
      child: {
        pid,
        exitCode: null,
        signalCode: null,
        aelyrisStartedByPowerShell: true,
        kill() {
          spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        },
      },
      output: { stdout: `powershell-start-pid=${pid}`, stderr: "" },
    };
  }

  let child;
  try {
    child = spawn(sidecar, [], {
      cwd: root,
      env: {
        ...process.env,
        AELYRIS_API_TOKEN: token,
        AELYRIS_PTY_SERVER_PORT: String(port),
        AELYRIS_MUX_SNAPSHOT_DIR: muxDir,
        AELYRIS_PTY_SCROLLBACK_DIR: scrollbackDir,
      },
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`sidecar spawn failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const output = { stdout: "", stderr: "" };
  return { child, output };
}

const expectedModeShell = [
  ["terminal", "Alt+1", "pane", "mux-daemon", "pane:active"],
  ["agents", "Alt+2", "agent-session", "ai-cli-orchestrator", "agent:active"],
  ["workspace", "Alt+3", "workspace-item", "project-index", "workspace:selected"],
  ["review", "Alt+4", "review-queue", "command-center", "review:ready"],
  ["git", "Alt+5", "git-worktree", "git2", "git:worktree"],
  ["context", "Alt+6", "context-pack", "context-index", "context:active"],
  ["history", "Alt+7", "history-index", "sqlite-scrollback", "history:recent-command"],
  ["settings", "Alt+8", "settings-profile", "rust-config", "settings:active-profile"],
];

function expectedModeIds() {
  return expectedModeShell.map(([id]) => id);
}

function expectedModeShortcuts() {
  return expectedModeShell.map(([, shortcut]) => shortcut);
}

function expectedRoute(mode) {
  const entry = expectedModeShell.find(([id]) => id === mode);
  if (!entry) return null;
  return {
    kind: entry[2],
    source: entry[3],
    route: entry[4],
    owner: "rust",
  };
}

function assertModeShellRoute(actual, mode) {
  const expected = expectedRoute(mode);
  assert(expected, `unknown expected mode shell route: ${mode}`);
  assert(actual?.kind === expected.kind, `native mode shell ${mode} route kind mismatch`);
  assert(actual?.source === expected.source, `native mode shell ${mode} route source mismatch`);
  assert(actual?.route === expected.route, `native mode shell ${mode} route path mismatch`);
  assert(actual?.owner === expected.owner, `native mode shell ${mode} route owner mismatch`);
}

function assertNativeSleepResumeRunbook(actions) {
  assert(Array.isArray(actions), "native command center actions must be an array");
  const required = new Map([
    ["open-sleep-resume-preflight", "open-native-sleep-resume-preflight"],
    ["arm-native-sleep-resume", "run-proof"],
    ["verify-native-sleep-guard", "run-proof"],
    ["check-native-postcheck-readiness", "run-proof"],
    ["run-native-user-sleep-cycle", "run-user-initiated-host-power-proof"],
    ["run-native-sleep-cycle", "run-guarded-host-power-proof"],
    ["record-native-resume", "run-proof"],
    ["run-native-postcheck", "run-proof"],
    ["run-full-native-audit", "run-proof"],
  ]);
  for (const [id, operation] of required) {
    const action = actions.find((entry) => entry?.id === id);
    assert(action, `native sleep/resume runbook action missing: ${id}`);
    assert(action.operation === operation, `native sleep/resume runbook action operation mismatch: ${id}`);
    assert(action.requiresReact === false, `native sleep/resume runbook action must not require React: ${id}`);
    assert(action.requiresWebView === false, `native sleep/resume runbook action must not require WebView: ${id}`);
  }
  const guarded = actions.find((entry) => entry?.id === "run-native-sleep-cycle");
  const userInitiated = actions.find((entry) => entry?.id === "run-native-user-sleep-cycle");
  const guardVerifier = actions.find((entry) => entry?.id === "verify-native-sleep-guard");
  assert(
    guardVerifier?.provesExplicitOptInBoundary === true,
    "native sleep guard verifier must prove the explicit opt-in boundary",
  );
  assert(
    guardVerifier?.evidencePath === ".codex-auto/production-smoke/native-sleep-guard-refusal.json",
    "native sleep guard verifier evidence path missing",
  );
  assert(guarded?.requiresExplicitOptIn === true, "guarded native sleep cycle must require explicit opt-in");
  assert(
    guarded?.explicitOptInEnv === "AELYRIS_ALLOW_OS_SLEEP=1",
    "guarded native sleep cycle opt-in env missing",
  );
  assert(
    userInitiated?.command === "pnpm verify:production:suspend:native-user-cycle",
    "user-initiated native sleep cycle command missing",
  );
  assert(
    userInitiated?.requiresUserSleepAction === true && userInitiated?.doesNotInvokeSleepApi === true,
    "user-initiated native sleep cycle must wait for manual sleep without invoking sleep API",
  );
}

function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (child.aelyrisStartedByPowerShell && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.exitCode = 0;
    return;
  }
  child.kill();
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

function nearlyEqual(actual, expected, epsilon = 0.001) {
  return Math.abs(Number(actual) - expected) <= epsilon;
}

function buildNativeBinary() {
  if (process.env.AELYRIS_NATIVE_CLIENT_FORCE_BUILD !== "1" && existsSync(nativeBin)) {
    return;
  }
  const result = spawnSync("cargo", ["build", "--quiet", "--manifest-path", cargoManifest, "--bin", "aelyris-native"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 600_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`cargo build spawn failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`cargo build aelyris-native failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  if (!existsSync(nativeBin)) {
    throw new Error(`aelyris-native binary not found after build: ${nativeBin}`);
  }
}

async function runNative(base, args) {
  return await new Promise((resolve, reject) => {
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stdoutPath = join(root, ".codex-auto", "quality", `native-client-stdout-${runId}.json`);
    const stderrPath = join(root, ".codex-auto", "quality", `native-client-stderr-${runId}.txt`);
    mkdirSync(dirname(stdoutPath), { recursive: true });
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    let closed = false;
    const closeFiles = () => {
      if (closed) return;
      closed = true;
      closeSync(stdoutFd);
      closeSync(stderrFd);
    };
    const cleanupFiles = () => {
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
    };
    let child;
    try {
      child = spawn(nativeBin, args, {
        cwd: root,
        env: {
          ...process.env,
          AELYRIS_API_URL: base,
          AELYRIS_API_TOKEN: token,
        },
        shell: false,
        stdio: ["ignore", stdoutFd, stderrFd],
        windowsHide: true,
      });
    } catch (error) {
      closeFiles();
      cleanupFiles();
      reject(new Error(`aelyris-native spawn failed for ${args.join(" ")}: ${error.message}`));
      return;
    }
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      closeFiles();
      reject(new Error(`aelyris-native ${args.join(" ")} timed out`));
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      closeFiles();
      cleanupFiles();
      reject(new Error(`aelyris-native spawn failed for ${args.join(" ")}: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      closeFiles();
      const stdout = readFileSync(stdoutPath, "utf8");
      const stderr = readFileSync(stderrPath, "utf8");
      cleanupFiles();
      if (code !== 0) {
        reject(new Error(`aelyris-native ${args.join(" ")} failed with ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`aelyris-native ${args.join(" ")} returned invalid JSON: ${error.message}\n${stdout}`));
      }
    });
  });
}

function paneRecords(graph) {
  const workspace = graph.workspaces?.[graph.activeWorkspaceId];
  const window = workspace?.windows?.[workspace.activeWindowId];
  const tab = window?.tabs?.[window.activeTabId];
  return Object.values(tab?.panes ?? {});
}

function isLiveAttachedPane(pane) {
  return (
    ["active", "attached"].includes(String(pane.lifecycle ?? "")) &&
    typeof pane.pty?.terminalId === "string" &&
    pane.pty.terminalId.length > 0 &&
    !pane.pty.terminalId.startsWith("restore-pending:")
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

async function waitForNativeCapture(base, id, needle) {
  let capture = null;
  for (let i = 0; i < 80; i += 1) {
    capture = await runNative(base, ["capture", id, "--lines", "100"]);
    if (capture?.capture?.text?.includes(needle)) return capture;
    await sleep(100);
  }
  throw new Error(`native capture did not contain ${needle}: ${capture?.capture?.text?.slice?.(-500) ?? ""}`);
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tempRoot = join(root, ".codex-auto", "quality", `native-client-spike-${Date.now()}`);
  const muxDir = join(tempRoot, "mux");
  const scrollbackDir = join(tempRoot, "scrollback");
  mkdirSync(muxDir, { recursive: true });
  mkdirSync(scrollbackDir, { recursive: true });

  const report = {
    status: "running",
    sidecar,
    base,
    checks: [],
    errors: [],
    directContract: null,
    nativeContract: null,
    nativeWindow: null,
    nativeRender: null,
    nativeGridRender: null,
    nativePresentLoop: null,
    nativeGpuRender: null,
    nativeWinitWgpu: null,
    nativeImeDogfood: null,
    nativeImeOsDogfood: null,
    nativePasteGuard: null,
    nativeCommandCenter: null,
    nativeCommandCenterWindow: null,
    nativeCommandCenterInputScroll: null,
    nativeSettingsWindow: null,
    nativeModeShell: null,
    nativeModeRailWindow: null,
    nativeInspectorWindow: null,
    nativeRightRailDemotion: null,
    nativeAccessibility: null,
    nativeVisualQa: null,
    nativePrimaryShell: null,
    nativeList: null,
    nativeCapture: null,
    nativeAttach: null,
    nativeDetach: null,
    sidecarOutput: null,
  };
  let daemon = null;

  try {
    daemon = startSidecar(port, muxDir, scrollbackDir);
    const directContract = await waitForReady(base);
    report.directContract = directContract;
    report.checks.push("daemon-ready");
    buildNativeBinary();
    report.checks.push("native-binary-built");

    const nativeContract = await runNative(base, ["contract"]);
    report.nativeContract = nativeContract;
    assert(nativeContract.schema === "aelyris.native.client.v1", "native contract schema missing");
    assert(nativeContract.client?.process === "aelyris-native", "native process identity missing");
    assert(nativeContract.client?.uiBoundary === "no-webview", "native client must not claim WebView ownership");
    assert(nativeContract.claims?.webviewUsed === false, "native client contract must explicitly reject WebView use");
    assert(nativeContract.claims?.muxTruthSource === "daemon-api", "native client must attach to daemon API truth");
    assert(
      nativeContract.daemon?.instanceId === directContract.instanceId,
      "native client must target the same daemon instance",
    );
    report.checks.push("native-contract-attaches-same-daemon");
    report.checks.push("native-client-no-webview-boundary");

    const nativeWindow = await runNative(base, ["window-proof", "--duration-ms", "120", "--alpha", "218"]);
    report.nativeWindow = {
      operation: nativeWindow.operation,
      daemonInstanceId: nativeWindow.daemon?.instanceId,
      window: nativeWindow.window,
    };
    assert(nativeWindow.operation === "window-proof", "native window proof operation missing");
    assert(
      nativeWindow.daemon?.instanceId === directContract.instanceId,
      "native window proof must use the same daemon instance",
    );
    assert(nativeWindow.window?.nativeWindowCreated === true, "native Win32 window was not created");
    assert(nativeWindow.window?.webviewUsed === false, "native window proof must not use WebView");
    assert(nativeWindow.window?.reactUsed === false, "native window proof must not use React");
    assert(nativeWindow.window?.layered === true, "native window proof must enable layered transparency");
    assert(nativeWindow.window?.alpha === 218, "native window proof must preserve requested alpha");
    assert(nativeWindow.window?.processIdentity?.process === "aelyris-native", "native window process identity missing");
    report.checks.push("native-window-proof-no-webview");
    report.checks.push("native-window-layered-alpha");

    const created = await request(base, "/sessions", {
      method: "POST",
      body: JSON.stringify({ shell: "cmd", cols: 100, rows: 24, cwd: root }),
    });
    const workspaceId = created.id;
    const nativeList = await runNative(base, ["list"]);
    report.nativeList = {
      schema: nativeList.schema,
      workspaceCount: Array.isArray(nativeList.workspaces) ? nativeList.workspaces.length : null,
      daemonInstanceId: nativeList.daemon?.instanceId,
    };
    assert(
      Array.isArray(nativeList.workspaces) && nativeList.workspaces.some((workspace) => workspace.id === workspaceId),
      "native list should show the created workspace",
    );
    report.checks.push("native-list-reads-mux-workspaces");

    const marker = `aelyris-native-client-${Date.now()}`;
    await runNative(base, ["send", workspaceId, "echo", marker, "--enter"]);
    const nativeCapture = await waitForNativeCapture(base, workspaceId, marker);
    report.nativeCapture = {
      sessionId: workspaceId,
      containsMarker: nativeCapture.capture.text.includes(marker),
      textTail: nativeCapture.capture.text.slice(-300),
    };
    report.checks.push("native-send-and-capture-roundtrip");

    const nativeRender = await runNative(base, [
      "render-proof",
      "--session",
      workspaceId,
      "--expect",
      marker,
      "--lines",
      "100",
      "--duration-ms",
      "120",
      "--alpha",
      "218",
    ]);
    report.nativeRender = {
      operation: nativeRender.operation,
      daemonInstanceId: nativeRender.daemon?.instanceId,
      source: nativeRender.source,
      renderer: nativeRender.renderer,
      window: nativeRender.window,
    };
    assert(nativeRender.operation === "render-proof", "native render proof operation missing");
    assert(
      nativeRender.daemon?.instanceId === directContract.instanceId,
      "native render proof must use the same daemon instance",
    );
    assert(nativeRender.source?.capture?.sessionId === workspaceId, "native render proof must read session capture");
    assert(nativeRender.source?.expectedFound === true, "native render proof must render captured marker text");
    assert(nativeRender.renderer?.terminalRenderer === "native-gdi-text-proof", "native renderer proof missing");
    assert(nativeRender.renderer?.webviewUsed === false, "native render proof must not use WebView");
    assert(nativeRender.renderer?.reactUsed === false, "native render proof must not use React");
    assert(nativeRender.renderer?.nativeTextDrawn === true, "native render proof did not draw text");
    assert(nativeRender.renderer?.nonBlank === true, "native render proof did not produce nonblank pixels");
    assert(nativeRender.renderer?.nonBackgroundSamples > 0, "native render proof did not sample text pixels");
    assert(nativeRender.window?.nativeWindowCreated === true, "native render proof must keep native window proof green");
    assert(nativeRender.window?.webviewUsed === false, "native render window proof must not use WebView");
    report.checks.push("native-render-proof-uses-daemon-capture");
    report.checks.push("native-render-proof-nonblank-text");

    const nativeGridRender = await runNative(base, [
      "grid-render-proof",
      "--session",
      workspaceId,
      "--expect",
      marker,
      "--cols",
      "100",
      "--rows",
      "24",
      "--lines",
      "100",
      "--duration-ms",
      "120",
      "--alpha",
      "218",
    ]);
    report.nativeGridRender = {
      operation: nativeGridRender.operation,
      daemonInstanceId: nativeGridRender.daemon?.instanceId,
      source: nativeGridRender.source,
      grid: nativeGridRender.grid,
      renderFrame: nativeGridRender.renderFrame,
      renderDiff: nativeGridRender.renderDiff,
      renderCommit: nativeGridRender.renderCommit,
      renderCommitSeries: nativeGridRender.renderCommitSeries,
      renderer: nativeGridRender.renderer,
      window: nativeGridRender.window,
    };
    assert(nativeGridRender.operation === "grid-render-proof", "native grid render proof operation missing");
    assert(
      nativeGridRender.daemon?.instanceId === directContract.instanceId,
      "native grid render proof must use the same daemon instance",
    );
    assert(nativeGridRender.source?.capture?.sessionId === workspaceId, "native grid proof must read session capture");
    assert(nativeGridRender.source?.expectedFound === true, "native grid proof must include captured marker text");
    assert(nativeGridRender.grid?.cols === 100, "native grid proof must use requested columns");
    assert(nativeGridRender.grid?.rows === 24, "native grid proof must use requested rows");
    assert(nativeGridRender.grid?.nonBlankCells > 0, "native grid proof must produce nonblank cells");
    assert(nativeGridRender.renderFrame?.schema === "aelyris.native.render-frame.v1", "native render frame schema missing");
    assert(nativeGridRender.renderFrame?.rendererBoundary === "rust-native-render-frame", "native render frame boundary missing");
    assert(nativeGridRender.renderFrame?.webviewUsed === false, "native render frame must not use WebView");
    assert(nativeGridRender.renderFrame?.reactUsed === false, "native render frame must not use React");
    assert(nativeGridRender.renderFrame?.frameSha256?.length === 64, "native render frame must include a stable hash");
    assert(nativeGridRender.renderDiff?.schema === "aelyris.native.render-diff.v1", "native render diff schema missing");
    assert(
      nativeGridRender.renderDiff?.currentFrameSha256 === nativeGridRender.renderFrame?.frameSha256,
      "native render diff must target the current render frame hash",
    );
    assert(nativeGridRender.renderDiff?.rendererBoundary === "rust-native-render-frame-diff", "native render diff boundary missing");
    assert(nativeGridRender.renderDiff?.webviewUsed === false, "native render diff must not use WebView");
    assert(nativeGridRender.renderDiff?.reactUsed === false, "native render diff must not use React");
    assert(nativeGridRender.renderDiff?.dirtyCells > 0, "native render diff must expose dirty cells");
    assert(nativeGridRender.renderDiff?.dirtyRects?.length > 0, "native render diff must expose dirty rects");
    assert(nativeGridRender.renderCommit?.schema === "aelyris.native.render-commit.v1", "native render commit schema missing");
    assert(nativeGridRender.renderCommit?.rendererBoundary === "rust-native-render-pipeline", "native render commit boundary missing");
    assert(nativeGridRender.renderCommit?.webviewUsed === false, "native render commit must not use WebView");
    assert(nativeGridRender.renderCommit?.reactUsed === false, "native render commit must not use React");
    assert(nativeGridRender.renderCommit?.sequence === 2, "native render commit must advance from baseline to current frame");
    assert(nativeGridRender.renderCommit?.repaintMode === "partial", "native render commit must expose partial repaint mode");
    assert(
      nativeGridRender.renderCommit?.frame?.frameSha256 === nativeGridRender.renderFrame?.frameSha256,
      "native render commit frame hash must match render frame hash",
    );
    assert(
      nativeGridRender.renderCommit?.diff?.currentFrameSha256 === nativeGridRender.renderFrame?.frameSha256,
      "native render commit diff must target the current render frame hash",
    );
    assert(nativeGridRender.renderCommit?.diff?.dirtyRects?.length > 0, "native render commit must expose dirty rects");
    assert(
      Array.isArray(nativeGridRender.renderCommitSeries) && nativeGridRender.renderCommitSeries.length === 3,
      "native render commit series must include baseline, current, and stable commits",
    );
    const [baselineCommit, currentCommit, stableCommit] = nativeGridRender.renderCommitSeries ?? [];
    assert(baselineCommit?.sequence === 1, "native render baseline commit must be sequence 1");
    assert(baselineCommit?.repaintMode === "full", "native render baseline commit must be a full repaint");
    assert(baselineCommit?.diff?.fullRepaint === true, "native render baseline commit must mark full repaint");
    assert(currentCommit?.sequence === 2, "native render current commit must be sequence 2");
    assert(currentCommit?.repaintMode === "partial", "native render current commit must be partial");
    assert(currentCommit?.frame?.frameSha256 === nativeGridRender.renderFrame?.frameSha256, "current commit hash mismatch");
    assert(stableCommit?.sequence === 3, "native render stable commit must be sequence 3");
    assert(stableCommit?.repaintMode === "unchanged", "native render stable commit must be unchanged");
    assert(stableCommit?.diff?.dirtyCells === 0, "native render stable commit must have zero dirty cells");
    assert(stableCommit?.frame?.frameSha256 === nativeGridRender.renderFrame?.frameSha256, "stable commit hash mismatch");
    assert(nativeGridRender.renderer?.terminalRenderer === "native-gdi-grid-proof", "native grid renderer proof missing");
    assert(
      nativeGridRender.renderer?.renderFrameSha256 === nativeGridRender.renderFrame?.frameSha256,
      "native grid renderer must consume the same render frame hash",
    );
    assert(
      nativeGridRender.renderer?.rendererBoundary === "rust-native-render-frame",
      "native grid renderer must expose the Rust render-frame boundary",
    );
    assert(nativeGridRender.renderer?.nativeCellGrid === true, "native grid proof must render cells");
    assert(nativeGridRender.renderer?.webviewUsed === false, "native grid proof must not use WebView");
    assert(nativeGridRender.renderer?.reactUsed === false, "native grid proof must not use React");
    assert(nativeGridRender.renderer?.nonBlank === true, "native grid proof did not produce nonblank pixels");
    assert(nativeGridRender.renderer?.nonBackgroundSamples > 0, "native grid proof did not sample text pixels");
    assert(nativeGridRender.window?.nativeWindowCreated === true, "native grid proof must keep native window proof green");
    report.checks.push("native-grid-render-proof-uses-term-engine");
    report.checks.push("native-grid-render-proof-nonblank-cells");
    report.checks.push("native-render-frame-contract");
    report.checks.push("native-render-diff-contract");
    report.checks.push("native-render-pipeline-contract");
    report.checks.push("native-render-commit-series-contract");

    const nativePresentLoop = await runNative(base, [
      "present-loop-proof",
      "--session",
      workspaceId,
      "--expect",
      marker,
      "--cols",
      "100",
      "--rows",
      "24",
      "--lines",
      "100",
      "--duration-ms",
      "180",
      "--alpha",
      "218",
    ]);
    report.nativePresentLoop = {
      operation: nativePresentLoop.operation,
      daemonInstanceId: nativePresentLoop.daemon?.instanceId,
      source: nativePresentLoop.source,
      renderFrame: nativePresentLoop.renderFrame,
      presentLoop: nativePresentLoop.presentLoop,
    };
    assert(nativePresentLoop.operation === "present-loop-proof", "native present-loop proof operation missing");
    assert(
      nativePresentLoop.daemon?.instanceId === directContract.instanceId,
      "native present-loop proof must use the same daemon instance",
    );
    assert(nativePresentLoop.source?.capture?.sessionId === workspaceId, "native present loop must read session capture");
    assert(nativePresentLoop.source?.expectedFound === true, "native present loop must include captured marker text");
    assert(nativePresentLoop.renderFrame?.schema === "aelyris.native.render-frame.v1", "native present loop frame missing");
    assert(nativePresentLoop.presentLoop?.terminalRenderer === "native-win32-present-loop-proof", "native present loop renderer missing");
    assert(nativePresentLoop.presentLoop?.presentLoop === true, "native present loop flag missing");
    assert(nativePresentLoop.presentLoop?.interactiveWindow === true, "native present loop did not create an interactive window");
    assert(nativePresentLoop.presentLoop?.framesPresented >= 2, "native present loop should present multiple frames");
    assert(nativePresentLoop.presentLoop?.drawCalls > 0, "native present loop did not draw terminal text");
    assert(nativePresentLoop.presentLoop?.nonBlank === true, "native present loop did not produce nonblank pixels");
    assert(nativePresentLoop.presentLoop?.webviewUsed === false, "native present loop must not use WebView");
    assert(nativePresentLoop.presentLoop?.reactUsed === false, "native present loop must not use React");
    assert(
      nativePresentLoop.presentLoop?.renderFrameSha256 === nativePresentLoop.renderFrame?.frameSha256,
      "native present loop must consume the same render frame hash",
    );
    assert(nativePresentLoop.presentLoop?.nextRenderer === "winit-wgpu-present-loop", "native present loop next renderer policy missing");
    writeJsonAtomic(join(root, ".codex-auto", "quality", "native-present-loop-proof.json"), nativePresentLoop);
    report.checks.push("native-present-loop-proof");
    report.checks.push("native-present-loop-nonblank-frames");

    const nativeGpuRender = await runNative(base, [
      "gpu-render-proof",
      "--session",
      workspaceId,
      "--expect",
      marker,
      "--cols",
      "100",
      "--rows",
      "24",
      "--lines",
      "100",
    ]);
    report.nativeGpuRender = {
      operation: nativeGpuRender.operation,
      daemonInstanceId: nativeGpuRender.daemon?.instanceId,
      source: nativeGpuRender.source,
      renderFrame: nativeGpuRender.renderFrame,
      gpu: nativeGpuRender.gpu,
    };
    assert(nativeGpuRender.operation === "gpu-render-proof", "native GPU render proof operation missing");
    assert(
      nativeGpuRender.daemon?.instanceId === directContract.instanceId,
      "native GPU render proof must use the same daemon instance",
    );
    assert(nativeGpuRender.source?.capture?.sessionId === workspaceId, "native GPU render proof must read session capture");
    assert(nativeGpuRender.source?.expectedFound === true, "native GPU render proof must include captured marker text");
    assert(nativeGpuRender.renderFrame?.schema === "aelyris.native.render-frame.v1", "native GPU render frame schema missing");
    assert(nativeGpuRender.gpu?.terminalRenderer === "wgpu-offscreen-frame-proof", "native GPU renderer proof missing");
    assert(nativeGpuRender.gpu?.gpuRenderer === true, "native GPU renderer flag missing");
    assert(nativeGpuRender.gpu?.drawCalls === 1, "native GPU render proof must submit one draw call");
    assert(nativeGpuRender.gpu?.vertices === 3, "native GPU render proof must draw the proof triangle");
    assert(nativeGpuRender.gpu?.webviewUsed === false, "native GPU render proof must not use WebView");
    assert(nativeGpuRender.gpu?.reactUsed === false, "native GPU render proof must not use React");
    assert(
      nativeGpuRender.gpu?.renderFrameSha256 === nativeGpuRender.renderFrame?.frameSha256,
      "native GPU renderer must consume the same render frame hash",
    );
    assert(
      nativeGpuRender.gpu?.nextRenderer === "winit-wgpu-surface-present-loop",
      "native GPU proof must point to the visible winit/wgpu surface next step",
    );
    report.checks.push("native-gpu-render-proof");
    report.checks.push("native-gpu-render-frame-contract");

    const nativeWinitWgpu = await runNative(base, [
      "winit-wgpu-proof",
      "--session",
      workspaceId,
      "--expect",
      marker,
      "--cols",
      "100",
      "--rows",
      "24",
      "--lines",
      "100",
      "--duration-ms",
      "180",
    ]);
    report.nativeWinitWgpu = {
      operation: nativeWinitWgpu.operation,
      daemonInstanceId: nativeWinitWgpu.daemon?.instanceId,
      source: nativeWinitWgpu.source,
      renderFrame: nativeWinitWgpu.renderFrame,
      winitWgpu: nativeWinitWgpu.winitWgpu,
    };
    assert(nativeWinitWgpu.operation === "winit-wgpu-proof", "native winit/wgpu proof operation missing");
    assert(
      nativeWinitWgpu.daemon?.instanceId === directContract.instanceId,
      "native winit/wgpu proof must use the same daemon instance",
    );
    assert(nativeWinitWgpu.source?.capture?.sessionId === workspaceId, "native winit/wgpu proof must read session capture");
    assert(nativeWinitWgpu.source?.expectedFound === true, "native winit/wgpu proof must include captured marker text");
    assert(nativeWinitWgpu.renderFrame?.schema === "aelyris.native.render-frame.v1", "native winit/wgpu frame schema missing");
    assert(nativeWinitWgpu.winitWgpu?.terminalRenderer === "native-winit-wgpu-terminal", "native winit/wgpu renderer missing");
    assert(nativeWinitWgpu.winitWgpu?.renderer === "winit-wgpu-surface-present-loop", "native winit/wgpu surface loop missing");
    assert(nativeWinitWgpu.winitWgpu?.gpuRenderer === true, "native winit/wgpu proof must be GPU-backed");
    assert(nativeWinitWgpu.winitWgpu?.presentableSurface === true, "native winit/wgpu proof must create a presentable surface");
    assert(nativeWinitWgpu.winitWgpu?.surfaceConfigured === true, "native winit/wgpu proof must configure the swapchain");
    assert(nativeWinitWgpu.winitWgpu?.framesPresented >= 2, "native winit/wgpu proof should present multiple frames");
    assert(nativeWinitWgpu.winitWgpu?.drawCalls >= 2, "native winit/wgpu proof should submit draw calls");
    assert(nativeWinitWgpu.winitWgpu?.glyphMode === "font-atlas", "native winit/wgpu proof must use the native font atlas glyph renderer");
    assert(nativeWinitWgpu.winitWgpu?.fontAtlas === true, "native winit/wgpu proof must expose font atlas rendering");
    assert(nativeWinitWgpu.winitWgpu?.fontAtlasGlyphs > 0, "native winit/wgpu proof must rasterize glyphs into the font atlas");
    assert(nativeWinitWgpu.winitWgpu?.fontAtlasFontPath, "native winit/wgpu proof must record the native font path");
    assert(nativeWinitWgpu.winitWgpu?.terminalGlyphQuads > 0, "native winit/wgpu proof must render terminal glyph quads");
    assert(nativeWinitWgpu.winitWgpu?.cursorQuads >= 1, "native winit/wgpu proof must render a cursor quad");
    assert(nativeWinitWgpu.winitWgpu?.dirtyRectDogfood === true, "native winit/wgpu proof must consume dirty rects");
    assert(nativeWinitWgpu.winitWgpu?.dirtyRectsRendered > 0, "native winit/wgpu proof must render dirty rect overlays");
    assert(nativeWinitWgpu.winitWgpu?.dirtyCells > 0, "native winit/wgpu proof must expose dirty cell count");
    assert(nativeWinitWgpu.winitWgpu?.webviewUsed === false, "native winit/wgpu proof must not use WebView");
    assert(nativeWinitWgpu.winitWgpu?.reactUsed === false, "native winit/wgpu proof must not use React");
    assert(
      nativeWinitWgpu.winitWgpu?.renderFrameSha256 === nativeWinitWgpu.renderFrame?.frameSha256,
      "native winit/wgpu renderer must consume the same render frame hash",
    );
    assert(
      nativeWinitWgpu.winitWgpu?.nextRenderer === "native-ime-dogfood-terminal-input",
      "native winit/wgpu proof must point to native IME dogfood next",
    );
    writeJsonAtomic(join(root, ".codex-auto", "quality", "native-winit-wgpu-proof.json"), nativeWinitWgpu);
    report.checks.push("native-winit-wgpu-surface-proof");
    report.checks.push("native-winit-wgpu-frame-contract");
    report.checks.push("native-winit-wgpu-dirty-rect-cell-proof");
    report.checks.push("native-winit-wgpu-cursor-cell-proof");
    report.checks.push("native-winit-wgpu-font-atlas-proof");

    const nativeIme = await runNative(base, [
      "ime-proof",
      "--prompt",
      "PS C:\\Aelyris> ",
      "--preedit",
      "あああ",
      "--commit",
      "あいう",
      "--cols",
      "100",
      "--rows",
      "24",
    ]);
    report.nativeIme = {
      operation: nativeIme.operation,
      ime: nativeIme.ime,
      renderFrame: nativeIme.renderFrame,
    };
    assert(nativeIme.operation === "ime-proof", "native IME proof operation missing");
    assert(nativeIme.ime?.schema === "aelyris.native.ime-proof.v1", "native IME proof schema missing");
    assert(nativeIme.ime?.mode === "state-machine-proof", "native IME proof must be honest about proof mode");
    assert(nativeIme.ime?.nativeImeStateMachine === true, "native IME state machine proof missing");
    assert(nativeIme.ime?.nativePreeditOverlay === true, "native IME preedit overlay proof missing");
    assert(nativeIme.ime?.nativeCommitPath === true, "native IME commit proof missing");
    assert(nativeIme.ime?.preedit?.active === true, "native IME preedit state should be active before commit");
    assert(nativeIme.ime?.preedit?.text === "あああ", "native IME preedit text missing");
    assert(nativeIme.ime?.preedit?.textChars === 3, "native IME preedit char count missing");
    assert(nativeIme.ime?.preedit?.anchorWidthPx > 0, "native IME preedit anchor width missing");
    assert(nativeIme.ime?.commit?.active === false, "native IME commit state should end composition");
    assert(nativeIme.ime?.commit?.text === "あいう", "native IME commit text missing");
    assert(nativeIme.ime?.committedLineVisible === true, "native IME commit should be visible in the Rust render frame");
    assert(nativeIme.ime?.webviewUsed === false, "native IME proof must not use WebView");
    assert(nativeIme.ime?.reactUsed === false, "native IME proof must not use React");
    assert(nativeIme.ime?.realOsImeDogfood === false, "native IME proof must not claim live OS IME dogfood yet");
    report.checks.push("native-ime-state-machine-proof");
    report.checks.push("native-ime-preedit-anchor-proof");
    report.checks.push("native-ime-commit-render-frame-proof");

    const nativeImeDogfood = await runNative(base, ["ime-dogfood-proof", "--commit", "あいう"]);
    report.nativeImeDogfood = {
      operation: nativeImeDogfood.operation,
      imeDogfood: nativeImeDogfood.imeDogfood,
    };
    assert(nativeImeDogfood.operation === "ime-dogfood-proof", "native IME dogfood operation missing");
    assert(
      nativeImeDogfood.imeDogfood?.schema === "aelyris.native.ime-dogfood-proof.v1",
      "native IME dogfood schema missing",
    );
    assert(nativeImeDogfood.imeDogfood?.nativeHwndImeDogfood === true, "native HWND IME dogfood missing");
    assert(
      nativeImeDogfood.imeDogfood?.mode === "native-hwnd-message-loop-dogfood",
      "native IME dogfood mode mismatch",
    );
    assert(
      nativeImeDogfood.imeDogfood?.nativeCompositionSurfaceReady === true,
      "native composition surface should be ready",
    );
    assert(
      nativeImeDogfood.imeDogfood?.webviewCompositionBridgeRequired === false,
      "native IME dogfood must not need WebView composition bridge",
    );
    assert(
      nativeImeDogfood.imeDogfood?.imeStartCompositionObserved === true,
      "native IME start composition event should be observed",
    );
    assert(nativeImeDogfood.imeDogfood?.committedText === "あいう", "native IME dogfood commit text missing");
    assert(nativeImeDogfood.imeDogfood?.committedTextMatches === true, "native IME dogfood commit mismatch");
    assert(nativeImeDogfood.imeDogfood?.directPtyCommitCount === 1, "native IME dogfood commit count missing");
    assert(nativeImeDogfood.imeDogfood?.aiCliPromptRows?.length === 3, "native IME AI CLI matrix missing");
    assert(
      nativeImeDogfood.imeDogfood?.aiCliPromptRows?.every?.(
        (row) => ["codex", "claude", "gemini"].includes(row.provider) && row.committedLineVisible === true,
      ),
      "native IME AI CLI prompt-row dogfood incomplete",
    );
    assert(nativeImeDogfood.imeDogfood?.aiCliPromptDogfood === true, "native IME AI CLI dogfood flag missing");
    assert(nativeImeDogfood.imeDogfood?.webviewUsed === false, "native IME dogfood must not use WebView");
    assert(nativeImeDogfood.imeDogfood?.reactUsed === false, "native IME dogfood must not use React");
    assert(
      nativeImeDogfood.imeDogfood?.realOsImeDogfood === false,
      "native HWND dogfood must not overclaim real OS IME completion",
    );
    assert(
      nativeImeDogfood.imeDogfood?.nextProof === "real-os-ime-composition-dogfood",
      "native IME dogfood next proof missing",
    );
    report.checks.push("native-ime-hwnd-dogfood-proof");
    report.checks.push("native-ime-ai-cli-prompt-row-proof");
    report.checks.push("native-ime-dogfood-honesty-proof");

    const nativeImeOsDogfood = await runNative(base, [
      "ime-os-dogfood-proof",
      "--preedit",
      "あああ",
      "--commit",
      "あいう",
    ]);
    report.nativeImeOsDogfood = {
      operation: nativeImeOsDogfood.operation,
      imeOsDogfood: nativeImeOsDogfood.imeOsDogfood,
    };
    assert(nativeImeOsDogfood.operation === "ime-os-dogfood-proof", "native OS IME dogfood operation missing");
    assert(
      nativeImeOsDogfood.imeOsDogfood?.schema === "aelyris.native.ime-os-dogfood-proof.v1",
      "native OS IME dogfood schema missing",
    );
    assert(
      nativeImeOsDogfood.imeOsDogfood?.mode === "win32-imm32-composition-dogfood",
      "native OS IME dogfood mode mismatch",
    );
    assert(nativeImeOsDogfood.imeOsDogfood?.nativeOsImeDogfood === true, "native OS IME dogfood flag missing");
    assert(nativeImeOsDogfood.imeOsDogfood?.imeContextAvailable === true, "native OS IME context missing");
    assert(nativeImeOsDogfood.imeOsDogfood?.imeSetOpenStatusOk === true, "native OS IME open status failed");
    assert(nativeImeOsDogfood.imeOsDogfood?.immSetPreeditOk === true, "native OS IME preedit set failed");
    assert(nativeImeOsDogfood.imeOsDogfood?.immSetResultOk === true, "native OS IME result set failed");
    assert(nativeImeOsDogfood.imeOsDogfood?.immNotifyCompleteOk === true, "native OS IME completion notify failed");
    assert(
      nativeImeOsDogfood.imeOsDogfood?.nativeCompositionSurfaceReady === true &&
        nativeImeOsDogfood.imeOsDogfood?.webviewCompositionBridgeRequired === false,
      "native OS IME must use native composition surface",
    );
    assert(
      nativeImeOsDogfood.imeOsDogfood?.imeStartCompositionObserved === true &&
        nativeImeOsDogfood.imeOsDogfood?.nativeCompositionSurfaceReady === true,
      "native OS IME composition surface was not observed",
    );
    assert(
      nativeImeOsDogfood.imeOsDogfood?.preeditTextMatches === true ||
        nativeImeOsDogfood.imeOsDogfood?.manualJapaneseImeCandidateDogfood === false,
      "native OS IME preedit mismatch must stay tracked as manual Japanese candidate sweep work",
    );
    assert(nativeImeOsDogfood.imeOsDogfood?.committedText === "あいう", "native OS IME commit text missing");
    assert(nativeImeOsDogfood.imeOsDogfood?.committedTextMatches === true, "native OS IME commit mismatch");
    assert(nativeImeOsDogfood.imeOsDogfood?.directPtyCommitCount === 1, "native OS IME commit count missing");
    assert(
      nativeImeOsDogfood.imeOsDogfood?.aiCliPromptRows?.length === 3 &&
        nativeImeOsDogfood.imeOsDogfood.aiCliPromptRows.every(
          (row) => ["codex", "claude", "gemini"].includes(row.provider) && row.committedLineVisible === true,
        ),
      "native OS IME AI CLI prompt matrix missing",
    );
    assert(nativeImeOsDogfood.imeOsDogfood?.webviewUsed === false, "native OS IME dogfood must not use WebView");
    assert(nativeImeOsDogfood.imeOsDogfood?.reactUsed === false, "native OS IME dogfood must not use React");
    assert(nativeImeOsDogfood.imeOsDogfood?.realOsImeDogfood === true, "native OS IME dogfood flag missing");
    assert(
      nativeImeOsDogfood.imeOsDogfood?.guardrails?.noWmCharCommitFallback === true &&
        nativeImeOsDogfood.imeOsDogfood?.guardrails?.commitReadFromNativeImeResultString === true,
      "native OS IME dogfood guardrails missing",
    );
    assert(
      nativeImeOsDogfood.imeOsDogfood?.probeQuiescenceGuard?.serializesImm32Proofs === true &&
        nativeImeOsDogfood.imeOsDogfood?.probeQuiescenceGuard?.quietPeriodMs >= 12_000,
      "native OS IME proof must serialize Imm32 dogfood runs with a quiescence guard",
    );
    assert(
      nativeImeOsDogfood.imeOsDogfood?.manualJapaneseImeCandidateDogfood === false &&
        nativeImeOsDogfood.imeOsDogfood?.nextProof === "native-ime-manual-japanese-candidate-sweep",
      "native OS IME dogfood must be honest about manual candidate UI sweep",
    );
    report.checks.push("native-ime-os-composition-proof");
    report.checks.push("native-ime-os-result-commit-proof");
    report.checks.push("native-ime-os-ai-cli-prompt-proof");
    report.checks.push("native-ime-os-quiescence-guard-proof");

    const nativePasteGuard = await runNative(base, ["paste-guard-proof"]);
    report.nativePasteGuard = {
      operation: nativePasteGuard.operation,
      pasteGuard: nativePasteGuard.pasteGuard,
    };
    assert(nativePasteGuard.operation === "paste-guard-proof", "native paste guard operation missing");
    assert(
      nativePasteGuard.pasteGuard?.schema === "aelyris.native.paste-guard-proof.v1",
      "native paste guard schema missing",
    );
    assert(nativePasteGuard.pasteGuard?.nativePasteGuardProof === true, "native paste guard flag missing");
    assert(nativePasteGuard.pasteGuard?.nativeHwndWmPaste === true, "native WM_PASTE proof flag missing");
    assert(nativePasteGuard.pasteGuard?.nativeSurfaceHwnd, "native paste guard HWND missing");
    assert(nativePasteGuard.pasteGuard?.allCasesPass === true, "native paste guard cases failed");
    assert(
      nativePasteGuard.pasteGuard?.singleLineLfNormalizedAndExecuted === true,
      "native paste guard must normalize and drain allowed single-line LF paste",
    );
    assert(
      nativePasteGuard.pasteGuard?.destructivePasteBlockedBeforePty === true,
      "native paste guard must block destructive paste before PTY write",
    );
    assert(
      nativePasteGuard.pasteGuard?.multilinePasteBlockedBeforePty === true,
      "native paste guard must block multiline paste before PTY write",
    );
    assert(nativePasteGuard.pasteGuard?.webviewUsed === false, "native paste guard must not use WebView");
    assert(nativePasteGuard.pasteGuard?.reactUsed === false, "native paste guard must not use React");
    assert(nativePasteGuard.pasteGuard?.cdpUsed === false, "native paste guard must not use CDP");
    assert(nativePasteGuard.pasteGuard?.powershellUsed === false, "native paste guard must not use PowerShell");
    report.checks.push("native-paste-guard-proof");
    report.checks.push("native-paste-guard-wm-paste-proof");
    report.checks.push("native-paste-guard-no-cdp-proof");

    const nativeSettings = await runNative(base, [
      "settings-proof",
      "--theme",
      "sakura-hub",
      "--mood",
      "aelyris-sakura",
      "--wallpaper",
      "C:\\Images\\aelyris-native-sakura.jpg",
      "--opacity",
      "0.82",
      "--wallpaper-opacity",
      "0.24",
    ]);
    report.nativeSettings = {
      operation: nativeSettings.operation,
      settings: nativeSettings.settings,
    };
    assert(nativeSettings.operation === "settings-proof", "native settings proof operation missing");
    assert(nativeSettings.settings?.schema === "aelyris.native.settings-proof.v1", "native settings proof schema missing");
    assert(nativeSettings.settings?.nativeSettings === true, "native settings proof flag missing");
    assert(nativeSettings.settings?.webviewUsed === false, "native settings proof must not use WebView");
    assert(nativeSettings.settings?.reactUsed === false, "native settings proof must not use React");
    assert(nativeSettings.settings?.theme === "sakura-hub", "native settings theme did not persist");
    assert(nativeSettings.settings?.mood === "aelyris-sakura", "native settings mood did not persist");
    assert(nativeSettings.settings?.hotReloadProof?.changedWithoutReact === true, "native settings hot reload proof missing");
    assert(nativeSettings.settings?.paletteProof?.accentCount >= 3, "native settings palette overrides missing");
    assert(nativeSettings.settings?.materialProof?.panelColor === "#fff2f7", "native settings material override missing");
    assert(nativeSettings.settings?.wallpaperProof?.imagePath === "C:\\Images\\aelyris-native-sakura.jpg", "native settings wallpaper path missing");
    assert(nearlyEqual(nativeSettings.settings?.wallpaperProof?.opacity, 0.31), "native settings wallpaper hot reload opacity missing");
    assert(nativeSettings.settings?.wallpaperProof?.scale === 135, "native settings wallpaper scale missing");
    report.checks.push("native-settings-config-roundtrip-proof");
    report.checks.push("native-settings-hot-reload-proof");
    report.checks.push("native-settings-wallpaper-customization-proof");
    report.checks.push("native-settings-material-customization-proof");

    const nativeSettingsWindow = await runNative(base, [
      "settings-window-proof",
      "--theme",
      "sakura-hub",
      "--mood",
      "aelyris-sakura",
      "--wallpaper",
      "C:\\Images\\aelyris-native-sakura.jpg",
      "--opacity",
      "0.82",
      "--wallpaper-opacity",
      "0.24",
      "--duration-ms",
      "120",
      "--alpha",
      "236",
    ]);
    report.nativeSettingsWindow = {
      operation: nativeSettingsWindow.operation,
      settings: nativeSettingsWindow.settings,
      window: nativeSettingsWindow.window,
    };
    assert(nativeSettingsWindow.operation === "settings-window-proof", "native settings window proof operation missing");
    assert(
      nativeSettingsWindow.window?.schema === "aelyris.native.settings-window-proof.v1",
      "native settings window schema missing",
    );
    assert(nativeSettingsWindow.window?.nativeSettingsWindow === true, "native settings window flag missing");
    assert(
      nativeSettingsWindow.window?.nativeSettingsCustomization === true,
      "native settings customization flag missing",
    );
    assert(nativeSettingsWindow.window?.windowUi === true, "native settings window UI proof missing");
    assert(nativeSettingsWindow.window?.layered === true, "native settings window must be layered");
    assert(nativeSettingsWindow.window?.webviewUsed === false, "native settings window must not use WebView");
    assert(nativeSettingsWindow.window?.reactUsed === false, "native settings window must not use React");
    assert(nativeSettingsWindow.window?.controlRowsRendered >= 8, "native settings window controls missing");
    assert(
      nativeSettingsWindow.window?.controlHitTargets?.length >= 8,
      "native settings window hit targets missing",
    );
    assert(nativeSettingsWindow.window?.keyboardNavigation === true, "native settings keyboard navigation missing");
    assert(nativeSettingsWindow.window?.hotReloadBound === true, "native settings hot reload binding missing");
    assert(
      nativeSettingsWindow.window?.wallpaperControls?.includes?.("opacity") &&
        nativeSettingsWindow.window?.wallpaperControls?.includes?.("scale"),
      "native settings wallpaper controls missing",
    );
    assert(nativeSettingsWindow.window?.nonBlank === true, "native settings window should render nonblank pixels");
    assert(
      nativeSettingsWindow.window?.settingsUiStatus === "native-settings-window-ui",
      "native settings window status missing",
    );
    assert(
      nativeSettingsWindow.window?.readyForReactSettingsDemotion === true,
      "native settings should be ready for React settings demotion",
    );
    assert(
      nativeSettingsWindow.window?.readyForFullNativeClaim === false,
      "native settings window must not claim final full-native readiness",
    );
    report.checks.push("native-settings-window-ui-proof");
    report.checks.push("native-settings-window-controls-proof");
    report.checks.push("native-settings-window-hot-reload-proof");
    report.checks.push("native-settings-window-nonblank-proof");

    const nativeCommandCenter = await runNative(base, ["command-center-proof"]);
    report.nativeCommandCenter = {
      operation: nativeCommandCenter.operation,
      commandCenter: nativeCommandCenter.commandCenter,
    };
    assert(nativeCommandCenter.operation === "command-center-proof", "native command center proof operation missing");
    assert(
      nativeCommandCenter.commandCenter?.schema === "aelyris.native.command-center-proof.v1",
      "native command center schema missing",
    );
    assert(nativeCommandCenter.commandCenter?.nativeCommandCenter === true, "native command center flag missing");
    assert(
      nativeCommandCenter.commandCenter?.mode === "data-contract-proof",
      "native command center proof must be honest about data-contract mode",
    );
    assert(nativeCommandCenter.commandCenter?.webviewUsed === false, "native command center proof must not use WebView");
    assert(nativeCommandCenter.commandCenter?.reactUsed === false, "native command center proof must not use React");
    assert(
      nativeCommandCenter.commandCenter?.rightRailDataOwnedByRust === true,
      "native command center data ownership proof missing",
    );
    assert(
      nativeCommandCenter.commandCenter?.recoverySurface?.operation === "open-recovery",
      "native command center recovery surface missing",
    );
    assert(
      nativeCommandCenter.commandCenter?.aiCliSurface?.operation === "open-ai-cli-launch-plan",
      "native command center AI CLI launch surface missing",
    );
    assert(
      Array.isArray(nativeCommandCenter.commandCenter?.actions) &&
        nativeCommandCenter.commandCenter.actions.length >= 4 &&
        nativeCommandCenter.commandCenter.actions.some(
          (action) => action.id === "refresh-native-client" && action.operation === "run-proof",
        ),
      "native command center actions must expose actionable recovery/next-step commands",
    );
    assertNativeSleepResumeRunbook(nativeCommandCenter.commandCenter?.actions);
    assert(
      nativeCommandCenter.commandCenter?.nextProof === "native-command-center-window-ui",
      "native command center must not claim native UI completion yet",
    );
    report.checks.push("native-command-center-data-contract-proof");
    report.checks.push("native-command-center-actions-proof");
    report.checks.push("native-command-center-recovery-surface-proof");
    report.checks.push("native-command-center-ai-cli-surface-proof");
    report.checks.push("native-command-center-sleep-resume-runbook-proof");

    const nativeCommandCenterWindow = await runNative(base, [
      "command-center-window-proof",
      "--duration-ms",
      "140",
      "--alpha",
      "232",
    ]);
    report.nativeCommandCenterWindow = {
      operation: nativeCommandCenterWindow.operation,
      commandCenter: nativeCommandCenterWindow.commandCenter,
      window: nativeCommandCenterWindow.window,
    };
    assert(
      nativeCommandCenterWindow.operation === "command-center-window-proof",
      "native command center window proof operation missing",
    );
    assert(
      nativeCommandCenterWindow.commandCenter?.schema === "aelyris.native.command-center-proof.v1",
      "native command center window proof must include the data contract",
    );
    assert(
      nativeCommandCenterWindow.window?.schema === "aelyris.native.command-center-window-proof.v1",
      "native command center window schema missing",
    );
    assert(
      nativeCommandCenterWindow.window?.nativeCommandCenterWindow === true,
      "native command center window flag missing",
    );
    assert(nativeCommandCenterWindow.window?.nativeRightRailWindow === true, "native right rail window flag missing");
    assert(nativeCommandCenterWindow.window?.windowUi === true, "native command center UI proof missing");
    assert(nativeCommandCenterWindow.window?.interactiveWindow === true, "native command center window was not created");
    assert(nativeCommandCenterWindow.window?.layered === true, "native command center window should be layered");
    assert(nativeCommandCenterWindow.window?.webviewUsed === false, "native command center window must not use WebView");
    assert(nativeCommandCenterWindow.window?.reactUsed === false, "native command center window must not use React");
    assert(nativeCommandCenterWindow.window?.evidenceRowsRendered >= 3, "native command center evidence rows missing");
    assert(nativeCommandCenterWindow.window?.actionRowsRendered >= 4, "native command center action rows missing");
    assert(nativeCommandCenterWindow.window?.actionableUiProof === true, "native command center actionable UI proof missing");
    assert(nativeCommandCenterWindow.window?.nonBlank === true, "native command center window must render nonblank pixels");
    assert(
      nativeCommandCenterWindow.window?.rightRailUiStatus === "native-command-center-window-ui-proof",
      "native command center window status missing",
    );
    assert(
      nativeCommandCenterWindow.window?.nextProof === "native-command-center-input-and-scroll",
      "native command center window must not claim input/scroll completion yet",
    );
    report.checks.push("native-command-center-window-ui-proof");
    report.checks.push("native-command-center-window-action-hit-targets-proof");
    report.checks.push("native-command-center-window-nonblank-proof");

    const nativeCommandCenterInputScroll = await runNative(base, ["command-center-input-scroll-proof"]);
    report.nativeCommandCenterInputScroll = {
      operation: nativeCommandCenterInputScroll.operation,
      commandCenter: nativeCommandCenterInputScroll.commandCenter,
      inputScroll: nativeCommandCenterInputScroll.inputScroll,
    };
    assert(
      nativeCommandCenterInputScroll.operation === "command-center-input-scroll-proof",
      "native command center input/scroll proof operation missing",
    );
    assert(
      nativeCommandCenterInputScroll.commandCenter?.schema === "aelyris.native.command-center-proof.v1",
      "native command center input/scroll proof must include the data contract",
    );
    assert(
      nativeCommandCenterInputScroll.inputScroll?.schema ===
        "aelyris.native.command-center-input-scroll-proof.v1",
      "native command center input/scroll schema missing",
    );
    assert(
      nativeCommandCenterInputScroll.inputScroll?.nativeCommandCenterInput === true,
      "native command center input model missing",
    );
    assert(
      nativeCommandCenterInputScroll.inputScroll?.nativeCommandCenterScroll === true,
      "native command center scroll model missing",
    );
    assert(nativeCommandCenterInputScroll.inputScroll?.webviewUsed === false, "native command center input must not use WebView");
    assert(nativeCommandCenterInputScroll.inputScroll?.reactUsed === false, "native command center input must not use React");
    assert(nativeCommandCenterInputScroll.inputScroll?.keyboardNavigation === true, "native keyboard navigation proof missing");
    assert(nativeCommandCenterInputScroll.inputScroll?.scrollModel === true, "native scroll model proof missing");
    assert(nativeCommandCenterInputScroll.inputScroll?.actionDispatchPlan === true, "native action dispatch proof missing");
    assert(nativeCommandCenterInputScroll.inputScroll?.actionCount >= 4, "native command center input needs actions");
    assert(nativeCommandCenterInputScroll.inputScroll?.visibleActions?.length >= 1, "native visible action window missing");
    assert(nativeCommandCenterInputScroll.inputScroll?.transitions?.length >= 6, "native key transition proof missing");
    assert(
      nativeCommandCenterInputScroll.inputScroll?.guardrails?.boundsCheckedSelection === true,
      "native command center selection bounds guard missing",
    );
    assert(
      nativeCommandCenterInputScroll.inputScroll?.guardrails?.scrollOffsetWithinActions === true,
      "native command center scroll bounds guard missing",
    );
    assert(
      nativeCommandCenterInputScroll.inputScroll?.guardrails?.dispatchDoesNotRequireReact === true,
      "native command center dispatch must not require React",
    );
    assert(
      nativeCommandCenterInputScroll.inputScroll?.guardrails?.dispatchDoesNotRequireWebView === true,
      "native command center dispatch must not require WebView",
    );
    assert(
      nativeCommandCenterInputScroll.inputScroll?.nextProof === "react-right-rail-compatibility-demotion",
      "native command center input/scroll must not claim React demotion yet",
    );
    report.checks.push("native-command-center-input-navigation-proof");
    report.checks.push("native-command-center-scroll-model-proof");
    report.checks.push("native-command-center-action-dispatch-proof");

    const nativeModeShell = await runNative(base, ["mode-shell-proof", "--mode", "terminal"]);
    report.nativeModeShell = {
      operation: nativeModeShell.operation,
      commandCenter: nativeModeShell.commandCenter,
      modeShell: nativeModeShell.modeShell,
    };
    assert(nativeModeShell.operation === "mode-shell-proof", "native mode shell proof operation missing");
    assert(
      nativeModeShell.commandCenter?.schema === "aelyris.native.command-center-proof.v1",
      "native mode shell proof must include the command center contract",
    );
    assert(nativeModeShell.modeShell?.schema === "aelyris.native.mode-shell.v1", "native mode shell schema missing");
    assert(nativeModeShell.modeShell?.nativeModeShell === true, "native mode shell flag missing");
    assert(nativeModeShell.modeShell?.webviewUsed === false, "native mode shell must not use WebView");
    assert(nativeModeShell.modeShell?.reactUsed === false, "native mode shell must not use React");
    assert(Array.isArray(nativeModeShell.modeShell?.modes), "native mode shell modes missing");
    const modeIds = nativeModeShell.modeShell.modes.map((mode) => mode.id);
    const modeShortcuts = nativeModeShell.modeShell.modes.map((mode) => mode.shortcut);
    assert(
      modeIds.length === expectedModeIds().length && modeIds.every((id, index) => id === expectedModeIds()[index]),
      "native mode shell modes must match the fixed product mode list",
    );
    assert(
      modeShortcuts.every((shortcut, index) => shortcut === expectedModeShortcuts()[index]),
      "native mode shell shortcuts must be stable Alt+1..Alt+8",
    );
    assert(nativeModeShell.modeShell?.selectedMode === "terminal", "native mode shell selected mode mismatch");
    assertModeShellRoute(nativeModeShell.modeShell?.selectedEntityRoute, "terminal");
    assert(
      nativeModeShell.modeShell?.routeMatrix?.length === expectedModeShell.length,
      "native mode shell route matrix must cover all modes",
    );
    for (const [mode] of expectedModeShell) {
      const entry = nativeModeShell.modeShell.routeMatrix.find((route) => route.mode === mode);
      assert(entry, `native mode shell route matrix missing ${mode}`);
      assertModeShellRoute(entry.selectedEntityRoute, mode);
    }
    assert(nativeModeShell.modeShell?.modeRail?.schema === "aelyris.native.mode-rail.v1", "native mode rail schema missing");
    assert(nativeModeShell.modeShell?.modeRail?.modeCount === 8, "native mode rail count missing");
    assert(nativeModeShell.modeShell?.modeRail?.keyboardFirst === true, "native mode rail keyboard-first proof missing");
    assert(nativeModeShell.modeShell?.modeRail?.shortcutsStable === true, "native mode rail shortcuts proof missing");
    assert(
      nativeModeShell.modeShell?.modeRail?.shortcuts?.join("|") === expectedModeShortcuts().join("|"),
      "native mode rail shortcuts must exactly match Alt+1..Alt+8",
    );
    assert(
      nativeModeShell.modeShell?.inspector?.schema === "aelyris.native.inspector.v1",
      "native inspector schema missing",
    );
    assert(
      nativeModeShell.modeShell?.inspector?.contextualInspector === true,
      "native contextual inspector proof missing",
    );
    assert(
      nativeModeShell.modeShell?.inspector?.commandCenterBacked === true,
      "native inspector must be command-center backed",
    );
    assert(nativeModeShell.modeShell?.inspector?.actionsCount >= 1, "native inspector actions count missing");
    assert(
      nativeModeShell.modeShell?.inspector?.evidenceRows === nativeModeShell.commandCenter?.evidence?.length,
      "native inspector evidence count must match command center backing data",
    );
    assert(
      nativeModeShell.modeShell?.inspector?.actionsCount === nativeModeShell.commandCenter?.actions?.length,
      "native inspector action count must match command center backing data",
    );
    assert(
      nativeModeShell.modeShell?.inspector?.blockerCount === nativeModeShell.commandCenter?.blockerCount,
      "native inspector blocker count must match command center backing data",
    );
    assert(nativeModeShell.modeShell?.modeRail?.webviewUsed === false, "native mode rail must not use WebView");
    assert(nativeModeShell.modeShell?.modeRail?.reactUsed === false, "native mode rail must not use React");
    assert(nativeModeShell.modeShell?.inspector?.webviewUsed === false, "native inspector must not use WebView");
    assert(nativeModeShell.modeShell?.inspector?.reactUsed === false, "native inspector must not use React");
    assert(
      nativeModeShell.modeShell?.rightInspectorContractId === "aelyris.native.inspector.v1:command-center",
      "native right inspector contract id missing",
    );
    assert(
      nativeModeShell.modeShell?.guardrails?.modeCountAtLeastEight === true &&
        nativeModeShell.modeShell?.guardrails?.selectedIndexInBounds === true &&
        nativeModeShell.modeShell?.guardrails?.noReactDependency === true &&
        nativeModeShell.modeShell?.guardrails?.noWebViewDependency === true,
      "native mode shell guardrails missing",
    );
    assert(
      nativeModeShell.modeShell?.nextProof === "native-mode-rail-window-proof",
      "native mode shell must not claim native rail rendering yet",
    );
    assert(
      nativeModeShell.modeShell?.readyForReactDemotion === false,
      "native mode shell must not claim React demotion yet",
    );
    report.nativeModeShellRoutes = [];
    for (const [mode] of expectedModeShell) {
      const proof = await runNative(base, ["mode-shell-proof", "--mode", mode]);
      assert(proof.modeShell?.selectedMode === mode, `native mode shell selected mode mismatch for ${mode}`);
      assertModeShellRoute(proof.modeShell?.selectedEntityRoute, mode);
      report.nativeModeShellRoutes.push({
        mode,
        selectedEntityRoute: proof.modeShell?.selectedEntityRoute,
        inspector: proof.modeShell?.inspector,
      });
    }
    report.checks.push("native-mode-shell-contract-proof");
    report.checks.push("native-mode-rail-contract-proof");
    report.checks.push("native-inspector-contract-proof");

    const nativeModeRailWindow = await runNative(base, [
      "mode-rail-window-proof",
      "--mode",
      "terminal",
      "--duration-ms",
      "140",
      "--alpha",
      "232",
    ]);
    report.nativeModeRailWindow = {
      operation: nativeModeRailWindow.operation,
      modeShell: nativeModeRailWindow.modeShell,
      window: nativeModeRailWindow.window,
    };
    assert(nativeModeRailWindow.operation === "mode-rail-window-proof", "native mode rail window operation missing");
    assert(
      nativeModeRailWindow.modeShell?.schema === "aelyris.native.mode-shell.v1",
      "native mode rail window must include the mode shell contract",
    );
    assert(
      nativeModeRailWindow.window?.schema === "aelyris.native.mode-rail-window-proof.v1",
      "native mode rail window schema missing",
    );
    assert(nativeModeRailWindow.window?.nativeModeRailWindow === true, "native mode rail window flag missing");
    assert(nativeModeRailWindow.window?.nativeModeRail === true, "native mode rail flag missing");
    assert(nativeModeRailWindow.window?.windowUi === true, "native mode rail UI proof missing");
    assert(nativeModeRailWindow.window?.interactiveWindow === true, "native mode rail window was not created");
    assert(nativeModeRailWindow.window?.layered === true, "native mode rail window should be layered");
    assert(nativeModeRailWindow.window?.webviewUsed === false, "native mode rail window must not use WebView");
    assert(nativeModeRailWindow.window?.reactUsed === false, "native mode rail window must not use React");
    assert(nativeModeRailWindow.window?.selectedMode === "terminal", "native mode rail selected mode mismatch");
    assert(nativeModeRailWindow.window?.focusedMode === "terminal", "native mode rail focused mode mismatch");
    assert(nativeModeRailWindow.window?.modeRowsRendered === 8, "native mode rail must render all 8 modes");
    assert(nativeModeRailWindow.window?.hitTargetCount === 8, "native mode rail hit target count missing");
    assert(nativeModeRailWindow.window?.hitTargets?.length === 8, "native mode rail hit targets missing");
    assert(
      nativeModeRailWindow.window.hitTargets.every((target, index) => target.id === expectedModeShell[index][0]),
      "native mode rail hit target ids must match mode order",
    );
    assert(
      nativeModeRailWindow.window.hitTargets.every((target, index) => target.shortcut === expectedModeShell[index][1]),
      "native mode rail hit target shortcuts must match Alt+1..Alt+8",
    );
    assert(nativeModeRailWindow.window?.keyboardNavigation === true, "native mode rail keyboard navigation missing");
    assert(
      nativeModeRailWindow.window?.keyboardTransitions?.length >= 5,
      "native mode rail keyboard transition proof missing",
    );
    assert(nativeModeRailWindow.window?.nonBlank === true, "native mode rail window must render nonblank pixels");
    assert(
      nativeModeRailWindow.window?.readyForReactDemotion === false,
      "native mode rail window must not claim React demotion yet",
    );
    assert(
      nativeModeRailWindow.window?.nextProof === "native-inspector-window-proof",
      "native mode rail window must point to the inspector window proof next",
    );
    report.checks.push("native-mode-rail-window-ui-proof");
    report.checks.push("native-mode-rail-window-hit-targets-proof");
    report.checks.push("native-mode-rail-window-keyboard-proof");
    report.checks.push("native-mode-rail-window-nonblank-proof");

    const nativeInspectorWindow = await runNative(base, [
      "inspector-window-proof",
      "--mode",
      "terminal",
      "--duration-ms",
      "140",
      "--alpha",
      "232",
    ]);
    report.nativeInspectorWindow = {
      operation: nativeInspectorWindow.operation,
      commandCenter: nativeInspectorWindow.commandCenter,
      modeShell: nativeInspectorWindow.modeShell,
      window: nativeInspectorWindow.window,
    };
    assert(nativeInspectorWindow.operation === "inspector-window-proof", "native inspector window operation missing");
    assert(
      nativeInspectorWindow.commandCenter?.schema === "aelyris.native.command-center-proof.v1",
      "native inspector window must include the command center contract",
    );
    assert(
      nativeInspectorWindow.modeShell?.schema === "aelyris.native.mode-shell.v1",
      "native inspector window must include the mode shell contract",
    );
    assert(
      nativeInspectorWindow.window?.schema === "aelyris.native.inspector-window-proof.v1",
      "native inspector window schema missing",
    );
    assert(nativeInspectorWindow.window?.nativeInspectorWindow === true, "native inspector window flag missing");
    assert(nativeInspectorWindow.window?.nativeContextualInspector === true, "native contextual inspector flag missing");
    assert(nativeInspectorWindow.window?.windowUi === true, "native inspector UI proof missing");
    assert(nativeInspectorWindow.window?.interactiveWindow === true, "native inspector window was not created");
    assert(nativeInspectorWindow.window?.layered === true, "native inspector window should be layered");
    assert(nativeInspectorWindow.window?.webviewUsed === false, "native inspector window must not use WebView");
    assert(nativeInspectorWindow.window?.reactUsed === false, "native inspector window must not use React");
    assert(nativeInspectorWindow.window?.selectedMode === "terminal", "native inspector selected mode mismatch");
    assert(
      nativeInspectorWindow.window?.rightInspectorContractId === "aelyris.native.inspector.v1:command-center",
      "native inspector contract id missing",
    );
    assert(
      nativeInspectorWindow.window?.inspector?.schema === "aelyris.native.inspector.v1",
      "native inspector embedded contract missing",
    );
    assert(nativeInspectorWindow.window?.commandCenterBacked === true, "native inspector must be command-center backed");
    assert(nativeInspectorWindow.window?.contextualInspector === true, "native contextual inspector proof missing");
    assert(
      nativeInspectorWindow.window?.evidenceRowsTotal === nativeInspectorWindow.commandCenter?.evidence?.length,
      "native inspector evidence total must match command center backing data",
    );
    assert(
      nativeInspectorWindow.window?.actionRowsTotal === nativeInspectorWindow.commandCenter?.actions?.length,
      "native inspector action total must match command center backing data",
    );
    assert(
      nativeInspectorWindow.window?.evidenceRowsRendered === Math.min(nativeInspectorWindow.commandCenter?.evidence?.length ?? 0, 5),
      "native inspector evidence rows rendered mismatch",
    );
    assert(
      nativeInspectorWindow.window?.actionRowsRendered ===
        Math.min(nativeInspectorWindow.commandCenter?.actions?.length ?? 0, nativeInspectorWindow.window?.visibleRows ?? 0),
      "native inspector action rows rendered mismatch",
    );
    assert(nativeInspectorWindow.window?.actionHitTargets?.length >= 1, "native inspector action hit targets missing");
    assert(nativeInspectorWindow.window?.keyboardSelection === true, "native inspector keyboard selection missing");
    assert(nativeInspectorWindow.window?.scrollModel === true, "native inspector scroll model missing");
    assert(
      nativeInspectorWindow.window?.keyboardTransitions?.length >= 5,
      "native inspector keyboard transition proof missing",
    );
    assert(
      nativeInspectorWindow.window?.guardrails?.selectedActionInBounds === true,
      "native inspector selected action bounds guard missing",
    );
    assert(
      nativeInspectorWindow.window?.guardrails?.scrollOffsetInBounds === true,
      "native inspector scroll bounds guard missing",
    );
    assert(
      nativeInspectorWindow.window?.guardrails?.dispatchDoesNotRequireReact === true,
      "native inspector dispatch must not require React",
    );
    assert(
      nativeInspectorWindow.window?.guardrails?.dispatchDoesNotRequireWebView === true,
      "native inspector dispatch must not require WebView",
    );
    assert(nativeInspectorWindow.window?.nonBlank === true, "native inspector window must render nonblank pixels");
    assert(
      nativeInspectorWindow.window?.readyForReactDemotion === false,
      "native inspector window must not claim React demotion yet",
    );
    assert(
      nativeInspectorWindow.window?.nextProof === "react-right-rail-compatibility-demotion",
      "native inspector window must point to React right-rail demotion next",
    );
    report.checks.push("native-inspector-window-ui-proof");
    report.checks.push("native-inspector-window-action-hit-targets-proof");
    report.checks.push("native-inspector-window-scroll-keyboard-proof");
    report.checks.push("native-inspector-window-nonblank-proof");

    const nativeRightRailDemotion = await runNative(base, ["right-rail-demotion-proof"]);
    report.nativeRightRailDemotion = {
      operation: nativeRightRailDemotion.operation,
      commandCenter: nativeRightRailDemotion.commandCenter,
      modeShell: nativeRightRailDemotion.modeShell,
      rightRailDemotion: nativeRightRailDemotion.rightRailDemotion,
    };
    assert(
      nativeRightRailDemotion.operation === "right-rail-demotion-proof",
      "native right rail demotion operation missing",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.schema === "aelyris.native.right-rail-demotion-proof.v1",
      "native right rail demotion schema missing",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.nativeRightRailDemotionProof === true,
      "native right rail demotion proof flag missing",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.sourceOfTruth === "rust-native-command-center-mode-shell-inspector",
      "native right rail demotion source of truth mismatch",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.webviewUsed === false &&
        nativeRightRailDemotion.rightRailDemotion?.reactUsed === false,
      "native right rail demotion proof must not execute through React/WebView",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.nativeProductPathReady === true,
      "native right rail native replacement path must be ready before demotion",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.nativePrerequisites?.length >= 7 &&
        nativeRightRailDemotion.rightRailDemotion.nativePrerequisites.every((entry) => entry.complete === true),
      "native right rail demotion prerequisites must all be complete",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.reactCompatibilityOnly === true,
      "native right rail demotion proof must mark React right rail compatibility-only",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.reactRightRailSourcesPresent === true,
      "native right rail demotion proof must honestly report current React right rail sources",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.reactSourcesMarkedCompatibilityOnly === true,
      "native right rail demotion proof must show all React right rail sources marked compatibility-only",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.compatibilityStatus === "react-right-rail-compatibility-only",
      "native right rail demotion status must be compatibility-only after source markers land",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.compatibilityClients?.length >= 4 &&
        nativeRightRailDemotion.rightRailDemotion.compatibilityClients.every(
          (entry) =>
            entry.compatibilityMarkerPresent === true &&
            entry.compatibilityRole === "legacy-tauri-react-client" &&
            entry.reactOwnsProductTruth === false &&
            entry.webviewDispatchRequired === false,
        ),
      "native right rail compatibility clients must all be explicitly demoted",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.nativeReplacementMap?.length >= 4,
      "native right rail replacement map missing",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.guardrails?.doesNotClaimReactRemoved === true &&
        nativeRightRailDemotion.rightRailDemotion?.guardrails?.compatibilityOnlyClaimBackedByMarkers === true &&
        nativeRightRailDemotion.rightRailDemotion?.guardrails?.reactSourcesMarkedCompatibilityOnly === true &&
        nativeRightRailDemotion.rightRailDemotion?.guardrails?.reactProductTruthDisabled === true &&
        nativeRightRailDemotion.rightRailDemotion?.guardrails?.nativeReplacementReadyBeforeDemotion === true,
      "native right rail demotion honesty guardrails missing",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.reactDemotionComplete === true &&
        nativeRightRailDemotion.rightRailDemotion?.readyForReactDemotion === false,
      "native right rail demotion should be complete and not still pending",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.readyForFullNativeClaim === false,
      "native right rail demotion proof must not claim full-native readiness",
    );
    assert(
      nativeRightRailDemotion.rightRailDemotion?.nextProof === "aelyris-native-primary-daily-driver-promotion",
      "native right rail demotion next proof mismatch",
    );
    report.checks.push("native-right-rail-demotion-contract-proof");
    report.checks.push("native-right-rail-replacement-map-proof");
    report.checks.push("native-right-rail-demotion-honesty-proof");
    report.checks.push("react-right-rail-compatibility-demotion-proof");

    const nativeAccessibility = await runNative(base, ["accessibility-proof"]);
    report.nativeAccessibility = {
      operation: nativeAccessibility.operation,
      accessibility: nativeAccessibility.accessibility,
    };
    assert(nativeAccessibility.operation === "accessibility-proof", "native accessibility proof operation missing");
    assert(
      nativeAccessibility.accessibility?.schema === "aelyris.native.accessibility-proof.v1",
      "native accessibility schema missing",
    );
    assert(
      nativeAccessibility.accessibility?.nativeAccessibilityTreeProof === true,
      "native accessibility tree proof missing",
    );
    assert(nativeAccessibility.accessibility?.mode === "semantic-tree-proof", "native accessibility mode mismatch");
    assert(nativeAccessibility.accessibility?.webviewUsed === false, "native accessibility must not use WebView");
    assert(nativeAccessibility.accessibility?.reactUsed === false, "native accessibility must not use React");
    assert(nativeAccessibility.accessibility?.namedNodes >= 16, "native accessibility named nodes missing");
    assert(nativeAccessibility.accessibility?.unnamedNodes === 0, "native accessibility unnamed nodes present");
    assert(nativeAccessibility.accessibility?.focusableNodes >= 12, "native accessibility focus order too small");
    assert(nativeAccessibility.accessibility?.keyboardTraversal === true, "native accessibility keyboard traversal missing");
    assert(
      nativeAccessibility.accessibility?.roles?.includes?.("terminal") &&
        nativeAccessibility.accessibility?.roles?.includes?.("button") &&
        nativeAccessibility.accessibility?.roles?.includes?.("tab"),
      "native accessibility role coverage missing",
    );
    assert(
      nativeAccessibility.accessibility?.guardrails?.noUnnamedFocusableNodes === true,
      "native accessibility focusable names guardrail missing",
    );
    assert(
      nativeAccessibility.accessibility?.guardrails?.actionsDoNotRequireReact === true &&
        nativeAccessibility.accessibility?.guardrails?.actionsDoNotRequireWebView === true,
      "native accessibility action guardrails missing",
    );
    assert(
      nativeAccessibility.accessibility?.readyForNativeUiaProvider === true,
      "native accessibility should be ready for UIA provider binding",
    );
    assert(
      nativeAccessibility.accessibility?.screenReaderProviderReady === false &&
        nativeAccessibility.accessibility?.readyForFullNativeClaim === false,
      "native accessibility must not overclaim screen reader/full native completion",
    );
    assert(
      nativeAccessibility.accessibility?.nextProof === "native-uia-provider-dogfood",
      "native accessibility next proof missing",
    );
    report.checks.push("native-accessibility-tree-proof");
    report.checks.push("native-accessibility-focus-order-proof");
    report.checks.push("native-accessibility-honesty-proof");

    const nativeUiaProvider = await runNative(base, ["uia-provider-proof"]);
    report.nativeUiaProvider = {
      operation: nativeUiaProvider.operation,
      uiaProvider: nativeUiaProvider.uiaProvider,
    };
    assert(nativeUiaProvider.operation === "uia-provider-proof", "native UIA provider proof operation missing");
    assert(
      nativeUiaProvider.uiaProvider?.schema === "aelyris.native.uia-provider-proof.v1",
      "native UIA provider schema missing",
    );
    assert(
      nativeUiaProvider.uiaProvider?.nativeUiaProviderDogfood === true,
      "native UIA provider dogfood flag missing",
    );
    assert(nativeUiaProvider.uiaProvider?.webviewUsed === false, "native UIA provider must not use WebView");
    assert(nativeUiaProvider.uiaProvider?.reactUsed === false, "native UIA provider must not use React");
    assert(nativeUiaProvider.uiaProvider?.uiaProviderBound === true, "native UIA provider must be bound");
    assert(
      nativeUiaProvider.uiaProvider?.elementFromHandle === true &&
        nativeUiaProvider.uiaProvider?.root?.name === "Aelyris Native Accessibility Dogfood",
      "native UIA provider must be observable through ElementFromHandle",
    );
    assert(nativeUiaProvider.uiaProvider?.descendantCount >= 3, "native UIA provider descendants missing");
    assert(
      nativeUiaProvider.uiaProvider?.dogfoodChecks?.terminalNameReadable === true &&
        nativeUiaProvider.uiaProvider?.dogfoodChecks?.actionNameReadable === true &&
        nativeUiaProvider.uiaProvider?.dogfoodChecks?.settingsNameReadable === true,
      "native UIA provider readable names missing",
    );
    assert(
      nativeUiaProvider.uiaProvider?.dogfoodChecks?.buttonInvokePatternAvailable === true &&
        nativeUiaProvider.uiaProvider?.dogfoodChecks?.buttonInvokedThroughUia === true,
      "native UIA provider InvokePattern dogfood missing",
    );
    assert(
      nativeUiaProvider.uiaProvider?.screenReaderProviderReady === true &&
        nativeUiaProvider.uiaProvider?.manualNarratorDogfood === false,
      "native UIA provider must be screen-reader ready but honest about manual Narrator sweep",
    );
    assert(
      nativeUiaProvider.uiaProvider?.guardrails?.noReactDependency === true &&
        nativeUiaProvider.uiaProvider?.guardrails?.noWebViewDependency === true &&
        nativeUiaProvider.uiaProvider?.guardrails?.invokeDidNotUseDomClick === true,
      "native UIA provider guardrails missing",
    );
    assert(
      nativeUiaProvider.uiaProvider?.readyForFullNativeClaim === false &&
        nativeUiaProvider.uiaProvider?.nextProof === "native-accessibility-manual-screen-reader-sweep",
      "native UIA provider must not claim full-native final readiness",
    );
    report.checks.push("native-uia-provider-dogfood-proof");
    report.checks.push("native-uia-provider-name-role-proof");
    report.checks.push("native-uia-provider-invoke-proof");

    const nativeVisualQa = await runNative(base, ["visual-qa-proof"]);
    report.nativeVisualQa = {
      operation: nativeVisualQa.operation,
      visualQa: nativeVisualQa.visualQa,
    };
    assert(nativeVisualQa.operation === "visual-qa-proof", "native visual QA proof operation missing");
    assert(
      nativeVisualQa.visualQa?.schema === "aelyris.native.visual-qa-proof.v1",
      "native visual QA schema missing",
    );
    assert(nativeVisualQa.visualQa?.nativeVisualQaHarness === true, "native visual QA harness flag missing");
    assert(nativeVisualQa.visualQa?.webviewUsed === false, "native visual QA must not use WebView");
    assert(nativeVisualQa.visualQa?.reactUsed === false, "native visual QA must not use React");
    assert(nativeVisualQa.visualQa?.allRequiredSurfacesComplete === true, "native visual QA surfaces incomplete");
    assert(nativeVisualQa.visualQa?.allRequiredSurfacesNonBlank === true, "native visual QA nonblank coverage missing");
    assert(nativeVisualQa.visualQa?.contrastPass === true, "native visual QA contrast pass missing");
    assert(nativeVisualQa.visualQa?.pixelProbePass === true, "native visual QA pixel probe missing");
    assert(nativeVisualQa.visualQa?.resizeProbePass === true, "native visual QA resize probe missing");
    assert(nativeVisualQa.visualQa?.focusCoveragePass === true, "native visual QA focus coverage missing");
    assert(nativeVisualQa.visualQa?.pixelProbe?.webviewCdpUsed === false, "native visual QA must not use CDP");
    assert(
      nativeVisualQa.visualQa?.sleepResumeRecoveryProbe?.schema ===
        "aelyris.native.sleep-resume-recovery-probe.v1" &&
        nativeVisualQa.visualQa?.sleepResumeRecoveryProbe?.syntheticPowerBroadcastDogfood === true &&
        nativeVisualQa.visualQa?.sleepResumeRecoveryProbe?.realWindowsSleepResumeDogfood === false &&
        nativeVisualQa.visualQa?.sleepResumeRecoveryProbe?.doesNotClaimMachineSleep === true &&
        nativeVisualQa.visualQa?.sleepResumeRecoveryProbe?.wmPowerBroadcastObserved === true &&
        nativeVisualQa.visualQa?.sleepResumeRecoveryProbe?.postResumeVisualNonBlank === true &&
        nativeVisualQa.visualQa?.sleepResumeRecoveryProbe?.readyForRealSleepResumeDogfood === true &&
        nativeVisualQa.visualQa?.sleepResumeRecoveryProbePass === true,
      "native sleep/resume recovery probe missing or overclaiming",
    );
    assert(
      nativeVisualQa.visualQa?.contrastPairs?.every?.((pair) => pair.wcagAaText === true && pair.ratio >= 4.5),
      "native visual QA contrast pairs must pass AA text contrast",
    );
    assert(
      nativeVisualQa.visualQa?.sleepResumeDogfood === false &&
        nativeVisualQa.visualQa?.readyForFullNativeClaim === false,
      "native visual QA must not overclaim sleep/resume or final readiness",
    );
    assert(
      nativeVisualQa.visualQa?.nextProof === "native-sleep-resume-visual-dogfood",
      "native visual QA next proof missing",
    );
    report.checks.push("native-visual-qa-harness-proof");
    report.checks.push("native-visual-qa-contrast-proof");
    report.checks.push("native-visual-qa-resize-proof");
    report.checks.push("native-sleep-resume-recovery-probe-proof");
    report.checks.push("native-visual-qa-honesty-proof");

    process.env.AELYRIS_NATIVE_CLIENT_CURRENT_CHECKS = JSON.stringify(report.checks);
    const nativePrimaryShell = await runNative(base, ["primary-shell-proof", "--duration-ms", "140", "--alpha", "232"]);
    report.nativePrimaryShell = {
      operation: nativePrimaryShell.operation,
      primaryShell: nativePrimaryShell.primaryShell,
    };
    assert(nativePrimaryShell.operation === "primary-shell-proof", "native primary shell proof operation missing");
    assert(
      nativePrimaryShell.primaryShell?.schema === "aelyris.native.primary-shell-proof.v1",
      "native primary shell schema missing",
    );
    assert(
      nativePrimaryShell.primaryShell?.nativePrimaryShellPromotion === true &&
        nativePrimaryShell.primaryShell?.primarySurface === "aelyris-native",
      "native primary shell promotion flag missing",
    );
    assert(
      nativePrimaryShell.primaryShell?.reactWebViewCompatibilityOnly === true &&
        nativePrimaryShell.primaryShell?.reactOwnsProductTruth === false &&
        nativePrimaryShell.primaryShell?.webviewOwnsTerminal === false,
      "native primary shell must demote React/WebView from product truth",
    );
    assert(nativePrimaryShell.primaryShell?.webviewUsed === false, "native primary shell must not use WebView");
    assert(nativePrimaryShell.primaryShell?.reactUsed === false, "native primary shell must not use React");
    assert(nativePrimaryShell.primaryShell?.promotionReady === true, "native primary shell prerequisites incomplete");
    assert(
      nativePrimaryShell.primaryShell?.prerequisites?.length >= 8 &&
        nativePrimaryShell.primaryShell.prerequisites.every((entry) => entry.complete === true),
      "native primary shell prerequisites must all be complete",
    );
    assert(
      nativePrimaryShell.primaryShell?.primaryShellWindow?.schema ===
        "aelyris.native.primary-shell-window-proof.v1" &&
        nativePrimaryShell.primaryShell?.primaryShellWindow?.nativePrimaryShellWindow === true &&
        nativePrimaryShell.primaryShell?.primaryShellWindow?.nonBlank === true &&
        nativePrimaryShell.primaryShell?.primaryShellWindow?.modeRowsRendered >= 8 &&
        nativePrimaryShell.primaryShell?.primaryShellWindow?.actionRowsRendered >= 4,
      "native primary shell window proof missing",
    );
    assert(
      nativePrimaryShell.primaryShell?.readyForFullNativeClaim === false &&
        nativePrimaryShell.primaryShell?.guardrails?.doesNotClaimSleepResumeWithoutRealDogfood === true,
      "native primary shell must not claim full native before real sleep/resume dogfood",
    );
    report.checks.push("native-primary-shell-promotion-proof");
    report.checks.push("native-primary-shell-window-proof");
    report.checks.push("react-webview-compatibility-only-proof");

    const nativeDetach = await runNative(base, ["detach", workspaceId]);
    report.nativeDetach = {
      workspaceId,
      paneLifecycles: paneRecords(nativeDetach.graph).map((pane) => pane.lifecycle).sort(),
    };
    assert(
      paneRecords(nativeDetach.graph).every((pane) => pane.lifecycle === "detached"),
      "native detach should mark panes detached through mux graph",
    );
    report.checks.push("native-detach-updates-mux-graph");

    const nativeAttach = await runNative(base, ["attach", workspaceId]);
    report.nativeAttach = {
      workspaceId,
      paneLifecycles: paneRecords(nativeAttach.graph).map((pane) => pane.lifecycle).sort(),
      ptyIds: paneRecords(nativeAttach.graph)
        .map((pane) => pane.pty?.terminalId)
        .filter(Boolean)
        .sort(),
    };
    assert(
      paneRecords(nativeAttach.graph).every((pane) => isLiveAttachedPane(pane)),
      "native attach should restore live non-detached PTY bindings through mux graph",
    );
    report.checks.push("native-attach-updates-mux-graph");

    await request(base, `/sessions/${workspaceId}`, { method: "DELETE" });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (daemon) {
      report.sidecarOutput = {
        stdoutTail: daemon.output.stdout.slice(-2_000),
        stderrTail: daemon.output.stderr.slice(-2_000),
      };
      killProcess(daemon.child);
    }
    writeJsonAtomic(out, report);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ status: report.status, checks: report.checks, artifact: out }, null, 2));
  if (report.errors.length > 0) {
    console.error(`Errors:\n- ${report.errors.join("\n- ")}`);
    process.exitCode = 1;
  }
}

await main();
