import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const artifactPath = join(root, ".codex-auto", "quality", "control-layer-scaffold.json");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

const files = {
  lib: "src-tauri/src/lib.rs",
  mod: "src-tauri/src/control/mod.rs",
  worktree: "src-tauri/src/control/worktree.rs",
  agent: "src-tauri/src/control/agent.rs",
  pane: "src-tauri/src/control/pane.rs",
  diff: "src-tauri/src/control/diff.rs",
  approval: "src-tauri/src/control/approval.rs",
  commands: "src-tauri/src/ipc/commands.rs",
  interactive: "src-tauri/src/ipc/interactive_commands.rs",
};

const text = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, read(path)]));

const checks = [
  check("lib-exports-control", text.lib.includes("pub mod control;"), files.lib),
  check(
    "domain-modules-present",
    ["agent", "approval", "diff", "pane", "worktree"].every((name) => text.mod.includes(`pub mod ${name};`)),
    files.mod,
  ),
  check(
    "worktree-delegates-single-validator",
    text.worktree.includes("git::validate_branch_name(name)") &&
      text.worktree.includes("git::predict_worktree_path(repo_path, branch_name)"),
    files.worktree,
  ),
  check(
    "agent-delegates-router-and-manager",
    text.agent.includes("AgentRouter::route(prompt, budget_remaining)") &&
      /manager\s*\.\s*list_sessions\s*\(\s*\)/.test(text.agent) &&
      /manager\s*\.\s*start_session\s*\(/.test(text.agent),
    files.agent,
  ),
  check(
    "pane-delegates-registry",
    text.pane.includes("registry.resolve_send_target(target)") &&
      text.pane.includes("registry.rename(terminal_id, name)") &&
      text.pane.includes("registry.set_role(terminal_id, role)"),
    files.pane,
  ),
  check(
    "diff-read-only",
    text.diff.includes("registry.snapshot()") &&
      text.diff.includes("registry.get_file(layer_id, path)") &&
      !/std::fs::write|writeFileSync|apply_ghost/.test(text.diff),
    files.diff,
  ),
  check(
    "approval-has-no-grant-surface",
    text.approval.includes("WatchdogDecision::AskUser => ApprovalGateDecision::PendingUser") &&
      !/grant_approval|grantApproval|merge_to_main|mergeToMain/.test(text.approval),
    files.approval,
  ),
  check(
    "unified-fleet-ipc-and-event",
    text.commands.includes("pub fn list_agent_fleet") &&
      text.commands.includes('"agent-fleet-updated"') &&
      text.interactive.includes("super::emit_agent_fleet(app)"),
    "src-tauri/src/ipc",
  ),
  check(
    "legacy-ipc-names-still-registered",
    ["ipc::list_agents", "ipc::list_interactive_agents", "ipc::route_agent", "ipc::start_agent"].every((needle) =>
      text.lib.includes(needle),
    ),
    files.lib,
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  version: 1,
  generatedAt: new Date().toISOString(),
  ok,
  status: ok ? "pass" : "fail",
  checks,
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(`control-layer-scaffold: PASS ${artifactPath}`);
