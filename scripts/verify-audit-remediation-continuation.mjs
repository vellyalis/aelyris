import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "audit-remediation-continuation.json");

const paths = {
  agents: "AGENTS.md",
  workOrder: "audit-remediation-instructions.md",
  protocol: "docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  specIndex: "docs/specs/README.md",
  workflows: "docs/AGENT_WORKFLOWS.md",
  tasks: "tasks/README.md",
  packageJson: "package.json",
  report: ".codex-auto/quality/COMPREHENSIVE_PRODUCT_ARCHITECTURE_AUDIT_2026-07-10.md",
  worklogDir: ".codex-auto/worklogs/audit-remediation",
  handoff: ".claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md",
};

function fullPath(path) {
  return join(ROOT, path);
}

function readText(path) {
  const full = fullPath(path);
  return existsSync(full) && statSync(full).isFile() ? readFileSync(full, "utf8") : "";
}

function normalize(value) {
  return value.replace(/`/g, "").replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLowerCase();
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function includesAll(text, values) {
  const haystack = normalize(text);
  return values.filter((value) => !haystack.includes(normalize(value)));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function isIgnored(path) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function statusPaths() {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trimEnd();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .map((path) => (path.includes(" -> ") ? path.split(" -> ").at(-1) : path))
    .map((path) => path.replace(/^"|"$/g, ""));
}

const source = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, readText(path)]));
const head = git(["rev-parse", "--short", "HEAD"]);
const branch = git(["branch", "--show-current"]);
const shortStatus = git(["status", "--short", "--branch"]);
const changedPaths = statusPaths();

const requiredFiles = [
  "agents",
  "workOrder",
  "protocol",
  "plan",
  "specIndex",
  "workflows",
  "tasks",
  "packageJson",
  "report",
  "handoff",
];

const checks = [];
for (const id of requiredFiles) {
  checks.push(check(`file-${id}`, existsSync(fullPath(paths[id])), `${paths[id]} exists`, { path: paths[id] }));
}

const workOrderMissing = includesAll(source.workOrder, [
  "STATUS: ACTIVE",
  "PROGRAM: audit-remediation",
  "CURRENT PHASE: R0",
  "A0.1 no-token/token-spending authority split",
  paths.plan,
  paths.protocol,
  paths.handoff,
  "pnpm verify:audit-remediation:continuation",
]);
checks.push(
  check("work-order-contract", workOrderMissing.length === 0, "root work order routes one active program", {
    missing: workOrderMissing,
  }),
);

const phaseIds = ["R0", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];
const planMissing = includesAll(source.plan, [
  ...phaseIds.map((phase) => `## ${phase} -`),
  "Dependency Graph",
  "Required Session Record",
  "CompletedWorkPacket",
  "Terminal Input Authority",
]);
checks.push(
  check("plan-dependency-contract", planMissing.length === 0, "tracked plan contains every ordered phase", {
    missing: planMissing,
  }),
);

const protocolMissing = includesAll(source.protocol, [
  "Canonical Paths",
  "Worklog Minimum",
  "Local Handoff Minimum",
  "Mandatory Session Close",
  "Mandatory Restart From 続き",
  "clear-safe",
  "one current packet",
]);
checks.push(
  check("record-and-resume-protocol", protocolMissing.length === 0, "record and continuation protocol is explicit", {
    missing: protocolMissing,
  }),
);

const routingMissing = includesAll(source.agents, [
  "audit-remediation-instructions.md",
  paths.handoff,
  "Comprehensive Audit Remediation Continuation Override",
]);
checks.push(
  check("agents-routing", routingMissing.length === 0, "AGENTS routes continuation to the active audit program", {
    missing: routingMissing,
  }),
);

const indexMissing = includesAll(source.specIndex, [
  "COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "WORK_RECORD_AND_CONTINUATION_PROTOCOL.md",
  "audit-remediation-instructions.md",
]);
checks.push(
  check("spec-index-routing", indexMissing.length === 0, "spec index exposes the plan and protocol", {
    missing: indexMissing,
  }),
);

const workflowMissing = includesAll(`${source.workflows}\n${source.tasks}`, [
  "WORK_RECORD_AND_CONTINUATION_PROTOCOL.md",
  "clear-safe",
  "canonical local handoff",
  "worklog",
]);
checks.push(
  check(
    "workflow-closeout-routing",
    workflowMissing.length === 0,
    "workflow docs require records and clear-safe closeout",
    {
      missing: workflowMissing,
    },
  ),
);

let packageJson = {};
try {
  packageJson = JSON.parse(source.packageJson);
} catch {
  // The parse check below reports the failure.
}
checks.push(
  check(
    "package-script",
    packageJson.scripts?.["verify:audit-remediation:continuation"] ===
      "node scripts/verify-audit-remediation-continuation.mjs",
    "package script exposes the continuation gate",
  ),
);

const worklogs = existsSync(fullPath(paths.worklogDir))
  ? readdirSync(fullPath(paths.worklogDir)).filter((name) => name.endsWith(".md"))
  : [];
checks.push(check("worklog-present", worklogs.length > 0, "at least one session worklog exists", { worklogs }));

const handoffMissing = includesAll(source.handoff, [
  "LOCAL ONLY. DO NOT COMMIT.",
  "program: audit-remediation",
  "active_phase: R0",
  `branch: ${branch}`,
  `head: ${head}`,
  "Read Order",
  "Commands And Results",
  "Next Exact Action",
  "Blocker Split",
  "Pasteable /goal",
  "worklog:",
]);
checks.push(
  check(
    "handoff-schema",
    handoffMissing.length === 0,
    "canonical local handoff has current identity and required fields",
    {
      missing: handoffMissing,
      branch,
      head,
    },
  ),
);

const normalizedHandoff = normalize(source.handoff);
const unrecordedPaths = changedPaths.filter((path) => !normalizedHandoff.includes(normalize(path)));
checks.push(
  check(
    "dirty-tree-recorded",
    unrecordedPaths.length === 0,
    "every current tracked/untracked path is named in the handoff",
    { changedPaths, unrecordedPaths },
  ),
);

const localPaths = [paths.report, paths.handoff, paths.worklogDir];
const notIgnored = localPaths.filter((path) => !isIgnored(path));
checks.push(
  check("local-evidence-ignored", notIgnored.length === 0, "report, worklogs, and handoff are ignored", {
    paths: localPaths,
    notIgnored,
  }),
);

const latestWorklog = worklogs
  .map((name) => ({ name, mtimeMs: statSync(join(fullPath(paths.worklogDir), name)).mtimeMs }))
  .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name;
checks.push(
  check(
    "handoff-points-to-worklog",
    Boolean(latestWorklog && normalizedHandoff.includes(normalize(latestWorklog))),
    "handoff points to the latest worklog",
    { latestWorklog },
  ),
);

const failed = checks.filter((entry) => entry.status === "failed");
const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? "pass-current-audit-remediation-continuation" : "failed",
  ok: failed.length === 0,
  program: "audit-remediation",
  activePhase: "R0",
  nextPhase: "A0",
  branch,
  head,
  gitStatus: shortStatus,
  checkCount: checks.length,
  failedCount: failed.length,
  checks,
  nextAction:
    failed.length === 0
      ? "Review and commit R0 when authorized, then start A0.1 from the canonical handoff."
      : "Repair the failed continuation contract checks before session clear.",
};

writeJsonAtomic(OUT, result);
console.log(JSON.stringify({ artifact: OUT, ...result }, null, 2));
if (!result.ok) process.exitCode = 1;
