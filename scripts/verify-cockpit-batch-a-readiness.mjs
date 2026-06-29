import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "cockpit-batch-a-readiness.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const paths = {
  requirements: "docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md",
  specIndex: "docs/specs/README.md",
  rustStatus: "src-tauri/src/agent/status.rs",
  rustAgentMod: "src-tauri/src/agent/mod.rs",
  outputMonitor: "src-tauri/src/agent/output_monitor.rs",
  worktree: "src-tauri/src/git/worktree.rs",
  interactiveCommands: "src-tauri/src/ipc/interactive_commands.rs",
  tsStatus: "src/shared/types/agentStatus.ts",
  tsStatusTest: "src/__tests__/agentStatusContract.test.ts",
  globalCss: "src/styles/global.css",
  agentInspectorCss: "src/features/agent-inspector/AgentInspector.module.css",
  packageJson: "package.json",
};

function full(path) {
  return join(ROOT, path);
}

function read(path) {
  return readFileSync(full(path), "utf8");
}

function mtimeMs(path) {
  return existsSync(full(path)) ? statSync(full(path)).mtimeMs : 0;
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function add(checks, id, ok, detail, evidence = {}) {
  checks.push({ id, ok: Boolean(ok), detail, evidence });
}

const source = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, existsSync(full(path)) ? read(path) : ""]),
);

const expectedStatuses = [
  "spawning",
  "thinking",
  "coding",
  "running_tests",
  "waiting_approval",
  "blocked",
  "idle",
  "done",
  "error",
];

const checks = [];

add(
  checks,
  "requirements-doc-created",
  source.requirements.includes("Aelyris Control API") &&
    source.requirements.includes("Agent Runtime Unification") &&
    source.requirements.includes("Worktree Safety") &&
    source.requirements.includes("UI Token Dial") &&
    source.requirements.includes("Acceptance Definition"),
  "A durable implementation requirements document exists for the current spec index.",
  { path: paths.requirements },
);

add(
  checks,
  "rust-agent-run-status-contract",
  source.rustStatus.includes("pub enum AgentRunStatus") &&
    source.rustStatus.includes("AGENT_RUN_STATUS_NAMES") &&
    expectedStatuses.every((status) => source.rustStatus.includes(`"${status}"`)) &&
    source.rustAgentMod.includes("pub mod status") &&
    source.rustAgentMod.includes("pub use status::AgentRunStatus"),
  "Rust owns the canonical AgentRunStatus names and exports the type.",
  { expectedStatuses },
);

add(
  checks,
  "output-monitor-canonical-mapper",
  source.outputMonitor.includes("to_agent_run_status") &&
    source.outputMonitor.includes("DetectedStatus::WaitingPermission") &&
    source.outputMonitor.includes("AgentRunStatus::WaitingApproval") &&
    source.interactiveCommands.includes(".and_then(output_monitor::DetectedStatus::to_agent_run_status)") &&
    !source.interactiveCommands.includes('DetectedStatus::WaitingPermission => "waiting"'),
  "Interactive output status now maps through the canonical status adapter.",
);

add(
  checks,
  "ts-agent-status-contract",
  source.tsStatus.includes("AGENT_RUN_STATUSES") &&
    expectedStatuses.every((status) => source.tsStatus.includes(`"${status}"`)) &&
    source.tsStatus.includes("normalizeAgentRunStatus") &&
    source.tsStatusTest.includes("keeps TS status names in lockstep with Rust"),
  "TypeScript mirror and contract test exist until generated bindings land.",
);

add(
  checks,
  "single-branch-validator",
  source.worktree.includes("pub fn validate_branch_name") &&
    source.worktree.includes("name.len() > 200") &&
    source.worktree.includes("name.starts_with('-')") &&
    source.worktree.includes("is_ascii_alphanumeric") &&
    source.interactiveCommands.includes("crate::git::validate_branch_name(branch)?") &&
    !source.interactiveCommands.includes("c.is_alphanumeric()"),
  "Interactive agent spawn uses the shared Rust branch validator.",
);

add(
  checks,
  "worktree-path-sync-comment-removed",
  source.worktree.includes("pub fn predict_worktree_path") &&
    !source.worktree.includes("the two must stay in sync"),
  "The manual sync hazard comment is gone and create_worktree calls predict_worktree_path.",
);

add(
  checks,
  "ui-token-dial-applied",
  source.globalCss.includes("--aelyris-border: rgba(121, 202, 226, 0.1)") &&
    source.globalCss.includes("--aelyris-border-strong: rgba(146, 221, 239, 0.16)") &&
    source.globalCss.includes("--type-card-title: var(--text-base)") &&
    source.globalCss.includes("--type-rail-section-title: var(--text-md)") &&
    source.globalCss.includes("--type-metadata-label: var(--text-xs)") &&
    source.globalCss.includes("--type-metric-value: var(--text-2xl)") &&
    source.globalCss.includes("--type-ui-small: var(--text-md)") &&
    source.globalCss.includes("--tracking-kicker: 0.04em") &&
    source.globalCss.includes("--surface-selected:") &&
    source.agentInspectorCss.includes("var(--surface-selected)") &&
    source.agentInspectorCss.includes("var(--surface-selected-inset)"),
  "Glass UI token dial-up is present and selected surfaces are tokenized.",
);

add(
  checks,
  "heavy-glass-font-weights-removed",
  !/font-weight:\s*(8|9)\d{2};/.test(source.globalCss),
  "Global glass chrome no longer uses 800-950 font weights.",
);

add(
  checks,
  "single-blur-preserved-in-batch-a-tokens",
  !source.agentInspectorCss.match(/\.cardActive\s*\{[^}]*backdrop-filter/) &&
    !source.globalCss.match(/--surface-selected[\s\S]{0,240}backdrop-filter/),
  "Batch A selected-surface changes do not add nested backdrop filters.",
);

add(
  checks,
  "package-script-registered",
  source.packageJson.includes('"verify:cockpit:batch-a": "node scripts/verify-cockpit-batch-a-readiness.mjs"'),
  "Batch A readiness verifier is runnable from package scripts.",
);

const failedChecks = checks.filter((check) => !check.ok).map((check) => check.id);
const ok = failedChecks.length === 0;
const sourceMtims = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, mtimeMs(path)]));

const report = {
  artifact: OUT,
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status: ok ? "pass-current-cockpit-batch-a-readiness" : "fail-current-cockpit-batch-a-readiness",
  checks,
  failedChecks,
  sourceMtims,
  nextRequiredAction: ok
    ? "Proceed to Batch B: AgentSession/AgentFleet/useAgentFleet adapters and control layer scaffold."
    : `Fix failing checks: ${failedChecks.join(", ")}`,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({ artifact: OUT, ok, status: report.status, failedChecks }, null, 2));
if (!ok) {
  process.exit(1);
}
