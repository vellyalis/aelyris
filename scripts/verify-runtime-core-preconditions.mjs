import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "runtime-core-preconditions.json");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function record(id, ok, detail) {
  return { id, ok, detail };
}

const outputMonitor = read("src-tauri/src/agent/output_monitor.rs");
const sendKeys = read("src-tauri/src/ipc/send_keys_commands.rs");
const inputAuthority = read("src-tauri/src/command_risk/authority.rs");
const mcp = read("src-tauri/src/api/mcp.rs");
const apiMod = read("src-tauri/src/api/mod.rs");
const apiMux = read("src-tauri/src/api/mux.rs");
const ipcCommands = read("src-tauri/src/ipc/commands.rs");
const sessionLifecycle = read("src-tauri/src/ipc/session_lifecycle_commands.rs");
const sidecar = read("src-tauri/src/pty_sidecar.rs");
const paneFleet = read("src-tauri/src/control/pane_fleet.rs");
const loopPorts = read("src-tauri/src/control/loop_ports.rs");
const decisionInbox = read("src/shared/lib/decisionInbox.ts");
const panel = read("src/features/decision-inbox/DecisionInboxPanel.tsx");
const decisionInboxTest = read("src/__tests__/decisionInbox.test.ts");
const panelTest = read("src/__tests__/DecisionInboxPanel.test.tsx");

const cursorRegexSection = outputMonitor.match(/static CURSOR_OPTION_RE:[\s\S]*?;\r?\n\r?\n/)?.[0] ?? "";
const promptCap = Number(outputMonitor.match(/const APPROVAL_PROMPT_MAX_CHARS: usize = (\d+);/)?.[1] ?? 0);

