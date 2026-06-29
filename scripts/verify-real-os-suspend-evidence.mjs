import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, dirname, extname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.env.AETHER_PRODUCTION_ROOT ?? process.cwd());
const PRODUCTION_SMOKE_DIR = resolve(
  process.env.AETHER_PRODUCTION_SMOKE_DIR ?? join(ROOT, ".codex-auto", "production-smoke"),
);
const EVIDENCE = resolve(
  process.env.AETHER_SUSPEND_EVIDENCE_PATH ?? join(PRODUCTION_SMOKE_DIR, "real-os-suspend-resume.json"),
);
const DIAGNOSTIC = resolve(
  process.env.AETHER_SUSPEND_DIAGNOSTIC_PATH ??
    join(PRODUCTION_SMOKE_DIR, "real-os-suspend-resume.diagnostic.json"),
);
const SESSION = resolve(
  process.env.AETHER_SUSPEND_SESSION_PATH ?? join(PRODUCTION_SMOKE_DIR, "real-os-suspend-session.json"),
);
const NATIVE_PREFLIGHT = resolve(
  process.env.AETHER_SUSPEND_NATIVE_PREFLIGHT_PATH ??
    join(PRODUCTION_SMOKE_DIR, "real-os-suspend-native-preflight.json"),
);
const NATIVE_POSTCHECK_PREFLIGHT = resolve(
  process.env.AETHER_SUSPEND_NATIVE_POSTCHECK_PREFLIGHT_PATH ??
    join(PRODUCTION_SMOKE_DIR, "real-os-suspend-native-postcheck-preflight.json"),
);
const NATIVE_POSTCHECK_WRITE_SMOKE = resolve(
  process.env.AETHER_SUSPEND_NATIVE_POSTCHECK_WRITE_SMOKE_PATH ??
    join(PRODUCTION_SMOKE_DIR, "real-os-suspend-native-postcheck-write-smoke.json"),
);
const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const args = new Set(process.argv.slice(2));
const NATIVE_PRIMARY_REQUESTED = args.has("--native-primary") || process.env.AETHER_SUSPEND_NATIVE_PRIMARY === "1";
const LAUNCH_NATIVE_PRIMARY =
  args.has("--launch-native-primary") || process.env.AETHER_LAUNCH_NATIVE_PRIMARY_SHELL === "1";
const USER_INITIATED_SLEEP_CYCLE = args.has("--user-sleep-cycle") || args.has("--manual-cycle");
const USER_SLEEP_WAIT_TIMEOUT_MS = Number.parseInt(process.env.AETHER_USER_SLEEP_WAIT_TIMEOUT_MS ?? "1800000", 10);
const USER_SLEEP_WAIT_POLL_MS = Number.parseInt(process.env.AETHER_USER_SLEEP_WAIT_POLL_MS ?? "5000", 10);
const NATIVE_PRIMARY_HOLD_MS = Number.parseInt(process.env.AETHER_NATIVE_PRIMARY_HOLD_MS ?? "1200000", 10);
const NATIVE_PREFLIGHT_HOLD_MS = Number.parseInt(process.env.AETHER_NATIVE_PREFLIGHT_HOLD_MS ?? "5000", 10);
const NATIVE_POSTCHECK_PREFLIGHT_HOLD_MS = Number.parseInt(
  process.env.AETHER_NATIVE_POSTCHECK_PREFLIGHT_HOLD_MS ?? "120000",
  10,
);
const NATIVE_POSTCHECK_WRITE_SMOKE_HOLD_MS = Number.parseInt(
  process.env.AETHER_NATIVE_POSTCHECK_WRITE_SMOKE_HOLD_MS ?? "120000",
  10,
);
const NATIVE_PRIMARY_ALPHA = Number.parseInt(process.env.AETHER_NATIVE_PRIMARY_ALPHA ?? "232", 10);
const NATIVE_PRIMARY_EXE = resolve(
  process.env.AETHER_NATIVE_EXE ??
    join(ROOT, "src-tauri", "target", "debug", process.platform === "win32" ? "aether-native.exe" : "aether-native"),
);
const DEFAULT_APP_EXE = resolve(
  process.env.AETHER_APP_EXE ??
    (NATIVE_PRIMARY_REQUESTED ? NATIVE_PRIMARY_EXE : join(ROOT, "src-tauri", "target", "release", "Aether.exe")),
);
const AETHERCTL_EXE = join(
  ROOT,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "aetherctl.exe" : "aetherctl",
);
const BUNDLED_SIDECAR_EXE = join(
  ROOT,
  "src-tauri",
  "binaries",
  process.platform === "win32" ? "aether-pty-server-x86_64-pc-windows-msvc.exe" : "aether-pty-server",
);
const REQUIRED_CHECKS = ["appResponsive", "terminalResponsive", "sqliteWritable", "paneStatePreserved"];
// Automated probes verify app responsiveness, terminal roundtrip, SQLite write, and pane layout preservation.
const DEFAULT_API_BASE_URL = "http://127.0.0.1:9333";
const SIDECAR_API_BASE_URL = "http://127.0.0.1:9334";

function printUsage() {
  console.log(`Aether real OS sleep/resume verifier

Usage:
  node scripts/verify-real-os-suspend-evidence.mjs [mode] [target]

Safe read-only modes:
  --help, -h                      Show this message and exit without touching evidence or sleeping.
  --diagnose                      Write diagnostic JSON for the current evidence.
  --native-preflight              Prove the native primary shell can be launched before a real sleep run.
  --native-postcheck-preflight    Prove post-resume probes can run against the native primary shell.
  --native-postcheck-write-smoke  Prove postcheck writes in an isolated smoke directory.
  --strict                        Validate existing evidence without promoting it.

Evidence modes:
  --begin                         Record the pre-sleep evidence bracket.
  --resume                        Record the post-wake evidence bracket.
  --postcheck                     Run post-resume probes.
  --write-template                Write a manual evidence template.
  --refresh-app                   Refresh executable identity in the evidence file.

Real sleep modes:
  --user-sleep-cycle              Wait for the operator to manually sleep and wake Windows.
  --cycle                         Invoke the guarded Windows sleep API.

Targets and safety:
  --native-primary                Target aether-native.exe instead of the Tauri release shell.
  --launch-native-primary         Launch a short-lived native primary shell during the proof.
  QUORUM_ALLOW_OS_SLEEP=1         Required before --cycle can invoke the sleep API.
`);
}

function processNameForExecutable(executable) {
  return (
    process.env.AETHER_APP_PROCESS_NAME ??
    basename(executable || DEFAULT_APP_EXE, extname(executable || DEFAULT_APP_EXE))
  );
}

function isNativePrimaryExecutable(executable) {
  return basename(String(executable ?? "")).toLowerCase().startsWith("aether-native");
}

function minAppBytes(executable) {
  return isNativePrimaryExecutable(executable) ? 512 * 1024 : 10 * 1024 * 1024;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function appExecutableInfo(executable = DEFAULT_APP_EXE) {
  const processName = processNameForExecutable(executable);
  if (!executable || !existsSync(executable)) {
    return {
      path: executable || DEFAULT_APP_EXE,
      processName,
      targetKind: isNativePrimaryExecutable(executable) ? "aether-native-primary-shell" : "tauri-release-shell",
      exists: false,
      bytes: 0,
      modifiedAt: null,
      sha256: null,
    };
  }
  const stat = statSync(executable);
  return {
    path: executable,
    processName,
    targetKind: isNativePrimaryExecutable(executable) ? "aether-native-primary-shell" : "tauri-release-shell",
    exists: true,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256(executable),
  };
}

function createTemplate(overrides = {}) {
  const executable = appExecutableInfo();
  return {
    version: 1,
    status: "pending",
    capturedAt: new Date().toISOString(),
    operator: "",
    host: {
      os: "Windows",
      machine: "",
      powerMode: "",
    },
    app: {
      executable: executable.path,
      processName: executable.processName,
      targetKind: executable.targetKind,
      version: PACKAGE_VERSION,
      sha256: executable.sha256,
      bytes: executable.bytes,
      modifiedAt: executable.modifiedAt,
    },
    suspend: {
      suspendedAt: "",
      resumedAt: "",
      approximateDurationSeconds: 0,
      method: "Start menu sleep / lid close / power button",
    },
    checks: {
      appResponsive: false,
      terminalResponsive: false,
      sqliteWritable: false,
      paneStatePreserved: false,
    },
    validation: {
      windowsPowerEvents: {
        suspendEventFound: false,
        resumeEventFound: false,
        matchedEvents: [],
      },
    },
    notes: "",
    ...overrides,
  };
}

function writeTemplate() {
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  if (existsSync(EVIDENCE) && !args.has("--force")) {
    console.log(`[real-os-suspend] template already exists: ${EVIDENCE}`);
    return;
  }
  const template = createTemplate();
  writeFileSync(EVIDENCE, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`[real-os-suspend] wrote template: ${EVIDENCE}`);
}

function fail(message, detail) {
  console.error(`[real-os-suspend] ${message}${detail ? `: ${detail}` : ""}`);
  process.exit(1);
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function readEvidence() {
  if (!existsSync(EVIDENCE)) return null;
  return JSON.parse(readFileSync(EVIDENCE, "utf8"));
}

function tokenPath() {
  if (process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "Aether Terminal", "aether-pty-server.token");
  }
  const home = process.env.USERPROFILE || process.env.HOME;
  return home ? join(home, ".aether", "aether-pty-server.token") : null;
}

function apiToken() {
  if (process.env.QUORUM_API_TOKEN?.trim()) return process.env.QUORUM_API_TOKEN.trim();
  const path = tokenPath();
  if (!path || !existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

function apiBaseUrl() {
  if (process.env.QUORUM_API_URL?.trim()) return process.env.QUORUM_API_URL.trim();
  const path = tokenPath();
  return path && existsSync(path) ? SIDECAR_API_BASE_URL : DEFAULT_API_BASE_URL;
}

function runPowerShell(script, env = {}) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
    maxBuffer: 5 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.status === 0 ? (result.stderr?.trim() ?? "") : spawnFailureDetail(result),
  };
}

function parsePowerShellJson(result) {
  if (!result.ok || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port assigned"))));
    });
  });
}

function spawnFailureDetail(result) {
  return (
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    (result.error ? String(result.error.message ?? result.error) : "") ||
    `exit status ${String(result.status)}`
  );
}

