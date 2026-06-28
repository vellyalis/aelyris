import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "mux-tmux-grade-contract.json");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function between(source, start, endMarkers = []) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  let endIndex = source.length;
  for (const marker of endMarkers) {
    const markerIndex = source.indexOf(marker, startIndex + start.length);
    if (markerIndex >= 0 && markerIndex < endIndex) endIndex = markerIndex;
  }
  return source.slice(startIndex, endIndex);
}

function check(id, ok, detail, evidence = {}) {
  return { id, ok: Boolean(ok), detail, evidence };
}

const graph = read("src-tauri/src/mux/graph.rs");
const packageJson = read("package.json");
const layout = read("src-tauri/src/mux/layout.rs");
const manager = read("src-tauri/src/mux/manager.rs");
const store = read("src-tauri/src/mux/store.rs");
const apiMux = read("src-tauri/src/api/mux.rs");
const apiMod = read("src-tauri/src/api/mod.rs");
const ipcMux = read("src-tauri/src/ipc/mux_commands.rs");
const windowSession = read("scripts/verify-mux-window-session-model.mjs");
const liveRestore = read("scripts/verify-mux-live-restore.mjs");
const perf = read("scripts/verify-mux-performance.mjs");
const multiClientAttach = read("scripts/verify-mux-multiclient-attach.mjs");
const fallbackBlocker = read("scripts/verify-mux-fallback-blocker.mjs");
const processPreservation = read("scripts/verify-mux-live-process-preservation.mjs");

const attach = between(apiMux, "async fn attach_mux_workspace(", ["async fn broadcast_mux_workspace_input("]);
const detach = between(apiMux, "async fn detach_mux_workspace(", ["async fn attach_mux_workspace("]);
const sendInput = between(apiMux, "pub(super) fn send_workspace_input(", ["async fn list_mux_workspaces("]);
const ipcPersistHelper = between(ipcMux, "fn persist_mux_workspace_snapshot(", [
  "#[tauri::command]\npub async fn mux_close_pane",
]);

const apiMutationRoutes = [
  "/mux/workspaces/{id}/panes/split",
  "/mux/workspaces/{id}/panes/swap",
  "/mux/workspaces/{id}/panes/move",
  "/mux/workspaces/{id}/panes/join",
  "/mux/workspaces/{id}/panes/synchronize",
  "/mux/workspaces/{id}/panes/{pane_id}/break",
  "/mux/workspaces/{id}/panes/{pane_id}/zoom",
  "/mux/workspaces/{id}/panes/{pane_id}",
  "/mux/workspaces/{id}/layout/even",
  "/mux/workspaces/{id}/layout/equalize",
  "/mux/workspaces/{id}/layout/tiled",
  "/mux/workspaces/{id}/layout/rotate",
];

