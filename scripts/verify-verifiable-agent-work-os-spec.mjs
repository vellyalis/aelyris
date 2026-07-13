import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "verifiable-agent-work-os-spec.json");

const paths = {
  spec: "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md",
  design: "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md",
  roadmap: "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md",
  controlApi: "docs/specs/AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md",
  mcpCatalog: "docs/specs/MCP_TOOL_SURFACE_SPEC.md",
  requirements: "docs/requirements.md",
  contracts: "contracts/README.md",
  architecture: "ARCHITECTURE.md",
  decisions: "DECISIONS.md",
  index: "docs/specs/README.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  workOrder: "audit-remediation-instructions.md",
  packageJson: "package.json",
  traceVerifier: "scripts/verify-requirements-spec-design-traceability.mjs",
  verifier: "scripts/verify-verifiable-agent-work-os-spec.mjs",
};

const fullPath = (path) => join(ROOT, path);
const readText = (path) => (existsSync(fullPath(path)) ? readFileSync(fullPath(path), "utf8") : "");
const mtime = (path) => (existsSync(fullPath(path)) ? statSync(fullPath(path)).mtimeMs : null);
const files = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readText(path)]));

function normalize(value) {
  return value.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function missingFrom(text, required) {
  const normalized = normalize(text);
  return required.filter((clause) => !normalized.includes(normalize(clause)));
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function headingIds(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function exactSequence(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function dirtyPaths() {
  let output = "";
  try {
    output = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: ROOT,
      encoding: "utf8",
    }).replace(/\r?\n$/, "");
  } catch {
    output = "";
  }
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .map((path) => (path.includes(" -> ") ? path.split(" -> ").at(-1) : path))
    .map((path) => path.replaceAll("\\", "/"));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

const requiredSpecClauses = [
  "Verifiable Agent Work OS",
  "Four-Layer Differentiation Audit",
  "Borrowed Substrate",
  "Aelyris-Owned Higher-Order Concepts",
  "Original Surprises",
  "Post-Release Evolution Waves",
  "Standardize the substrate; own the project's semantic truth",
  "Aelyris Mission",
  "Intent -> Model -> Rehearse -> Lease -> Execute -> Observe",
  "Now / Next / Unlocks",
  "Universal Agent Fabric",
  "PtyAdapter",
  "AcpAdapter",
  "SdkAdapter",
  "A2aAdapter",
  "Pane Control Baton",
  "Runtime Domains And Semantic Command Evidence",
  "Chronicle / Flight Recorder",
  "Mission Rehearsal And Counterfactual Arena",
  "Capability And Credential Broker",
  "CompletedWorkPacket",
  "MissionCompletionPacket",
  "Attention Compiler And Ambient Mission Health",
  "Reversible Autonomy",
  "Qralis Decision Lab And Adversarial Council",
  "Verified Skill Foundry And Team Memory",
  "Temporal Code Map / Project Twin",
  "Remote Continuity Companion",
  "Signed Extension Ecosystem",
  "FR-18 Canonical Control API And MCP Adapter",
  "Pane-First Trust Grammar",
  "UI Polish Acceptance",
  "license/SBOM/attribution impact",
  "Anti-Features And Stop Conditions",
  "current Aelyris remains alpha and not release-ready",
];

const requiredDesignClauses = [
  "Architecture Invariants",
  "Threat Model And Trust Boundary",
  "no second DAG",
  "do not create a third log",
  "Schema, ID, Sequence, And Canonicalization Authority",
  "MissionDefinitionRevision",
  "MissionExecutionProjection",
  "MissionRecord",
  "WorkUnitDefinition",
  "MissionProgressProjection",
  "TypedBlocker",
  "AgentAdapterDescriptor",
  "AgentSession lifecycle",
  "RuntimeDomain",
  "PaneControlBaton",
  "ActionIntent",
  "CapabilityLease",
  "reserve -> effect -> commit",
  "WorkEventEnvelope",
  "IntegrityEnvelope",
  "Journal convergence",
  "deterministic replay",
  "EvidenceRefV2",
  "GateExecutionRecord",
  "CompletedWorkPacket",
  "BlockedWorkPacket",
  "MissionCompletionPacket",
  "Work-unit state transitions",
  "ReconciliationCase",
  "RepositoryResourceRef",
  "ProvenanceEnvelopeRef",
  "TerminalInputAuthority",
  "Canonical Control API And MCP Boundary",
  "Classification-To-Gate Traceability",
  "AcceptanceCoverageEntry",
  "ReviewerIndependenceProof",
  "ReplayCheckpoint",
  "DecisionCase",
  "MemoryCandidate",
  "MemoryClaim",
  "SkillCandidate",
  "EvaluationRun",
  "ExtensionManifest",
  "Storage, Atomicity, And Reconciliation",
  "Failure Semantics",
  "Release-Blocking A7 Vertical Design",
  "A7.0 Mission Contract Gate",
  "A7.5 Proofbook Product, Recipes, And Budget/Cost",
  "A7.6 Remote Read-Only Continuity",
  "A7.8 Successful First Mission Acceptance",
  "RPO=0",
  "Apex Design Gates",
  "Verification Matrix",
];

const requiredRoadmapClauses = [
  "Permanent Now / Next / Unlocks Rule",
  "Four-Layer Differentiation And Evolution Audit",
  "Borrowed Substrate — Use It, Do Not Brand It",
  "Aelyris-Owned Higher-Order Concepts",
  "Original Surprises — Experience Unlocks",
  "Post-Release Evolution Waves",
  "MissionCompletionPacket",
  "This roadmap does not silently change the continuation schema",
  "Wave numbers express product sequencing, not a sufficient linear dependency",
  "baseline_artifact",
  "rollback_or_retire",
  "rendered_acceptance",
  "A6.2v1",
  "A6.2e1 remains the next runtime implementation slice",
  "A7 Core Mission Loop",
  "A7.0 — Mission Contract Gate",
  "A7.5 — Proofbook Product, Recipes, Budget/Cost, And Fleet Briefing",
  "A7.6 — Remote Read-Only Continuity",
  "A7.8 — Successful First Mission Acceptance",
  "A8 And A9 Remain Unchanged Release Gates",
  "Apex V1 — Universal Agent Fabric Expansion",
  "Apex V2 — Mission Time Machine",
  "Apex V3 — Qralis Coordination Fabric",
  "Apex V4 — Verified Skill Foundry And Team Memory",
  "Apex V5 — Decision Lab And Adversarial Council",
  "Apex V6 — Counterfactual Arena",
  "Apex V7 — Temporal Project Twin",
  "Apex V8 — Governed Remote Control And Runtime Domains",
  "Apex V9 — Signed Extension And Agent Federation",
  "Work Packet Template",
  "not hidden R0-A9 completion criteria",
];

const requiredIndexClauses = [
  "[AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md](./AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md)",
  "[AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md](./AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md)",
  "[AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md](./AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md)",
  "[AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md](./AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md)",
  "Verifiable Agent Work OS",
  "実装済みclaimではない",
];

const requiredRequirementsClauses = [
  "Verifiable Agent Work OS product contract",
  "AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md",
  "AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md",
  "pnpm verify:verifiable-agent-work-os-spec",
  "Mission as the durable top-level work contract",
  "target design category",
  "A7 runtime gates",
  "A8 decision evidence",
  "A9 release/external evidence",
];

const requiredPlanClauses = [
  "A6.2v1",
  "Verifiable Agent Work OS Architecture Review",
  "A6.2e1 remains the next implementation slice",
  "A7 - Evidence-Backed Core Mission Loop",
  "A7.0 - Mission Contract And Owner Inventory Gate",
  "A7.5 - Proofbook Product, Recipes, Fleet Briefing, And Budget/Cost",
  "A7.6 - Remote Read-Only Continuity",
  "A7.8 - Successful First Mission Combined Acceptance",
  "Control API command registry/kernel",
  "MissionCompletionPacket",
  "Post-A9 Apex Product Program - Tracked Destination, Not R0-A9 Scope",
  "A8",
  "A9",
];

const requiredWorkOrderClauses = [
  "ACTIVE SLICE: `A6.2e1`",
  "LAST COMPLETED SLICE: `A6.2v1`",
  "NEXT IMPLEMENTATION SLICE: `A6.2e1`",
  "design-only A6.2v1 checkpoint",
  "A6.3 and all A7 runtime work must not start early",
];

const precommitWorkOrderClauses = [
  "ACTIVE SLICE: `A6.2v1`",
  "LAST COMPLETED SLICE: `A6.2e0`",
  "NEXT IMPLEMENTATION SLICE: `A6.2e1`",
];

const requiredArchitectureClauses = [
  "Verifiable Agent Work OS Composition",
  "Mission / WorkGraph",
  "MissionProgressProjection",
  "Control Kernel",
  "finite A7 Core Mission Loop",
  "separately gated Apex work",
];

const requiredControlApiClauses = [
  "Current Audit Findings At HEAD `3db3932`",
  "Non-Negotiable Invariants",
  "Canonical Command Registry",
  "ControlCommandEnvelope",
  "ControlCommandResult",
  "Command Lifecycle And Atomicity",
  "Identity, Capability, And Review Authority",
  "candidate.freeze | worktree.snapshot_commit",
  "Adapter Contract",
  "MCP-Specific Contract",
  "Versioning And Compatibility",
  "Backpressure, Streaming, And Cancellation",
  "Chronicle And Evidence",
  "Migration And Rollback",
  "Verification Matrix",
  "R0-A9 completion criteria remain unchanged",
];

const requiredContractIndexClauses = [
  "Verifiable Agent Work OS target",
  "Canonical Control API / MCP boundary",
  "Transport-local `FREE`/`GATED` labels never grant authority",
];

const requiredMcpCatalogClauses = [
  "Control-authority update (2026-07-13)",
  "AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md",
  "not an authorization decision",
  "not an implemented claim",
];

const requiredDecisionClauses = [
  "ADR-011 Mission Is The Top-Level Work Contract",
  "Verifiable Agent Work OS",
  "backend-owned, versioned `Mission`",
  "do not add a second TaskGraph, lifecycle journal, dispatcher, Proofbook runner",
  "MissionCompletionPacket",
  "Control Command registry/kernel",
  "not a shipped or release-ready claim",
];

const missing = {
  spec: missingFrom(files.spec, requiredSpecClauses),
  design: missingFrom(files.design, requiredDesignClauses),
  roadmap: missingFrom(files.roadmap, requiredRoadmapClauses),
  controlApi: missingFrom(files.controlApi, requiredControlApiClauses),
  contracts: missingFrom(files.contracts, requiredContractIndexClauses),
  mcpCatalog: missingFrom(files.mcpCatalog, requiredMcpCatalogClauses),
  index: missingFrom(files.index, requiredIndexClauses),
  requirements: missingFrom(files.requirements, requiredRequirementsClauses),
  architecture: missingFrom(files.architecture, requiredArchitectureClauses),
  decisions: missingFrom(files.decisions, requiredDecisionClauses),
  plan: missingFrom(files.plan, requiredPlanClauses),
  workOrder: missingFrom(files.workOrder, requiredWorkOrderClauses),
};

const forbiddenPositiveClaims = [
  /Verifiable Agent Work OS\s+(?:is|are|has been)\s+(?:implemented|shipped|complete|release-ready)/gi,
  /Mission (?:Time Machine|Rehearsal|Cockpit)\s+(?:is|are|has been)\s+(?:implemented|shipped|complete|release-ready)/gi,
  /(?:Verified Skill Foundry|Counterfactual Arena|Decision Lab|Temporal Project Twin)\s+(?:is|are|has been)\s+(?:implemented|shipped|complete|release-ready)/gi,
];

const forbiddenCompletionEscapes = [
  /exact-OID merge or (?:a )?(?:durable )?(?:typed )?blocked handoff/gi,
  /merge or blocked-handoff outcome/gi,
  /CompletedWorkPacket[^\n]{0,160}blocked_handoff/gi,
  /A7 (?:is |may be )?complete[^\n]{0,160}BlockedWorkPacket/gi,
];

const claimHits = [];
const completionEscapeHits = [];
for (const [key, text] of Object.entries({
  spec: files.spec,
  design: files.design,
  roadmap: files.roadmap,
  requirements: files.requirements,
  architecture: files.architecture,
  decisions: files.decisions,
  index: files.index,
  plan: files.plan,
})) {
  for (const pattern of forbiddenPositiveClaims) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) claimHits.push({ source: key, match: match[0] });
  }
  for (const pattern of forbiddenCompletionEscapes) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      completionEscapeHits.push({ source: key, match: match[0] });
    }
  }
}