const checks = [
  record(
    "a1-typed-terminal-write-envelope",
    [
      "request_id",
      "actor",
      "source",
      "terminal_id",
      "session_id",
      "target_ids",
      "payload_mode",
      "command_hash",
      "approval",
    ].every((field) => inputAuthority.includes(`pub ${field}:`)) &&
      inputAuthority.includes("TerminalWriteAck") &&
      inputAuthority.includes("TerminalWriteNack"),
    "A1 typed envelope carries identity, scope, payload mode, hash, approval binding, request id, and typed ACK/NACK",
  ),
  record(
    "a1-daemon-authority-covers-write-faces",
    apiMod.includes('"rest-session-input"') &&
      apiMod.includes('"ws-session-input"') &&
      mcp.includes('"mcp-pane-input"') &&
      mcp.includes('"mcp-safe-input"') &&
      apiMux.includes('"rest-mux-input"') &&
      sendKeys.includes('"ipc-broadcast-keys"') &&
      sendKeys.includes("SEND_KEYS_SOURCE") &&
      ipcCommands.includes('"ipc-native-paste"') &&
      ipcCommands.includes('"ipc-native-keystroke"') &&
      sessionLifecycle.includes('"runtime-session-lifecycle"'),
    "REST, WS, MCP, mux, broadcast/send-keys, native input/paste, and runtime prompt faces route through typed authority",
  ),
  record(
    "a1-sidecar-capability-separate-from-bearer",
    sidecar.includes("INPUT_AUTHORITY_TOKEN_FILE_NAME") &&
      sidecar.includes('x-aelyris-input-authority') &&
      apiMod.includes("verify_input_authority") &&
      apiMod.includes("human input approval capability is required") &&
      mcp.includes("humanApprovalCapability"),
    "App-to-daemon input authority and human approval use a capability separate from the public bearer token",
  ),
  record(
    "a1-adversarial-authority-tests",
    inputAuthority.includes("raw_programmatic_enter_cannot_resolve_waiting_approval") &&
      inputAuthority.includes("interactive approval claims are single-use") &&
      inputAuthority.includes("payload_hash_and_cross_target_mutations_fail_closed") &&
      inputAuthority.includes("queue_acceptance_is_not_reported_when_raw_write_fails") &&
      inputAuthority.includes("ack_is_emitted_only_after_every_effective_target_writes"),
    "Authority tests cover raw Enter, replay/stale/cross-target/hash failures, effective targets, and post-write ACK semantics",
  ),
  record(
    "approval-detection-highlighted-yes-only",
    cursorRegexSection.includes("\\s+yes\\b") && !cursorRegexSection.includes("yes|no"),
    "CURSOR_OPTION_RE only treats a highlighted Yes option as resolvable",
  ),
  record(
    "approval-prompt-transport-cap-is-loose",
    promptCap >= 1024 && outputMonitor.includes("bound_transport_prompt"),
    `approval prompt transport cap is ${promptCap}`,
  ),
  record(
    "backend-test-middle-danger-preserved",
    outputMonitor.includes("claude_permission_prompt_keeps_middle_danger_for_classification") &&
      outputMonitor.includes("rm -rf C:/danger"),
    "Rust parser has a regression test for destructive text in the middle of a long prompt",
  ),
  record(
    "backend-test-highlighted-no-not-resolvable",
    outputMonitor.includes("claude_permission_menu_requires_highlighted_yes_option") &&
      outputMonitor.includes("❯ 2. No"),
    "Rust parser rejects a permission menu when No is the highlighted option",
  ),
  record(
    "decision-inbox-keeps-full-prompt",
    decisionInbox.includes("const context = prompt;") && !decisionInbox.includes("const context = shortText(prompt"),
    "Decision Inbox stores the full captured prompt and leaves clipping to render",
  ),
  record(
    "decision-inbox-classifies-full-prompt-test",
    decisionInboxTest.includes("keeps the full interactive approval prompt before render clipping") &&
      decisionInboxTest.includes("expect(inbox.pendingItems[0].context).toBe(approvalPrompt)"),
    "Vitest covers full prompt retention before visual clipping",
  ),
  record(
    "panel-tooltip-uses-full-context",
    panel.includes("title={item.context}") &&
      panelTest.includes("keeps the full approval prompt in the rendered tooltip") &&
      panelTest.includes("screen.getByTitle(approvalPrompt)"),
    "DecisionInboxPanel exposes the full prompt in the tooltip while CSS clips visually",
  ),
  record(
    "approve-keystroke-selects-option-one",
    /fn approval_resolution_keystroke\(approve: bool\)[\s\S]*?if approve\s*\{\s*b"1"\s*\}\s*else\s*\{\s*b"\\x1b"\s*\}/.test(
      sendKeys,
    ) &&
      sendKeys.includes("approval_resolution_keystroke(approve)") &&
      !/if approve\s*\{\s*b"\\r"\s*\}\s*else\s*\{\s*b"\\x1b"\s*\}/.test(sendKeys),
    "Approve sends option 1 explicitly; Deny sends Escape",
  ),
  record(
    "approve-keystroke-tests-present",
    sendKeys.includes("approve_keystroke_explicitly_selects_yes") &&
      sendKeys.includes("deny_keystroke_rejects_with_escape"),
    "Rust tests lock approve/deny keystroke bytes",
  ),
  record(
    "approval-resolution-rechecks-current-session",
    sendKeys.includes("sync_terminal_interactive_approval_authority") &&
      inputAuthority.includes("claim_interactive_approval") &&
      inputAuthority.includes("state.session_id != envelope.session_id"),
    "resolve_interactive_approval projects current state and the daemon authority claims the matching session before writing",
  ),
  record(
    "approval-resolution-requires-prompt-fingerprint",
    sendKeys.includes("expected_prompt_key: Option<String>") &&
      sendKeys.includes("expected_prompt_key.as_deref()") &&
      inputAuthority.includes("interactive approval requires the current prompt fingerprint") &&
      decisionInbox.includes("approvalPromptKey: promptKey"),
    "Decision Inbox passes a prompt fingerprint and the backend fails closed when it is absent",
  ),
  record(
    "approval-resolution-stale-error-contract",
    sendKeys.includes("stale_approval") &&
      inputAuthority.includes("interactive approval fingerprint, session, or target set changed") &&
      sendKeys.includes("stable_interactive_prompt_key") &&
      sendKeys.includes("stable_text_key_matches_decision_inbox_vectors"),
    "stale approval errors are typed and cross-language prompt fingerprint vectors are tested",
  ),
  record(
    "approval-fingerprint-checked-inside-write-lock",
    (() => {
      const fnStart = sendKeys.indexOf("pub async fn resolve_interactive_approval");
      if (fnStart < 0) return false;
      const body = sendKeys.slice(fnStart);
      const lockAt = body.indexOf("write_order.lock().await");
      const authorityAt = body.indexOf("terminal_write_authorized_async(");
      return lockAt >= 0 && authorityAt >= 0 && lockAt < authorityAt;
    })(),
    "resolve_interactive_approval acquires the per-terminal write lock BEFORE daemon-authority claim and delivery",
  ),
  record(
    "write-paths-block-targeted-waiting-approval",
    inputAuthority.includes("blocked_waiting_approval") &&
      inputAuthority.includes("programmatic input cannot resolve an interactive approval") &&
      sendKeys.includes("terminal_write_authorized_async"),
    "targeted send-key paths delegate waiting-approval enforcement to the daemon authority",
  ),
  record(
    "fanout-write-paths-skip-and-report-waiting-approval",
    sendKeys.includes("TerminalWriteBatchResult") &&
      sendKeys.includes("SkippedTerminalWrite") &&
      sendKeys.includes("record_waiting_approval_skip") &&
      sendKeys.includes("broadcast_keys_skipped_waiting_approval") &&
      sendKeys.includes("send_keys_skipped_waiting_approval") &&
      sendKeys.includes('"skipped": &skipped'),
    "fan-out write paths skip waiting-approval panes, return skipped entries, and audit each skipped pane",
  ),
  record(
    "done-marker-path-includes-terminal-id",
    paneFleet.includes("done_marker_path(worktree_path: &str, task_id: &str, terminal_id: &str)") &&
      paneFleet.includes('"{}-{}.done"') &&
      paneFleet.includes("done_marker_collision_uses_terminal_id_discriminator") &&
      loopPorts.includes("completion_marker_section(task_id: &str, cwd: &str, terminal_id: &str)") &&
      loopPorts.includes("spawn_with_terminal_id"),
    "visible-fleet done marker path includes the terminal id and prompt generation uses the same backend-built path",
  ),
  record(
    "approval-resolve-mcp-delegates-to-shared-core",
    sendKeys.includes("pub(crate) async fn resolve_interactive_approval_core") &&
      sendKeys.includes("resolve_interactive_approval_core(app, terminal_id, decision, expected_prompt_key).await") &&
      mcp.includes('"aelyris.approval.resolve"') &&
      mcp.includes("mcp_approval_resolve") &&
      mcp.includes("crate::ipc::resolve_interactive_approval_core") &&
      mcp.includes('"required": ["terminalId", "decision", "expectedPromptKey", "humanApprovalCapability"]'),
    "aelyris.approval.resolve is cataloged, schema-required, and delegates to the shared approval core",
  ),
  record(
    "rest-and-mcp-write-faces-share-waiting-approval-guard",
    apiMod.includes("execute_terminal_write(") &&
      apiMod.includes("terminal_input_authority") &&
      (() => {
        const arm = mcp.indexOf('"aelyris.pane_send_input" =>');
        if (arm < 0) return false;
        const body = mcp.slice(arm, arm + 2200);
        return body.includes("execute_terminal_write(") && body.includes("terminalWriteNack");
      })(),
    "REST and MCP writes delegate classify-and-deliver to the same daemon terminal input authority",
  ),
  record(
    "by-target-single-resolution-uses-typed-error",
    (() => {
      const fn = sendKeys.indexOf("pub async fn send_keys_by_target");
      if (fn < 0) return false;
      const body = sendKeys.slice(fn, fn + 4000);
      return body.includes("write_to_terminals") && inputAuthority.includes("blocked_waiting_approval");
    })(),
    "send_keys_by_target treats a single-pane resolution as a targeted send (typed blocked_waiting_approval, not a silent fan-out skip)",
  ),
  record(
    "waiting-approval-audit-throttled-per-episode",
    sendKeys.includes("WAITING_SKIP_AUDIT_KEYS") &&
      sendKeys.includes("stable_interactive_prompt_key(&prompt)"),
    "skipped-write audit events are throttled to one per pane per approval episode (prompt-fingerprint keyed)",
  ),
];

const ok = checks.every((check) => check.ok);
const artifact = {
  ok,
  status: ok ? "pass-runtime-core-preconditions" : "fail-runtime-core-preconditions",
  generatedAt: new Date().toISOString(),
  checks,
};

mkdirSync(join(ROOT, ".codex-auto", "quality"), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));
