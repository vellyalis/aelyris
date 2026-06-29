import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CODEX_HOME = (process.env.CODEX_HOME ?? join(homedir(), ".codex")).replaceAll("\\", "/");
const WATCHDOG = `${CODEX_HOME}/codex-longrun-watchdog.mjs`;
const PROGRESS_SERVER = `${CODEX_HOME}/codex-progress-server.mjs`;

const taxonomy = await import(pathToFileURL(`${CODEX_HOME}/codex-blocker-taxonomy.mjs`).href);
const notificationStore = await import(pathToFileURL(`${CODEX_HOME}/codex-notification-store.mjs`).href);
const autoLoop = await import(pathToFileURL(`${CODEX_HOME}/codex-auto-loop.mjs`).href);
const eventJournal = await import(pathToFileURL(`${CODEX_HOME}/codex-event-journal.mjs`).href);
const workspaceProfile = await import(pathToFileURL(`${CODEX_HOME}/codex-workspace-profile.mjs`).href);

const {
  BLOCKER_KINDS,
  classifyBlocker,
  normalizeBlockerAnalysis,
  probeExternalDependency,
} = taxonomy;

const report = {
  version: 1,
  roadmapId: "P2-07",
  parentRoadmapId: "P2-07",
  reason: "blocker-decomposition",
  taskId: "auto-1778005841170-3-chaos-and-recovery-test-pack",
  generatedAt: new Date().toISOString(),
  scenarios: [],
};

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function compactError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function scenario(id, description, fn) {
  const startedAt = Date.now();
  try {
    const evidence = await fn();
    report.scenarios.push({
      id,
      description,
      status: "pass",
      durationMs: Date.now() - startedAt,
      evidence,
    });
  } catch (error) {
    report.scenarios.push({
      id,
      description,
      status: "fail",
      durationMs: Date.now() - startedAt,
      error: compactError(error),
    });
    throw error;
  }
}

function makeWorkspace(name) {
  const workspace = mkdtempSync(join(tmpdir(), `aelyris-chaos-${name}-`));
  const auto = join(workspace, ".codex-auto");
  mkdirSync(auto, { recursive: true });
  writeFileSync(join(workspace, "AGENT_STATE.md"), "# Goal\n\nP2-07 chaos verifier fixture\n", "utf8");
  return { workspace, auto };
}

function cleanupWorkspace(workspace) {
  stopProcessesMentioningWorkspace(workspace);
  rmSync(workspace, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
}

function stopProcessesMentioningWorkspace(workspace) {
  if (process.platform !== "win32") return;
  const script = `
$needle = [Environment]::GetEnvironmentVariable('AELYRIS_CHAOS_WORKSPACE')
if (-not $needle) { exit 0 }
Get-CimInstance Win32_Process |
  Where-Object { [int]$_.ProcessId -ne ${process.pid} -and [string]$_.CommandLine -like "*$needle*" } |
  ForEach-Object {
    try { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue } catch {}
  }
`;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      cwd: tmpdir(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, AELYRIS_CHAOS_WORKSPACE: workspace },
    });
  } catch {
    // Best-effort cleanup; rmSync below still has retries.
  }
}

