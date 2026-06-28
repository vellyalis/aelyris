import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = process.platform === "win32" ? ".exe" : "";
const sidecar =
  process.env.AETHER_MUX_LIVE_SIDECAR ??
  join(root, "src-tauri", "pty-server", "target", "release", `aether-pty-server${extension}`);
const out = process.env.AETHER_MUX_LIVE_OUT ?? join(root, ".codex-auto", "performance", "mux-live-restore-smoke.json");
const token = process.env.AETHER_MUX_LIVE_TOKEN ?? "mux-live-restore-smoke-token";
const cargoManifest = join(root, "src-tauri", "Cargo.toml");

class HostCapabilityBlockedError extends Error {
  constructor(capability, message, details = {}) {
    super(message);
    this.name = "HostCapabilityBlockedError";
    this.capability = capability;
    this.details = details;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function classifySpawnBlock(error) {
  const text = `${error?.code ?? ""}\n${errorMessage(error)}`;
  if (/EPERM|operation not permitted/i.test(text)) return "spawn-eperm";
  if (/EACCES|permission denied/i.test(text)) return "spawn-permission-denied";
  return null;
}

function assertNodeChildProcessAvailable() {
  const command = process.platform === "win32" ? "cmd.exe" : "true";
  const args = process.platform === "win32" ? ["/c", "exit", "0"] : [];
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    const reason = classifySpawnBlock(result.error);
    if (reason) {
      throw new HostCapabilityBlockedError(
        "node-child-process",
        `Node child_process is blocked before the PTY daemon can be launched: ${result.error.message}`,
        { phase: "host-preflight", command, code: result.error.code ?? null, reason },
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Node child_process preflight failed with status ${result.status}`);
  }
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

function startSidecar(port, muxDir, scrollbackDir, phase) {
  let child;
  try {
    child = spawn(sidecar, [], {
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
  } catch (error) {
    const reason = classifySpawnBlock(error);
    if (reason) {
      throw new HostCapabilityBlockedError(
        "pty-sidecar-spawn",
        `PTY sidecar process launch is blocked: ${errorMessage(error)}`,
        { phase, command: sidecar, code: error?.code ?? null, reason },
      );
    }
    throw error;
  }
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

function runAetherctl(base, args) {
  const phase = `aetherctl-${args[0] ?? "command"}`;
  const result = spawnSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", cargoManifest, "--bin", "aetherctl", "--", ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        AETHER_API_URL: base,
        AETHER_API_TOKEN: token,
      },
      encoding: "utf8",
      shell: false,
      timeout: 600_000,
      windowsHide: true,
    },
  );
  if (result.error) {
    const reason = classifySpawnBlock(result.error);
    if (reason) {
      throw new HostCapabilityBlockedError(
        "aetherctl-spawn",
        `aetherctl child process launch is blocked: ${result.error.message}`,
        {
          phase,
          command: "cargo",
          args: ["run", "--quiet", "--manifest-path", cargoManifest, "--bin", "aetherctl", "--", ...args],
          code: result.error.code ?? null,
          reason,
        },
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `aetherctl ${args.join(" ")} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`aetherctl ${args.join(" ")} returned invalid JSON: ${error.message}\n${result.stdout}`);
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

function assertDaemonContract(contract, phase) {
  const capabilities = Array.isArray(contract?.capabilities) ? contract.capabilities : [];
  const requiredCapabilities = [
    "mux-inspect",
    "mux-pane-control",
    "mux-layout-control",
    "mux-layout-equalize",
    "mux-layout-rotate",
    "mux-pane-break-join",
    "mux-pane-zoom",
    "mux-broadcast-input",
    "mux-synchronized-panes",
    "mux-attach-detach",
    "mux-live-attach-detach",
    "mux-snapshot-restore-pending",
    "mux-export-import",
    "durable-scrollback",
    "terminal-core-policy",
    "native-input-boundary-contract",
    "native-render-pipeline-contract",
    "terminal-fallback-telemetry",
  ];
  const terminalCorePolicy = contract?.terminalCorePolicy ?? {};
  assert(contract?.contractSchemaVersion === 1, `${phase} daemon contract schema version must be 1`);
  assert(typeof contract?.instanceId === "string" && contract.instanceId.length > 0, `${phase} instance id missing`);
  assert(typeof contract?.protocolVersion === "number" && contract.protocolVersion > 0, `${phase} protocol missing`);
  assert(contract?.muxGraphVersion === 1, `${phase} mux graph version must be 1`);
  assert(contract?.transport === "loopback-http-websocket", `${phase} transport policy changed`);
  assert(contract?.authPolicy === "bearer-token-or-disabled-test-mode", `${phase} auth policy changed`);
  assert(
    contract?.clientDetachPolicy === "detach-keeps-live-pty-while-daemon-running",
    `${phase} detach policy missing`,
  );
  assert(
    contract?.restartRestorePolicy === "snapshot-restores-graph-as-restore-pending-with-durable-scrollback",
    `${phase} restart restore policy missing`,
  );
  assert(
    contract?.attachPolicy === "reattach-respawns-only-missing-or-restore-pending-pty-bindings",
    `${phase} attach policy missing`,
  );
  assert(
    contract?.shutdownPolicy === "explicit-workspace-close-terminates-owned-child-ptys",
    `${phase} shutdown policy missing`,
  );
  assert(terminalCorePolicy.nativeInputOwner === "rust-native-input-host", `${phase} native input owner missing`);
  assert(
    terminalCorePolicy.inputBoundary === "tauri-native-surface-before-webview-fallback",
    `${phase} native input boundary policy missing`,
  );
  assert(
    terminalCorePolicy.rendererTruthSource === "rust-term-engine-render-pipeline",
    `${phase} renderer truth source missing`,
  );
  assert(
    terminalCorePolicy.renderFrameSchema === "aether.native.render-frame.v1",
    `${phase} render frame schema missing`,
  );
  assert(terminalCorePolicy.renderDiffSchema === "aether.native.render-diff.v1", `${phase} render diff schema missing`);
  assert(
    terminalCorePolicy.renderCommitSchema === "aether.native.render-commit.v1",
    `${phase} render commit schema missing`,
  );
  assert(
    terminalCorePolicy.renderPipelineBoundary === "rust-native-render-pipeline",
    `${phase} native render pipeline boundary missing`,
  );
  assert(terminalCorePolicy.nextRenderer === "winit-wgpu-present-loop", `${phase} next renderer policy missing`);
  assert(
    terminalCorePolicy.webviewTerminalRendererPolicy === "fallback-contained-not-source-of-truth",
    `${phase} WebView renderer fallback policy missing`,
  );
  assert(
    terminalCorePolicy.reactTerminalRendererPolicy === "control-plane-only-not-terminal-core",
    `${phase} React terminal renderer policy missing`,
  );
  assert(terminalCorePolicy.muxTruthSource === "daemon-api", `${phase} mux truth source missing`);
  assert(terminalCorePolicy.scrollbackTruthSource === "durable-scrollback", `${phase} scrollback truth source missing`);
  assert(
    terminalCorePolicy.fallbackVisibilityPolicy === "release-blocking-telemetry",
    `${phase} fallback visibility policy missing`,
  );
  assert(
    terminalCorePolicy.releaseBlockerPolicy === "native-boundary-contract-must-pass-before-release",
    `${phase} terminal release-blocker policy missing`,
  );
  for (const capability of requiredCapabilities) {
    assert(capabilities.includes(capability), `${phase} missing daemon capability ${capability}`);
  }
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

async function sendMarkerAndWaitForCapture(base, id, marker) {
  await request(base, `/sessions/${id}/input`, {
    method: "POST",
    body: JSON.stringify({ text: `echo ${marker}\r` }),
  });
  await waitForCapture(base, id, marker);
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
    strictPass: false,
    generatedAt: new Date().toISOString(),
    verificationMode: "node-managed-sidecar-restart",
    sidecar,
    base,
    hostRequirements: [
      "Node child_process must be allowed to spawn the PTY daemon.",
      "Node child_process must be allowed to run cargo aetherctl parity checks.",
      "The verifier must be allowed to terminate its own short-lived sidecar process.",
    ],
    hostBlocked: false,
    blockers: [],
    checks: [],
    errors: [],
    firstRunOutput: null,
    secondRunOutput: null,
    firstContract: null,
    secondContract: null,
    aetherctlContract: null,
    aetherctlSearch: null,
    aetherctlExport: null,
    aetherctlImport: null,
  };
  let first = null;
  let second = null;

  try {
    if (!existsSync(sidecar)) {
      throw new HostCapabilityBlockedError(
        "pty-sidecar-binary",
        `PTY sidecar not found: ${sidecar}\nRun "node scripts/build-pty-sidecar.mjs" first.`,
        { phase: "host-preflight", command: sidecar, reason: "missing-sidecar-binary" },
      );
    }
    assertNodeChildProcessAvailable();
    report.checks.push("host-node-child-process-preflight");

    first = startSidecar(port, muxDir, scrollbackDir, "first-sidecar-launch");
    const firstContract = await waitForReady(base);
    assertDaemonContract(firstContract, "first-run");
    report.firstContract = firstContract;
    report.checks.push("daemon-ready");
    report.checks.push("daemon-contract-policies-machine-readable");
    report.checks.push("terminal-core-policy-machine-readable");
    const aetherctlContract = runAetherctl(base, ["daemon"]);
    assertDaemonContract(aetherctlContract, "aetherctl");
    assert(
      aetherctlContract.instanceId === firstContract.instanceId,
      "aetherctl daemon contract should target the same live daemon instance",
    );
    report.aetherctlContract = aetherctlContract;
    report.checks.push("aetherctl-daemon-contract-parity");

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
    assert(
      allPaneIds(graph).join("|") === [childId, workspaceId].sort().join("|"),
      "break should preserve pane records",
    );
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
    const aetherctlSearch = runAetherctl(base, [
      "search",
      workspaceId,
      broadcastMarker,
      "--lines",
      "200",
      "--limit",
      "5",
    ]);
    assert(aetherctlSearch.query === broadcastMarker, "aetherctl search should echo the searched marker");
    assert(
      Array.isArray(aetherctlSearch.matches) &&
        aetherctlSearch.matches.some((match) => String(match.text ?? "").includes(broadcastMarker)),
      "aetherctl search should find the broadcast marker in durable scrollback",
    );
    report.aetherctlSearch = aetherctlSearch;
    report.checks.push("aetherctl-scrollback-search-parity");

    const aetherctlExport = runAetherctl(base, ["mux-export", workspaceId]);
    assert(aetherctlExport.schema === "aether.mux.v1", "aetherctl mux-export should return a versioned snapshot");
    assert(
      aetherctlExport.graph?.activeWorkspaceId === workspaceId,
      "aetherctl mux-export should export the requested workspace",
    );
    assert(
      paneIds(aetherctlExport.graph).join("|") === [childId, workspaceId].sort().join("|"),
      "aetherctl mux-export should preserve the active mux pane set",
    );
    report.aetherctlExport = {
      schema: aetherctlExport.schema,
      workspaceId: aetherctlExport.graph?.activeWorkspaceId,
      paneCount: paneIds(aetherctlExport.graph).length,
    };
    report.checks.push("aetherctl-mux-export-parity");

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

    second = startSidecar(port, muxDir, scrollbackDir, "second-sidecar-launch");
    const secondContract = await waitForReady(base);
    assertDaemonContract(secondContract, "second-run");
    report.secondContract = secondContract;
    report.checks.push("daemon-contract-stable-after-restart");
    report.checks.push("terminal-core-policy-stable-after-restart");
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
    assert(
      attachedPtyIds.every((id) => !id.startsWith("restore-pending:")),
      "attach should replace restore-pending ids",
    );
    assert(new Set(attachedPtyIds).size === 2, "attach should not duplicate PTY ids");
    report.checks.push("attach-respawns-live-pty-without-duplicates");

    const reattachedBaseMarker = `aether-reattached-base-${Date.now()}`;
    const reattachedChildMarker = `aether-reattached-child-${Date.now()}`;
    report.reattachedInputMarkers = {
      [workspaceId]: reattachedBaseMarker,
      [childId]: reattachedChildMarker,
    };
    await sendMarkerAndWaitForCapture(base, workspaceId, reattachedBaseMarker);
    await sendMarkerAndWaitForCapture(base, childId, reattachedChildMarker);
    report.checks.push("attach-reattached-panes-process-input");

    await request(base, `/mux/workspaces/${workspaceId}/panes/${childId}`, { method: "DELETE" });
    graph = await request(base, `/mux/workspaces/${workspaceId}`);
    assert(paneIds(graph).length === 1, "closing child pane should leave one pane");
    report.checks.push("close-pane-updates-mux-graph");

    const exportPath = join(tempRoot, "mux-import-parity.json");
    const exportToFile = runAetherctl(base, ["mux-export", workspaceId, "--out", exportPath]);
    assert(exportToFile.status === "exported", "aetherctl mux-export --out should acknowledge the export");
    assert(existsSync(exportPath), "aetherctl mux-export --out should create a snapshot file");
    const exportedSnapshot = JSON.parse(readFileSync(exportPath, "utf8"));
    assert(exportedSnapshot.schema === "aether.mux.v1", "exported snapshot file should be versioned");
    assert(
      exportedSnapshot.graph?.activeWorkspaceId === workspaceId,
      "exported snapshot file should contain the requested workspace",
    );

    const importedGraph = runAetherctl(base, ["mux-import", exportPath, "--replace"]);
    assert(
      importedGraph.activeWorkspaceId === workspaceId,
      "aetherctl mux-import should restore the same workspace id",
    );
    const importedPanes = allPaneRecords(importedGraph);
    assert(importedPanes.length === 1, "aetherctl mux-import should restore the exported one-pane graph");
    assert(
      importedPanes.every(
        (pane) => pane.lifecycle === "detached" && String(pane.pty?.terminalId ?? "").startsWith("restore-pending:"),
      ),
      "aetherctl mux-import should force imported panes into restore-pending detached state",
    );
    const sessionsAfterImport = await request(base, "/sessions");
    assert(
      Array.isArray(sessionsAfterImport) && !sessionsAfterImport.some((session) => session.id === workspaceId),
      "replace import should close the replaced live PTY instead of leaving stale live sessions",
    );
    report.aetherctlImport = {
      workspaceId: importedGraph.activeWorkspaceId,
      paneCount: importedPanes.length,
      restoredTerminalIds: importedPanes.map((pane) => pane.pty?.terminalId).sort(),
      replacedLivePtyClosed: true,
    };
    report.checks.push("aetherctl-mux-import-parity");
    report.checks.push("mux-import-restore-pending");
    report.checks.push("mux-import-replace-closes-live-pty");

    await request(base, `/sessions/${workspaceId}`, { method: "DELETE" });
    const afterClose = await requestMaybe404(base, `/mux/workspaces/${workspaceId}`);
    assert(afterClose === null, "closing workspace session should remove mux graph");
    report.checks.push("workspace-close-removes-mux-graph");

    report.status = "passed";
    report.strictPass = true;
  } catch (error) {
    if (error instanceof HostCapabilityBlockedError) {
      report.status = "environment-blocked";
      report.hostBlocked = true;
      report.blockers.push({
        capability: error.capability,
        message: error.message,
        phase: error.details?.phase ?? null,
        command: error.details?.command ?? null,
        code: error.details?.code ?? null,
        details: error.details,
      });
    } else {
      report.status = "failed";
    }
    report.errors.push(errorMessage(error));
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

  console.log(
    JSON.stringify(
      {
        status: report.status,
        hostBlocked: report.hostBlocked,
        checks: report.checks,
        blockers: report.blockers,
      },
      null,
      2,
    ),
  );
  if (report.errors.length > 0) {
    console.error(`Errors:\n- ${report.errors.join("\n- ")}`);
  }
  if (report.status !== "passed") {
    process.exitCode = 1;
  }
  console.log(`Report: ${out}`);
}

await main();