const expectedA7Ids = ["0", "1", "2", "3", "4", "5", "6", "7", "8"];
const a7Headings = {
  design: headingIds(files.design, /^### A7\.(\d+)\b/gm),
  roadmap: headingIds(files.roadmap, /^### A7\.(\d+)\b/gm),
  plan: headingIds(files.plan, /^### A7\.(\d+)\b/gm),
};
const expectedApexIds = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const apexHeadings = headingIds(files.roadmap, /^### Apex V(\d+)\b/gm);
const apexGateRows = headingIds(files.roadmap, /^\| V(\d+)\s/gm);

function uniqueIds(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];
}

const classificationIds = {
  borrowed: uniqueIds(files.spec, /\bBS-(\d{2})\b/g),
  owned: uniqueIds(files.spec, /\bAO-(\d{2})\b/g),
  surprise: uniqueIds(files.spec, /\bSX-(\d{2})\b/g),
  evolution: uniqueIds(files.spec, /\bEV-(\d{2})\b/g),
};
const expectedClassificationIds = {
  borrowed: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"],
  owned: ["01", "02", "03", "04", "05", "06"],
  surprise: ["01", "02", "03", "04", "05"],
  evolution: ["01", "02", "03", "04"],
};

const expectedProgramPhaseIds = ["R0", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];
const programPhaseHeadings = [...files.plan.matchAll(/^## (R0|A\d)\b/gm)].map((match) => match[1]);
const requiredR0A9CompletionClauses = [
  "continuation gate PASS",
  "authority/evidence gates PASS",
  "adversarial all-face input tests PASS",
  "repo-owned trust/evidence PASS; signed lifecycle remains an A9 release gate",
  "focused + rendered trust gates PASS",
  "upgrade/restart/fault tests PASS",
  "timeout/cancel/concurrency gates PASS",
  "ratchet + focused tests PASS",
  "restart-safe successful commit-bound Core Mission scenario PASS",
  "parity/perf/soak decision artifact",
  "enforced release lane + operator proof",
];
const missingR0A9CompletionScope = missingFrom(files.workOrder, requiredR0A9CompletionClauses);

const originalA7ScopeClauses = [
  "Proofbook product UI",
  "fleet recipes",
  "daily Fleet Briefing",
  "budget/cost controls",
  "read-only Remote Continuity",
  "principal/capability and agent connector contracts",
];
const missingOriginalA7Scope = missingFrom(files.plan, originalA7ScopeClauses);

const dirty = dirtyPaths();
const sourcePaths = Object.values(paths);
const sourceDirtyPaths = dirty.filter((path) => sourcePaths.includes(path));
const runtimeDirty = dirty.filter(
  (path) =>
    path.startsWith("src/") ||
    path.startsWith("src-tauri/") ||
    path.startsWith("tests/") ||
    path.startsWith("frontend/"),
);

const checks = [
  check(
    "authority-files-exist",
    sourcePaths.every((path) => existsSync(fullPath(path))),
    "Spec, design, roadmap, ultra Control API/MCP authority, contract indexes, plan, work order, package, and verifier exist",
    { missingPaths: sourcePaths.filter((path) => !existsSync(fullPath(path))) },
  ),
  check(
    "product-spec-contract",
    missing.spec.length === 0,
    "Product spec freezes the Work OS thesis and functional contract",
    {
      missingClauses: missing.spec,
    },
  ),
  check(
    "detailed-design-contract",
    missing.design.length === 0,
    "Detailed design freezes owners, schemas, states, persistence, failure, Core, and Apex boundaries",
    { missingClauses: missing.design },
  ),
  check(
    "control-api-mcp-ultra-contract",
    missing.controlApi.length === 0 && missing.contracts.length === 0 && missing.mcpCatalog.length === 0,
    "The ultra Control API/MCP design, contract index, and subordinate MCP catalog freeze one cross-face authority and current claim boundary",
    {
      missingControlApiClauses: missing.controlApi,
      missingContractClauses: missing.contracts,
      missingMcpCatalogClauses: missing.mcpCatalog,
    },
  ),
  check(
    "roadmap-now-next-unlocks",
    missing.roadmap.length === 0,
    "Roadmap keeps exact current work, next implementation, unlocks, A7 Core, A8/A9, and Apex waves explicit",
    { missingClauses: missing.roadmap },
  ),
  check(
    "spec-indexed",
    missing.index.length === 0,
    "Spec index links all three authorities with a non-shipped claim boundary",
    {
      missingClauses: missing.index,
    },
  ),
  check(
    "requirements-authority",
    missing.requirements.length === 0,
    "Requirements index names the target category while preserving A7/A8/A9 claim gates",
    { missingClauses: missing.requirements },
  ),
  check(
    "architecture-composition",
    missing.architecture.length === 0,
    "Architecture composes existing owners under Mission and keeps Core/Apex separate",
    { missingClauses: missing.architecture },
  ),
  check(
    "decision-authority",
    missing.decisions.length === 0,
    "ADR freezes Mission as the top-level contract without a shipped claim",
    { missingClauses: missing.decisions },
  ),
  check(
    "tracked-plan-integration",
    missing.plan.length === 0,
    "Tracked plan contains A6.2v1, scope-preserving finite A7.0-A7.8 Core, and separately gated post-A9 Apex",
    { missingClauses: missing.plan },
  ),
  check(
    "four-layer-differentiation-boundary",
    missing.spec.length === 0 &&
      missing.roadmap.length === 0 &&
      missingFrom(files.spec, ["not a feature backlog"]).length === 0 &&
      missingFrom(files.roadmap, ["not an imitation backlog"]).length === 0 &&
      Object.keys(expectedClassificationIds).every((key) =>
        exactSequence(classificationIds[key], expectedClassificationIds[key]),
      ),
    "Product research is organized as borrowed substrate, owned concepts, original surprises, and post-release waves rather than an imitation backlog",
    { expectedClassificationIds, classificationIds },
  ),
  check(
    "r0-a9-structure-and-completion-preserved",
    exactSequence(programPhaseHeadings, expectedProgramPhaseIds) && missingR0A9CompletionScope.length === 0,
    "The design checkpoint preserves R0-A9 exactly once, in order, with every phase completion contract still present",
    {
      expectedProgramPhaseIds,
      programPhaseHeadings,
      missingCompletionClauses: missingR0A9CompletionScope,
    },
  ),
  check(
    "a7-structure-exact",
    Object.values(a7Headings).every((ids) => exactSequence(ids, expectedA7Ids)),
    "Design, roadmap, and tracked plan each define A7.0-A7.8 exactly once and in order",
    { expectedA7Ids, a7Headings },
  ),
  check(
    "a7-original-scope-preserved",
    missingOriginalA7Scope.length === 0,
    "A7 retains Proofbook UI, recipes/Fleet Briefing/budget-cost, remote read-only, and principal/capability connector scope",
    { missingClauses: missingOriginalA7Scope },
  ),
  check(
    "apex-structure-exact",
    exactSequence(apexHeadings, expectedApexIds) && exactSequence(apexGateRows, expectedApexIds),
    "Roadmap defines Apex V1-V9 exactly once and gives every wave entry, measure, reversibility/data, and claim-boundary fields",
    { expectedApexIds, apexHeadings, apexGateRows },
  ),
  check(
    "work-order-frontier",
    missing.workOrder.length === 0 || missingFrom(files.workOrder, precommitWorkOrderClauses).length === 0,
    "Work order records either the in-review A6.2v1 frontier or the accepted checkpoint and keeps A6.2e1 as the next implementation slice",
    {
      missingCommittedClauses: missing.workOrder,
      missingPrecommitClauses: missingFrom(files.workOrder, precommitWorkOrderClauses),
    },
  ),
  check(
    "package-script-present",
    files.packageJson.includes(
      '"verify:verifiable-agent-work-os-spec": "node scripts/verify-verifiable-agent-work-os-spec.mjs"',
    ),
    "package.json exposes pnpm verify:verifiable-agent-work-os-spec",
  ),
  check(
    "no-positive-shipped-claim",
    claimHits.length === 0,
    "Target Work OS and Apex capabilities are not described as implemented, shipped, complete, or release-ready",
    { claimHits },
  ),
  check(
    "blocked-handoff-never-completion",
    completionEscapeHits.length === 0 &&
      missingFrom(files.design, [
        "repoBlockers: [];",
        "policyBlockers: [];",
        "operatorBlockers: [];",
        "externalBlockers: [];",
        "MissionCompletionPacket",
      ]).length === 0 &&
      missingFrom(files.plan, ["zero acceptance blockers", "MissionCompletionPacket"]).length === 0 &&
      missingFrom(files.roadmap, ["BlockedWorkPacket grants zero completion credit", "MissionCompletionPacket"])
        .length === 0,
    "Work-unit and Mission completion require zero blockers while BlockedWorkPacket grants no A7 or completion credit",
    { completionEscapeHits },
  ),
  check(
    "design-only-slice-has-no-runtime-diff",
    runtimeDirty.length === 0,
    "A6.2v1 changes no runtime or product test source",
    { dirtyPaths: dirty, runtimeDirty },
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const contractPass = failed.length === 0;
const committedAtHead = contractPass && sourceDirtyPaths.length === 0;
const report = {
  schema: "aelyris.verifiable-agent-work-os-spec/v2",
  contractVersion: "a6.2v1-verifiable-agent-work-os/v2",
  version: 2,
  ok: contractPass,
  status: !contractPass
    ? "fail-verifiable-agent-work-os-spec"
    : committedAtHead
      ? "pass-verifiable-agent-work-os-spec-committed"
      : "pass-verifiable-agent-work-os-spec-ready-to-commit",
  phase: "A6",
  attemptedSlice: "A6.2v1",
  lastCompletedSlice: committedAtHead ? "A6.2v1" : "A6.2e0",
  completedSlice: committedAtHead ? "A6.2v1" : null,
  nextImplementationSlice: "A6.2e1",
  readyToCommit: contractPass && !committedAtHead,
  sliceComplete: committedAtHead,
  phaseComplete: false,
  claimBoundary:
    "Documentation contract only; no Mission runtime, A7, A8, A9, external/operator, or release-ready completion claim.",
  generatedAt: new Date().toISOString(),
  git: {
    head: git(["rev-parse", "--short", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    dirtyPaths: dirty,
    sourceDirtyPaths,
  },
  artifact: ".codex-auto/quality/verifiable-agent-work-os-spec.json",
  sourcePaths,
  sourceMtimes: Object.fromEntries(sourcePaths.map((path) => [path, mtime(path)])),
  sourceSha256: Object.fromEntries(sourcePaths.map((path) => [path, sha256(readText(path))])),
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) process.exit(1);
