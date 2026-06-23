// Live proof of the orphaned-pane fix (commit 53fbc7d + FE 4060f32).
//
// Reproduces the exact path: dispatch a fleet agent into a visible PTY pane,
// let it produce its declared output, then run a second orchestrator_step so
// PaneFleet::poll_completions REAPS the now-idle interactive pane. The reap
// closes the pane's broadcast channel, which makes run_loop_pane_monitor emit
// `pty-exit-<id>`. THE BUG was that payload being `()` (JSON null) — the FE's
// setExitInfo(null) cleared exit state, kept the dead pane mounted, and re-fired
// resize -> 404 "Terminal degraded". THE FIX emits a typed
// `{ code: null, crashed: false }`.
//
// IMPORTANT — pane discovery (why we do NOT diff `list_terminals`):
//   The autonomy fleet (`PaneFleet`) spawns its panes in the IN-PROCESS
//   `PtyManager`. But in the dev build the PTY sidecar is connected, so the
//   `list_terminals` IPC (`terminal_ids_async`) returns the SIDECAR's terminal
//   list — a DIFFERENT registry. So a freshly dispatched fleet pane NEVER shows
//   up in `list_terminals` here. The correct, runtime-faithful way to learn a
//   dispatched pane's terminal id is the `AgentSpawned` event the cockpit emits
//   (`orchestrator_commands.rs`): `agent-event` with kind `agent_spawned` and
//   payload `{ taskId, terminalId, model }`. We capture that.
//
// NOTE — known native-crash risk: reaping a pane exercises the native PTY
// close path, where a ConPTY/WebView2 race can ACCESS_VIOLATION the app under
// load (a separate, pre-existing stability issue). If this probe dies with
// "Target page ... closed", check the dev log for STATUS_ACCESS_VIOLATION.
//
// Prereq: pnpm tauri:dev (CDP 9222), claude on PATH + authenticated.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