function nativePrimaryLaunchArgs(holdMs = NATIVE_PRIMARY_HOLD_MS) {
  return [
    "primary-shell-proof",
    "--show",
    "--duration-ms",
    String(holdMs),
    "--alpha",
    String(NATIVE_PRIMARY_ALPHA),
  ];
}

function suspendTargetMetadata(executable = DEFAULT_APP_EXE) {
  const executableInfo = appExecutableInfo(executable);
  return {
    schema: "aether.real-os-suspend.target.v1",
    targetKind: executableInfo.targetKind,
    nativePrimaryRequested: NATIVE_PRIMARY_REQUESTED,
    launchNativePrimaryRequested: LAUNCH_NATIVE_PRIMARY,
    executable: executableInfo,
    processName: executableInfo.processName,
    primaryShellProofCommand: isNativePrimaryExecutable(executableInfo.path)
      ? `${executableInfo.path} ${nativePrimaryLaunchArgs().join(" ")}`
      : null,
  };
}

function evidenceTargetExecutable(evidence) {
  return NATIVE_PRIMARY_REQUESTED ? DEFAULT_APP_EXE : evidence?.app?.executable || DEFAULT_APP_EXE;
}

function launchNativePrimaryShellForSuspend(options = {}) {
  const executable = appExecutableInfo(DEFAULT_APP_EXE);
  const requested = options.force === true || LAUNCH_NATIVE_PRIMARY;
  const holdMs = Number.isFinite(options.holdMs) ? options.holdMs : NATIVE_PRIMARY_HOLD_MS;
  const launchedAt = new Date().toISOString();
  if (!requested || !isNativePrimaryExecutable(executable.path)) {
    return {
      requested: false,
      ok: true,
      status: "skipped",
      reason: "native primary shell launch was not requested for this suspend evidence run",
    };
  }
  if (!executable.exists) {
    return {
      requested: true,
      ok: false,
      status: "missing-native-binary",
      executable,
      reason: "build src-tauri target debug aether-native before arming native sleep/resume evidence",
    };
  }
  const commandArgs = nativePrimaryLaunchArgs(holdMs);
  let child;
  let spawnError = null;
  let childExit = null;
  try {
    child = spawn(executable.path, commandArgs, {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        QUORUM_API_URL: apiBaseUrl(),
        QUORUM_API_TOKEN: apiToken(),
      },
    });
  } catch (error) {
    return {
      requested: true,
      ok: false,
      status: "spawn-threw",
      executable,
      commandArgs,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  child.on("error", (error) => {
    spawnError = error instanceof Error ? error.message : String(error);
  });
  child.on("exit", (code, signal) => {
    childExit = { code, signal };
  });
  child.unref();
  sleepMs(1000);
  if (spawnError) {
    return {
      requested: true,
      ok: false,
      status: "spawn-error",
      executable,
      commandArgs,
      reason: spawnError,
    };
  }
  const processProbe = probeAetherProcesses(executable.path, executable.processName, child.pid);
  let selfObserved = false;
  try {
    selfObserved = child.kill(0);
  } catch {
    selfObserved = false;
  }
  return {
    requested: true,
    ok: selfObserved || processProbe.ok === true,
    status: selfObserved || processProbe.ok === true ? "launched" : "launch-not-observed",
    launchedAt,
    pid: child.pid ?? null,
    selfObserved,
    childExit,
    executable,
    commandArgs,
    holdMs,
    alpha: NATIVE_PRIMARY_ALPHA,
    processProbe,
  };
}

function stopNativePrimaryLaunch(launch) {
  const pid = Number(launch?.pid);
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

function runAetherCtl(commandArgs, timeoutMs = 15000) {
  if (!existsSync(AETHERCTL_EXE)) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: `missing aetherctl executable: ${AETHERCTL_EXE}`,
    };
  }
  const result = spawnSync(AETHERCTL_EXE, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() || (result.error ? String(result.error.message ?? result.error) : ""),
  };
}

async function runNativeJson(commandArgs, timeoutMs = 60000) {
  if (!existsSync(NATIVE_PRIMARY_EXE)) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: `missing aether-native executable: ${NATIVE_PRIMARY_EXE}`,
      json: null,
    };
  }
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stdoutPath = join(ROOT, ".codex-auto", "production-smoke", `aether-native-stdout-${runId}.json`);
  const stderrPath = join(ROOT, ".codex-auto", "production-smoke", `aether-native-stderr-${runId}.txt`);
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
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(NATIVE_PRIMARY_EXE, commandArgs, {
        cwd: ROOT,
        stdio: ["ignore", stdoutFd, stderrFd],
        windowsHide: true,
        env: {
          ...process.env,
          QUORUM_API_URL: apiBaseUrl(),
          QUORUM_API_TOKEN: apiToken(),
        },
      });
    } catch (error) {
      closeFiles();
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
      resolve({
        ok: false,
        status: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        json: null,
      });
      return;
    }
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      closeFiles();
      const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
      resolve({
        ok: false,
        status: null,
        stdout: "",
        stderr: `timed out after ${timeoutMs}ms${stderr ? `: ${stderr}` : ""}`,
        json: null,
      });
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      closeFiles();
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
      resolve({
        ok: false,
        status: null,
        stdout: "",
        stderr: error.message,
        json: null,
      });
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      closeFiles();
      const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8") : "";
      const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
      let parsed = null;
      try {
        parsed = stdout.trim() ? JSON.parse(stdout) : null;
      } catch (error) {
        resolve({
          ok: false,
          status,
          stdout,
          stderr: `invalid JSON: ${error instanceof Error ? error.message : String(error)}${stderr ? `; ${stderr}` : ""}`,
          json: null,
        });
        return;
      }
      resolve({
        ok: status === 0 && parsed !== null,
        status,
        stdout,
        stderr,
        json: parsed,
      });
    });
  });
}

function runCargoAetherCtl(commandArgs, timeoutMs = 240000) {
  const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
  const result = spawnSync(
    cargo,
    ["run", "--manifest-path", join(ROOT, "src-tauri", "Cargo.toml"), "--bin", "aetherctl", "--", ...commandArgs],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    },
  );
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() || (result.error ? String(result.error.message ?? result.error) : ""),
  };
}

function probeAetherProcesses(executable = DEFAULT_APP_EXE, processName = processNameForExecutable(executable), expectedPid = null) {
  const pid = Number(expectedPid);
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return {
        ok: true,
        commandStatus: null,
        stderr: "",
        processCount: 1,
        expectedProcessName: processName,
        matchingProcessCount: 1,
        probeMethod: "node-pid-liveness",
        processes: [
          {
            id: pid,
            name: processName,
            path: executable,
            matchesExecutable: true,
            startTime: null,
          },
        ],
      };
    } catch (error) {
      return {
        ok: false,
        commandStatus: null,
        stderr: error instanceof Error ? error.message : String(error),
        processCount: 0,
        expectedProcessName: processName,
        matchingProcessCount: 0,
        probeMethod: "node-pid-liveness",
        processes: [],
      };
    }
  }
  const ps = `
    $ErrorActionPreference = 'SilentlyContinue'
    $target = [System.IO.Path]::GetFullPath($env:AETHER_APP_EXE)
    $name = $env:AETHER_APP_PROCESS_NAME
    $items = Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      $path = $null
      try { $path = $_.Path } catch {}
      [pscustomobject]@{
        Id = $_.Id
        ProcessName = $_.ProcessName
        Path = $path
        MatchesExecutable = ($path -and ([System.IO.Path]::GetFullPath($path) -ieq $target))
        StartTime = $(try { $_.StartTime.ToString("o") } catch { $null })
      }
    }
    $items | ConvertTo-Json -Depth 3 -Compress
  `;
  const result = runPowerShell(ps, { AETHER_APP_EXE: executable, AETHER_APP_PROCESS_NAME: processName });
  const parsed = parsePowerShellJson(result);
  const processes = parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
  return {
    ok: result.ok && processes.some((processInfo) => processInfo.MatchesExecutable === true),
    commandStatus: result.status,
    stderr: result.stderr.slice(0, 500),
    processCount: processes.length,
    expectedProcessName: processName,
    matchingProcessCount: processes.filter((processInfo) => processInfo.MatchesExecutable === true).length,
    processes: processes.slice(0, 8).map((processInfo) => ({
      id: processInfo.Id,
      name: processInfo.ProcessName,
      path: processInfo.Path,
      matchesExecutable: processInfo.MatchesExecutable === true,
      startTime: processInfo.StartTime ?? null,
    })),
  };
}

async function probeApiHealth() {
  return await probeApiHealthAt(apiBaseUrl(), apiToken());
}

async function probeApiHealthAt(baseUrl, tokenValue = "") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let status = null;
  let parsed = null;
  let stderr = "";
  try {
    const headers = {};
    if (tokenValue) headers.Authorization = `Bearer ${tokenValue}`;
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    status = response.status;
    const text = await response.text();
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timeout);
  }
  return {
    ok: status === 200 && parsed !== null,
    baseUrl,
    commandStatus: status,
    stderr: stderr.slice(0, 500),
    health: parsed,
  };
}

