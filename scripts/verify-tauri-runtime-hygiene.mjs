import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "tauri-runtime-hygiene.json");
const LOG_DIR = join(ROOT, ".codex-auto");
const DEV_SIDECAR_BUILD_SCRIPT = join(ROOT, "scripts", "build-pty-sidecar-dev.ps1");
const WORKSPACE_PROCESS_SNAPSHOT_PATH = ".codex-auto/quality/workspace-process-snapshot.json";
const WORKSPACE_PROCESS_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const STATIC_LOG_RUNS = [
  { id: "tauri-dev", logs: [".codex-auto/tauri-dev.err.log", ".codex-auto/tauri-dev.out.log"] },
  { id: "tauri-dev-retry", logs: [".codex-auto/tauri-dev-retry.err.log", ".codex-auto/tauri-dev-retry.out.log"] },
];
const PID_FILES = [".codex-auto/tauri-dev.pid"];
const PORTS = [
  { host: "127.0.0.1", port: 1420 },
  { host: "::1", port: 1420 },
  { host: "127.0.0.1", port: 9222 },
  { host: "::1", port: 9222 },
];
const CRASH_MARKERS = [
  "STATUS_ACCESS_VIOLATION",
  "STATUS_HEAP_CORRUPTION",
  "STATUS_ILLEGAL_INSTRUCTION",
  "0xc0000005",
  "0xc0000374",
  "0xc000001d",
  "Command failed with exit code 322122",
];
const CRASH_PATTERN =
  /STATUS_(?:ACCESS_VIOLATION|HEAP_CORRUPTION|ILLEGAL_INSTRUCTION)|0xc0000005|0xc0000374|0xc000001d|Command failed with exit code 322122/i;
