import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CODEX_HOME = (process.env.CODEX_HOME ?? join(homedir(), ".codex")).replaceAll("\\", "/");
const WATCHDOG = `${CODEX_HOME}/codex-longrun-watchdog.mjs`;
const PROGRESS_SERVER = `${CODEX_HOME}/codex-progress-server.mjs`;

const TASK_ID = "auto-1778017073638-p2-07-sleep-resume-db-lock-chaos";
const ARTIFACT_PATH = join(process.cwd(), ".codex-auto", "chaos-recovery", "p2-07-sleep-resume-db-lock-chaos.json");

const report = {
  version: 1,
  roadmapId: "P2-07",
  parentRoadmapId: "P2-07",
  reason: "blocker-decomposition",
  taskId: TASK_ID,
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
  const workspace = mkdtempSync(join(tmpdir(), `aether-chaos-${name}-`));
  const auto = join(workspace, ".codex-auto");
  mkdirSync(auto, { recursive: true });
  writeFileSync(join(workspace, "AGENT_STATE.md"), "# Goal\n\nP2-07 sleep/resume verifier fixture\n", "utf8");
  return { workspace, auto };
}

function stopProcessesMentioningWorkspace(workspace) {
  if (process.platform !== "win32") return;
  const script = `
$needle = [Environment]::GetEnvironmentVariable('AETHER_CHAOS_WORKSPACE')
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
      env: { ...process.env, AETHER_CHAOS_WORKSPACE: workspace },
    });
  } catch {
    // Best-effort cleanup. The temp directory removal below still retries.
  }
}

function cleanupWorkspace(workspace) {
  stopProcessesMentioningWorkspace(workspace);
  rmSync(workspace, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
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

async function unusedPort() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("p2-07-port-probe");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = Number(address.port);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function progressServerState(workspace) {
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
    const response = await fetch(`http://127.0.0.1:${port}/state`, { cache: "no-store" });
    assert.equal(response.ok, true, `progress server returned ${response.status}`);
    return await response.json();
  } finally {
    try {
      child.kill();
    } catch {}
    await waitForChild(child, 5_000).catch(() => null);
  }
}

function writeBaseArtifacts({ workspace, auto }) {
  const activeRoadmap = {
    id: "P2-07",
    title: "Chaos and recovery test pack",
    status: "doing",
    lane: "doing",
    priority: "P2",
    progress: 70,
    goal: "Validate sleep/resume and DB lock chaos behavior.",
    parentRoadmapId: "P2-07",
    reason: "original-roadmap-continuation",
    acceptanceCriteria: [
      "Scope is implemented in a narrow, reviewable slice without reverting unrelated dirty worktree changes.",
      "Focused validation is recorded in .codex-auto/validation-ledger.json with command/result/evidence.",
      "Progress, evidence, residual risks, and next action are written before the card is marked done.",
    ],
    requiredValidation: [
      "watchdog sleep/resume gap notification or injectable equivalent",
      "SQLite DB lock/write-failure incident test",
      "final report/dashboard truth survives recovery after the incident",
    ],
    riskLevel: "medium-high",
    owner: "longrun-executor",
    confidence: "medium-high",
    evidence: "P2-07 sleep/resume and DB lock chaos fixture is running.",
  };
  const activeSubtask = {
    id: TASK_ID,
    status: "doing",
    priority: "P2",
    title: "P2-07 sleep resume and DB lock chaos",
    goal: "Validate watchdog sleep/resume gap and DB write-failure incident recovery.",
    scope: [`${CODEX_HOME}/codex-longrun-watchdog.mjs`, "src-tauri/src/audit.rs", "src-tauri/src/db"],
    parentRoadmapId: "P2-07",
    reason: "blocker-decomposition",
    failureKind: "oversized_task",
    acceptanceCriteria: activeRoadmap.acceptanceCriteria,
    requiredValidation: activeRoadmap.requiredValidation,
    riskLevel: "medium-high",
    owner: "executor",
    attempts: 1,
  };

  writeJson(join(auto, "project-roadmap.json"), {
    version: 3,
    generatedAt: new Date().toISOString(),
    roadmap: [
      {
        id: "P2-06",
        title: "Performance Observatory",
        status: "done",
        lane: "done",
        progress: 100,
        parentRoadmapId: "P2-06",
        reason: "original-roadmap-continuation",
      },
      activeRoadmap,
      {
        id: "P2-08",
        title: "Release Doctor and distribution artifacts",
        status: "next",
        lane: "next",
        progress: 0,
        parentRoadmapId: "P2-08",
        reason: "original-roadmap-continuation",
      },
    ],
  });
  writeJson(join(auto, "decomposition-queue.json"), { version: 1, updatedAt: new Date().toISOString(), items: [activeSubtask] });
  writeJson(join(auto, "current-longrun.json"), {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    noTimeLimit: true,
    timeLimit: "none",
    minutes: 0,
    turnMinutes: 15,
    goal: "P2-07 sleep resume and DB lock chaos fixture",
  });
  writeJson(join(auto, "current-progress.json"), {
    version: 1,
    status: "running",
    phase: "p2-07-sleep-resume-db-lock-chaos",
    message: "P2-07 sleep/resume and DB-lock child is active.",
    activeRoadmapId: "P2-07",
    activeRoadmap,
    activeSubtask,
    blockerAnalysis: { status: "not_blocked", kind: "unknown", activeRoadmapId: "P2-07" },
  });
  writeJson(join(auto, "blocker-analysis.json"), {
    version: 1,
    taxonomyVersion: 1,
    status: "not_blocked",
    kind: "unknown",
    reason: "No active blocker in P2-07 sleep/resume fixture.",
    activeRoadmapId: "P2-07",
    activeSubtaskId: TASK_ID,
    nextAction: "Run sleep/resume and DB lock validation.",
  });
  writeJson(join(auto, "final-report.json"), {
    version: 1,
    generatedAt: new Date().toISOString(),
    workspace,
    finalStatus: "running",
    stopReason: "P2-07 sleep/resume and DB-lock runtime chaos pending",
    roadmap: { total: 3, done: 1, unfinished: 2 },
    qualityGate: { status: "partial", message: "P2-07 still collecting sleep/resume and DB lock evidence." },
  });
}