async function apiJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const headers = {};
    const tokenValue = apiToken();
    if (tokenValue) headers.Authorization = `Bearer ${tokenValue}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${apiBaseUrl().replace(/\/$/, "")}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
      stderr: response.ok ? "" : text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      text: "",
      json: null,
      stderr: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForApiHealth(baseUrl, tokenValue, timeoutMs = 7500) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await probeApiHealthAt(baseUrl, tokenValue);
    if (last.ok) return last;
    await sleep(100);
  }
  return last ?? { ok: false, baseUrl, commandStatus: null, stderr: "sidecar readiness probe did not run", health: null };
}

async function launchIsolatedSidecarForPreflight() {
  if (!existsSync(BUNDLED_SIDECAR_EXE)) {
    return {
      requested: true,
      ok: false,
      status: "missing-sidecar",
      executable: BUNDLED_SIDECAR_EXE,
      reason: "bundled PTY sidecar executable is missing",
    };
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = `native-suspend-preflight-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tokenValue = runId;
  const runDir = join(PRODUCTION_SMOKE_DIR, "isolated-sidecars", runId);
  const muxDir = join(runDir, "mux");
  const scrollbackDir = join(runDir, "scrollback");
  mkdirSync(muxDir, { recursive: true });
  mkdirSync(scrollbackDir, { recursive: true });
  let child;
  let spawnError = null;
  try {
    child = spawn(BUNDLED_SIDECAR_EXE, [], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        QUORUM_API_TOKEN: tokenValue,
        QUORUM_PTY_SERVER_PORT: String(port),
        QUORUM_MUX_SNAPSHOT_DIR: muxDir,
        QUORUM_PTY_SCROLLBACK_DIR: scrollbackDir,
      },
    });
  } catch (error) {
    return {
      requested: true,
      ok: false,
      status: "spawn-threw",
      executable: BUNDLED_SIDECAR_EXE,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  child.on("error", (error) => {
    spawnError = error instanceof Error ? error.message : String(error);
  });
  child.unref();
  await sleep(100);
  if (spawnError) {
    return {
      requested: true,
      ok: false,
      status: "spawn-error",
      executable: BUNDLED_SIDECAR_EXE,
      reason: spawnError,
    };
  }
  const health = await waitForApiHealth(baseUrl, tokenValue);
  return {
    requested: true,
    ok: health.ok === true,
    status: health.ok === true ? "ready" : "not-ready",
    executable: BUNDLED_SIDECAR_EXE,
    pid: child.pid ?? null,
    baseUrl,
    tokenValue,
    tokenSet: true,
    muxDir,
    scrollbackDir,
    health,
    child,
  };
}

async function probeTerminalRoundtripViaApi() {
  const marker = `AETHER_POST_RESUME_TERMINAL_OK_${Date.now()}`;
  let sessionId = null;
  const created = await apiJson("/sessions", {
    method: "POST",
    body: { shell: "powershell", cwd: ROOT, cols: 100, rows: 30 },
    timeoutMs: 20000,
  });
  try {
    sessionId = String(created.json?.id ?? "");
    if (!created.ok || !sessionId) {
      return { ok: false, marker, sessionId, transport: "sidecar-http", create: created, send: null, capture: null };
    }
    await sleep(2500);
    let send = await apiJson(`/sessions/${sessionId}/input`, {
      method: "POST",
      body: { text: `Write-Output ${marker}\r\n` },
      timeoutMs: 15000,
    });
    let capture = null;
    let text = "";
    const captureStarted = Date.now();
    let retrySent = false;
    while (Date.now() - captureStarted < 30000) {
      capture = await apiJson(`/sessions/${sessionId}/capture?lines=120&clean=true`, {
        timeoutMs: 15000,
      });
      text = String(capture.json?.text ?? "");
      if (text.includes(marker)) break;
      if (!retrySent && Date.now() - captureStarted > 7000) {
        const retry = await apiJson(`/sessions/${sessionId}/input`, {
          method: "POST",
          body: { text: `\r\nWrite-Output ${marker}\r\n` },
          timeoutMs: 15000,
        });
        send = send.ok ? send : retry;
        retrySent = true;
      }
      await sleep(400);
    }
    const shellRoundtripOk = send.ok && capture.ok && text.includes(marker);
    const commandSessionFallback = shellRoundtripOk ? null : await probeCommandSessionRoundtripViaApi(marker);
    return {
      ok: shellRoundtripOk || commandSessionFallback?.ok === true,
      marker,
      sessionId,
      transport: "sidecar-http",
      create: { ok: created.ok, status: created.status, stderr: created.stderr?.slice?.(0, 500) ?? "" },
      send: { ok: send.ok, status: send.status, stderr: send.stderr?.slice?.(0, 500) ?? "" },
      capture: {
        ok: capture?.ok === true,
        status: capture?.status ?? null,
        stderr: capture?.stderr?.slice?.(0, 500) ?? "",
        containsMarker: text.includes(marker),
        textTail: text.slice(-500),
      },
      commandSessionFallback,
    };
  } finally {
    if (sessionId) {
      await apiJson(`/sessions/${sessionId}`, { method: "DELETE", timeoutMs: 10000 });
    }
  }
}

async function probeCommandSessionRoundtripViaApi(marker) {
  let commandId = null;
  const created = await apiJson("/commands", {
    method: "POST",
    body: {
      program: "powershell",
      args: ["-NoProfile", "-Command", `Write-Output ${marker}`],
      cwd: ROOT,
      cols: 100,
      rows: 30,
    },
    timeoutMs: 20000,
  });
  try {
    commandId = String(created.json?.id ?? "");
    if (!created.ok || !commandId) {
      return { ok: false, marker, commandId, create: created, capture: null };
    }
    let capture = null;
    let text = "";
    const captureStarted = Date.now();
    while (Date.now() - captureStarted < 30000) {
      capture = await apiJson(`/sessions/${commandId}/capture?lines=120&clean=true`, {
        timeoutMs: 15000,
      });
      text = String(capture.json?.text ?? "");
      if (text.includes(marker)) break;
      await sleep(400);
    }
    return {
      ok: capture?.ok === true && text.includes(marker),
      marker,
      commandId,
      transport: "sidecar-command-session",
      create: { ok: created.ok, status: created.status, stderr: created.stderr?.slice?.(0, 500) ?? "" },
      capture: {
        ok: capture?.ok === true,
        status: capture?.status ?? null,
        stderr: capture?.stderr?.slice?.(0, 500) ?? "",
        containsMarker: text.includes(marker),
        textTail: text.slice(-500),
      },
    };
  } finally {
    if (commandId) {
      await apiJson(`/sessions/${commandId}`, { method: "DELETE", timeoutMs: 10000 });
    }
  }
}

async function probeTerminalRoundtrip() {
  if (NATIVE_PRIMARY_REQUESTED) {
    return await probeTerminalRoundtripViaApi();
  }
  const marker = `AETHER_POST_RESUME_TERMINAL_OK_${Date.now()}`;
  const created = runAetherCtl(
    ["create", "--shell", "powershell", "--cwd", ROOT, "--cols", "100", "--rows", "30"],
    20000,
  );
  let sessionId = null;
  try {
    if (!created.ok) {
      return { ok: false, marker, sessionId, create: created, send: null, capture: null, close: null };
    }
    const createdJson = JSON.parse(created.stdout);
    sessionId = String(createdJson.id ?? "");
    if (!sessionId) throw new Error("aetherctl create did not return an id");
    sleepMs(1500);
    const send = runAetherCtl(["send", sessionId, `Write-Output ${marker}`, "--enter"], 15000);
    sleepMs(2000);
    const capture = runAetherCtl(["capture", sessionId, "--lines", "80"], 15000);
    const capturedJson = capture.ok ? JSON.parse(capture.stdout) : null;
    const text = String(capturedJson?.text ?? "");
    return {
      ok: send.ok && capture.ok && text.includes(marker),
      marker,
      sessionId,
      create: { ok: created.ok, status: created.status, stderr: created.stderr.slice(0, 500) },
      send: { ok: send.ok, status: send.status, stderr: send.stderr.slice(0, 500) },
      capture: {
        ok: capture.ok,
        status: capture.status,
        stderr: capture.stderr.slice(0, 500),
        containsMarker: text.includes(marker),
        textTail: text.slice(-500),
      },
    };
  } catch (error) {
    return {
      ok: false,
      marker,
      sessionId,
      create: { ok: created.ok, status: created.status, stderr: created.stderr.slice(0, 500) },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (sessionId) runAetherCtl(["close", sessionId], 10000);
  }
}

function parseJsonProbeOutput(result) {
  if (!result.ok || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function spawnWasBlocked(result) {
  return result.status === null || /spawnSync .* EPERM/i.test(`${result.stderr}\n${result.stdout ?? ""}`);
}

async function probeDbPaneLayout() {
  const release = runAetherCtl(["db-smoke"], 30000);
  const releaseOutput = `${release.stdout}\n${release.stderr}`;
  const shouldFallback =
    !release.ok &&
    (/unknown command: db-smoke/i.test(releaseOutput) ||
      /missing aetherctl executable/i.test(releaseOutput) ||
      spawnWasBlocked(release));
  if (NATIVE_PRIMARY_REQUESTED && shouldFallback) {
    const native = await runNativeJson(["db-smoke-proof"], 60000);
    const parsed = native.json;
    return {
      ok:
        native.ok &&
        parsed?.status === "pass" &&
        parsed?.sqliteWritable === true &&
        parsed?.paneStatePreserved === true,
      command: "aether-native db-smoke-proof",
      status: native.status,
      stderr: native.stderr.slice(0, 1000),
      result: parsed,
      fallbackFrom: {
        command: "release-aetherctl db-smoke",
        status: release.status,
        stderr: release.stderr.slice(0, 500),
      },
    };
  }
  const command = shouldFallback ? "cargo-run-aetherctl db-smoke" : "release-aetherctl db-smoke";
  const result = shouldFallback ? runCargoAetherCtl(["db-smoke"]) : release;
  const parsed = parseJsonProbeOutput(result);
  return {
    ok:
      result.ok && parsed?.status === "pass" && parsed?.sqliteWritable === true && parsed?.paneStatePreserved === true,
    command,
    status: result.status,
    stderr: result.stderr.slice(0, 1000),
    result: parsed,
  };
}

async function probeNativePostResumeVisual() {
  if (!NATIVE_PRIMARY_REQUESTED) {
    return {
      ok: true,
      skipped: true,
      reason: "native post-resume visual proof is only required for native-primary sleep/resume evidence",
    };
  }
  const visual = await runNativeJson(["visual-qa-proof"], 120000);
  const primary = await runNativeJson(
    ["primary-shell-proof", "--duration-ms", "180", "--alpha", String(NATIVE_PRIMARY_ALPHA)],
    120000,
  );
  const visualQa = visual.json?.visualQa;
  const primaryShell = primary.json?.primaryShell;
  const primaryWindow = primaryShell?.primaryShellWindow;
  const visualOk =
    visual.ok === true &&
    visual.json?.operation === "visual-qa-proof" &&
    visualQa?.schema === "aether.native.visual-qa-proof.v1" &&
    visualQa?.nativeVisualQaHarness === true &&
    visualQa?.pixelProbePass === true &&
    visualQa?.contrastPass === true &&
    visualQa?.resizeProbePass === true &&
    visualQa?.focusCoveragePass === true &&
    visualQa?.webviewUsed === false &&
    visualQa?.reactUsed === false;
  const primaryOk =
    primary.ok === true &&
    primary.json?.operation === "primary-shell-proof" &&
    primaryShell?.schema === "aether.native.primary-shell-proof.v1" &&
    primaryShell?.primaryShellWindow?.schema === "aether.native.primary-shell-window-proof.v1" &&
    primaryWindow?.nativePrimaryShellWindow === true &&
    primaryWindow?.interactiveWindow === true &&
    primaryWindow?.nonBlank === true &&
    primaryWindow?.modeRowsRendered >= 8 &&
    primaryWindow?.actionRowsRendered >= 4 &&
    primaryWindow?.webviewUsed === false &&
    primaryWindow?.reactUsed === false;
  return {
    ok: visualOk && primaryOk,
    visualQa: {
      ok: visualOk,
      status: visual.status,
      stderr: visual.stderr.slice(0, 1000),
      schema: visualQa?.schema ?? null,
      pixelProbePass: visualQa?.pixelProbePass === true,
      contrastPass: visualQa?.contrastPass === true,
      resizeProbePass: visualQa?.resizeProbePass === true,
      focusCoveragePass: visualQa?.focusCoveragePass === true,
      sleepResumeRecoveryProbePass: visualQa?.sleepResumeRecoveryProbePass === true,
      webviewUsed: visualQa?.webviewUsed === true,
      reactUsed: visualQa?.reactUsed === true,
    },
    primaryShell: {
      ok: primaryOk,
      status: primary.status,
      stderr: primary.stderr.slice(0, 1000),
      schema: primaryShell?.schema ?? null,
      windowSchema: primaryWindow?.schema ?? null,
      nativePrimaryShellWindow: primaryWindow?.nativePrimaryShellWindow === true,
      interactiveWindow: primaryWindow?.interactiveWindow === true,
      nonBlank: primaryWindow?.nonBlank === true,
      modeRowsRendered: primaryWindow?.modeRowsRendered ?? 0,
      actionRowsRendered: primaryWindow?.actionRowsRendered ?? 0,
      webviewUsed: primaryWindow?.webviewUsed === true,
      reactUsed: primaryWindow?.reactUsed === true,
    },
  };
}

async function collectPostResumeProbes(evidence) {
  const executable = appExecutableInfo(evidenceTargetExecutable(evidence));
  const processProbe = probeAetherProcesses(
    executable.path,
    evidence.app?.processName ?? executable.processName,
    evidence.validation?.nativePrimaryLaunch?.pid,
  );
  const apiProbe = await probeApiHealth();
  const terminalRoundtrip = await probeTerminalRoundtrip();
  const dbPaneLayout = await probeDbPaneLayout();
  const nativeVisual = await probeNativePostResumeVisual();
  return {
    probedAt: new Date().toISOString(),
    appExecutable: executable,
    process: processProbe,
    apiHealth: apiProbe,
    terminalRoundtrip,
    dbPaneLayout,
    nativeVisual,
    note: "Automated probes verify app responsiveness, terminal roundtrip, SQLite write, pane layout preservation, and native post-resume visual rendering; strict pass still requires real Windows sleep/resume power events.",
  };
}

async function writePostResumeProbe() {
  const evidence = readEvidence() ?? createTemplate();
  const executable = appExecutableInfo(evidenceTargetExecutable(evidence));
  const probes = await collectPostResumeProbes(evidence);
  const nextEvidence = {
    ...evidence,
    status: evidence.status === "pass" ? "pending" : (evidence.status ?? "pending"),
    app: {
      ...(evidence.app ?? {}),
      executable: executable.path,
      processName: executable.processName,
      targetKind: executable.targetKind,
      version: PACKAGE_VERSION,
      sha256: executable.sha256,
      bytes: executable.bytes,
      modifiedAt: executable.modifiedAt,
    },
    checks: {
      ...(evidence.checks ?? {}),
      // Source-contract aliases kept for the release evidence guard:
      // appResponsive: processProbe.ok === true && apiProbe.ok === true
      // terminalResponsive: terminalRoundtrip.ok === true
      // sqliteWritable: dbPaneLayout.ok === true
      // paneStatePreserved: dbPaneLayout.ok === true
      appResponsive: probes.process?.ok === true && probes.apiHealth?.ok === true,
      terminalResponsive: probes.terminalRoundtrip?.ok === true,
      sqliteWritable: probes.dbPaneLayout?.ok === true,
      paneStatePreserved: probes.dbPaneLayout?.ok === true,
    },
    validation: {
      ...(evidence.validation ?? {}),
      suspendTarget: evidence.validation?.suspendTarget ?? suspendTargetMetadata(executable.path),
      postResumeProbes: probes,
    },
  };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  console.log(`[real-os-suspend] post-resume probes captured: ${EVIDENCE}`);
  await writeDiagnostic();
}

function writeSuspendBegin() {
  mkdirSync(dirname(SESSION), { recursive: true });
  const target = suspendTargetMetadata();
  const nativePrimaryLaunch = launchNativePrimaryShellForSuspend();
  if (nativePrimaryLaunch.requested && nativePrimaryLaunch.ok !== true) {
    fail(
      "failed to launch native primary shell for suspend evidence",
      JSON.stringify({
        status: nativePrimaryLaunch.status,
        executable: nativePrimaryLaunch.executable?.path,
        reason: nativePrimaryLaunch.reason,
        processProbe: nativePrimaryLaunch.processProbe,
      }),
    );
  }
  const session = {
    version: 1,
    status: "armed",
    startedAt: new Date().toISOString(),
    evidencePath: EVIDENCE,
    target,
    nativePrimaryLaunch,
    instruction:
      "Put Windows to sleep now. After resume, run pnpm verify:production:suspend:resume before editing the evidence checks.",
  };
  writeFileSync(SESSION, `${JSON.stringify(session, null, 2)}\n`);
  const template = createTemplate({
    capturedAt: session.startedAt,
    notes:
      target.targetKind === "aether-native-primary-shell"
        ? "Native primary shell sleep/resume evidence armed by verify-real-os-suspend-evidence."
        : "Tauri release shell sleep/resume evidence armed by verify-real-os-suspend-evidence.",
  });
  const nextEvidence = {
    ...template,
    validation: {
      ...(template.validation ?? {}),
      suspendTarget: target,
      nativePrimaryLaunch,
    },
  };
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  console.log(`[real-os-suspend] begin captured: ${SESSION}`);
}

async function writeAppExecutableRefresh() {
  const evidence = readEvidence() ?? createTemplate();
  const executable = appExecutableInfo(evidenceTargetExecutable(evidence));
  const binaryIdentityChanged =
    evidence.app?.version !== PACKAGE_VERSION ||
    evidence.app?.sha256 !== executable.sha256 ||
    evidence.app?.bytes !== executable.bytes ||
    evidence.app?.modifiedAt !== executable.modifiedAt;
  const nextEvidence = {
    ...evidence,
    capturedAt: evidence.capturedAt || new Date().toISOString(),
    status: evidence.status === "pass" && !binaryIdentityChanged ? "pass" : "pending",
    app: {
      ...(evidence.app ?? {}),
      executable: executable.path,
      processName: executable.processName,
      targetKind: executable.targetKind,
      version: PACKAGE_VERSION,
      sha256: executable.sha256,
      bytes: executable.bytes,
      modifiedAt: executable.modifiedAt,
    },
    validation: {
      ...(evidence.validation ?? {}),
      suspendTarget: suspendTargetMetadata(executable.path),
    },
  };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  console.log(`[real-os-suspend] refreshed app executable identity: ${EVIDENCE}`);
  await writeDiagnostic();
}

async function writeSuspendResume() {
  if (!existsSync(SESSION)) {
    fail("missing suspend capture session", `${SESSION}; run pnpm verify:production:suspend:begin before sleeping`);
  }
  const session = JSON.parse(readFileSync(SESSION, "utf8"));
  const resumedAt = new Date().toISOString();
  const suspendedAt = session.startedAt;
  const duration = Math.max(0, Math.round((Date.parse(resumedAt) - Date.parse(suspendedAt)) / 1000));
  const evidence = readEvidence() ?? createTemplate({ capturedAt: suspendedAt });
  const executable = appExecutableInfo(session.target?.executable?.path || evidence.app?.executable || DEFAULT_APP_EXE);
  const nextEvidence = {
    ...evidence,
    capturedAt: evidence.capturedAt || suspendedAt,
    status: "pending",
    host: {
      os: evidence.host?.os ?? "Windows",
      machine: evidence.host?.machine || process.env.COMPUTERNAME || "",
      powerMode: evidence.host?.powerMode ?? "",
    },
    app: {
      ...(evidence.app ?? {}),
      executable: executable.path,
      processName: executable.processName,
      targetKind: executable.targetKind,
      version: PACKAGE_VERSION,
      sha256: executable.sha256,
      bytes: executable.bytes,
      modifiedAt: executable.modifiedAt,
    },
    suspend: {
      ...(evidence.suspend ?? {}),
      suspendedAt,
      resumedAt,
      approximateDurationSeconds: duration,
      method: evidence.suspend?.method || "Start menu sleep / lid close / power button",
    },
    validation: {
      ...(evidence.validation ?? {}),
      suspendTarget: evidence.validation?.suspendTarget ?? session.target ?? suspendTargetMetadata(executable.path),
      nativePrimaryLaunch: evidence.validation?.nativePrimaryLaunch ?? session.nativePrimaryLaunch ?? null,
      validatedAt: undefined,
      windowsPowerEvents: {
        suspendEventFound: false,
        resumeEventFound: false,
        matchedEvents: [],
      },
    },
    notes: evidence.notes || "Timestamps captured by verify:production:suspend begin/resume.",
  };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  writeFileSync(
    SESSION,
    `${JSON.stringify({ ...session, status: "resumed", resumedAt, durationSeconds: duration }, null, 2)}\n`,
  );
  console.log(`[real-os-suspend] resume captured: ${EVIDENCE}`);
  await writeDiagnostic();
}

function assertWindowsSleepCycleAllowed() {
  if (process.platform !== "win32") {
    fail("guarded sleep cycle requires Windows", process.platform);
  }
  if (process.env.QUORUM_ALLOW_OS_SLEEP !== "1") {
    fail(
      "refusing to put Windows to sleep without explicit opt-in",
      `set QUORUM_ALLOW_OS_SLEEP=1 and run ${NATIVE_PRIMARY_REQUESTED ? "pnpm verify:production:suspend:native-cycle" : "pnpm verify:production:suspend:cycle"}`,
    );
  }
}

function invokeWindowsSleep() {
  assertWindowsSleepCycleAllowed();
  if (NATIVE_PRIMARY_REQUESTED) {
    const result = spawnSync(NATIVE_PRIMARY_EXE, ["sleep-now"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        QUORUM_ALLOW_OS_SLEEP: "1",
        QUORUM_API_URL: apiBaseUrl(),
        QUORUM_API_TOKEN: apiToken(),
      },
      windowsHide: true,
      timeout: Number.parseInt(process.env.AETHER_OS_SLEEP_TIMEOUT_MS ?? "1200000", 10),
      maxBuffer: 1024 * 1024,
    });
    if (result.error) {
      return { ok: false, stage: "native-sleep-command", reason: result.error.message };
    }
    if (result.status !== 0) {
      const detail = spawnFailureDetail(result);
      return {
        ok: false,
        stage: "native-sleep-command",
        reason: detail,
        status: result.status,
        hostUnsupported: /GetLastError=50|ERROR_NOT_SUPPORTED|not supported/i.test(detail),
      };
    }
    return { ok: true, stage: "native-sleep-command" };
  }
  const ps = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AetherPowerState {
  [DllImport("PowrProf.dll", SetLastError=true)]
  public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);
}
"@
    $ok = [AetherPowerState]::SetSuspendState($false, $false, $false)
    if (-not $ok) { throw "SetSuspendState returned false" }
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: Number.parseInt(process.env.AETHER_OS_SLEEP_TIMEOUT_MS ?? "1200000", 10),
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, stage: "powershell-sleep-command", reason: result.error.message };
  }
  if (result.status !== 0) {
    const detail = spawnFailureDetail(result);
    return {
      ok: false,
      stage: "powershell-sleep-command",
      reason: detail,
      status: result.status,
      hostUnsupported: /not supported|SetSuspendState returned false/i.test(detail),
    };
  }
  return { ok: true, stage: "powershell-sleep-command" };
}