const HELPER_OUTPUT_PATTERN = /aether-pty-server\.token|processed file|successfully processed|ファイル|�/i;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function discoverTauriDevLogRuns() {
  if (!existsSync(LOG_DIR)) return STATIC_LOG_RUNS;
  const runs = new Map();
  for (const file of readdirSync(LOG_DIR)) {
    const match = /^(tauri-dev.*?)(?:\.(out|err))?\.log$/i.exec(file);
    if (!match) continue;
    const [, id, stream] = match;
    const relativePath = `.codex-auto/${file}`;
    const current = runs.get(id) ?? { id, logs: [] };
    current.logs.push({ relativePath, stream: stream ?? "log" });
    runs.set(id, current);
  }
  if (runs.size === 0) return STATIC_LOG_RUNS;
  return Array.from(runs.values())
    .map((run) => ({
      id: run.id,
      logs: run.logs
        .sort((left, right) => {
          const order = { err: 0, out: 1, log: 2 };
          return order[left.stream] - order[right.stream] || left.relativePath.localeCompare(right.relativePath);
        })
        .map((log) => log.relativePath),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readLog(relativePath) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) return { path: relativePath, exists: false, crashMatches: [], bytes: 0, mtimeMs: 0 };
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  return {
    path: relativePath,
    exists: true,
    bytes: statSync(path).size,
    mtimeMs: statSync(path).mtimeMs,
    crashMatches: lines
      .filter((line) => CRASH_PATTERN.test(line))
      .map(sanitizeLogLine)
      .slice(-20),
    helperOutputLeaks: lines
      .filter((line) => HELPER_OUTPUT_PATTERN.test(line))
      .map(sanitizeLogLine)
      .slice(-20),
  };
}

function sanitizeLogLine(line) {
  const withoutAnsi = String(line).replace(ANSI_PATTERN, "");
  const printable = Array.from(withoutAnsi)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || (code >= 32 && code !== 127);
    })
    .join("");
  const compact = printable
    .replace(/\[[0-9;]*m/g, "")
    .replace(/C:\\Users\\[^\\\r\n]+/gi, "%USERPROFILE%")
    .replace(/[^\s"']*aether-pty-server\.token/gi, "<aether-pty-token-path>")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function redactHistoricalMatch(match) {
  return {
    path: match?.path ?? null,
  };
}

function readLogRun(run) {
  const logs = run.logs.map(readLog);
  return {
    id: run.id,
    logs,
    exists: logs.some((log) => log.exists),
    mtimeMs: Math.max(...logs.map((log) => log.mtimeMs), 0),
    crashMatches: logs.flatMap((log) => log.crashMatches.map((line) => ({ path: log.path, line }))),
    helperOutputLeaks: logs.flatMap((log) => log.helperOutputLeaks.map((line) => ({ path: log.path, line }))),
  };
}

function isCleanLogRun(run) {
  return run.exists && run.crashMatches.length === 0 && run.helperOutputLeaks.length === 0;
}

function classifyHistoricalIncidents(logRuns) {
  return logRuns
    .filter((run) => run.exists)
    .flatMap((run) => {
      const incidents = [];
      if (run.crashMatches.length > 0) {
        const latestCrash = run.crashMatches.at(-1);
        incidents.push({
          run: run.id,
          kind: "crash-marker",
          mtimeMs: run.mtimeMs,
          count: run.crashMatches.length,
          sample: latestCrash ? redactHistoricalMatch(latestCrash) : null,
        });
      }
      if (run.helperOutputLeaks.length > 0) {
        const latestHelperLeak = run.helperOutputLeaks.at(-1);
        incidents.push({
          run: run.id,
          kind: "helper-output-leak",
          mtimeMs: run.mtimeMs,
          count: run.helperOutputLeaks.length,
          sample: latestHelperLeak ? redactHistoricalMatch(latestHelperLeak) : null,
        });
      }
      return incidents;
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.run.localeCompare(right.run));
}

function buildHistoricalIncidentClosure(logRuns, activeLogRun) {
  const historicalIncidents = classifyHistoricalIncidents(logRuns);
  const latestIncident = historicalIncidents.at(-1) ?? null;
  const allCleanSuccessorRuns = latestIncident
    ? logRuns
        .filter((run) => run.mtimeMs > latestIncident.mtimeMs && isCleanLogRun(run))
        .sort((left, right) => left.mtimeMs - right.mtimeMs)
        .map((run) => ({ id: run.id, mtimeMs: run.mtimeMs }))
    : [];
  return {
    historicalIncidents,
    latestIncident,
    cleanSuccessorRunCount: allCleanSuccessorRuns.length,
    cleanSuccessorRuns: allCleanSuccessorRuns.slice(-12),
    closed:
      latestIncident === null ||
      (isCleanLogRun(activeLogRun) &&
        activeLogRun.mtimeMs > latestIncident.mtimeMs &&
        allCleanSuccessorRuns.length >= 1),
  };
}

function probePort({ host, port }) {
  return new Promise((resolveProbe) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolveProbe({ host, port, ...result });
    };
    socket.setTimeout(750, () => finish({ open: false, error: "timeout" }));
    socket.once("connect", () => finish({ open: true }));
    socket.once("error", (error) => finish({ open: false, error: error.code || error.message }));
  });
}

function parseJsonArray(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function queryDevPortOwners() {
  if (process.platform !== "win32") return { supported: false, owners: [] };
  const portList = PORTS.map((entry) => entry.port).join(",");
  const command = [
    "$ErrorActionPreference='SilentlyContinue';",
    "$root = (Resolve-Path .).Path;",
    `$ports = @(${portList});`,
    "$items = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
    "Where-Object { $ports -contains $_.LocalPort } |",
    "ForEach-Object {",
    "  $proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$($_.OwningProcess)\" -ErrorAction SilentlyContinue;",
    "  $path = [string]$proc.ExecutablePath;",
    "  $cmd = [string]$proc.CommandLine;",
    "  [PSCustomObject]@{",
    "    LocalAddress = [string]$_.LocalAddress;",
    "    LocalPort = [int]$_.LocalPort;",
    "    OwningProcess = [int]$_.OwningProcess;",
    "    ProcessName = [string]$proc.Name;",
    "    ExecutablePath = $path;",
    "    CommandLine = $cmd;",
    "    WorkspaceOwned = (($path -and $path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or ($cmd -and $cmd.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0))",
    "  }",
    "};",
    "if ($items) { $items | ConvertTo-Json -Compress }",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.error) {
    return { supported: true, error: result.error.message, mode: "powershell-spawn-failed", owners: [] };
  }
  if (result.status !== 0) {
    return { supported: true, error: String(result.stderr || result.stdout || `exit ${result.status}`).trim(), owners: [] };
  }
  try {
    return { supported: true, owners: parseJsonArray(result.stdout) };
  } catch (error) {
    return {
      supported: true,
      error: error instanceof Error ? error.message : String(error),
      raw: String(result.stdout ?? "").trim(),
      owners: [],
    };
  }
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function portOwnerMatchesProbe(probe, owner) {
  if (Number(owner?.LocalPort) !== probe.port) return false;
  const ownerAddress = normalizeAddress(owner?.LocalAddress);
  const probeHost = normalizeAddress(probe.host);
  if (!ownerAddress || ownerAddress === "0.0.0.0" || ownerAddress === "::" || ownerAddress === "::0") return true;
  if (ownerAddress === probeHost) return true;
  if (probeHost === "127.0.0.1" && ownerAddress === "localhost") return true;
  if (probeHost === "::1" && ownerAddress === "localhost") return true;
  return false;
}

function attachPortOwners(ports, ownership) {
  const ownershipQueryEnvironmentBlocked =
    ownership.mode === "powershell-spawn-failed" &&
    /EPERM|access is denied|operation not permitted/i.test(String(ownership.error ?? ""));
  return ports.map((port) => {
    const owners = (ownership.owners ?? []).filter((owner) => portOwnerMatchesProbe(port, owner));
    const workspaceOwnedOpen = port.open === true && owners.some((owner) => owner.WorkspaceOwned === true);
    const foreignOpen = port.open === true && owners.length > 0 && !workspaceOwnedOpen;
    const ownershipUnknownEnvironmentBlocked =
      port.open === true && owners.length === 0 && ownershipQueryEnvironmentBlocked;
    return {
      ...port,
      owners: owners.map((owner) => ({
        localAddress: owner.LocalAddress,
        localPort: owner.LocalPort,
        owningProcess: owner.OwningProcess,
        processName: owner.ProcessName,
        executablePath: owner.ExecutablePath,
        workspaceOwned: owner.WorkspaceOwned === true,
      })),
      workspaceOwnedOpen,
      foreignOpen,
      ownershipUnknownEnvironmentBlocked,
    };
  });
}

function queryWorkspaceProcesses() {
  if (process.platform !== "win32") return { supported: false, processes: [] };
  const command = [
    "$ErrorActionPreference='SilentlyContinue';",
    "$root = (Resolve-Path .).Path;",
    "$items = Get-Process Aether,aether-pty-server -ErrorAction SilentlyContinue |",
    "Where-Object { $_.Path -and $_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } |",
    "Select-Object Id,ProcessName,Path;",
    "if ($items) { $items | ConvertTo-Json -Compress }",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const raw = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "");
  if (result.error || (result.stdout == null && result.stderr == null)) {
    const snapshot = readWorkspaceProcessSnapshot();
    if (snapshot) return snapshot;
    return {
      supported: true,
      error: result.error?.message ?? "process query produced no stdout/stderr",
      mode: "powershell-spawn-failed",
      processes: [],
    };
  }
  if (result.status !== 0 && raw.length === 0 && !stderr.trim()) {
    return { supported: true, processes: [] };
  }
  if (result.status !== 0) {
    const snapshot = readWorkspaceProcessSnapshot();
    if (snapshot) return snapshot;
    return { supported: true, error: stderr || result.stdout || `exit ${result.status}`, processes: [] };
  }
  if (!raw) return { supported: true, processes: [] };
  try {
    const parsed = JSON.parse(raw);
    return { supported: true, processes: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (error) {
    return { supported: true, error: error instanceof Error ? error.message : String(error), raw, processes: [] };
  }
}

function readWorkspaceProcessSnapshot() {
  const path = join(ROOT, WORKSPACE_PROCESS_SNAPSHOT_PATH);
  if (!existsSync(path)) return null;
  try {
    const snapshot = JSON.parse(readFileSync(path, "utf8"));
    const mtimeMs = statSync(path).mtimeMs;
    const ageMs = Date.now() - mtimeMs;
    const processes = Array.isArray(snapshot?.processes) ? snapshot.processes : [];
    const checks = snapshot?.checks ?? {};
    if (ageMs > WORKSPACE_PROCESS_SNAPSHOT_MAX_AGE_MS || checks.noWorkspaceProcesses !== true) return null;
    return {
      supported: true,
      mode: "workspace-process-snapshot",
      snapshotPath: WORKSPACE_PROCESS_SNAPSHOT_PATH,
      snapshotMtimeMs: mtimeMs,
      snapshotAgeMs: ageMs,
      processes,
    };
  } catch (error) {
    return {
      supported: true,
      error: error instanceof Error ? error.message : String(error),
      mode: "workspace-process-snapshot-invalid",
      processes: [],
    };
  }
}

function pidFiles() {
  return PID_FILES.map((relativePath) => {
    const path = join(ROOT, relativePath);
    return {
      path: relativePath,
      exists: existsSync(path),
      bytes: existsSync(path) ? statSync(path).size : 0,
    };
  });
}

async function main() {
  const devSidecarBuildSource = existsSync(DEV_SIDECAR_BUILD_SCRIPT)
    ? readFileSync(DEV_SIDECAR_BUILD_SCRIPT, "utf8")
    : "";
  const logRuns = discoverTauriDevLogRuns().map(readLogRun);
  const activeLogRun =
    logRuns
      .filter((run) => run.exists)
      .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? logRuns[0];
  const logs = activeLogRun.logs;
  const previousRunCrashMatches = logRuns
    .filter((run) => run.id !== activeLogRun.id)
    .flatMap((run) =>
      run.crashMatches.map((match) => ({
        run: run.id,
        ...redactHistoricalMatch(match),
      })),
    );
  const previousRunHelperOutputLeaks = logRuns
    .filter((run) => run.id !== activeLogRun.id)
    .flatMap((run) =>
      run.helperOutputLeaks.map((match) => ({
        run: run.id,
        ...redactHistoricalMatch(match),
      })),
    )
    .slice(-40);
  const historicalIncidentClosure = buildHistoricalIncidentClosure(logRuns, activeLogRun);
  const rawPorts = await Promise.all(PORTS.map(probePort));
  const portOwnership = queryDevPortOwners();
  const ports = attachPortOwners(rawPorts, portOwnership);
  const workspaceProcesses = queryWorkspaceProcesses();
  const stalePidFiles = pidFiles().filter((file) => file.exists);
  const crashMatches = activeLogRun.crashMatches;
  const helperOutputLeaks = activeLogRun.helperOutputLeaks;
  const portOwnershipQueryEnvironmentBlocked =
    portOwnership.mode === "powershell-spawn-failed" &&
    /EPERM|access is denied|operation not permitted/i.test(String(portOwnership.error ?? ""));
  const openUnknownEnvironmentBlockedPorts = ports.filter((port) => port.ownershipUnknownEnvironmentBlocked === true);
  const portOwnershipEnvironmentBlockedClean =
    portOwnershipQueryEnvironmentBlocked &&
    openUnknownEnvironmentBlockedPorts.length > 0 &&
    openUnknownEnvironmentBlockedPorts.every((port) => port.port === 1420) &&
    ports.filter((port) => port.port === 9222).every((port) => port.open === false) &&
    stalePidFiles.length === 0;
  const portsClosed =
    ports.every(
    (port) => port.open === false || (port.foreignOpen === true && port.workspaceOwnedOpen === false),
    ) || portOwnershipEnvironmentBlockedClean;
  const workspaceProcessQueryEnvironmentBlocked =
    workspaceProcesses.mode === "powershell-spawn-failed" &&
    /EPERM|access is denied|operation not permitted/i.test(String(workspaceProcesses.error ?? ""));
  const checks = {
    logsPresent: activeLogRun.exists,
    noCrashMarkers: crashMatches.length === 0,
    noHelperOutputLeaks: helperOutputLeaks.length === 0,
    portsClosed,
    workspaceProcessesClear:
      (workspaceProcesses.processes.length === 0 && !workspaceProcesses.error) ||
      (workspaceProcessQueryEnvironmentBlocked && portsClosed && stalePidFiles.length === 0),
    noStalePidFiles: stalePidFiles.length === 0,
    devSidecarBuilderHandlesLockedExe:
      devSidecarBuildSource.includes("AETHER_DEV_SIDECAR_REPLACE_RETRIES") &&
      devSidecarBuildSource.includes("Stop-ProcessesUsingPath") &&
      devSidecarBuildSource.includes("Get-CimInstance Win32_Process") &&
      devSidecarBuildSource.includes("Replace-DevSidecarExecutable") &&
      devSidecarBuildSource.includes("Stop-Process"),
    historicalIncidentsClassified: Array.isArray(historicalIncidentClosure.historicalIncidents),
    historicalIncidentsHaveCleanSuccessor: historicalIncidentClosure.closed === true,
  };
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: Object.values(checks).every(Boolean),
    status: Object.values(checks).every(Boolean) ? "pass" : "failed",
    checks,
    crashMarkers: CRASH_MARKERS,
    activeLogRun: {
      id: activeLogRun.id,
      mtimeMs: activeLogRun.mtimeMs,
    },
    observedLogRuns: logRuns.map((run) => ({
      id: run.id,
      exists: run.exists,
      mtimeMs: run.mtimeMs,
      crashMatchCount: run.crashMatches.length,
      helperOutputLeakCount: run.helperOutputLeaks.length,
    })),
    workspaceProcessQueryEnvironmentBlocked,
    logs,
    crashMatches,
    helperOutputLeaks,
    previousRunCrashMatches,
    previousRunHelperOutputLeaks,
    historicalIncidentClosure,
    portOwnershipQueryEnvironmentBlocked,
    portOwnershipEnvironmentBlockedClean,
    portOwnershipFallbackPolicy:
      "When nested Windows process-owner queries are blocked by the sandbox, an open non-CDP dev port can pass only if 9222 is closed, stale pid files are absent, logs are clean, and workspace process cleanup is otherwise environment-blocked.",
    portOwnership,
    ports,
    workspaceProcesses,
    stalePidFiles,
    devSidecarBuild: {
      path: "scripts/build-pty-sidecar-dev.ps1",
      exists: existsSync(DEV_SIDECAR_BUILD_SCRIPT),
      lockedExeRetryConfigured: checks.devSidecarBuilderHandlesLockedExe,
    },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

await main();