function waitForChild(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      reject(new Error(`child timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function waitUntil(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function withHttpServer(callback) {
  const server = createHttpServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, method: request.method }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function occupyPort(callback) {
  const server = createHttpServer((_request, response) => {
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("occupied by P2-07 port-conflict fixture");
  });
  server.on("error", () => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback(address.port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function unusedPort() {
  return occupyPort(async (port) => port);
}

async function progressServerFetch(workspace, pathname) {
  const port = await unusedPort();
  const child = spawn(process.execPath, [PROGRESS_SERVER, "--workspace", workspace, "--port", String(port), "--refresh-seconds", "1"], {
    cwd: workspace,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const ready = await waitUntil(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { cache: "no-store" });
        return response.ok;
      } catch {
        return false;
      }
    }, 15_000);
    assert.equal(ready, true, "progress server did not become healthy");
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { cache: "no-store" });
    assert.equal(response.ok, true, `progress server returned ${response.status}`);
    return await response.text();
  } finally {
    try {
      child.kill();
    } catch {}
    await waitForChild(child, 5_000).catch(() => null);
  }
}

async function runWatchdogOnce(workspace, timeoutMs = 45_000) {
  const auto = join(workspace, ".codex-auto");
  const healthPath = join(auto, "current-health.json");
  const child = spawn(process.execPath, [WATCHDOG, "--workspace", workspace, "--interval-seconds", "2", "--max-restarts", "1"], {
    cwd: workspace,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const wroteHealth = await waitUntil(() => existsSync(healthPath), timeoutMs);
    assert.equal(wroteHealth, true, "watchdog did not write current-health.json");
    return readJson(healthPath);
  } finally {
    try {
      child.kill();
    } catch {}
    await waitForChild(child, 5_000).catch(() => null);
  }
}

function writeBaseRoadmap(auto, activePatch = {}) {
  const active = {
    id: "P2-07",
    title: "Chaos and recovery test pack",
    status: "doing",
    lane: "doing",
    progress: 10,
    priority: "P2",
    goal: "Validate chaos and recovery paths.",
    parentRoadmapId: "P2-07",
    reason: "original-roadmap-continuation",
    acceptanceCriteria: ["Focused validation is recorded."],
    requiredValidation: ["chaos smoke pack"],
    riskLevel: "medium",
    owner: "longrun-executor",
    ...activePatch,
  };
  writeJson(join(auto, "project-roadmap.json"), {
    version: 3,
    generatedAt: new Date().toISOString(),
    roadmap: [
      { id: "P2-06", title: "Performance Observatory", status: "done", lane: "done", progress: 100, parentRoadmapId: "P2-06", reason: "original-roadmap-continuation" },
      active,
    ],
  });
  return active;
}

await scenario("external-service-loss-and-recovery", "Classify local network loss as external_dependency and recover when the service returns.", async () => {
  const down = classifyBlocker({ message: "ERR_CONNECTION_REFUSED http://127.0.0.1:9/state" });
  assert.equal(down.kind, BLOCKER_KINDS.EXTERNAL_DEPENDENCY);
  const failedProbe = await probeExternalDependency(normalizeBlockerAnalysis(down), {
    nowMs: 1_000,
    backoff: { initialDelayMs: 250, maxDelayMs: 1_000, multiplier: 2 },
  });
  assert.equal(failedProbe.attempted, true);
  assert.equal(failedProbe.ok, false);
  assert.equal(failedProbe.backoff.nextProbeAt, new Date(1_250).toISOString());

  const recoveredProbe = await withHttpServer(async (url) => {
    const recovered = classifyBlocker({ message: `ERR_CONNECTION_REFUSED ${url}/state` });
    assert.equal(recovered.kind, BLOCKER_KINDS.EXTERNAL_DEPENDENCY);
    return probeExternalDependency(normalizeBlockerAnalysis(recovered), {
      nowMs: 2_000,
      backoff: { initialDelayMs: 250, maxDelayMs: 1_000, multiplier: 2 },
    });
  });
  assert.equal(recoveredProbe.attempted, true);
  assert.equal(recoveredProbe.ok, true);
  assert.equal(recoveredProbe.backoff.nextProbeAt, null);

  return {
    failedStatus: failedProbe.status,
    failedBackoff: failedProbe.backoff.nextProbeAt,
    recoveredStatus: recoveredProbe.status,
  };
});

await scenario("moved-workspace-needs-attention", "Treat a moved/missing workspace as non-self-healable environment_down.", async () => {
  const { workspace } = makeWorkspace("moved-workspace");
  try {
    const missingWorkspace = join(workspace, "missing");
    const analysis = normalizeBlockerAnalysis({
      status: "blocked",
      kind: BLOCKER_KINDS.ENVIRONMENT_DOWN,
      reason: "Workspace moved or was deleted.",
      dependency: { kind: "environment", workspace: missingWorkspace },
      environment: {
        workspace: missingWorkspace,
        packageManager: "definitely-missing-aelyris-package-manager",
      },
    });
    const probe = await probeExternalDependency(analysis, {
      nowMs: 5_000,
      backoff: { initialDelayMs: 500, maxDelayMs: 2_000, multiplier: 2 },
    });
    assert.equal(probe.attempted, true);
    assert.equal(probe.ok, false);
    assert.equal(probe.nonSelfHealableFailures.includes("workspace"), true);
    assert.equal(probe.nonSelfHealableFailures.includes("package_manager"), true);
    assert.equal(probe.canSelfHeal, false);
    return {
      status: probe.status,
      nonSelfHealableFailures: probe.nonSelfHealableFailures,
      nextAction: probe.nextAction,
    };
  } finally {
    cleanupWorkspace(workspace);
  }
});

await scenario("timeout-splits-with-lineage", "Retry-cap timeout decomposes to a child with parentRoadmapId and reason.", async () => {
  const { workspace, auto } = makeWorkspace("timeout-split");
  try {
    const activeRoadmap = writeBaseRoadmap(auto);
    const parentTask = {
      id: "auto-p2-07-parent-chaos",
      status: "doing",
      priority: "P2",
      title: "Chaos and recovery test pack",
      goal: "Broad chaos pack exceeded its window.",
      scope: ["scripts", "e2e", CODEX_HOME],
      parentRoadmapId: "P2-07",
      reason: "blocker-decomposition",
      requiredValidation: ["chaos smoke pack"],
      acceptanceCriteria: ["Focused validation is recorded."],
      riskLevel: "medium",
      owner: "executor",
      attempts: 2,
    };
    writeJson(join(auto, "decomposition-queue.json"), { version: 1, updatedAt: new Date().toISOString(), items: [parentTask] });
    writeJson(join(auto, "current-progress.json"), { version: 1, status: "running", activeRoadmap, activeSubtask: parentTask });

    const failure = classifyBlocker({ message: "command timed out after 120000ms", durationSeconds: 1_200, turnMinutes: 15 });
    assert.equal(failure.kind, BLOCKER_KINDS.TIMEOUT);
    const result = await autoLoop.__test.applyFailurePolicy({
      logDir: auto,
      goal: "P2-07 chaos verifier",
      failure,
      turn: 7,
      exitCode: 124,
      activeRoadmap,
      subtask: parentTask,
      consecutiveFailures: 3,
      wizardArtifactPaths: {
        validationLedger: join(auto, "validation-ledger.json"),
        decisionLog: join(auto, "decision-log.json"),
        riskRegister: join(auto, "risk-register.json"),
        controlState: join(auto, "wizard-control.json"),
        currentProgress: join(auto, "current-progress.json"),
        currentChild: join(auto, "current-child.json"),
      },
    });
    assert.equal(result.continueLoop, true);

    const queue = readJson(join(auto, "decomposition-queue.json"));
    const parent = queue.items.find((item) => item.id === parentTask.id);
    const child = queue.items.find((item) => item.id !== parentTask.id);
    assert.equal(parent.status, "split");
    assert.equal(child.parentRoadmapId, "P2-07");
    assert.equal(child.reason, "blocker-decomposition");
    assert.equal(child.failureKind, BLOCKER_KINDS.TIMEOUT);
    assert.equal(parent.splitChildTaskIds.includes(child.id), true);

    const progress = readJson(join(auto, "current-progress.json"));
    assert.equal(progress.status, "recovering");
    assert.equal(progress.lastFailure.retryPolicy.action, "decompose-after-cap");
    return { parentStatus: parent.status, childId: child.id, childReason: child.reason };
  } finally {
    cleanupWorkspace(workspace);
  }
});

await scenario("denied-notification-and-stale-lock", "Denied browser notifications fall back to dashboard/local JSON/JSONL after a stale store lock.", async () => {
  const { workspace, auto } = makeWorkspace("notification-lock");
  try {
    const notificationPath = join(auto, "current-notifications.json");
    writeFileSync(
      `${notificationPath}.lock`,
      JSON.stringify({ pid: 1, lockedAt: "1970-01-01T00:00:00.000Z", path: notificationPath }),
      "utf8",
    );
    const appended = notificationStore.appendNotification(
      notificationPath,
      {
        type: "attention",
        severity: "warning",
        title: "P2-07 denied notification fixture",
        body: "Browser notification permission denied.",
        delivery: { browser: { status: "denied", permission: "denied" } },
        dedupeKey: "p2-07-denied-notification",
      },
      { source: "p2-07-chaos", staleMs: 1, timeoutMs: 2_000 },
    );
    assert.equal(appended, true);
    const stored = readJson(notificationPath);
    assert.equal(stored.items.length, 1);
    assert.equal(stored.items[0].fallback.reason, "browser_notification_denied");
    assert.equal(stored.items[0].fallback.channels.includes("dashboard"), true);
    assert.equal(stored.items[0].fallback.channels.includes("local-jsonl"), true);
    assert.equal(existsSync(join(auto, "notifications.jsonl")), true);
    assert.equal(existsSync(`${notificationPath}.lock`), false);
    return {
      fallbackReason: stored.items[0].fallback.reason,
      channels: stored.items[0].fallback.channels,
      jsonlExists: true,
    };
  } finally {
    cleanupWorkspace(workspace);
  }
});

await scenario("dashboard-port-conflict-recovers", "A dashboard port conflict starts a healthy dashboard on the next available port.", async () => {
  const { workspace, auto } = makeWorkspace("dashboard-port");
  try {
    await occupyPort(async (occupiedPort) => {
      workspaceProfile.writeWorkspaceProfile(workspace, {
        workspaceOverride: {
          dashboardPortPolicy: { mode: "explicit", explicitPort: occupiedPort },
        },
      });
      writeBaseRoadmap(auto);
      writeJson(join(auto, "current-longrun.json"), {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        noTimeLimit: true,
        timeLimit: "none",
        minutes: 0,
        turnMinutes: 15,
        goal: "P2-07 dashboard port conflict fixture",
      });
      writeJson(join(auto, "current-progress.json"), {
        version: 1,
        status: "running",
        phase: "chaos-port-conflict",
        activeRoadmapId: "P2-07",
        activeRoadmap: {
          id: "P2-07",
          title: "Chaos and recovery test pack",
          status: "doing",
          lane: "doing",
          parentRoadmapId: "P2-07",
          reason: "original-roadmap-continuation",
        },
      });
      writeJson(join(auto, "current-dashboard.json"), {
        workspace,
        port: occupiedPort,
        url: `http://127.0.0.1:${occupiedPort}/`,
        pid: 999999,
        serverPid: 999999,
      });
      const health = await runWatchdogOnce(workspace);
      assert.equal(health.dashboardAlive, true);
      assert.notEqual(Number(health.dashboardServerPid), 999999);
      assert.notEqual(new URL(health.dashboardUrl).port, String(occupiedPort));
      assert.match(health.dashboardIdentity.reason, /ok|health-/);
    });
    const dashboard = readJson(join(auto, "current-dashboard.json"));
    return {
      dashboardUrl: dashboard.url,
      dashboardPort: dashboard.port,
      restarted: dashboard.restarted === true || dashboard.reused === true,
    };
  } finally {
    cleanupWorkspace(workspace);
  }
});