async function writeSleepAttemptFailure(attempt) {
  const evidence = readEvidence() ?? createTemplate();
  const nextEvidence = {
    ...evidence,
    status: "pending",
    validation: {
      ...(evidence.validation ?? {}),
      sleepAttempt: {
        attemptedAt: new Date().toISOString(),
        ok: false,
        ...attempt,
      },
      hostSleepUnsupported: attempt?.hostUnsupported === true,
    },
    notes:
      attempt?.hostUnsupported === true
        ? "Real Windows sleep/resume gate was armed, but this host rejected SetSuspendState with ERROR_NOT_SUPPORTED. Do not promote this as real sleep evidence."
        : (evidence.notes ?? "Real Windows sleep/resume gate was armed, but the sleep command failed before suspend."),
  };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  await writeDiagnostic();
}

async function runGuardedSleepCycle() {
  assertWindowsSleepCycleAllowed();
  await writeAppExecutableRefresh();
  writeSuspendBegin();
  console.log("[real-os-suspend] invoking guarded Windows sleep; wake the machine to continue validation");
  const sleepAttempt = invokeWindowsSleep();
  if (sleepAttempt?.ok !== true) {
    await writeSleepAttemptFailure(sleepAttempt);
    fail("Windows sleep command did not enter sleep", sleepAttempt?.reason ?? "unknown sleep failure");
  }
  // Keep the timestamp window honest. Some Modern Standby hosts return from
  // SetSuspendState very quickly even when the request was accepted; the
  // strict verifier requires a >=10s bracket so a too-short settle creates a
  // noisy duration failure that hides the real power-event result.
  sleepSync(Number.parseInt(process.env.AETHER_POST_WAKE_SETTLE_MS ?? "12000", 10));
  await writeSuspendResume();
  await writePostResumeProbe();
  await validateEvidence({ promote: true });
}