function writeFakeClockModule(auto, clockPath) {
  const fakeClockModule = join(auto, "fake-clock.mjs");
  writeFileSync(
    fakeClockModule,
    `
import { readFileSync } from "node:fs";
const realNow = Date.now.bind(Date);
const clockPath = process.env.AETHER_FAKE_CLOCK_PATH;
Date.now = function fakeNow() {
  try {
    const value = Number(readFileSync(clockPath, "utf8"));
    if (Number.isFinite(value)) return value;
  } catch {}
  return realNow();
};
`,
    "utf8",
  );
  writeFileSync(clockPath, String(Date.now()), "utf8");
  return fakeClockModule;
}

await scenario("watchdog-sleep-resume-gap-injected", "Inject a >60s watchdog monitoring gap and require resume notification/dashboard truth.", async () => {
  const fixture = makeWorkspace("sleep-resume");
  const { workspace, auto } = fixture;
  let child = null;
  let childStdout = "";
  let childStderr = "";
  try {
    writeBaseArtifacts(fixture);
    const clockPath = join(auto, "fake-clock-now.txt");
    const fakeClockModule = writeFakeClockModule(auto, clockPath);
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(fakeClockModule).href,
        WATCHDOG,
        "--workspace",
        workspace,
        "--interval-seconds",
        "2",
        "--max-restarts",
        "0",
        "--no-dashboard",
      ],
      {
        cwd: workspace,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, AETHER_FAKE_CLOCK_PATH: clockPath },
      },
    );
    child.stdout?.on("data", (chunk) => {
      childStdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      childStderr += chunk.toString();
    });

    const healthPath = join(auto, "current-health.json");
    const firstHealth = await waitUntil(() => existsSync(healthPath), 15_000);
    assert.equal(
      firstHealth,
      true,
      `watchdog did not write initial health; stdout=${childStdout.slice(-800)} stderr=${childStderr.slice(-800)}`,
    );
    const baseNow = Number(readFileSync(clockPath, "utf8"));
    writeFileSync(clockPath, String(baseNow + 65_000), "utf8");

    const resumed = await waitUntil(() => {
      const health = existsSync(healthPath) ? readJson(healthPath) : null;
      return health?.resumedAfterSleep === true && Number(health?.checkGapSeconds) >= 60;
    }, 15_000);
    assert.equal(resumed, true, "watchdog did not record a resume gap");
    try {
      child.kill();
    } catch {}
    await waitForChild(child, 5_000).catch(() => null);
    child = null;

    const health = readJson(healthPath);
    const progress = readJson(join(auto, "current-progress.json"));
    const notifications = readJson(join(auto, "current-notifications.json"));
    const state = await progressServerState(workspace);

    assert.equal(health.resumedAfterSleep, true);
    assert.equal(progress.resumedAfterSleep, true);
    assert.equal(notifications.items.some((item) => item.type === "resume" && Number(item.checkGapSeconds) >= 60), true);
    assert.equal(state.activeCard.id, "P2-07");
    assert.equal(state.currentProgress.activeSubtask.id, TASK_ID);
    assert.equal(state.currentProgress.resumedAfterSleep, true);
    assert.equal(state.finalReport.finalStatus, "running");
    assert.equal(state.finalReport.qualityGate.status, "partial");
    assert.equal(state.counts.done, 1);

    return {
      checkGapSeconds: health.checkGapSeconds,
      resumedAfterSleep: health.resumedAfterSleep,
      notificationCount: notifications.items.length,
      dashboardActiveCard: state.activeCard.id,
      dashboardActiveSubtask: state.currentProgress.activeSubtask.id,
      finalReportStatus: state.finalReport.finalStatus,
      qualityGate: state.finalReport.qualityGate.status,
    };
  } finally {
    if (child) {
      try {
        child.kill();
      } catch {}
      await waitForChild(child, 5_000).catch(() => null);
    }
    cleanupWorkspace(workspace);
  }
});

report.completedAt = new Date().toISOString();
report.status = report.scenarios.every((item) => item.status === "pass") ? "pass" : "fail";
report.coverage = {
  covered: [
    "watchdog sleep/resume gap notification via injected clock",
    "dashboard /state active card/subtask truth after resume incident",
    "final-report running/partial truth after resume incident",
  ],
  externalValidation: [
    "cargo test test_audit_sqlite_db_lock_emits_explicit_incident --manifest-path src-tauri/Cargo.toml --test test_audit_event_bus_snapshot -- --nocapture",
  ],
};

writeJson(ARTIFACT_PATH, report);
console.log(JSON.stringify({ status: report.status, scenarios: report.scenarios.length, artifactPath: ARTIFACT_PATH }, null, 2));
