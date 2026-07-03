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
    sendKeys.includes("InteractiveSessionManager") &&
      sendKeys.includes("verify_current_interactive_approval") &&
      sendKeys.includes('session.status != "waiting_approval"') &&
      sendKeys.includes("approval_prompt.as_deref()"),
    "resolve_interactive_approval re-checks the live interactive session status and prompt before writing",
  ),
  record(
    "approval-resolution-requires-prompt-fingerprint",
    sendKeys.includes("expected_prompt_key: Option<String>") &&
      sendKeys.includes("expected_prompt_key.as_deref()") &&
      sendKeys.includes("expected prompt fingerprint is required") &&
      decisionInbox.includes("approvalPromptKey: promptKey"),
    "Decision Inbox passes a prompt fingerprint and the backend fails closed when it is absent",
  ),
  record(
    "approval-resolution-stale-error-contract",
    sendKeys.includes("stale_approval") &&
      sendKeys.includes("prompt fingerprint changed") &&
      sendKeys.includes("stable_text_key") &&
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
      const verifyAt = body.indexOf("verify_current_interactive_approval(");
      return lockAt >= 0 && verifyAt >= 0 && lockAt < verifyAt;
    })(),
    "resolve_interactive_approval acquires the per-terminal write lock BEFORE the stale-approval fingerprint re-check (no check-then-lock TOCTOU)",
  ),
  record(
    "write-paths-block-targeted-waiting-approval",
    sendKeys.includes("blocked_waiting_approval") &&
      sendKeys.includes("reject_targeted_waiting_approval") &&
      sendKeys.includes("waiting_approval_write_skip") &&
      sendKeys.includes('session.status == "waiting_approval"'),
    "targeted send-key paths fail closed when the pane is waiting at an approval gate",
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