const repo = mkdtempSync(join(tmpdir(), "aether-orphan-"));
git(repo, "init", "-b", "main");
git(repo, "config", "user.email", "orphan@aether.test");
git(repo, "config", "user.name", "Orphan");
writeFileSync(join(repo, "README.md"), "# orphan demo\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "init");

const uniq = String(process.pid);
const TASK = {
  id: `task-orphan-${uniq}`,
  owner: `worker-${uniq}`,
  branch: `feat/orphan-${uniq}`,
  file: "HELLO.md",
  title:
    "Create a file named HELLO.md containing a single friendly one-line greeting. Only create that file, then you are done.",
};

const browser = await chromium.connectOverCDP(CDP);
const fail = (msg) => { throw new Error(msg); };
try {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no 1420 page");
  const inv = (n, a) =>
    page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);

  // Capture the AgentSpawned event so we learn the dispatched pane's terminal id
  // (see header — list_terminals can't see fleet panes in the sidecar dev build).
  const installSpawnCapture = () =>
    page.evaluate(() => {
      window.__agentSpawned = [];
      const internals = window.__TAURI_INTERNALS__;
      const handler = internals.transformCallback((event) => {
        const p = event?.payload;
        if (p && p.kind === "agent_spawned" && p.payload) {
          window.__agentSpawned.push(p.payload);
        }
      });
      return internals.invoke("plugin:event|listen", {
        event: "agent-event",
        target: { kind: "Any" },
        handler,
      });
    });
  const readSpawned = () => page.evaluate(() => window.__agentSpawned ?? []);

  // Install a pty-exit capture for a given terminal id using the Tauri v2 event
  // plugin internals (withGlobalTauri is off, so use __TAURI_INTERNALS__).
  const installExitCapture = (terminalId) =>
    page.evaluate((id) => {
      window.__ptyExit = { fired: false, payload: undefined };
      const internals = window.__TAURI_INTERNALS__;
      const handler = internals.transformCallback((event) => {
        window.__ptyExit = { fired: true, payload: event?.payload };
      });
      return internals.invoke("plugin:event|listen", {
        event: `pty-exit-${id}`,
        target: { kind: "Any" },
        handler,
      });
    }, terminalId);
  const readExitCapture = () => page.evaluate(() => window.__ptyExit);
  const degradedCount = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("span")).filter(
        (s) => s.textContent === "Terminal degraded",
      ).length,
    );

  await installSpawnCapture();

  const info = await inv("create_worktree", { repoPath: repo, branchName: TASK.branch });
  const wtPath = info.path;
  await inv("task_create", {
    task: {
      id: TASK.id,
      title: TASK.title,
      description: "",
      status: "pending",
      owner: TASK.owner,
      model: "sonnet",
      priority: "medium",
      dependencies: [],
      outputs: [TASK.file],
      source_branch: TASK.branch,
      target_branch: "main",
    },
  });

  const rep = await inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo,
    reviewerId: "reviewer",
    gates: {},
  });
  console.log("dispatched:", JSON.stringify(rep.dispatched));
  if (!rep.dispatched.includes(TASK.id)) fail(`task not dispatched: ${TASK.id}`);

  // Learn the fleet pane's terminal id from the AgentSpawned event.
  let termId = null;
  for (let i = 0; i < 15 && !termId; i++) {
    const spawned = await readSpawned();
    const mine = spawned.find((s) => s.taskId === TASK.id);
    if (mine) termId = mine.terminalId;
    else await sleep(1000);
  }
  console.log("fleet pane terminal id (from AgentSpawned):", termId);
  if (!termId) fail("never received AgentSpawned for our task (no fleet pane terminal id)");

  await installExitCapture(termId);
  console.log(`installed pty-exit capture for ${termId}; degraded spans now=${await degradedCount()}`);

  // Wait for the real claude agent to produce the declared output.
  let built = false;
  for (let i = 0; i < 60; i++) {
    if (existsSync(join(wtPath, TASK.file))) {
      built = true;
      break;
    }
    await sleep(2000);
  }
  console.log(`output ${TASK.file} built in worktree: ${built}`);
  if (!built) fail("agent never produced HELLO.md within budget");

  // Second step: poll_completions sees outputs-ready -> kills + reaps the pane.
  const rep2 = await inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo,
    reviewerId: "reviewer",
    gates: {},
  });
  console.log("step2:", JSON.stringify({ merged: rep2.merged, dispatched: rep2.dispatched }));

  // Give the reap + channel-close + emit a moment to propagate.
  let cap = await readExitCapture();
  for (let i = 0; i < 20 && !cap.fired; i++) {
    await sleep(1000);
    cap = await readExitCapture();
  }
  console.log("pty-exit capture:", JSON.stringify(cap));

  // ── Core assertion: the reaped pane emitted a TYPED, NON-NULL ExitInfo ──
  if (!cap.fired) fail("pty-exit never fired for the reaped pane");
  if (cap.payload === null || cap.payload === undefined)
    fail(`pty-exit payload is null/undefined (THE OLD BUG): ${JSON.stringify(cap.payload)}`);
  if (typeof cap.payload !== "object" || !("crashed" in cap.payload) || !("code" in cap.payload))
    fail(`pty-exit payload is not a typed ExitInfo: ${JSON.stringify(cap.payload)}`);

  // ── Secondary (informational): resize routing + degraded banner. These depend
  // on sidecar-vs-in-process routing, so they are logged, not hard-asserted. ──
  let resizeErr = null;
  try {
    await inv("resize_terminal", { id: termId, cols: 80, rows: 24 });
  } catch (e) {
    resizeErr = String(e);
  }
  console.log("post-reap resize result:", resizeErr ?? "(ok)");
  const deg = await degradedCount();
  console.log(`"Terminal degraded" spans visible: ${deg}`);

  await sleep(500);
  console.log(
    `\nPASS: reaped fleet pane emitted a TYPED pty-exit payload ${JSON.stringify(cap.payload)} ` +
      `(non-null -> FE setExitInfo engages the resize guard). degraded spans=${deg}.`,
  );
  await browser.close();
} catch (e) {
  console.error(e);
  await browser.close();
  process.exit(1);
}
