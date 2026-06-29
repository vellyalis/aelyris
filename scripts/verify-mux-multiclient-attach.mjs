import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "mux-multiclient-attach-contract.json");

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

const apiMod = read("src-tauri/src/api/mod.rs");
const apiMux = read("src-tauri/src/api/mux.rs");
const graph = read("src-tauri/src/mux/graph.rs");
const manager = read("src-tauri/src/mux/manager.rs");
const store = read("src-tauri/src/mux/store.rs");
const ptyManager = read("src-tauri/src/pty/manager.rs");
const v2bTests = read("src-tauri/tests/test_api_3d1_v2b.rs");
const broadcastTests = read("src-tauri/tests/test_pty_broadcast.rs");

const ticketRegistry = between(apiMod, "pub struct TicketRegistry", ["impl Default for TicketRegistry"]);
const authMiddleware = between(apiMod, "async fn auth_middleware(", ["/// E1 governance choke point"]);
const issueStreamTicket = between(apiMod, "async fn issue_stream_ticket(", [
  "#[derive(Deserialize)]\nstruct StreamTicketQuery",
]);
const wsSession = between(apiMod, "async fn ws_session(", ["#[derive(Deserialize)]\nstruct StreamSessionQuery"]);
const handleWs = between(apiMod, "async fn handle_ws(", ["// ─── Unit tests"]);
const resizeSession = between(apiMod, "async fn resize_session(", ["async fn send_session_input("]);
const sendSessionInput = between(apiMod, "async fn send_session_input(", ["fn synchronized_input_targets("]);
const subscribeOutput = between(ptyManager, "pub fn subscribe_output(", ["/// Capture the recent PTY output"]);
const captureAndSubscribe = between(ptyManager, "pub fn capture_and_subscribe(", ["/// Capture the recent PTY output"]);

