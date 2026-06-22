// Make-or-break check: does the visible fleet now render the LIVE INTERACTIVE
// claude TUI in a pane (the BridgeSpace experience), instead of headless `-p`
// print output? Dispatches one worktree-backed task, then screenshots the
// center panel at intervals so we can SEE whether claude's interactive
// interface (alt-screen, boxes, working spinner) renders via the native
// alacritty engine.
// Prereq: pnpm tauri:dev (CDP 9222), claude on PATH + authenticated.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

const repo = mkdtempSync(join(tmpdir(), "aether-tui-"));
git(repo, "init", "-b", "main");
git(repo, "config", "user.email", "tui@aether.test");
git(repo, "config", "user.name", "Tui");
writeFileSync(join(repo, "README.md"), "# tui demo\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "init");

const shotDir = join(repo, "_shots");
mkdirSync(shotDir, { recursive: true });

const TASK = {
  id: "task-tui",
  owner: "worker-a",
  branch: "feat/tui",
  file: "HELLO.md",
  title:
    "Create a file named HELLO.md containing a single friendly one-line greeting. Only create that file, then you are done.",
};

const browser = await chromium.connectOverCDP(CDP);
try {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no 1420 page");
  const inv = (n, a) =>
    page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);
  const canvases = () =>
    page.evaluate(
      () => document.querySelector(".center-panel")?.querySelectorAll("canvas").length ?? -1,
    );
  const shoot = async (name) => {
    const el = await page.$(".center-panel");
    if (el) await el.screenshot({ path: join(shotDir, name) });
  };

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

  const before = await canvases();
  const rep = await inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo,
    reviewerId: "reviewer",
    gates: {},
  });
  console.log("dispatched:", JSON.stringify(rep.dispatched));
  await sleep(6000);
  const after = await canvases();
  console.log(`canvases ${before} -> ${after}`);
  await shoot("01-after-dispatch-6s.png");
  await sleep(8000);
  await shoot("02-at-14s.png");
  await sleep(10000);
  await shoot("03-at-24s.png");
  const built = existsSync(join(wtPath, TASK.file));
  console.log(`output ${TASK.file} built in worktree: ${built}`);
  await sleep(6000);
  await shoot("04-at-30s.png");

  console.log("SHOTS:", shotDir);
  await browser.close();
} catch (e) {
  console.error(e);
  await browser.close();
  process.exit(1);
}