const checks = [
  check(
    "mux-graph-model-covers-tmux-entities",
    graph.includes("pub struct WorkspaceRecord") &&
      graph.includes("pub struct WindowRecord") &&
      graph.includes("pub struct TabRecord") &&
      graph.includes("pub struct PaneRecord") &&
      graph.includes("pub struct MuxClientRecord") &&
      graph.includes("pub enum MuxClientMode") &&
      graph.includes("pub enum LifecycleState") &&
      graph.includes("pub struct PtyBinding") &&
      graph.includes("pub struct ProjectContext") &&
      graph.includes("pub struct AgentContext"),
    "Mux graph models workspace/window/tab/pane/client, lifecycle, PTY binding, project context, and agent context.",
  ),
  check(
    "window-session-model-verifier-is-required",
    packageJson.includes('"verify:mux-window-session-model"') &&
      packageJson.includes("scripts/verify-mux-window-session-model.mjs") &&
      windowSession.includes("aether.mux-window-session-model/v1") &&
      windowSession.includes("delete_mux_workspace") &&
      windowSession.includes("create_mux_window") &&
      windowSession.includes("close_mux_window") &&
      windowSession.includes("record_stream_client_attached") &&
      windowSession.includes("tmuxLiveRestoreClaim"),
    "G4.1 window/session/client model verifier is wired as a package script and explicitly keeps live restore as a separate blocked claim.",
  ),
  check(
    "mux-client-model-is-backend-owned",
    graph.includes("pub fn upsert_client(") &&
      graph.includes("pub fn remove_client(") &&
      manager.includes("pub fn pane_attachment(") &&
      manager.includes("pub fn upsert_client(") &&
      apiMux.includes("record_stream_client_attached") &&
      apiMod.includes("ActiveMuxClient") &&
      store.includes("workspace.clients.clear()"),
    "Mux clients are backend graph records updated by WS attach/detach and cleared on restart restore rather than invisible frontend-only stream state.",
  ),
  check(
    "live-process-preservation-gate-is-separated",
    packageJson.includes('"verify:mux-live-process-preservation"') &&
      packageJson.includes("scripts/verify-mux-live-process-preservation.mjs") &&
      processPreservation.includes("aether.mux-live-process-preservation/v1") &&
      processPreservation.includes('currentCapability: ok ? "daemon-live-detach-reattach-same-process" : "unknown"') &&
      processPreservation.includes('requiredCapability: "same-process-or-broker-preserved-reconnect"') &&
      processPreservation.includes("daemon-restart-is-restore-pending-respawn") &&
      processPreservation.includes("restart restore remains explicitly restore-pending respawn"),
    "True mux live process preservation is a separate gate; daemon-live detach/reattach can pass, while restart restore respawn remains an explicit boundary.",
  ),
  check(
    "layout-core-supports-tmux-style-operations",
    layout.includes("split_pane") &&
      layout.includes("close_pane") &&
      layout.includes("swap_panes") &&
      layout.includes("move_pane_next_to") &&
      layout.includes("apply_even") &&
      layout.includes("apply_tiled") &&
      layout.includes("rotate_panes") &&
      layout.includes("set_zoomed"),
    "Layout core supports split/close/swap/move/even/tiled/rotate/zoom operations.",
  ),
  check(
    "manager-validates-active-tab-operations",
    manager.includes("split_active_pane") &&
      manager.includes("close_active_pane") &&
      manager.includes("break_active_pane_to_new_tab") &&
      manager.includes("join_pane_into_active_tab") &&
      manager.includes("set_active_tab_synchronized_panes") &&
      manager.includes("synchronized_input_targets_for_pane") &&
      manager.includes("validate_all"),
    "MuxManager owns graph mutation and validation for active tab operations and synchronized panes.",
  ),
  check(
    "snapshot-store-is-versioned-atomic-and-restore-pending",
    store.includes("VersionedMuxSnapshot") &&
      store.includes("aether.mux.v") &&
      store.includes("tmp_snapshot_path") &&
      store.includes("fs::rename") &&
      store.includes("graph_for_snapshot_restore") &&
      store.includes("restore-pending:") &&
      store.includes("LifecycleState::Detached"),
    "FileMuxSnapshotStore writes versioned atomic snapshots and restores live PTY bindings as detached restore-pending panes.",
  ),
  check(
    "api-restores-snapshots-on-startup",
    apiMod.includes("with_mux_store") &&
      apiMod.includes("store.load_all_graphs()") &&
      apiMod.includes("graph_for_snapshot_restore(graph)") &&
      apiMod.includes("with_env_mux_store") &&
      apiMod.includes("AETHER_MUX_SNAPSHOT_DIR"),
    "ApiState loads mux snapshots on startup from AETHER_MUX_SNAPSHOT_DIR and converts them to restore-pending graphs.",
  ),
  check(
    "api-mux-mutating-routes-persist-snapshots",
    apiMutationRoutes.every((route) => apiMux.includes(route)) &&
      apiMux.includes("fn persist_mux_graph") &&
      (apiMux.match(/persist_mux_graph\(&state, &graph\)\?/g) ?? []).length >= 10,
    "REST mux mutation routes persist graph snapshots after successful graph mutations.",
  ),
  check(
    "api-detach-attach-have-tmux-like-restore-policy",
    detach.includes("mark_mux_graph_detached") &&
      detach.includes("persist_mux_graph(&state, &graph)") &&
      attach.includes("collect_mux_attach_plan") &&
      attach.includes("spawn_with_id") &&
      attach.includes("mark_mux_graph_attached") &&
      attach.includes("persist_mux_graph(&state, &graph)") &&
      attach.includes("state.max_sessions"),
    "REST detach marks panes detached without killing PTYs, attach respawns missing/restore-pending panes under the session cap, and both persist.",
  ),
  check(
    "mux-input-fanout-is-bounded-and-risk-gated",
    sendInput.includes("WS_MAX_INPUT_FRAME_BYTES") &&
      sendInput.includes("collect_live_pty_ids") &&
      sendInput.includes("gate_command_input") &&
      apiMux.includes("GateMode::HoldUntilApproved") &&
      sendInput.includes("state.pty.write"),
    "Workspace input fanout is bounded, command-risk gated, and writes only to live PTY targets.",
  ),
  check(
    "tauri-ipc-fallback-persists-mux-snapshots",
    ipcPersistHelper.includes("try_state::<crate::api::ApiState>") &&
      ipcPersistHelper.includes("api_state.mux_store.as_ref()") &&
      ipcPersistHelper.includes(".save_graph(&graph)") &&
      ipcMux.includes("persist_mux_workspace_snapshot(&app, &workspace_id)?") &&
      (ipcMux.match(/persist_mux_workspace_snapshot\(&app, &workspace_id\)\?/g) ?? []).length >= 7,
    "Tauri IPC in-process mux fallback saves graph snapshots after split/close/swap/break/join/sync/layout/zoom mutations.",
  ),
  check(
    "live-restore-verifier-covers-sidecar-contract-and-restart",
    liveRestore.includes("mux-live-attach-detach") &&
      liveRestore.includes("mux-snapshot-restore-pending") &&
      liveRestore.includes("durable-scrollback") &&
      liveRestore.includes("startSidecar") &&
      liveRestore.includes("killProcess") &&
      liveRestore.includes("aetherctl"),
    "Live restore verifier checks sidecar contract capabilities and exercises restart/restore through aetherctl.",
  ),
  check(
    "performance-verifier-covers-attach-detach-budgets",
    perf.includes("detachP95Ms") &&
      perf.includes("attachP95Ms") &&
      perf.includes("resizeP95Ms") &&
      perf.includes("iterations") &&
      perf.includes("/mux/workspaces/") &&
      perf.includes("/attach"),
    "Mux performance verifier records p95 budgets for create/split/detach/attach/resize/close.",
  ),
  check(
    "multi-client-attach-contract-covers-read-only-and-output-fanout",
    multiClientAttach.includes("stream-mode-contract-is-explicit") &&
      multiClientAttach.includes("read-only-websocket-cannot-write-to-pty") &&
      multiClientAttach.includes("pty-output-fanout-supports-multiple-clients") &&
      multiClientAttach.includes("ws-handler-prefers-ticket-mode-over-query-mode") &&
      multiClientAttach.includes("exclusive-controller-lease-is-acquired-and-released") &&
      multiClientAttach.includes("rest-input-and-resize-respect-controller-lease-owner") &&
      multiClientAttach.includes("attach-snapshot-replay-uses-atomic-capture-subscribe"),
    "Dedicated multi-client attach verifier covers typed stream mode, read-only input isolation, ticket-mode binding, exclusive controller lease, REST owner checks, atomic attach replay, and PTY output fanout.",
  ),
  check(
    "fallback-blocker-prevents-degraded-tmux-claim",
    fallbackBlocker.includes("design-declares-fallbacks-claim-blocking") &&
      fallbackBlocker.includes("visible-runtime-classifies-native-as-degraded") &&
      fallbackBlocker.includes("ipc-fallback-persists-but-is-not-claim-unlocker") &&
      fallbackBlocker.includes("anti-debt-register-enforces-claim-block-shape"),
    "Dedicated fallback blocker verifier prevents in-process/native fallback from satisfying the tmux-grade claim.",
  ),
];

const failed = checks.filter((item) => !item.ok);
const report = {
  schema: "aether.mux-tmux-grade-contract/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  ok: failed.length === 0,
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.map((item) => item.id),
  checks,
  knownGaps: [
    {
      id: "legacy-shared-read-write-remains-compatible",
      severity: "review",
      detail:
        "Exclusive controller lease is now contract-checked, but default read-write WS clients intentionally remain shared for existing clients.",
    },
    {
      id: "ipc-fallback-persistence-has-no-unit-test-yet",
      severity: "review",
      detail:
        "Tauri IPC fallback now saves mux snapshots through ApiState.mux_store, but this is currently covered by static contract and compile tests, not a direct Tauri command unit test.",
    },
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.id}`);
  console.log(`      ${item.detail}`);
}
if (report.knownGaps.length > 0) {
  console.log("\nKnown review gaps:");
  for (const gap of report.knownGaps) console.log(`REVIEW ${gap.id}: ${gap.detail}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${checks.length} mux tmux-grade assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} mux tmux-grade assertions PASSED`);