const checks = [
  check(
    "stream-mode-contract-is-explicit",
    apiMod.includes("pub enum StreamMode") &&
      apiMod.includes("pub enum StreamControl") &&
      apiMod.includes("ReadWrite") &&
      apiMod.includes("ReadOnly") &&
      apiMod.includes("Exclusive") &&
      apiMod.includes('#[serde(rename_all = "kebab-case")]') &&
      apiMod.includes("fn parse_stream_mode") &&
      apiMod.includes("fn parse_stream_control"),
    "API stream attach/control mode is a typed backend contract with read-write/read-only modes and shared/exclusive control.",
  ),
  check(
    "stream-ticket-persists-mode-in-registry",
    ticketRegistry.includes("mode: StreamMode") &&
      ticketRegistry.includes("control: StreamControl") &&
      ticketRegistry.includes("client_id: Option<String>") &&
      ticketRegistry.includes("pub fn issue_with_mode") &&
      ticketRegistry.includes("pub fn issue_with_attach") &&
      ticketRegistry.includes("redeem_claim_for_session") &&
      ticketRegistry.includes("StreamTicketClaim") &&
      ticketRegistry.includes("mode: entry.mode") &&
      ticketRegistry.includes("control: entry.control") &&
      ticketRegistry.includes("client_id: entry.client_id.clone()"),
    "One-shot stream tickets carry attach mode, control policy, and client id until redemption instead of trusting WS query parameters.",
  ),
  check(
    "ticket-issue-endpoint-defaults-compatible-and-reports-mode",
    issueStreamTicket.includes("Query(query): Query<StreamTicketQuery>") &&
      issueStreamTicket.includes("parse_stream_mode(query.mode.as_deref())") &&
      issueStreamTicket.includes("parse_stream_control(query.control.as_deref())") &&
      issueStreamTicket.includes("ticket_client_id(query.client_id.as_deref(), mode, control)") &&
      issueStreamTicket.includes("issue_with_attach(&id, mode, control, client_id.clone())") &&
      issueStreamTicket.includes("mode,") &&
      issueStreamTicket.includes("control,") &&
      issueStreamTicket.includes("writable: mode.can_write()"),
    "POST /sessions/{id}/stream-ticket remains compatible by default and reports mode/control/writable/clientId for clients.",
  ),
  check(
    "auth-middleware-binds-redeemed-ticket-claim",
    authMiddleware.includes("let mut stream_ticket_claim") &&
      authMiddleware.includes("redeem_claim_for_session(&ticket, session_id)") &&
      authMiddleware.includes("stream_ticket_claim = Some(claim)") &&
      authMiddleware.includes("req.extensions_mut().insert(claim)"),
    "The WS upgrade path binds the redeemed ticket claim into request extensions before the handler runs.",
  ),
  check(
    "ws-handler-prefers-ticket-mode-over-query-mode",
    wsSession.includes("ticket_claim: Option<Extension<StreamTicketClaim>>") &&
      wsSession.includes("Some(Extension(claim))") &&
      wsSession.includes("claim.mode") &&
      wsSession.includes("claim.control") &&
      wsSession.includes("claim.client_id") &&
      wsSession.includes("None => match parse_stream_mode(query.mode.as_deref())") &&
      wsSession.includes("handle_ws(") &&
      wsSession.includes("active_lease") &&
      wsSession.includes("initial_replay") &&
      wsSession.includes("client_id"),
    "A read-only ticket cannot be upgraded by appending a read-write mode query; bearer WS clients may still opt down to read-only.",
  ),
  check(
    "exclusive-controller-lease-is-acquired-and-released",
    apiMod.includes("pub struct StreamControllerLeases") &&
      apiMod.includes("pub fn acquire(&self, session_id: &str, client_id: &str)") &&
      apiMod.includes("pub fn ensure_can_control") &&
      apiMod.includes("struct ActiveStreamLease") &&
      apiMod.includes("impl Drop for ActiveStreamLease") &&
      wsSession.includes("control.is_exclusive()") &&
      wsSession.includes("state.controller_leases.acquire(&id, &client_id)") &&
      wsSession.includes("ActiveStreamLease") &&
      handleWs.includes("_active_lease: Option<ActiveStreamLease>"),
    "Explicit exclusive controller streams acquire a session lease and release it when the WS handler ends.",
  ),
  check(
    "rest-input-and-resize-respect-controller-lease-owner",
    apiMod.includes("pub const CLIENT_ID_HEADER") &&
      apiMod.includes("client_id_header_name()") &&
      apiMod.includes("client_id_from_headers") &&
      resizeSession.includes("headers: HeaderMap") &&
      resizeSession.includes("ensure_can_control(&id, client_id.as_deref())") &&
      sendSessionInput.includes("headers: HeaderMap") &&
      sendSessionInput.includes("for target_id in &targets") &&
      sendSessionInput.includes("ensure_can_control(target_id, client_id.as_deref())"),
    "REST input and resize remain compatible without a lease but require the lease owner's x-aelyris-client-id when an exclusive controller is active.",
  ),
  check(
    "mux-client-record-is-backend-visible-and-persisted",
    graph.includes("pub struct MuxClientRecord") &&
      graph.includes("pub enum MuxClientMode") &&
      graph.includes("pub fn upsert_client(") &&
      graph.includes("pub fn remove_client(") &&
      manager.includes("pub fn pane_attachment(") &&
      manager.includes("pub fn upsert_client(") &&
      apiMod.includes("struct ActiveMuxClient") &&
      apiMod.includes("record_stream_client_attached(&state, &id, client_id, mode)") &&
      apiMux.includes("MuxClientRecord::new") &&
      apiMux.includes("mux.upsert_client") &&
      apiMux.includes("mux.remove_client") &&
      apiMux.includes("persist_mux_graph(state, &graph)") &&
      store.includes("workspace.clients.clear()"),
    "Live WS stream attach/detach is mirrored into backend mux client records and persisted while avoiding stale client resurrection on restart.",
  ),
  check(
    "read-only-websocket-cannot-write-to-pty",
    handleWs.includes("mut rx: broadcast::Receiver<Vec<u8>>") &&
      handleWs.includes("mode: StreamMode") &&
      handleWs.includes("if !mode.can_write()") &&
      handleWs.includes("rejected") &&
      handleWs.indexOf("if !mode.can_write()") < handleWs.indexOf("gate_command_input") &&
      handleWs.indexOf("if !mode.can_write()") < handleWs.indexOf("write_state.pty.write"),
    "Read-only WS streams keep receiving output but reject client bytes before command-risk gating and PTY write.",
  ),
  check(
    "attach-snapshot-replay-uses-atomic-capture-subscribe",
    captureAndSubscribe.includes("output_buffer") &&
      captureAndSubscribe.includes("let rx = instance.output_tx.subscribe()") &&
      captureAndSubscribe.includes("tail_including_partial") &&
      apiMod.includes("stream-attach-snapshot-replay") &&
      wsSession.includes("capture_and_subscribe(&id, replay_lines, replay_clean)") &&
      handleWs.includes("initial_replay: Option<Vec<u8>>") &&
      handleWs.includes("sender.send(Message::Binary(initial.into()))") &&
      broadcastTests.includes("capture_and_subscribe_replays_snapshot_then_future_bytes"),
    "Opt-in WS replayLines uses atomic capture+subscribe and sends the captured snapshot before future live bytes.",
  ),
  check(
    "pty-output-fanout-supports-multiple-clients",
    subscribeOutput.includes("initial_rx.take()") &&
      subscribeOutput.includes("instance.output_tx.subscribe()") &&
      ptyManager.includes("single OS-level reader thread") &&
      ptyManager.includes("fans out master bytes to every subscriber"),
    "PtyManager keeps one master reader and broadcasts output to every subscriber, including multiple WS clients.",
  ),
  check(
    "multi-subscriber-output-tests-exist",
    broadcastTests.includes("two_subscribers_receive_same_marker") &&
      broadcastTests.includes("slow_subscriber_does_not_block_fast") &&
      broadcastTests.includes("late_subscriber_sees_future_bytes"),
    "Existing PTY broadcast tests cover multi-subscriber output fanout and slow-reader isolation.",
  ),
  check(
    "stream-mode-tests-cover-registry-and-http-shape",
    v2bTests.includes("registry_redeem_claim_preserves_stream_mode") &&
      v2bTests.includes("registry_redeem_claim_preserves_exclusive_control") &&
      v2bTests.includes("controller_lease_rejects_competing_client_until_release") &&
      v2bTests.includes("read_only_stream_ticket_reports_non_writable_mode") &&
      v2bTests.includes("exclusive_stream_ticket_returns_controller_client_id") &&
      broadcastTests.includes("capture_and_subscribe_replays_snapshot_then_future_bytes") &&
      v2bTests.includes('Some("read-write")') &&
      v2bTests.includes('Some("read-only")'),
    "Focused stream-ticket tests cover mode/control preservation, controller lease conflict, and response compatibility.",
  ),
];

const failed = checks.filter((item) => !item.ok);
const report = {
  schema: "aelyris.mux-multiclient-attach-contract/v1",
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
        "Exclusive controller lease is available and enforced when requested, but default read-write streams intentionally remain shared for existing clients.",
    },
    {
      id: "live-read-only-ws-proof-depends-on-host-conpty",
      severity: "review",
      detail:
        "Static and integration-test contracts exist; a live two-client marker proof still depends on a host where ConPTY/session spawn is allowed.",
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
  console.error(`\n${failed.length}/${checks.length} mux multi-client assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} mux multi-client attach assertions PASSED`);