await scenario("final-report-replays-after-artifact-loss", "Final report survives reload when JSON artifacts are missing and event journal replay is used.", async () => {
  const { workspace, auto } = makeWorkspace("final-report-replay");
  try {
    writeBaseRoadmap(auto);
    const activeProgress = {
      version: 1,
      status: "running",
      activeRoadmap: { id: "P2-07", title: "Chaos and recovery test pack", status: "doing" },
      activeRoadmapId: "P2-07",
      message: "Replay current progress from event journal.",
    };
    const finalReport = {
      finalStatus: "complete",
      stopReason: "chaos-fixture-complete",
      summary: "Chaos fixture final report restored after artifact loss.",
      roadmap: { total: 1, done: 1, unfinished: 0 },
      qualityGate: { status: "pass" },
    };
    eventJournal.appendLongrunAuditEvent(auto, {
      kind: "progress_updated",
      severity: "info",
      source: "p2-07-chaos",
      correlationId: "progress:p2-07-replay",
      payloadJson: { currentProgress: activeProgress },
    });
    eventJournal.appendLongrunAuditEvent(auto, {
      kind: "final_report_written",
      severity: "info",
      source: "p2-07-chaos",
      correlationId: "final-report:p2-07-replay",
      payloadJson: { finalReport },
    });
    const state = JSON.parse(await progressServerFetch(workspace, "/state"));
    assert.equal(state.currentProgress.replayedFromJournal, true);
    assert.equal(state.activeCard.id, "P2-07");
    assert.equal(state.finalReport.exists, true);
    assert.equal(state.finalReport.replayedFromJournal, true);
    assert.equal(state.finalReport.summary, finalReport.summary);
    assert.equal(state.eventJournal.replayedState.currentProgress, true);
    assert.equal(state.eventJournal.replayedState.finalReport, true);
    return {
      activeCard: state.activeCard.id,
      finalReportSummary: state.finalReport.summary,
      replayedState: state.eventJournal.replayedState,
    };
  } finally {
    cleanupWorkspace(workspace);
  }
});

report.completedAt = new Date().toISOString();
report.status = report.scenarios.every((item) => item.status === "pass") ? "pass" : "fail";
report.coverage = {
  covered: [
    "network loss/local service recovery",
    "moved workspace non-self-healable attention",
    "timeout retry-cap split lineage",
    "notification denied fallback",
    "stale notification lock recovery",
    "dashboard killed/port conflict recovery",
    "final report replay after artifact loss",
  ],
  remaining: [
    "live Tauri/WebView2 reload with localStorage deletion",
    "live PTY killed/restart and AI CLI killed/recovery",
    "real watchdog sleep/resume gap over an OS suspend or long monitoring pause",
    "SQLite DB lock/write-failure incident under app runtime",
  ],
};

const artifactPath = join(process.cwd(), ".codex-auto", "chaos-recovery", "p2-07-control-plane-chaos-smoke.json");
writeJson(artifactPath, report);
console.log(JSON.stringify({ status: report.status, scenarios: report.scenarios.length, artifactPath }, null, 2));
