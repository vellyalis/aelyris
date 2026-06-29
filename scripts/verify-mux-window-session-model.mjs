import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "mux-window-session-model.json");

const SOURCE_PATHS = [
  "package.json",
  "src-tauri/src/mux/graph.rs",
  "src-tauri/src/mux/manager.rs",
  "src-tauri/src/mux/store.rs",
  "src-tauri/src/api/mux.rs",
  "src-tauri/src/ipc/mux_commands.rs",
  "scripts/verify-mux-window-session-model.mjs",
  "docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
];

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function mtime(rel) {
  return statSync(join(ROOT, rel)).mtimeMs;
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

function hasAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

function check(id, ok, detail, evidence = {}) {
  return { id, ok: Boolean(ok), detail, evidence };
}

const packageJson = read("package.json");
const graph = read("src-tauri/src/mux/graph.rs");
const manager = read("src-tauri/src/mux/manager.rs");
const store = read("src-tauri/src/mux/store.rs");
const apiMux = read("src-tauri/src/api/mux.rs");
const ipcMux = read("src-tauri/src/ipc/mux_commands.rs");
const visiblePaneSpec = read("docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md");

const router = between(apiMux, "pub(super) fn router()", ["#[derive(Deserialize)]"]);
const deleteWorkspace = between(apiMux, "async fn delete_mux_workspace(", ["async fn list_mux_windows("]);
const listWindows = between(apiMux, "async fn list_mux_windows(", ["async fn create_mux_window("]);
const createWindow = between(apiMux, "async fn create_mux_window(", ["async fn rename_mux_window("]);
const renameWindow = between(apiMux, "async fn rename_mux_window(", ["async fn close_mux_window("]);
const closeWindow = between(apiMux, "async fn close_mux_window(", ["async fn detach_mux_workspace("]);
const windowSummary = between(apiMux, "fn window_summary(", ["#[allow(clippy::too_many_arguments)]"]);

const checks = [
  check(
    "package-script",
    packageJson.includes('"verify:mux-window-session-model"') &&
      packageJson.includes("scripts/verify-mux-window-session-model.mjs"),
    "package.json exposes the G4.1 mux window/session model verifier.",
  ),
  check(
    "graph-owns-session-window-tab-pane-model",
    hasAll(graph, [
      "pub struct WorkspaceRecord",
      "pub struct WindowRecord",
      "pub struct TabRecord",
      "pub struct PaneRecord",
      "pub struct MuxClientRecord",
      "pub enum MuxClientMode",
      "pub active_window_id: String",
      "pub clients: HashMap<String, MuxClientRecord>",
      "validate_active_ref(",
      '"workspace"',
      '"window"',
      '"tab"',
    ]),
    "MuxGraph owns workspace/window/tab/pane/client state and validates active references in the backend model.",
  ),
  check(
    "graph-client-lifecycle-is-first-class",
    hasAll(graph, [
      "pub fn upsert_client(",
      "pub fn remove_client(",
      "ClientRecordMismatch",
      "ClientWorkspaceMismatch",
      "client_lifecycle_is_backend_owned_and_window_scoped",
      "removing_window_detaches_clients_bound_to_that_window",
      "legacy_graph_without_clients_defaults_to_empty_client_map",
    ]),
    "Mux clients are first-class backend graph records, survive serde compatibility, and are removed when their attached window is removed.",
  ),
  check(
    "graph-window-lifecycle-is-first-class",
    hasAll(graph, [
      "pub fn create_window(&mut self, window: WindowRecord)",
      "pub fn rename_window(",
      "pub fn remove_window(",
      "MuxGraphError::CannotRemoveLastWindow",
      "MuxGraphError::MissingWindow",
      "window_lifecycle_keeps_active_window_valid",
      "window_lifecycle_rejects_last_window_removal",
    ]),
    "Window create/rename/remove is a first-class graph operation and cannot delete the last window.",
  ),
  check(
    "manager-wraps-window-lifecycle",
    hasAll(manager, [
      "pub fn create_window(",
      "pub fn rename_window(",
      "pub fn close_window(",
      "pub fn upsert_client(",
      "pub fn remove_client(",
      "pub fn pane_attachment(",
      "manager_drives_window_lifecycle",
      "manager_drives_client_lifecycle",
      "manager_finds_workspace_window_attachment_for_pane",
      "graph.validate()?",
    ]),
    "MuxManager exposes validated window/client lifecycle operations instead of forcing API callers to mutate graph internals.",
  ),
  check(
    "snapshot-store-supports-session-delete-and-restore-pending",
    hasAll(store, [
      "VersionedMuxSnapshot",
      "pub fn save_graph",
      "fs::rename",
      "pub fn delete_graph",
      "graph_for_snapshot_restore",
      "restore-pending:",
      "LifecycleState::Detached",
      "workspace.clients.clear()",
      "snapshot_restore_drops_live_client_records",
    ]),
    "FileMuxSnapshotStore can atomically save, delete, and restore mux session snapshots as restore-pending graphs without resurrecting stale live clients.",
  ),
  check(
    "rest-routes-cover-session-and-window-lifecycle",
    hasAll(router, [
      '"/mux/workspaces/{id}"',
      "get(get_mux_workspace).delete(delete_mux_workspace)",
      '"/mux/workspaces/{id}/windows"',
      "get(list_mux_windows).post(create_mux_window)",
      '"/mux/workspaces/{id}/windows/{window_id}/rename"',
      '"/mux/workspaces/{id}/windows/{window_id}"',
      "delete(close_mux_window)",
    ]),
    "REST mux routes expose backend-owned session delete and window list/create/rename/kill operations.",
  ),
  check(
    "session-delete-closes-ptys-and-deletes-snapshot",
    hasAll(deleteWorkspace, [
      "mux.remove_graph(&workspace_id)",
      "collect_pty_ids(&graph)",
      "close_mux_pty_ids(&state, terminal_ids.clone())",
      "state.controller_leases.release_session",
      "delete_graph_snapshot(&state, &workspace_id)",
      "StatusCode::NO_CONTENT",
    ]),
    "DELETE /mux/workspaces/{id} removes the graph, closes bound PTYs, releases controller leases, and deletes the snapshot.",
  ),
  check(
    "window-list-uses-backend-active-window",
    hasAll(listWindows, [
      "workspace",
      "windows",
      "values()",
      "window_summary",
      "active_window_id",
      "windows.sort_by",
    ]) && hasAll(windowSummary, ["active: window.id == active_window_id", "tab_count", "pane_count"]),
    "GET /mux/workspaces/{id}/windows reports backend active window plus tab/pane counts.",
  ),
  check(
    "window-create-spawns-pty-adds-graph-and-rolls-back",
    hasAll(createWindow, [
      "spawn_with_id",
      "mux_window_from_pane",
      "create_window",
      "&workspace_id",
      "window",
      "persist_mux_graph(&state, &graph)",
      "pty.close(&pane_id)",
      "session limit reached",
    ]),
    "POST /mux/workspaces/{id}/windows creates a new PTY-backed window and closes the spawned PTY if graph insertion fails.",
  ),
  check(
    "window-rename-and-delete-persist",
    hasAll(renameWindow, [
      "rename_window",
      "&workspace_id",
      "&window_id",
      "title",
      "persist_mux_graph(&state, &graph)",
    ]) &&
      hasAll(closeWindow, [
        "close_window",
        "&workspace_id",
        "&window_id",
        "persist_mux_graph(&state, &graph)",
        "collect_window_pty_ids(&removed)",
        "close_mux_pty_ids(&state, terminal_ids.clone())",
        "state.controller_leases.release_session",
      ]),
    "Window rename/delete routes mutate the manager, persist the graph, and close/release removed window PTYs.",
  ),
  check(
    "ipc-fallback-persists-snapshots",
    hasAll(ipcMux, [
      "fn persist_mux_workspace_snapshot(",
      "api_state.mux_store.as_ref()",
      ".save_graph(&graph)",
      "persist_mux_workspace_snapshot(&app, &workspace_id)?",
    ]),
    "Tauri IPC fallback persists snapshots through ApiState.mux_store after mux graph mutations.",
  ),
  check(
    "stream-client-attach-updates-backend-model",
    hasAll(apiMux, [
      "record_stream_client_attached",
      "MuxClientRecord::new",
      "pane_attachment(pane_id)",
      "mux.upsert_client",
      "persist_mux_graph(state, &graph)",
      "remove_stream_client",
      "mux.remove_client",
    ]),
    "WebSocket stream attach/detach updates backend mux client records and persists the graph instead of remaining an invisible stream-only side effect.",
  ),
  check(
    "runtime-spec-keeps-live-restore-separate",
    visiblePaneSpec.includes("Do not claim tmux-level durability until sidecar-owned attach/recover is proven") &&
      visiblePaneSpec.includes("WU-VP-3 sidecar-owned loop panes") &&
      apiMux.includes("record_stream_client_attached") &&
      store.includes("restore-pending:"),
    "The current runtime spec and source contracts keep this model gate separate from daemon-live process preservation and restart restore proof.",
  ),
];

const failed = checks.filter((item) => !item.ok);
const report = {
  schema: "aelyris.mux-window-session-model/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-static-model-contract" : "failed",
  sourceCutoffMs: Math.max(...SOURCE_PATHS.map(mtime)),
  sourcePaths: SOURCE_PATHS,
  claimScope: "static-backend-session-window-client-model",
  tmuxLiveRestoreClaim: "blocked-by-verify-mux-live-restore",
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.map((item) => item.id),
  checks,
  knownGaps: [
    {
      id: "live-two-client-websocket-proof-depends-on-host-conpty",
      severity: "review",
      detail:
        "MuxClient is now represented in the backend graph, but a fresh two-client live WebSocket proof still depends on a host where ConPTY/session spawn is allowed.",
    },
    {
      id: "attach-route-is-restore-respawn-not-second-client-attach",
      severity: "block",
      detail:
        "/mux/workspaces/{id}/attach restores missing or restore-pending PTYs; live second-client attach remains covered by separate multi-client and live restore gates.",
    },
    {
      id: "restart-time-process-preservation-not-proven",
      severity: "block",
      detail:
        "This verifier proves backend model and route ownership only. Daemon-live process preservation is covered by verify:mux-live-process-preservation; sidecar restart remains restore-pending respawn.",
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
  console.log("\nKnown G4.1 gaps:");
  for (const gap of report.knownGaps) console.log(`${gap.severity.toUpperCase()} ${gap.id}: ${gap.detail}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${checks.length} mux window/session model assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} mux window/session model assertions PASSED`);
