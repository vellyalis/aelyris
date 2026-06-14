import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const qualityDir = path.join(root, ".codex-auto", "quality");
fs.mkdirSync(qualityDir, { recursive: true });

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const api = read("src-tauri/src/api/mod.rs");
const lib = read("src-tauri/src/lib.rs");
const controlMod = read("src-tauri/src/control/mod.rs");
const merge = read("src-tauri/src/control/merge.rs");
const gitMod = read("src-tauri/src/git/mod.rs");
const gitMerge = read("src-tauri/src/git/merge.rs");
const ipcCommands = read("src-tauri/src/ipc/commands.rs");

const requiredTools = [
  "aether.worktree.validate",
  "aether.worktree.predictPath",
  "aether.worktree.list",
  "aether.worktree.create",
  "aether.worktree.remove",
  "aether.fleet_status",
  "aether.route_agent",
  "aether.pane_send_input",
  "aether.agent_diff",
  "aether.request_approval",
  "aether.list_pending_approvals",
  "aether.request_merge",
];

const checks = [
  {
    id: "required-aether-tool-catalog",
    ok: requiredTools.every((tool) => api.includes(`"${tool}"`)),
    detail: "all aether.mcp.v1 orchestration tools are listed",
  },
  {
    id: "no-grant-or-merge-to-main-tools",
    ok:
      !api.includes('"aether.grant_approval"') &&
      !api.includes('"aether.merge_to_main"') &&
      !api.includes('"grant_approval"') &&
      !api.includes('"merge_to_main"'),
    detail: "MCP catalog exposes request/observe only for gated operations",
  },
  {
    id: "request-approval-queues-pending",
    ok:
      api.includes('"aether.request_approval"') &&
      api.includes('kind: "permission_required".to_string()') &&
      api.includes('status: "pending".to_string()'),
    detail: "approval requests create pending inbox items instead of grants",
  },
  {
    id: "request-merge-queues-only",
    ok:
      controlMod.includes("pub mod merge;") &&
      merge.includes("pub fn queue_request") &&
      merge.includes('status: "queued".to_string()') &&
      api.includes('"aether.request_merge"') &&
      api.includes("no merge was performed"),
    detail: "merge requests validate and queue without merging to main",
  },
  {
    id: "merge-readiness-read-only-backend",
    ok:
      gitMod.includes("mod merge;") &&
      gitMod.includes("pub use merge::*;") &&
      gitMerge.includes("pub fn inspect_merge_worktree_branch") &&
      gitMerge.includes("graph_ahead_behind") &&
      gitMerge.includes("fast_forward_ready") &&
      ipcCommands.includes("pub fn inspect_merge_worktree_branch") &&
      ipcCommands.includes("This is read-only"),
    detail: "human/UI merge readiness can be inspected without checkout, fast-forward, or main writes",
  },
  {
    id: "pending-observe-only-contract",
    ok:
      api.includes('"aether.list_pending_approvals"') &&
      api.includes('"grantToolExposed": false'),
    detail: "pending approval polling explicitly reports no grant tool exposure",
  },
  {
    id: "native-state-connected-to-mcp",
    ok:
      api.includes("with_agent_manager") &&
      api.includes("with_ghost_layers") &&
      lib.includes(".with_agent_manager(agent_manager)") &&
      lib.includes(".with_ghost_layers(ghost_layers)"),
    detail: "in-process MCP surface reads the same Rust agent and GhostDiff state",
  },
];

const ok = checks.every((check) => check.ok);
const artifact = {
  schema: "aether.mcp-orchestrator-surface.v1",
  status: ok ? "passed" : "failed",
  ok,
  checkedAt: new Date().toISOString(),
  requiredTools,
  checks,
};

const artifactPath = path.join(qualityDir, "mcp-orchestrator-surface.json");
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(`MCP orchestrator surface gate passed: ${artifactPath}`);
