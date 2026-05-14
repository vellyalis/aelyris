import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = process.platform === "win32" ? ".exe" : "";
const sidecar =
  process.env.AETHER_MUX_LIVE_SIDECAR ??
  join(root, "src-tauri", "pty-server", "target", "release", `aether-pty-server${extension}`);
const out =
  process.env.AETHER_MUX_LIVE_OUT ??
  join(root, ".codex-auto", "performance", "mux-live-restore-smoke.json");
const token = process.env.AETHER_MUX_LIVE_TOKEN ?? "mux-live-restore-smoke-token";

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

async function requestMaybe404(base, path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GET ${path} -> ${response.status}: ${body}`);
  }
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
  const child = spawn(sidecar, [], {
    cwd: root,
    env: {
      ...process.env,
      AETHER_API_TOKEN: token,
      AETHER_PTY_SERVER_PORT: String(port),
      AETHER_MUX_SNAPSHOT_DIR: muxDir,
      AETHER_PTY_SCROLLBACK_DIR: scrollbackDir,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += chunk.toString();
  });
  return { child, output };
}

function killProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

function activeTab(graph) {
  const workspace = graph.workspaces?.[graph.activeWorkspaceId];
  const window = workspace?.windows?.[workspace.activeWindowId];
  return window?.tabs?.[window.activeTabId];
}

function paneRecords(graph) {
  const tab = activeTab(graph);
  return Object.values(tab?.panes ?? {});
}

function allPaneRecords(graph) {
  const workspace = graph.workspaces?.[graph.activeWorkspaceId];
  const window = workspace?.windows?.[workspace.activeWindowId];
  return Object.values(window?.tabs ?? {}).flatMap((tab) => Object.values(tab?.panes ?? {}));
}

function paneIds(graph) {
  return paneRecords(graph)
    .map((pane) => pane.id)
    .sort();
}

function allPaneIds(graph) {
  return allPaneRecords(graph)
    .map((pane) => pane.id)
    .sort();
}

function layoutPaneIds(node) {
  if (!node) return [];
  const paneId = node.paneId ?? node.pane_id;
  if (node.kind === "pane" || paneId) return paneId ? [paneId] : [];
  if (node.kind === "split") return [...layoutPaneIds(node.first), ...layoutPaneIds(node.second)];
  return [];
}

function ptyIds(graph) {
  return paneRecords(graph)
    .map((pane) => pane.pty?.terminalId)
    .filter(Boolean)
    .sort();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForCapture(base, id, needle) {
  let text = "";
  for (let i = 0; i < 80; i += 1) {
    const captured = await request(base, `/sessions/${id}/capture?lines=80&clean=true`);
    text = captured.text ?? "";
    if (text.includes(needle)) return text;
    await sleep(100);
  }
  throw new Error(`capture did not contain ${needle}: ${text.slice(-500)}`);
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tempRoot = join(root, ".codex-auto", "performance", `mux-live-${Date.now()}`);
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
    firstRunOutput: null,
    secondRunOutput: null,
  };
  let first = null;
  let second = null;

  try {
    first = startSidecar(port, muxDir, scrollbackDir);
    await waitForReady(base);
    report.checks.push("daemon-ready");

    const created = await request(base, "/sessions", {
      method: "POST",
      body: JSON.stringify({ shell: "cmd", cols: 100, rows: 30, cwd: root }),
    });
    const workspaceId = created.id;
    const split = await request(base, `/mux/workspaces/${workspaceId}/panes/split`, {
      method: "POST",
      body: JSON.stringify({
        targetPaneId: workspaceId,
        axis: "horizontal",
        shell: "cmd",
        cwd: root,
        cols: 100,
        rows: 15,
      }),
    });
    const childId = split.id;
    let graph = await request(base, `/mux/workspaces/${workspaceId}`);
    assert(paneIds(graph).length === 2, "split should create exactly two mux panes");
    assert(new Set(ptyIds(graph)).size === 2, "split should not duplicate PTY ids");
    report.checks.push("split-two-panes-no-duplicate-pty");

    await request(base, `/mux/workspaces/${workspaceId}/layout/tiled`, { method: "POST" });
    await request(base, `/mux/workspaces/${workspaceId}/layout/even`, {
      method: "POST",
      body: JSON.stringify({ axis: "vertical" }),
    });
    await request(base, `/mux/workspaces/${workspaceId}/layout/equalize`, { method: "POST" });
    graph = await request(base, `/mux/workspaces/${workspaceId}`);
    assert(paneIds(graph).join("|") === [childId, workspaceId].sort().join("|"), "layout should preserve pane ids");
    report.checks.push("layout-preserves-pane-identity");

    const beforeRotateOrder = layoutPaneIds(activeTab(graph)?.layout?.root);
    graph = await request(base, `/mux/workspaces/${workspaceId}/layout/rotate`, {
      method: "POST",
      body: JSON.stringify({ direction: "next" }),
    });
    const afterRotateOrder = layoutPaneIds(activeTab(graph)?.layout?.root);
    assert(
      afterRotateOrder.slice().sort().join("|") === beforeRotateOrder.slice().sort().join("|"),
      "rotate should preserve the pane set",
    );
    assert(
      afterRotateOrder.join("|") !== beforeRotateOrder.join("|"),
      "rotate should change tree-order pane placement",
    );
    report.checks.push("rotate-layout-preserves-pane-set-and-changes-order");

    graph = await request(base, `/mux/workspaces/${workspaceId}/panes/${childId}/break`, { method: "POST" });
    assert(allPaneIds(graph).join("|") === [childId, workspaceId].sort().join("|"), "break should preserve pane records");
    assert(layoutPaneIds(activeTab(graph)?.layout?.root).length === 1, "break should leave one pane in the active tab");
    report.checks.push("break-pane-preserves-live-pane-records");

    graph = await request(base, `/mux/workspaces/${workspaceId}/panes/join`, {
      method: "POST",
      body: JSON.stringify({ sourcePaneId: workspaceId, targetPaneId: childId, axis: "horizontal" }),
    });
    assert(paneIds(graph).join("|") === [childId, workspaceId].sort().join("|"), "join should preserve pane records");
    assert(layoutPaneIds(activeTab(graph)?.layout?.root).length === 2, "join should rebuild a two-pane active layout");
    report.checks.push("join-pane-restores-two-pane-active-layout");

    graph = await request(base, `/mux/workspaces/${workspaceId}/panes/synchronize`, {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
    assert(activeTab(graph)?.synchronizedPanes === true, "synchronized panes should be enabled on active tab");
    const syncMarker = `aether-mux-sync-${Date.now()}`;
    report.syncMarker = syncMarker;
    await request(base, `/sessions/${workspaceId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: `echo ${syncMarker}\r` }),
    });
    await waitForCapture(base, workspaceId, syncMarker);
    await waitForCapture(base, childId, syncMarker);
    graph = await request(base, `/mux/workspaces/${workspaceId}/panes/synchronize`, {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    });
    assert(activeTab(graph)?.synchronizedPanes === false, "synchronized panes should be disabled on active tab");
    report.checks.push("synchronized-pane-mode-mirrors-single-pane-input");

    const broadcastMarker = `aether-mux-broadcast-${Date.now()}`;
    report.broadcastMarker = broadcastMarker;
    const broadcast = await request(base, `/mux/workspaces/${workspaceId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: `echo ${broadcastMarker}\r` }),
    });
    assert(broadcast.targets === 2, `broadcast should target two panes, got ${broadcast.targets}`);
    assert(broadcast.accepted === 2, `broadcast should be accepted by two panes, got ${broadcast.accepted}`);
    await waitForCapture(base, workspaceId, broadcastMarker);
    await waitForCapture(base, childId, broadcastMarker);
    report.checks.push("broadcast-input-reaches-all-live-panes");

    graph = await request(base, `/mux/workspaces/${workspaceId}/panes/${childId}/zoom`, {
      method: "POST",
      body: JSON.stringify({ zoomed: true }),
    });
    assert(activeTab(graph)?.layout?.zoomedPaneId === childId, "zoom should mark child pane in mux layout");
    graph = await request(base, `/mux/workspaces/${workspaceId}/panes/${childId}/zoom`, {
      method: "POST",
      body: JSON.stringify({ zoomed: false }),
    });
    assert(!activeTab(graph)?.layout?.zoomedPaneId, "unzoom should clear mux zoomed pane");
    report.checks.push("zoom-unzoom-round-trips-through-mux-layout");

    const detachedMarker = `aether-live-detached-${Date.now()}`;
    report.detachedMarker = detachedMarker;

    await request(base, `/mux/workspaces/${workspaceId}/detach`, { method: "POST" });
    await request(base, `/sessions/${workspaceId}/input`, {
      method: "POST",
      body: JSON.stringify({ text: `echo ${detachedMarker}\r` }),
    });
    await waitForCapture(base, workspaceId, detachedMarker);
    report.checks.push("detached-live-pty-still-processes-input");

    killProcess(first.child);
    await sleep(500);
    first = null;
    report.checks.push("daemon-stopped-for-restore");

    second = startSidecar(port, muxDir, scrollbackDir);
    await waitForReady(base);
    graph = await request(base, `/mux/workspaces/${workspaceId}`);
    assert(paneIds(graph).length === 2, "restored mux graph should keep two panes");
    assert(
      ptyIds(graph).every((id) => id.startsWith("restore-pending:")),
      `restored PTY ids should be restore-pending, got ${ptyIds(graph).join(", ")}`,
    );
    report.checks.push("daemon-restart-restores-mux-graph");

    const restoredCapture = await request(base, `/sessions/${workspaceId}/capture?lines=80&clean=true`);
    assert(
      restoredCapture.text?.includes(detachedMarker),
      `restored scrollback should include detached marker ${detachedMarker}`,
    );
    report.checks.push("daemon-restart-replays-durable-scrollback");

    graph = await request(base, `/mux/workspaces/${workspaceId}/attach`, { method: "POST" });
    const attachedPtyIds = ptyIds(graph);
    assert(attachedPtyIds.length === 2, "attach should create two live PTY bindings");
    assert(attachedPtyIds.every((id) => !id.startsWith("restore-pending:")), "attach should replace restore-pending ids");
    assert(new Set(attachedPtyIds).size === 2, "attach should not duplicate PTY ids");
    report.checks.push("attach-respawns-live-pty-without-duplicates");

    await request(base, `/mux/workspaces/${workspaceId}/panes/${childId}`, { method: "DELETE" });
    graph = await request(base, `/mux/workspaces/${workspaceId}`);
    assert(paneIds(graph).length === 1, "closing child pane should leave one pane");
    report.checks.push("close-pane-updates-mux-graph");

    await request(base, `/sessions/${workspaceId}`, { method: "DELETE" });
    const afterClose = await requestMaybe404(base, `/mux/workspaces/${workspaceId}`);
    assert(afterClose === null, "closing workspace session should remove mux graph");
    report.checks.push("workspace-close-removes-mux-graph");

    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (first) {
      report.firstRunOutput = {
        stdoutTail: first.output.stdout.slice(-2_000),
        stderrTail: first.output.stderr.slice(-2_000),
      };
      killProcess(first.child);
    }
    if (second) {
      report.secondRunOutput = {
        stdoutTail: second.output.stdout.slice(-2_000),
        stderrTail: second.output.stderr.slice(-2_000),
      };
      killProcess(second.child);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ status: report.status, checks: report.checks }, null, 2));
  if (report.errors.length > 0) {
    console.error(`Errors:\n- ${report.errors.join("\n- ")}`);
    process.exitCode = 1;
  }
  console.log(`Report: ${out}`);
}

await main();