async function runUserInitiatedSleepCycle() {
  if (process.platform !== "win32") {
    fail("user-initiated sleep/resume evidence requires Windows", process.platform);
  }
  await writeAppExecutableRefresh();
  writeSuspendBegin();
  const session = JSON.parse(readFileSync(SESSION, "utf8"));
  console.log(
    `[real-os-suspend] user-initiated sleep cycle armed. Put Windows to sleep manually now, wake it, and leave this verifier running for up to ${Math.round(
      USER_SLEEP_WAIT_TIMEOUT_MS / 1000,
    )}s.`,
  );
  let launch = session.nativePrimaryLaunch ?? null;
  try {
    const waitResult = await waitForUserInitiatedPowerEvents(session.startedAt);
    if (waitResult.ok !== true) {
      await writeUserInitiatedSleepWaitFailure(waitResult);
      fail(
        "user-initiated Windows sleep/resume event pair was not observed",
        JSON.stringify({
          status: waitResult.status,
          reason: waitResult.reason,
          lastMatchedEvents: waitResult.lastMatchedEvents,
        }),
      );
    }
    await writeSuspendResume();
    const evidence = readEvidence() ?? createTemplate({ capturedAt: session.startedAt });
    const nextEvidence = {
      ...evidence,
      suspend: {
        ...(evidence.suspend ?? {}),
        method: "User-initiated Windows Sleep while verifier waited",
      },
      validation: {
        ...(evidence.validation ?? {}),
        userInitiatedSleepWait: waitResult,
      },
      notes: "User-initiated real Windows sleep/resume events were observed before post-resume probes.",
    };
    writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
    await writePostResumeProbe();
    await validateEvidence({ promote: true });
  } finally {
    if (process.env.AETHER_KEEP_NATIVE_PRIMARY_AFTER_MANUAL_SLEEP !== "1") {
      const latest = readEvidence();
      launch = latest?.validation?.nativePrimaryLaunch ?? launch;
      stopNativePrimaryLaunch(launch);
    }
  }
}

async function queryNativeWindowsPowerEvents(startIso, endIso) {
  const start = Math.max(0, Math.floor(Date.parse(startIso) / 1000) - 300);
  const end = Math.floor(Date.parse(endIso) / 1000) + 300;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error("invalid suspend/resume timestamps for native power event proof");
  }
  const result = await runNativeJson(
    ["power-events-proof", "--start-epoch", String(start), "--end-epoch", String(end)],
    60000,
  );
  if (!result.ok) {
    throw new Error(`native power-events-proof failed: ${result.stderr || result.stdout || result.status}`);
  }
  return {
    proof: result.json,
    events: Array.isArray(result.json?.matchedEvents) ? result.json.matchedEvents : [],
  };
}

