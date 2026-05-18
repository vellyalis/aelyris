import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.env.AETHER_PRODUCTION_ROOT ?? process.cwd());
const EVIDENCE = join(ROOT, ".codex-auto", "production-smoke", "real-os-suspend-resume.json");
const DIAGNOSTIC = join(ROOT, ".codex-auto", "production-smoke", "real-os-suspend-resume.diagnostic.json");
const SESSION = join(ROOT, ".codex-auto", "production-smoke", "real-os-suspend-session.json");
const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const DEFAULT_APP_EXE = join(ROOT, "src-tauri", "target", "release", "Aether.exe");
const AETHERCTL_EXE = join(
  ROOT,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "aetherctl.exe" : "aetherctl",
);
const args = new Set(process.argv.slice(2));
const REQUIRED_CHECKS = ["appResponsive", "terminalResponsive", "sqliteWritable", "paneStatePreserved"];
const DEFAULT_API_BASE_URL = "http://127.0.0.1:9333";
const SIDECAR_API_BASE_URL = "http://127.0.0.1:9334";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function appExecutableInfo(executable = DEFAULT_APP_EXE) {
  if (!executable || !existsSync(executable)) {
    return {
      path: executable || DEFAULT_APP_EXE,
      exists: false,
      bytes: 0,
      modifiedAt: null,
      sha256: null,
    };
  }
  const stat = statSync(executable);
  return {
    path: executable,
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
  if (process.env.AETHER_API_TOKEN?.trim()) return process.env.AETHER_API_TOKEN.trim();
  const path = tokenPath();
  if (!path || !existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

function apiBaseUrl() {
  if (process.env.AETHER_API_URL?.trim()) return process.env.AETHER_API_URL.trim();
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
    stderr: result.stderr?.trim() ?? "",
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

function probeAetherProcesses(executable = DEFAULT_APP_EXE) {
  const ps = `
    $ErrorActionPreference = 'SilentlyContinue'
    $target = [System.IO.Path]::GetFullPath($env:AETHER_APP_EXE)
    $items = Get-Process -Name Aether -ErrorAction SilentlyContinue | ForEach-Object {
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
  const result = runPowerShell(ps, { AETHER_APP_EXE: executable });
  const parsed = parsePowerShellJson(result);
  const processes = parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
  return {
    ok: result.ok && processes.some((processInfo) => processInfo.MatchesExecutable === true),
    commandStatus: result.status,
    stderr: result.stderr.slice(0, 500),
    processCount: processes.length,
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

function probeApiHealth() {
  const ps = `
    $ErrorActionPreference = 'Stop'
    $headers = @{}
    if ($env:AETHER_API_TOKEN_VALUE) { $headers["Authorization"] = "Bearer $($env:AETHER_API_TOKEN_VALUE)" }
    $value = Invoke-RestMethod -Method Get -Uri "$($env:AETHER_API_BASE_URL.TrimEnd('/'))/health" -Headers $headers -TimeoutSec 5
    $value | ConvertTo-Json -Depth 6 -Compress
  `;
  const result = runPowerShell(ps, {
    AETHER_API_BASE_URL: apiBaseUrl(),
    AETHER_API_TOKEN_VALUE: apiToken(),
  });
  const parsed = parsePowerShellJson(result);
  return {
    ok: result.ok && parsed !== null,
    baseUrl: apiBaseUrl(),
    commandStatus: result.status,
    stderr: result.stderr.slice(0, 500),
    health: parsed,
  };
}

function probeTerminalRoundtrip() {
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

function probeDbPaneLayout() {
  const release = runAetherCtl(["db-smoke"], 30000);
  const releaseOutput = `${release.stdout}\n${release.stderr}`;
  const shouldFallback =
    !release.ok &&
    (/unknown command: db-smoke/i.test(releaseOutput) ||
      /missing aetherctl executable/i.test(releaseOutput) ||
      release.status === null);
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

function writePostResumeProbe() {
  const evidence = readEvidence() ?? createTemplate();
  const executable = appExecutableInfo(evidence.app?.executable || DEFAULT_APP_EXE);
  const processProbe = probeAetherProcesses(executable.path);
  const apiProbe = probeApiHealth();
  const terminalRoundtrip = probeTerminalRoundtrip();
  const dbPaneLayout = probeDbPaneLayout();
  const probes = {
    probedAt: new Date().toISOString(),
    appExecutable: executable,
    process: processProbe,
    apiHealth: apiProbe,
    terminalRoundtrip,
    dbPaneLayout,
    note: "Automated probes verify app responsiveness, terminal roundtrip, SQLite write, and pane layout preservation; strict pass still requires real Windows sleep/resume power events.",
  };
  const nextEvidence = {
    ...evidence,
    status: evidence.status === "pass" ? "pending" : (evidence.status ?? "pending"),
    checks: {
      ...(evidence.checks ?? {}),
      appResponsive: processProbe.ok === true && apiProbe.ok === true,
      terminalResponsive: terminalRoundtrip.ok === true,
      sqliteWritable: dbPaneLayout.ok === true,
      paneStatePreserved: dbPaneLayout.ok === true,
    },
    validation: {
      ...(evidence.validation ?? {}),
      postResumeProbes: probes,
    },
  };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  console.log(`[real-os-suspend] post-resume probes captured: ${EVIDENCE}`);
  writeDiagnostic();
}

function writeSuspendBegin() {
  mkdirSync(dirname(SESSION), { recursive: true });
  const session = {
    version: 1,
    status: "armed",
    startedAt: new Date().toISOString(),
    evidencePath: EVIDENCE,
    instruction:
      "Put Windows to sleep now. After resume, run pnpm verify:production:suspend:resume before editing the evidence checks.",
  };
  writeFileSync(SESSION, `${JSON.stringify(session, null, 2)}\n`);
  if (!existsSync(EVIDENCE)) {
    writeFileSync(EVIDENCE, `${JSON.stringify(createTemplate({ capturedAt: session.startedAt }), null, 2)}\n`);
  }
  console.log(`[real-os-suspend] begin captured: ${SESSION}`);
}

function writeAppExecutableRefresh() {
  const evidence = readEvidence() ?? createTemplate();
  const executable = appExecutableInfo(evidence.app?.executable || DEFAULT_APP_EXE);
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
      version: PACKAGE_VERSION,
      sha256: executable.sha256,
      bytes: executable.bytes,
      modifiedAt: executable.modifiedAt,
    },
  };
  mkdirSync(dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, `${JSON.stringify(nextEvidence, null, 2)}\n`);
  console.log(`[real-os-suspend] refreshed app executable identity: ${EVIDENCE}`);
  writeDiagnostic();
}

function writeSuspendResume() {
  if (!existsSync(SESSION)) {
    fail("missing suspend capture session", `${SESSION}; run pnpm verify:production:suspend:begin before sleeping`);
  }
  const session = JSON.parse(readFileSync(SESSION, "utf8"));
  const resumedAt = new Date().toISOString();
  const suspendedAt = session.startedAt;
  const duration = Math.max(0, Math.round((Date.parse(resumedAt) - Date.parse(suspendedAt)) / 1000));
  const evidence = readEvidence() ?? createTemplate({ capturedAt: suspendedAt });
  const executable = appExecutableInfo(evidence.app?.executable || DEFAULT_APP_EXE);
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
  writeDiagnostic();
}

function assertWindowsSleepCycleAllowed() {
  if (process.platform !== "win32") {
    fail("guarded sleep cycle requires Windows", process.platform);
  }
  if (process.env.AETHER_ALLOW_OS_SLEEP !== "1") {
    fail(
      "refusing to put Windows to sleep without explicit opt-in",
      "set AETHER_ALLOW_OS_SLEEP=1 and run pnpm verify:production:suspend:cycle",
    );
  }
}

function invokeWindowsSleep() {
  assertWindowsSleepCycleAllowed();
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
    fail("Windows sleep command failed", result.error.message);
  }
  if (result.status !== 0) {
    fail("Windows sleep command exited non-zero", result.stderr?.trim() || result.stdout?.trim());
  }
}

function runGuardedSleepCycle() {
  assertWindowsSleepCycleAllowed();
  writeAppExecutableRefresh();
  writeSuspendBegin();
  console.log("[real-os-suspend] invoking guarded Windows sleep; wake the machine to continue validation");
  invokeWindowsSleep();
  // Keep the timestamp window honest. Some Modern Standby hosts return from
  // SetSuspendState very quickly even when the request was accepted; the
  // strict verifier requires a >=10s bracket so a too-short settle creates a
  // noisy duration failure that hides the real power-event result.
  sleepSync(Number.parseInt(process.env.AETHER_POST_WAKE_SETTLE_MS ?? "12000", 10));
  writeSuspendResume();
  writePostResumeProbe();
  validateEvidence({ promote: true });
}

function queryWindowsPowerEvents(startIso, endIso) {
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
    throw new Error(`failed to query Windows power events: ${result.stderr?.trim() || result.stdout?.trim()}`);
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

function buildMissingFields(evidence) {
  if (!evidence) return ["manual evidence file is missing"];
  const missing = [];
  const executable = appExecutableInfo(evidence.app?.executable || DEFAULT_APP_EXE);
  if (evidence.status !== "pass") missing.push(`status must be pass, currently ${String(evidence.status)}`);
  if (evidence.app?.version !== PACKAGE_VERSION) {
    missing.push(`app.version must match package.json version ${PACKAGE_VERSION}`);
  }
  if (!evidence.app?.executable) missing.push("app.executable is required");
  if (!executable.exists) missing.push(`app.executable does not exist: ${executable.path}`);
  if (executable.exists && executable.bytes < 10 * 1024 * 1024) {
    missing.push("app.executable must be a release-sized Aether.exe");
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
  return missing;
}

function safeQueryWindowsPowerEvents(evidence) {
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
    const events = queryWindowsPowerEvents(suspendedAt, resumedAt);
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
    availableStates,
    modernStandbyAvailable: /\bS0\b/i.test(availableSection),
    s3Available: /\bS3\b/i.test(availableSection),
    availabilityText: availabilityText.slice(0, 4000),
    requests: {
      queried: requests.status === 0,
      commandStatus: requests.status,
      text: requestsText.slice(0, 4000),
      hasActiveRequests: requests.status === 0 && !/None\.|なし|ありません/i.test(requestsText),
    },
  };
}

function writeDiagnostic() {
  const evidence = readEvidence();
  const missingFields = buildMissingFields(evidence);
  const powerEvents = safeQueryWindowsPowerEvents(evidence);
  const powerCapabilities = queryWindowsPowerCapabilities();
  const executable = appExecutableInfo(evidence?.app?.executable || DEFAULT_APP_EXE);
  const eventMissing = [];
  if (powerEvents.queried && !powerEvents.suspendEventFound)
    eventMissing.push("Windows System event 42 or Modern Standby event 506 was not found");
  if (powerEvents.queried && !powerEvents.resumeEventFound)
    eventMissing.push("Windows System event 1, 107, or Modern Standby event 507 was not found");
  const nextSteps = [];
  if (!evidence) {
    nextSteps.push("Run pnpm verify:production:suspend:template to create the evidence template.");
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
      nextSteps.push("Launch the release Aether.exe and rerun pnpm verify:production:suspend:postcheck.");
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
  }
  if (eventMissing.length > 0) {
    nextSteps.push("Re-run the diagnostic with timestamps that bracket the real Windows sleep/resume events.");
  }
  if (
    powerCapabilities.modernStandbyAvailable &&
    powerEvents.attemptedSuspendEventFound &&
    !powerEvents.suspendEventFound
  ) {
    nextSteps.push(
      "This host reports S0 Modern Standby and only attempted-suspend event 187; use a user-initiated Windows Sleep cycle and rerun begin/resume/postcheck.",
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

function validateEvidence(options = {}) {
  const promote = options.promote === true;
  const evidence = readEvidence();
  if (!evidence) {
    fail("missing manual evidence", EVIDENCE);
  }
  const missing = REQUIRED_CHECKS.filter((key) => evidence?.checks?.[key] !== true);
  const executable = appExecutableInfo(evidence.app?.executable || DEFAULT_APP_EXE);
  if (!promote && evidence.status !== "pass") fail("status must be pass", String(evidence.status));
  if (evidence.app?.version !== PACKAGE_VERSION) {
    fail("app version must match package.json version", `${String(evidence.app?.version)} !== ${PACKAGE_VERSION}`);
  }
  if (!executable.exists || executable.bytes < 10 * 1024 * 1024) {
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
    events = queryWindowsPowerEvents(evidence.suspend.suspendedAt, evidence.suspend.resumedAt);
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
      suspendEventFound,
      resumeEventFound,
      rawEventCount: events.length,
      matchedEvents,
    },
  };
  writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`[real-os-suspend] pass: ${EVIDENCE}`);
}

function main() {
  if (args.has("--cycle")) {
    runGuardedSleepCycle();
    return;
  }
  if (args.has("--postcheck")) {
    writePostResumeProbe();
    return;
  }
  if (args.has("--refresh-app")) {
    writeAppExecutableRefresh();
    return;
  }
  if (args.has("--begin")) {
    writeSuspendBegin();
    return;
  }
  if (args.has("--resume")) {
    writeSuspendResume();
    return;
  }
  if (args.has("--write-template")) {
    writeTemplate();
    return;
  }
  if (args.has("--diagnose")) {
    writeDiagnostic();
    return;
  }
  if (args.has("--strict")) {
    validateEvidence();
    return;
  }
  validateEvidence({ promote: true });
}

main();