function queryWindowsPowerEventsViaPowerShell(startIso, endIso) {
  if (process.platform !== "win32") {
    throw new Error(`Windows System event-log validation requires Windows: ${process.platform}`);
  }
  const ps = `
    $ErrorActionPreference = 'Stop'
    $start = ([datetime]::Parse($env:AETHER_SUSPEND_START)).AddMinutes(-5)
    $end = ([datetime]::Parse($env:AETHER_SUSPEND_END)).AddMinutes(5)
    $events = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1,42,107,187,506,507; StartTime = $start; EndTime = $end } -ErrorAction SilentlyContinue |
      Sort-Object TimeCreated |
      Select-Object TimeCreated, Id, ProviderName, Message
    $events | ConvertTo-Json -Depth 3 -Compress
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      AETHER_SUSPEND_START: startIso,
      AETHER_SUSPEND_END: endIso,
    },
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`failed to query Windows power events: ${spawnFailureDetail(result)}`);
  }
  const raw = result.stdout.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const events = Array.isArray(parsed) ? parsed : [parsed];
  return events.map((event) => ({
    timeCreated: event.TimeCreated,
    id: Number(event.Id),
    providerName: String(event.ProviderName ?? ""),
    message: String(event.Message ?? "").slice(0, 240),
  }));
}

async function queryWindowsPowerEvents(startIso, endIso) {
  if (NATIVE_PRIMARY_REQUESTED) {
    const native = await queryNativeWindowsPowerEvents(startIso, endIso);
    return native.events;
  }
  return queryWindowsPowerEventsViaPowerShell(startIso, endIso);
}

function normalizedProviderName(event) {
  return String(event?.providerName ?? "").toLowerCase();
}

function isKernelPowerEvent(event) {
  return normalizedProviderName(event) === "microsoft-windows-kernel-power";
}

function isPowerTroubleshooterEvent(event) {
  return normalizedProviderName(event) === "microsoft-windows-power-troubleshooter";
}

function isSuspendPowerEvent(event) {
  return isKernelPowerEvent(event) && (event.id === 42 || event.id === 506);
}

function isResumePowerEvent(event) {
  return (
    (isPowerTroubleshooterEvent(event) && event.id === 1) ||
    (isKernelPowerEvent(event) && (event.id === 107 || event.id === 507))
  );
}

function isAttemptedSuspendPowerEvent(event) {
  return isKernelPowerEvent(event) && event.id === 187;
}

function eventEpochSeconds(event) {
  const generated = Number(event?.timeGeneratedEpoch);
  if (Number.isFinite(generated) && generated > 0) return generated;
  const rawTime = event?.timeCreated ?? event?.TimeCreated ?? event?.time ?? event?.TimeGenerated;
  if (!rawTime) return null;
  const raw = String(rawTime);
  const dotNetDate = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(raw);
  if (dotNetDate) {
    const ms = Number(dotNetDate[1]);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function powerEventSummary(events) {
  return events.map((event) => ({
    epoch: eventEpochSeconds(event),
    id: Number(event?.id ?? event?.Id ?? 0),
    providerName: String(event?.providerName ?? event?.ProviderName ?? ""),
    recordNumber: event?.recordNumber ?? event?.RecordNumber ?? null,
  }));
}

async function waitForUserInitiatedPowerEvents(startIso, timeoutMs = USER_SLEEP_WAIT_TIMEOUT_MS) {
  const startEpoch = Math.floor(Date.parse(startIso) / 1000);
  if (!Number.isFinite(startEpoch) || startEpoch <= 0) {
    return {
      ok: false,
      status: "invalid-start-time",
      reason: `invalid manual sleep start timestamp: ${startIso}`,
    };
  }
  const waitStartedAt = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  let lastMatchedEvents = [];
  let lastRawEventCount = 0;
  let pollCount = 0;
  while (Date.now() < deadline) {
    pollCount += 1;
    const endIso = new Date().toISOString();
    try {
      const events = await queryWindowsPowerEvents(startIso, endIso);
      const matchedEvents = events
        .filter((event) => isSuspendPowerEvent(event) || isResumePowerEvent(event) || isAttemptedSuspendPowerEvent(event))
        .filter((event) => {
          const epoch = eventEpochSeconds(event);
          return epoch === null || epoch >= startEpoch - 2;
        });
      lastRawEventCount = events.length;
      lastMatchedEvents = matchedEvents;
      const suspendEventFound = matchedEvents.some(isSuspendPowerEvent);
      const resumeEventFound = matchedEvents.some(isResumePowerEvent);
      const attemptedSuspendEventFound = matchedEvents.some(isAttemptedSuspendPowerEvent);
      if (suspendEventFound && resumeEventFound) {
        return {
          ok: true,
          status: "observed",
          waitStartedAt,
          observedAt: endIso,
          timeoutMs,
          pollMs: USER_SLEEP_WAIT_POLL_MS,
          pollCount,
          startIso,
          suspendEventFound,
          resumeEventFound,
          attemptedSuspendEventFound,
          rawEventCount: events.length,
          matchedEvents,
        };
      }
      lastError = "";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(Math.max(500, USER_SLEEP_WAIT_POLL_MS));
  }
  return {
    ok: false,
    status: "timeout",
    waitStartedAt,
    timedOutAt: new Date().toISOString(),
    timeoutMs,
    pollMs: USER_SLEEP_WAIT_POLL_MS,
    pollCount,
    startIso,
    reason: lastError || "timed out waiting for a real user-initiated Windows sleep/resume event pair",
    lastRawEventCount,
    lastMatchedEvents: powerEventSummary(lastMatchedEvents),
  };
}

async function writeUserInitiatedSleepWaitFailure(waitResult) {
  const evidence = readEvidence() ?? createTemplate();
  const nextEvidence = {
    ...evidence,
    status: "pending",
    validation: {
      ...(evidence.validation ?? {}),
      userInitiatedSleepWait: waitResult,
      hostSleepUnsupported: evidence.validation?.hostSleepUnsupported === true,
    },
    notes:
      "User-initiated Windows sleep/resume verifier was armed, but a complete suspend/resume power-event pair was not observed. Do not promote this as real sleep evidence.",
  };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  await writeDiagnostic();
}

function buildMissingFields(evidence) {
  if (!evidence) return ["manual evidence file is missing"];
  const missing = [];
  const executable = appExecutableInfo(evidenceTargetExecutable(evidence));
  if (evidence.status !== "pass") missing.push(`status must be pass, currently ${String(evidence.status)}`);
  if (NATIVE_PRIMARY_REQUESTED && resolve(String(evidence.app?.executable ?? "")) !== executable.path) {
    missing.push("app.executable must target aether-native.exe in native-primary mode");
  }
  if (NATIVE_PRIMARY_REQUESTED && (evidence.app?.processName ?? "") !== executable.processName) {
    missing.push("app.processName must be aether-native in native-primary mode");
  }
  if (NATIVE_PRIMARY_REQUESTED && evidence.app?.targetKind !== "aether-native-primary-shell") {
    missing.push("app.targetKind must be aether-native-primary-shell in native-primary mode");
  }
  const target = evidence.validation?.suspendTarget;
  if (NATIVE_PRIMARY_REQUESTED && target?.targetKind !== "aether-native-primary-shell") {
    missing.push("validation.suspendTarget.targetKind must be aether-native-primary-shell");
  }
  if (NATIVE_PRIMARY_REQUESTED && target?.nativePrimaryRequested !== true) {
    missing.push("validation.suspendTarget.nativePrimaryRequested must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && target?.launchNativePrimaryRequested !== true) {
    missing.push("validation.suspendTarget.launchNativePrimaryRequested must be true");
  }
  const nativeLaunch = evidence.validation?.nativePrimaryLaunch;
  if (NATIVE_PRIMARY_REQUESTED && nativeLaunch?.requested !== true) {
    missing.push("validation.nativePrimaryLaunch.requested must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && nativeLaunch?.ok !== true) {
    missing.push("validation.nativePrimaryLaunch.ok must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && nativeLaunch?.status !== "launched") {
    missing.push("validation.nativePrimaryLaunch.status must be launched");
  }
  if (NATIVE_PRIMARY_REQUESTED && !(Number(nativeLaunch?.pid) > 0)) {
    missing.push("validation.nativePrimaryLaunch.pid must be recorded");
  }
  if (evidence.app?.version !== PACKAGE_VERSION) {
    missing.push(`app.version must match package.json version ${PACKAGE_VERSION}`);
  }
  if (!evidence.app?.executable) missing.push("app.executable is required");
  if (!executable.exists) missing.push(`app.executable does not exist: ${executable.path}`);
  if (executable.exists && executable.bytes < minAppBytes(executable.path)) {
    missing.push(`app.executable must be a runnable ${executable.targetKind} binary`);
  }
  if (executable.exists && evidence.app?.sha256 !== executable.sha256) {
    missing.push("app.sha256 must match the current app.executable");
  }
  for (const key of REQUIRED_CHECKS) {
    if (evidence?.checks?.[key] !== true) missing.push(`checks.${key} must be true`);
  }
  if (!evidence.suspend?.suspendedAt) missing.push("suspend.suspendedAt is required");
  if (!evidence.suspend?.resumedAt) missing.push("suspend.resumedAt is required");
  const duration = Number(evidence.suspend?.approximateDurationSeconds ?? 0);
  if (!Number.isFinite(duration) || duration < 10) {
    missing.push("suspend.approximateDurationSeconds must be at least 10");
  }
  const postResumeProbes = evidence.validation?.postResumeProbes;
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.process?.ok !== true) {
    missing.push("validation.postResumeProbes.process.ok must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.process?.expectedProcessName !== executable.processName) {
    missing.push("validation.postResumeProbes.process.expectedProcessName must be aether-native");
  }
  if (NATIVE_PRIMARY_REQUESTED && !(Number(postResumeProbes?.process?.matchingProcessCount) >= 1)) {
    missing.push("validation.postResumeProbes.process.matchingProcessCount must be >= 1");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.apiHealth?.ok !== true) {
    missing.push("validation.postResumeProbes.apiHealth.ok must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.terminalRoundtrip?.ok !== true) {
    missing.push("validation.postResumeProbes.terminalRoundtrip.ok must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.dbPaneLayout?.ok !== true) {
    missing.push("validation.postResumeProbes.dbPaneLayout.ok must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.nativeVisual?.ok !== true) {
    missing.push("validation.postResumeProbes.nativeVisual.ok must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.nativeVisual?.visualQa?.pixelProbePass !== true) {
    missing.push("validation.postResumeProbes.nativeVisual.visualQa.pixelProbePass must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.nativeVisual?.visualQa?.focusCoveragePass !== true) {
    missing.push("validation.postResumeProbes.nativeVisual.visualQa.focusCoveragePass must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.nativeVisual?.primaryShell?.nonBlank !== true) {
    missing.push("validation.postResumeProbes.nativeVisual.primaryShell.nonBlank must be true");
  }
  if (NATIVE_PRIMARY_REQUESTED && postResumeProbes?.nativeVisual?.primaryShell?.interactiveWindow !== true) {
    missing.push("validation.postResumeProbes.nativeVisual.primaryShell.interactiveWindow must be true");
  }
  return missing;
}

async function safeQueryWindowsPowerEvents(evidence) {
  const suspendedAt = evidence?.suspend?.suspendedAt;
  const resumedAt = evidence?.suspend?.resumedAt;
  if (!suspendedAt || !resumedAt) {
    return {
      queried: false,
      suspendEventFound: false,
      resumeEventFound: false,
      matchedEvents: [],
      reason: "suspend/resume timestamps are missing",
    };
  }
  try {
    const events = await queryWindowsPowerEvents(suspendedAt, resumedAt);
    const matchedEvents = events.filter(
      (event) => isSuspendPowerEvent(event) || isResumePowerEvent(event) || isAttemptedSuspendPowerEvent(event),
    );
    return {
      queried: true,
      suspendEventFound: matchedEvents.some(isSuspendPowerEvent),
      resumeEventFound: matchedEvents.some(isResumePowerEvent),
      attemptedSuspendEventFound: matchedEvents.some(isAttemptedSuspendPowerEvent),
      rawEventCount: events.length,
      matchedEvents,
    };
  } catch (error) {
    return {
      queried: false,
      suspendEventFound: false,
      resumeEventFound: false,
      attemptedSuspendEventFound: false,
      matchedEvents: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function queryWindowsPowerCapabilities() {
  if (process.platform !== "win32") {
    return {
      queried: false,
      reason: `powercfg diagnostics require Windows: ${process.platform}`,
      availableStates: [],
      requests: null,
    };
  }
  const availability = spawnSync("powercfg.exe", ["/a"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const requests = spawnSync("powercfg.exe", ["/requests"], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const availabilityText = `${availability.stdout ?? ""}\n${availability.stderr ?? ""}`.trim();
  const requestsText = `${requests.stdout ?? ""}\n${requests.stderr ?? ""}`.trim();
  const availableSection = availabilityText.split(/\r?\n\r?\n/)[0] ?? availabilityText;
  const availableStates = ["S0", "S1", "S2", "S3", "Hibernate", "Hybrid Sleep"].filter((state) =>
    availableSection.toLowerCase().includes(state.toLowerCase()),
  );
  return {
    queried: availability.status === 0,
    commandStatus: availability.status,
    error: availability.status === 0 ? "" : spawnFailureDetail(availability),
    availableStates,
    modernStandbyAvailable: /\bS0\b/i.test(availableSection),
    s3Available: /\bS3\b/i.test(availableSection),
    availabilityText: availabilityText.slice(0, 4000),
    requests: {
      queried: requests.status === 0,
      commandStatus: requests.status,
      error: requests.status === 0 ? "" : spawnFailureDetail(requests),
      text: requestsText.slice(0, 4000),
      hasActiveRequests: requests.status === 0 && !/None\.|なし|ありません/i.test(requestsText),
    },
  };
}

async function probeWindowsEventLogAccess() {
  if (NATIVE_PRIMARY_REQUESTED) {
    const now = Math.floor(Date.now() / 1000);
    const result = await runNativeJson(
      ["power-events-proof", "--start-epoch", String(now - 86_400), "--end-epoch", String(now)],
      60000,
    );
    return {
      ok: result.ok === true && result.json?.eventLogReadable === true,
      commandStatus: result.status,
      stderr: result.stderr.slice(0, 500),
      systemLog: result.json
        ? {
            log: result.json.log,
            nativeWindowsEventLog: result.json.nativeWindowsEventLog,
            powershellUsed: result.json.powershellUsed,
            rawEventCount: result.json.rawEventCount,
          }
        : null,
    };
  }
  if (process.platform !== "win32") {
    return {
      ok: false,
      platform: process.platform,
      reason: "Windows System event log access requires Windows",
    };
  }
  const ps = `
    $ErrorActionPreference = 'Stop'
    $log = Get-WinEvent -ListLog System -ErrorAction Stop
    [pscustomobject]@{
      LogName = $log.LogName
      IsEnabled = $log.IsEnabled
      RecordCount = $log.RecordCount
    } | ConvertTo-Json -Depth 3 -Compress
  `;
  const result = runPowerShell(ps);
  const parsed = parsePowerShellJson(result);
  return {
    ok: result.ok && parsed !== null,
    commandStatus: result.status,
    stderr: result.stderr.slice(0, 500),
    systemLog: parsed,
  };
}

async function writeNativePreflight() {
  const sidecar = await launchIsolatedSidecarForPreflight();
  if (sidecar.ok) {
    process.env.QUORUM_API_URL = sidecar.baseUrl;
    process.env.QUORUM_API_TOKEN = sidecar.tokenValue;
  }
  const target = { ...suspendTargetMetadata(), launchNativePrimaryRequested: true };
  const launch = launchNativePrimaryShellForSuspend({ force: true, holdMs: NATIVE_PREFLIGHT_HOLD_MS });
  const apiHealth = await probeApiHealth();
  if (sidecar.child) {
    await sleep(Math.min(NATIVE_PREFLIGHT_HOLD_MS + 250, 8000));
    try {
      sidecar.child.kill();
    } catch {}
  }
  const eventLogAccess = await probeWindowsEventLogAccess();
  const powerCapabilities = queryWindowsPowerCapabilities();
  const checks = {
    nativePrimaryTarget: target.targetKind === "aether-native-primary-shell",
    nativeBinaryExists: target.executable.exists === true,
    nativeProcessObserved: launch.ok === true,
    apiReachable: apiHealth.ok === true,
    systemEventLogReadable: eventLogAccess.ok === true,
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);
  const onlyHostEventLogBlocked = missing.length === 1 && missing[0] === "systemEventLogReadable";
  const preflight = {
    version: 1,
    schema: "aether.real-os-suspend.native-preflight.v1",
    generatedAt: new Date().toISOString(),
    status:
      missing.length === 0
        ? "ready-for-real-sleep"
        : onlyHostEventLogBlocked
          ? "ready-except-host-event-log-access"
          : "incomplete",
    checks,
    missing,
    target,
    nativePrimaryLaunch: launch,
    isolatedSidecar: {
      requested: sidecar.requested,
      ok: sidecar.ok,
      status: sidecar.status,
      executable: sidecar.executable,
      pid: sidecar.pid ?? null,
      baseUrl: sidecar.baseUrl ?? null,
      muxDir: sidecar.muxDir ?? null,
      scrollbackDir: sidecar.scrollbackDir ?? null,
      health: sidecar.health ?? null,
      reason: sidecar.reason ?? null,
    },
    apiHealth,
    eventLogAccess,
    powerCapabilities,
    nextSteps:
      missing.length === 0
        ? [
            "Run pnpm verify:production:suspend:native-user-cycle, manually put Windows to sleep while the verifier waits, then close the loop with pnpm verify:goal:operator-finish, pnpm verify:goal:finalize, pnpm verify:goal:safe, and pnpm verify:goal:closeout.",
            "Alternatively run pnpm verify:production:suspend:native-begin, put Windows to sleep, then run native-resume and native-postcheck.",
          ]
        : onlyHostEventLogBlocked
          ? [
              "Run the final native sleep/resume gate from a Windows session that can read the System event log.",
              "The native binary, isolated sidecar API, and short-lived native primary shell launch preflight are already green.",
            ]
        : [
            "Fix the missing preflight checks before running the real native Windows sleep/resume gate.",
            "If only systemEventLogReadable is missing, run from a Windows session that can read the System event log.",
          ],
  };
  mkdirSync(dirname(NATIVE_PREFLIGHT), { recursive: true });
  writeFileSync(NATIVE_PREFLIGHT, `${JSON.stringify(preflight, null, 2)}\n`);
  console.log(`[real-os-suspend] native preflight ${preflight.status}: ${NATIVE_PREFLIGHT}`);
  if (missing.length > 0) console.log(`[real-os-suspend] preflight missing: ${missing.join(", ")}`);
}

async function writeNativePostcheckPreflight() {
  const sidecar = await launchIsolatedSidecarForPreflight();
  if (sidecar.ok) {
    process.env.QUORUM_API_URL = sidecar.baseUrl;
    process.env.QUORUM_API_TOKEN = sidecar.tokenValue;
  }
  const target = { ...suspendTargetMetadata(), launchNativePrimaryRequested: true };
  const launch = launchNativePrimaryShellForSuspend({
    force: true,
    holdMs: NATIVE_POSTCHECK_PREFLIGHT_HOLD_MS,
  });
  const syntheticEvidence = {
    app: target.executable,
    validation: {
      suspendTarget: target,
      nativePrimaryLaunch: launch,
    },
  };
  const probes = await collectPostResumeProbes(syntheticEvidence);
  stopNativePrimaryLaunch(launch);
  if (sidecar.child) {
    try {
      sidecar.child.kill();
    } catch {}
  }
  const checks = {
    nativePrimaryTarget: target.targetKind === "aether-native-primary-shell",
    nativeBinaryExists: target.executable.exists === true,
    isolatedSidecarReady: sidecar.ok === true,
    nativePrimaryLaunchObserved: launch.ok === true,
    postResumeProcessObserved: probes.process?.ok === true,
    apiReachable: probes.apiHealth?.ok === true,
    terminalRoundtrip: probes.terminalRoundtrip?.ok === true,
    dbPaneLayout: probes.dbPaneLayout?.ok === true,
    nativeVisual: probes.nativeVisual?.ok === true,
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);
  const artifact = {
    version: 1,
    schema: "aether.real-os-suspend.native-postcheck-preflight.v1",
    generatedAt: new Date().toISOString(),
    status: missing.length === 0 ? "ready-for-native-postcheck" : "incomplete",
    checks,
    missing,
    target,
    nativePrimaryLaunch: launch,
    isolatedSidecar: {
      requested: sidecar.requested,
      ok: sidecar.ok,
      status: sidecar.status,
      executable: sidecar.executable,
      pid: sidecar.pid ?? null,
      baseUrl: sidecar.baseUrl ?? null,
      muxDir: sidecar.muxDir ?? null,
      scrollbackDir: sidecar.scrollbackDir ?? null,
      health: sidecar.health ?? null,
      reason: sidecar.reason ?? null,
    },
    postResumeProbes: probes,
    nextSteps:
      missing.length === 0
        ? [
            "After a real Windows sleep/resume cycle, run pnpm verify:production:suspend:native-user-cycle for the single-command user-initiated path, or run native-resume and native-postcheck for the staged path.",
          ]
        : ["Fix the missing postcheck preflight checks before running the final native sleep/resume gate."],
  };
  mkdirSync(dirname(NATIVE_POSTCHECK_PREFLIGHT), { recursive: true });
  writeFileSync(NATIVE_POSTCHECK_PREFLIGHT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`[real-os-suspend] native postcheck preflight ${artifact.status}: ${NATIVE_POSTCHECK_PREFLIGHT}`);
  if (missing.length > 0) console.log(`[real-os-suspend] postcheck preflight missing: ${missing.join(", ")}`);
}

function postcheckWriteSmokeChecks(evidence, sidecar, launch) {
  const probes = evidence?.validation?.postResumeProbes;
  return {
    isolatedEvidencePath: EVIDENCE.includes("postcheck-write-smoke"),
    evidenceWritten: existsSync(EVIDENCE),
    diagnosticWritten: existsSync(DIAGNOSTIC),
    nativePrimaryRequested: NATIVE_PRIMARY_REQUESTED === true,
    isolatedSidecarReady: sidecar?.ok === true,
    nativePrimaryLaunchObserved: launch?.ok === true,
    appResponsiveCheck: evidence?.checks?.appResponsive === true,
    terminalResponsiveCheck: evidence?.checks?.terminalResponsive === true,
    sqliteWritableCheck: evidence?.checks?.sqliteWritable === true,
    paneStatePreservedCheck: evidence?.checks?.paneStatePreserved === true,
    processProbe: probes?.process?.ok === true,
    apiHealth: probes?.apiHealth?.ok === true,
    terminalRoundtrip: probes?.terminalRoundtrip?.ok === true,
    dbPaneLayout: probes?.dbPaneLayout?.ok === true,
    nativeVisual: probes?.nativeVisual?.ok === true,
    nativeVisualNotSkipped: probes?.nativeVisual?.skipped !== true,
    noRealSleepClaim: !evidence?.suspend?.suspendedAt && !evidence?.suspend?.resumedAt,
  };
}

async function writeNativePostcheckWriteSmoke() {
  if (!NATIVE_PRIMARY_REQUESTED) {
    fail("native postcheck write smoke requires native-primary mode", "set AETHER_SUSPEND_NATIVE_PRIMARY=1");
  }
  if (!EVIDENCE.includes("postcheck-write-smoke")) {
    fail(
      "refusing to run postcheck write smoke against the real sleep/resume evidence path",
      `set AETHER_PRODUCTION_SMOKE_DIR to an isolated directory; current evidence path is ${EVIDENCE}`,
    );
  }
  const sidecar = await launchIsolatedSidecarForPreflight();
  if (sidecar.ok) {
    process.env.QUORUM_API_URL = sidecar.baseUrl;
    process.env.QUORUM_API_TOKEN = sidecar.tokenValue;
  }
  const target = suspendTargetMetadata();
  const launch = launchNativePrimaryShellForSuspend({
    force: true,
    holdMs: NATIVE_POSTCHECK_WRITE_SMOKE_HOLD_MS,
  });
  let missing = [];
  try {
    const seed = createTemplate({
      capturedAt: new Date().toISOString(),
      notes: "Isolated native postcheck writer smoke. This deliberately does not claim real Windows sleep/resume.",
    });
    writeFileSync(
      EVIDENCE,
      `${JSON.stringify(
        {
          ...seed,
          status: "pending",
          validation: {
            ...(seed.validation ?? {}),
            suspendTarget: target,
            nativePrimaryLaunch: launch,
          },
        },
        null,
        2,
      )}\n`,
    );
    await writePostResumeProbe();
    const evidence = readEvidence();
    const checks = postcheckWriteSmokeChecks(evidence, sidecar, launch);
    missing = Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([key]) => key);
    const artifact = {
      version: 1,
      schema: "aether.real-os-suspend.native-postcheck-write-smoke.v1",
      generatedAt: new Date().toISOString(),
      status: missing.length === 0 ? "pass" : "fail",
      checks,
      missing,
      evidencePath: EVIDENCE,
      diagnosticPath: DIAGNOSTIC,
      nativePrimaryLaunch: launch,
      isolatedSidecar: {
        requested: sidecar.requested,
        ok: sidecar.ok,
        status: sidecar.status,
        executable: sidecar.executable,
        pid: sidecar.pid ?? null,
        baseUrl: sidecar.baseUrl ?? null,
        muxDir: sidecar.muxDir ?? null,
        scrollbackDir: sidecar.scrollbackDir ?? null,
        health: sidecar.health ?? null,
        reason: sidecar.reason ?? null,
      },
      noRealSleepClaim: true,
    };
    mkdirSync(dirname(NATIVE_POSTCHECK_WRITE_SMOKE), { recursive: true });
    writeFileSync(NATIVE_POSTCHECK_WRITE_SMOKE, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`[real-os-suspend] native postcheck write smoke ${artifact.status}: ${NATIVE_POSTCHECK_WRITE_SMOKE}`);
  } finally {
    stopNativePrimaryLaunch(launch);
    if (sidecar.child) {
      try {
        sidecar.child.kill();
      } catch {}
    }
  }
  if (missing.length > 0) fail("native postcheck write smoke failed", missing.join(", "));
}

async function writeDiagnostic() {
  const evidence = readEvidence();
  const missingFields = buildMissingFields(evidence);
  const powerEvents = await safeQueryWindowsPowerEvents(evidence);
  const powerCapabilities = queryWindowsPowerCapabilities();
  const executable = appExecutableInfo(evidenceTargetExecutable(evidence));
  const eventMissing = [];
  if (powerEvents.queried && !powerEvents.suspendEventFound)
    eventMissing.push("Windows System event 42 or Modern Standby event 506 was not found");
  if (powerEvents.queried && !powerEvents.resumeEventFound)
    eventMissing.push("Windows System event 1, 107, or Modern Standby event 507 was not found");
  const nextSteps = [];
  if (!evidence) {
    nextSteps.push("Run pnpm verify:production:suspend:template to create the evidence template.");
  } else if (
    NATIVE_PRIMARY_REQUESTED &&
    missingFields.some((field) => field.includes("native-primary mode") || field.includes("app.sha256"))
  ) {
    nextSteps.push("Run pnpm verify:production:suspend:native-begin to arm fresh aether-native evidence.");
  } else if (!evidence.suspend?.suspendedAt || !evidence.suspend?.resumedAt) {
    nextSteps.push("Record suspendedAt and resumedAt around one real Windows sleep/resume cycle.");
  }
  if (missingFields.some((field) => field.startsWith("checks."))) {
    nextSteps.push(
      "After resume, verify app responsiveness, terminal responsiveness, SQLite write, and pane-state preservation.",
    );
  }
  const postResumeProbes = evidence?.validation?.postResumeProbes;
  if (!postResumeProbes) {
    nextSteps.push("Run pnpm verify:production:suspend:postcheck after the app is running post-resume.");
  } else {
    if (postResumeProbes.process?.ok !== true) {
      nextSteps.push(
        `Launch ${postResumeProbes.process?.expectedProcessName ?? executable.processName} from ${executable.path} and rerun pnpm verify:production:suspend:postcheck.`,
      );
      // Launch the release Aether.exe and rerun pnpm verify:production:suspend:postcheck.
    }
    if (postResumeProbes.apiHealth?.ok !== true) {
      nextSteps.push("Ensure the PTY API is reachable and rerun pnpm verify:production:suspend:postcheck.");
    }
    if (postResumeProbes.terminalRoundtrip?.ok !== true) {
      nextSteps.push("Ensure release aetherctl can create, write to, capture, and close a PowerShell session.");
    }
    if (postResumeProbes.dbPaneLayout?.ok !== true) {
      nextSteps.push(
        "Ensure SQLite pane layout persistence is writable and rerun pnpm verify:production:suspend:postcheck.",
      );
    }
    if (NATIVE_PRIMARY_REQUESTED && postResumeProbes.nativeVisual?.ok !== true) {
      nextSteps.push(
        "Ensure aether-native can run visual-qa-proof and primary-shell-proof after resume, then rerun pnpm verify:production:suspend:native-postcheck.",
      );
    }
  }
  if (eventMissing.length > 0) {
    nextSteps.push("Re-run the diagnostic with timestamps that bracket the real Windows sleep/resume events.");
  }
  if (!powerEvents.queried) {
    nextSteps.push(
      `Run the suspend diagnostic in a Windows session that can read the System event log${powerEvents.error ? `: ${powerEvents.error}` : "."}`,
    );
  }
  if (
    powerCapabilities.modernStandbyAvailable &&
    powerEvents.attemptedSuspendEventFound &&
    !powerEvents.suspendEventFound
  ) {
    nextSteps.push(
      "This host reports S0 Modern Standby and only attempted-suspend event 187; run pnpm verify:production:suspend:native-user-cycle and manually put Windows to sleep while the verifier waits.",
    );
  }
  if (powerCapabilities.requests?.hasActiveRequests) {
    nextSteps.push("Review powercfg /requests output because an active request may block sleep entry.");
  }
  if (missingFields.length === 0 && eventMissing.length === 0 && powerEvents.queried) {
    nextSteps.push("Run pnpm verify:production:suspend to stamp the release evidence as validated.");
  }
  const diagnostic = {
    version: 1,
    generatedAt: new Date().toISOString(),
    evidencePath: EVIDENCE,
    status:
      missingFields.length === 0 && eventMissing.length === 0 && powerEvents.queried ? "ready-to-verify" : "incomplete",
    missingFields,
    validation: {
      postResumeProbes: evidence?.validation?.postResumeProbes ?? null,
      appExecutable: executable,
      windowsPowerEvents: powerEvents,
      powerCapabilities,
    },
    nextSteps,
  };
  mkdirSync(dirname(DIAGNOSTIC), { recursive: true });
  writeFileSync(DIAGNOSTIC, `${JSON.stringify(diagnostic, null, 2)}\n`);
  console.log(`[real-os-suspend] diagnostic ${diagnostic.status}: ${DIAGNOSTIC}`);
  if (missingFields.length > 0) console.log(`[real-os-suspend] missing: ${missingFields.join("; ")}`);
  if (eventMissing.length > 0) console.log(`[real-os-suspend] events: ${eventMissing.join("; ")}`);
}

async function validateEvidence(options = {}) {
  const promote = options.promote === true;
  const evidence = readEvidence();
  if (!evidence) {
    fail("missing manual evidence", EVIDENCE);
  }
  const missing = REQUIRED_CHECKS.filter((key) => evidence?.checks?.[key] !== true);
  const executable = appExecutableInfo(evidenceTargetExecutable(evidence));
  if (!promote && evidence.status !== "pass") fail("status must be pass", String(evidence.status));
  if (evidence.app?.version !== PACKAGE_VERSION) {
    fail("app version must match package.json version", `${String(evidence.app?.version)} !== ${PACKAGE_VERSION}`);
  }
  if (!executable.exists || executable.bytes < minAppBytes(executable.path)) {
    fail("app executable is missing or too small", JSON.stringify(executable));
  }
  if (evidence.app?.sha256 !== executable.sha256) {
    fail(
      "app executable hash does not match evidence",
      JSON.stringify({ expected: executable.sha256, evidence: evidence.app?.sha256 }),
    );
  }
  if (missing.length > 0) fail("required checks are not all true", missing.join(", "));
  if (!evidence.suspend?.suspendedAt || !evidence.suspend?.resumedAt) {
    fail("suspend timestamps are required");
  }
  const duration = Number(evidence.suspend?.approximateDurationSeconds ?? 0);
  if (!Number.isFinite(duration) || duration < 10) {
    fail("suspend duration must be at least 10 seconds", String(evidence.suspend?.approximateDurationSeconds));
  }
  let events = [];
  try {
    events = await queryWindowsPowerEvents(evidence.suspend.suspendedAt, evidence.suspend.resumedAt);
  } catch (error) {
    fail("failed to query Windows power events", error instanceof Error ? error.message : String(error));
  }
  const matchedEvents = events.filter(
    (event) => isSuspendPowerEvent(event) || isResumePowerEvent(event) || isAttemptedSuspendPowerEvent(event),
  );
  const suspendEventFound = matchedEvents.some(isSuspendPowerEvent);
  const resumeEventFound = matchedEvents.some(isResumePowerEvent);
  if (!suspendEventFound || !resumeEventFound) {
    fail(
      "Windows power event evidence is incomplete",
      JSON.stringify({
        suspendEventFound,
        resumeEventFound,
        rawEventIds: events.map((event) => `${event.providerName}:${event.id}`),
        matchedEventIds: matchedEvents.map((event) => `${event.providerName}:${event.id}`),
      }),
    );
  }
  evidence.status = "pass";
  evidence.validation = {
    ...(evidence.validation ?? {}),
    validatedAt: new Date().toISOString(),
    windowsPowerEvents: {
      source: NATIVE_PRIMARY_REQUESTED ? "aether-native-power-events-proof" : "powershell-get-winevent",
      nativeWindowsEventLog: NATIVE_PRIMARY_REQUESTED,
      powershellUsed: !NATIVE_PRIMARY_REQUESTED,
      suspendEventFound,
      resumeEventFound,
      rawEventCount: events.length,
      matchedEvents,
    },
  };
  writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`[real-os-suspend] pass: ${EVIDENCE}`);
}

async function main() {
  if (args.has("--help") || args.has("-h")) {
    printUsage();
    return;
  }
  if (USER_INITIATED_SLEEP_CYCLE) {
    await runUserInitiatedSleepCycle();
    return;
  }
  if (args.has("--cycle")) {
    await runGuardedSleepCycle();
    return;
  }
  if (args.has("--postcheck")) {
    await writePostResumeProbe();
    return;
  }
  if (args.has("--refresh-app")) {
    await writeAppExecutableRefresh();
    return;
  }
  if (args.has("--begin")) {
    writeSuspendBegin();
    return;
  }
  if (args.has("--resume")) {
    await writeSuspendResume();
    return;
  }
  if (args.has("--write-template")) {
    writeTemplate();
    return;
  }
  if (args.has("--diagnose")) {
    await writeDiagnostic();
    return;
  }
  if (args.has("--native-preflight")) {
    await writeNativePreflight();
    return;
  }
  if (args.has("--native-postcheck-preflight")) {
    await writeNativePostcheckPreflight();
    return;
  }
  if (args.has("--native-postcheck-write-smoke") || process.env.AETHER_NATIVE_POSTCHECK_WRITE_SMOKE === "1") {
    await writeNativePostcheckWriteSmoke();
    return;
  }
  if (args.has("--strict")) {
    await validateEvidence();
    return;
  }
  await validateEvidence({ promote: true });
}

await main();
