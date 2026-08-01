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
  proofbook: "docs/specs/PROOFBOOK_AUTOMATION_SPEC.md",
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

function duplicateJsonKeys(text) {
  const stack = [];
  const duplicates = [];
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const readString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") index += 2;
      else if (text[index++] === '"') break;
    }
    return JSON.parse(text.slice(start, index));
  };
  while (index < text.length) {
    skipWhitespace();
    const token = text[index];
    if (token === '"') {
      const key = readString();
      const after = index;
      skipWhitespace();
      const frame = stack.at(-1);
      if (text[index] === ":" && frame?.kind === "object" && frame.expectingKey) {
        if (frame.keys.has(key)) duplicates.push(key);
        frame.keys.add(key);
        frame.expectingKey = false;
      }
      index = after;
    } else if (token === "{") {
      stack.push({ kind: "object", keys: new Set(), expectingKey: true });
      index += 1;
    } else if (token === "[") {
      stack.push({ kind: "array" });
      index += 1;
    } else if (token === "}" || token === "]") {
      stack.pop();
      index += 1;
    } else if (token === ",") {
      const frame = stack.at(-1);
      if (frame?.kind === "object") frame.expectingKey = true;
      index += 1;
    } else {
      index += 1;
    }
  }
  return duplicates;
}

function markedJson(text, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(
      `<!-- ${escaped}_BEGIN -->\\s*\\x60\\x60\\x60json\\s*([\\s\\S]*?)\\s*\\x60\\x60\\x60\\s*<!-- ${escaped}_END -->`,
    ),
  );
  if (!match) return { value: null, raw: null, error: `missing ${marker} marked JSON block` };
  try {
    const duplicates = duplicateJsonKeys(match[1]);
    if (duplicates.length > 0) {
      return { value: null, raw: match[1], error: `${marker} duplicate JSON keys: ${duplicates.join(", ")}` };
    }
    return { value: JSON.parse(match[1]), raw: match[1], error: null };
  } catch (error) {
    return { value: null, raw: match[1], error: `${marker} JSON parse failed: ${error.message}` };
  }
}

function backtickField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^${escaped}:\\s*\\x60([^\\x60]+)\\x60`, "m"))?.[1] ?? null;
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

const currentFrontier = {
  phase: backtickField(files.workOrder, "CURRENT PHASE"),
  activeSlice: backtickField(files.workOrder, "ACTIVE SLICE"),
  lastCompletedSlice: backtickField(files.workOrder, "LAST COMPLETED SLICE"),
  nextPhase: backtickField(files.workOrder, "NEXT PHASE"),
  nextImplementationSlice: backtickField(files.workOrder, "NEXT IMPLEMENTATION SLICE"),
};

const a7ScopeLockParse = markedJson(files.design, "A7_CORE_SCOPE_LOCK_V1");
const a7ScopeLock = a7ScopeLockParse.value;

function headingIds(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function exactSequence(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function exactSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    exactSequence([...actual].sort(), [...expected].sort()) &&
    new Set(actual).size === actual.length
  );
}

function keyedBy(items, field) {
  if (!Array.isArray(items)) return new Map();
  return new Map(items.map((item) => [item?.[field], item]));
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && exactSet(Object.keys(value), expected);
}

function uniqueBy(items, field) {
  return Array.isArray(items) && new Set(items.map((item) => item?.[field])).size === items.length;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function unresolvedCatalogTypeRefs(catalog) {
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) return ["<invalid-catalog>"];
  const known = new Set(Object.keys(catalog));
  const builtinNamedTypes = new Set(["Record"]);
  const referenced = new Set();
  for (const definition of Object.values(catalog)) {
    if (typeof definition?.extends === "string") referenced.add(definition.extends);
    for (const expression of Object.values(definition?.fields ?? {})) {
      if (typeof expression !== "string") continue;
      for (const token of expression.match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? []) referenced.add(token);
    }
  }
  return [...referenced].filter((name) => !builtinNamedTypes.has(name) && !known.has(name)).sort();
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
  "minimal team policy",
  "integrated-OID barrier",
  "capability-filtered projection",
  "proof-preserving distillation",
  "Result Capsule",
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
  "A7.0 Core Mission Scope Lock And Owner Inventory",
  "A7.5 Canonical Core Mission Combined Acceptance",
  "RPO=0",
  "Apex Design Gates",
  "OpenCode Candidate Adapter Research Contract",
  "OC-R0-10",
  "verify:opencode-adapter-candidate",
  "TeamExecutionPolicy",
  "completion barrier is this packet validation plus compare-and-swap settlement",
  "capability-scoped tool discovery",
  "External Team-Operations Synthesis Contract",
  "V1-R1",
  "V1-R2",
  "V1-R3",
  "V3a",
  "V3b",
  "Obligation Ledger projection",
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
  "changing A6.2e1 as the eventual A6 resume slice",
  "A7 Core Mission Loop",
  "A7.0 — Core Mission Scope Lock And Owner Inventory",
  "A7.5 — Canonical Core Mission Combined Acceptance",
  "A8 And A9 Remain Release Gates; A8.0 Adds A Decision Gate",
  "This stable roadmap does not copy the exact current phase or slice",
  "Apex V1 — Universal Agent Fabric Expansion",
  "V1-R0 — OpenCode Candidate Adapter Comparison",
  "proof-carrying runtime portability",
  "does not alter the active",
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
  "V1-R1 — Structured State Authority And Explainability",
  "V1-R2 — Quarantined External-Run Adoption",
  "V1-R3 — Conditional Aelyris Runtime TUI",
  "V3a — Typed Message And Team Coordination",
  "V3b — Obligation-Driven Team Operations",
  "Obligation Ledger projection",
  "proof-preserving PB-6 distillation",
];

const requiredIndexClauses = [
  "[AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md](./AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md)",
  "[AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md](./AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md)",
  "[AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md](./AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md)",
  "[AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md](./AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md)",
  "Verifiable Agent Work OS",
  "V1-R0",
  "OpenCode",
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
  "A7 - Evidence-Backed Core Mission Loop",
  "A7.0 - Core Mission Scope Lock And Owner Inventory",
  "A7.5 - Canonical Core Mission Combined Acceptance",
  "universal all-face Control Kernel migration beyond the enabled Mission path",
  "MissionCompletionPacket",
  "Post-A9 Apex Product Program - Tracked Destination, Not R0-A9 Scope",
  "A8",
  "A9",
  "enabled IPC/MCP/PTY actions used by the journey",
  "enforce packet settlement inside existing owners",
  "V1-R1 structured state authority/explainability",
  "V3a adds addressed typed messages",
  "proof-preserving PB-6",
  "aelyris.a7_core_scope_lock/v1",
  "A7.0 scope lock is accepted",
  "A7.1 is the next implementation slice",
];

const requiredWorkOrderClauses = [
  "CURRENT PHASE: `A7`",
  "ACTIVE SLICE:",
  "LAST COMPLETED SLICE:",
  "NEXT IMPLEMENTATION SLICE:",
  "Execution Order And Complexity Stop Rules",
  "A7.0 scope lock and owner inventory is complete",
  "A7.1 request contract and versioned plan preview is complete",
  "A7.3 independent review and exact-OID acceptance is complete",
  "A7.4 immutable completion and blocked settlement is now active",
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
  "ADR-012 Structured Runtimes Are Replaceable Adapters",
  "OpenCode ACP, OpenCode HTTP/SSE",
  "cannot change the active A4/A6/A7/A8/A9 order",
  "ADR-013 External Team Patterns Extend Existing Owners",
  "Result Capsule is only a coordination projection",
  "the active A4 runtime-integrity sequence through A4.12",
];

const requiredProofbookClauses = [
  "Proof preservation is a design hypothesis",
  "typed side-effect contract",
  "proof-equivalence comparators",
  "repeated and held-out differential replay",
  "visual proof",
  "capability delta that is reduced or equal",
  "canary, monitoring, rollback, and stale invalidation",
  "never a `CompletedWorkPacket`",
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
  proofbook: missingFrom(files.proofbook, requiredProofbookClauses),
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

const expectedA7Ids = ["0", "1", "2", "3", "4", "5"];
const a7Headings = {
  design: headingIds(files.design, /^### (?:\*\*)?A7\.(\d+)\b/gm),
  roadmap: headingIds(files.roadmap, /^### (?:\*\*)?A7\.(\d+)\b/gm),
  plan: headingIds(files.plan, /^### (?:\*\*)?A7\.(\d+)\b/gm),
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
  "successful commit-bound Core Mission scenario plus blocked-settlement negative scenario PASS",
  "parity/perf/soak decision artifact",
  "enforced release lane + operator proof",
];
const missingR0A9CompletionScope = missingFrom(files.workOrder, requiredR0A9CompletionClauses);

const canonicalA7ScopeClauses = [
  "request",
  "versioned plan preview",
  "visible implementation",
  "fresh tests",
  "independent review",
  "exact-OID accept/merge",
  "immutable completion packet",
];
const deferredA7ScopeClauses = [
  "Proofbook product UI/recipes",
  "Fleet Briefing",
  "broad budget/cost UX",
  "Remote Continuity",
  "universal all-face Control Kernel migration beyond the enabled Mission path",
  "learning layers",
];
const missingCanonicalA7Scope = missingFrom(files.plan, canonicalA7ScopeClauses);
const missingDeferredA7Scope = missingFrom(files.plan, deferredA7ScopeClauses);

const expectedA7Journey = [
  "request",
  "versioned_plan_preview",
  "visible_implementation",
  "fresh_tests",
  "independent_review",
  "exact_oid_accept_merge",
  "immutable_completion_packet",
];
const expectedA7OwnerIds = [
  "mission_work_settlement",
  "runtime_visible_pty",
  "ownership",
  "chronicle_event",
  "evidence_test",
  "review",
  "merge",
  "capability_policy",
  "frontend_projection",
];
const expectedMinimumTypeOwners = {
  AcceptanceClause: ["aelyris.acceptance_clause/v1", "mission_work_settlement"],
  RiskPolicy: ["aelyris.risk_policy/v1", "mission_work_settlement"],
  BudgetPolicy: ["aelyris.budget_policy/v1", "mission_work_settlement"],
  RuntimePolicy: ["aelyris.runtime_policy/v1", "mission_work_settlement"],
  GateRequirement: ["aelyris.gate_requirement/v1", "evidence_test"],
  ArtifactRequirement: ["aelyris.artifact_requirement/v1", "evidence_test"],
  CapabilityTemplate: ["aelyris.capability_template/v1", "capability_policy"],
  CapabilityScope: ["aelyris.capability_scope/v1", "capability_policy"],
  ProofCoverage: ["aelyris.proof_coverage/v1", "mission_work_settlement"],
  RepositoryTruth: ["aelyris.repository_truth/v1", "mission_work_settlement"],
  RedactionRecord: ["aelyris.redaction_record/v1", "chronicle_event"],
  SymbolIntent: ["aelyris.symbol_intent/v1", "ownership"],
  ResourceIntent: ["aelyris.resource_intent/v1", "ownership"],
  ResourceRequest: ["aelyris.resource_request/v1", "capability_policy"],
  CanonicalResourceHandle: ["aelyris.canonical_resource_handle/v1", "capability_policy"],
  CanonicalResourceScope: ["aelyris.canonical_resource_scope/v1", "capability_policy"],
  NetworkScope: ["aelyris.network_scope/v1", "capability_policy"],
  BudgetLimit: ["aelyris.budget_limit/v1", "capability_policy"],
  NormalizedPolicyScore: ["aelyris.normalized_policy_score/v1", "mission_work_settlement"],
  EvidenceFreshnessPolicy: ["aelyris.evidence_freshness_policy/v1", "evidence_test"],
  IntegrityEnvelope: ["aelyris.integrity_envelope/v1", "chronicle_event"],
  EvidenceLocator: ["aelyris.evidence_locator/v1", "evidence_test"],
  AcceptanceCoverageEntry: ["aelyris.acceptance_coverage_entry/v1", "mission_work_settlement"],
  ChronicleRangeProof: ["aelyris.chronicle_range_proof/v1", "chronicle_event"],
  ReviewerIndependenceProof: ["aelyris.reviewer_independence_proof/v1", "review"],
  SafeOperatorCommand: ["aelyris.safe_operator_command/v1", "mission_work_settlement"],
  RecoveryInstruction: ["aelyris.recovery_instruction/v1", "mission_work_settlement"],
  ReplayInstruction: ["aelyris.replay_instruction/v1", "mission_work_settlement"],
};
const expectedMinimumContracts = {
  mission: ["MissionDefinitionRevision", "mission_work_settlement"],
  workUnit: ["WorkUnitDefinition", "mission_work_settlement"],
  evidence: ["EvidenceRefV2", "evidence_test"],
  review: ["ReviewRecord", "review"],
  exactOid: ["ExactOidSettlement", "merge"],
  completedWork: ["CompletedWorkPacket", "mission_work_settlement"],
  blockedWork: ["BlockedWorkPacket", "mission_work_settlement"],
  missionCompletion: ["MissionCompletionPacket", "mission_work_settlement"],
  versioning: ["A7ContractVersions", "mission_work_settlement"],
};
const expectedSupportingSchemas = {
  AdapterCapability: ["aelyris.adapter_capability/v1", "runtime_visible_pty"],
  CapabilityUnlock: ["aelyris.capability_unlock/v1", "mission_work_settlement"],
  DissentRecord: ["aelyris.dissent_record/v1", "review"],
  NonBlockingResidualRisk: ["aelyris.non_blocking_residual_risk/v1", "mission_work_settlement"],
  PrincipalRef: ["aelyris.principal_ref/v1", "capability_policy"],
  ProvenanceEnvelopeRef: ["aelyris.evidence-provenance/v1", "evidence_test"],
  RepositoryResourceRef: ["aelyris.repository_resource_ref/v1", "ownership"],
  TeamRolePolicy: ["aelyris.team_role_policy/v1", "mission_work_settlement"],
  TeamExecutionPolicy: ["aelyris.team_execution_policy/v1", "mission_work_settlement"],
  TypedBlocker: ["aelyris.typed_blocker/v1", "mission_work_settlement"],
  VersionedRef: ["aelyris.versioned_ref/v1", "mission_work_settlement"],
  MissionDefinitionRevision: ["aelyris.mission_definition/v1", "mission_work_settlement"],
  WorkUnitDefinition: ["aelyris.work_unit_definition/v1", "mission_work_settlement"],
  EvidenceRefV2: ["aelyris.evidence_ref/v2", "evidence_test"],
  GateExecutionRecord: ["aelyris.gate_execution_record/v1", "evidence_test"],
  ReviewRecord: ["aelyris.review_record/v1", "review"],
  ExactOidSettlement: ["aelyris.exact_oid_settlement/v1", "merge"],
  WorkPacketBase: ["aelyris.work_packet_base/v1", "mission_work_settlement"],
  CompletedWorkPacket: ["aelyris.completed_work_packet/v1", "mission_work_settlement"],
  BlockedWorkPacket: ["aelyris.blocked_work_packet/v1", "mission_work_settlement"],
  MissionCompletionPacket: ["aelyris.mission_completion_packet/v1", "mission_work_settlement"],
  A7ContractVersions: ["aelyris.a7_contract_versions/v1", "mission_work_settlement"],
};
const expectedSchemaCatalog = { ...expectedMinimumTypeOwners, ...expectedSupportingSchemas };
const expectedA7SchemaCatalogDigest = "5c6cc8f6dc98a61fd87143ce2d32493793787dd2b593d62623089de042edc1ea";
const expectedA7FaceSteps = expectedA7Journey;
const expectedDeferredDestinations = [
  "proofbook_product_ui_and_recipes",
  "fleet_briefing",
  "broad_budget_and_cost_ux",
  "remote_continuity",
  "all_face_control_kernel_beyond_enabled_mission_path",
  "provider_fabric_expansion",
  "learning_layers",
];
const expectedForbiddenA7Owners = [
  "second_mission_dag",
  "second_operation_journal",
  "second_runner",
  "second_dispatcher",
  "completion_barrier_or_table_owner",
  "frontend_mission_or_completion_state_owner",
];

const a7OwnerMap = keyedBy(a7ScopeLock?.ownerInventory, "ownerId");
const a7FaceMap = keyedBy(a7ScopeLock?.faceDisposition, "journeyStep");
const a7OwnerPaths = Array.isArray(a7ScopeLock?.ownerInventory)
  ? a7ScopeLock.ownerInventory.flatMap((owner) => owner.existingPaths ?? [])
  : [];
const schemaCatalogDigest = sha256(canonicalJson(a7ScopeLock?.schemaCatalog ?? {}));
const unresolvedA7CatalogTypes = unresolvedCatalogTypeRefs(a7ScopeLock?.schemaCatalog);
const a7TypeInventoryValid =
  exactKeys(a7ScopeLock?.schemaCatalog, Object.keys(expectedSchemaCatalog)) &&
  Object.entries(expectedSchemaCatalog).every(([type, [schemaId, ownerId]]) => {
    const definition = a7ScopeLock?.schemaCatalog?.[type];
    const isEnum = Array.isArray(definition?.values);
    const expectedDefinitionKeys = isEnum
      ? ["schemaId", "ownerId", "values"]
      : definition?.extends
        ? ["schemaId", "ownerId", "extends", "additionalProperties", "fields"]
        : ["schemaId", "ownerId", "additionalProperties", "fields"];
    return (
      exactKeys(definition, expectedDefinitionKeys) &&
      definition.schemaId === schemaId &&
      definition.ownerId === ownerId &&
      (isEnum
        ? definition.values.length > 0 &&
          definition.values.every((value) => typeof value === "string" && value.length > 0) &&
          new Set(definition.values).size === definition.values.length
        : definition.additionalProperties === false &&
          exactKeys(definition.fields, Object.keys(definition.fields ?? {})) &&
          Object.keys(definition.fields).length > 0 &&
          Object.values(definition.fields).every(
            (fieldType) => typeof fieldType === "string" && fieldType.length > 0,
          )) &&
      a7OwnerMap.has(ownerId)
    );
  }) &&
  unresolvedA7CatalogTypes.length === 0 &&
  exactKeys(a7ScopeLock?.schemaCatalogRef, ["catalogId", "definitionLanguage", "digestAlgorithm", "catalogDigest"]) &&
  a7ScopeLock.schemaCatalogRef.catalogId === "aelyris.a7_core_schema_catalog/v1" &&
  a7ScopeLock.schemaCatalogRef.definitionLanguage === "aelyris-field-map/v1" &&
  a7ScopeLock.schemaCatalogRef.digestAlgorithm === "sha256" &&
  a7ScopeLock.schemaCatalogRef.catalogDigest === expectedA7SchemaCatalogDigest &&
  schemaCatalogDigest === expectedA7SchemaCatalogDigest;
const a7MinimumContractsValid =
  exactSet(Object.keys(a7ScopeLock?.minimumContracts ?? {}), Object.keys(expectedMinimumContracts)) &&
  Object.entries(expectedMinimumContracts).every(([contract, [schemaRef, ownerId]]) => {
    const entry = a7ScopeLock?.minimumContracts?.[contract];
    return (
      exactKeys(entry, ["schemaRef", "ownerId"]) &&
      entry?.schemaRef === schemaRef &&
      entry?.ownerId === ownerId &&
      a7ScopeLock?.schemaCatalog?.[schemaRef]?.ownerId === ownerId &&
      a7OwnerMap.has(ownerId)
    );
  });
const a7FaceDispositionValid =
  exactSet([...a7FaceMap.keys()], expectedA7FaceSteps) &&
  uniqueBy(a7ScopeLock?.faceDisposition, "journeyStep") &&
  [...a7FaceMap.values()].every(
    (entry) =>
      exactKeys(entry, ["journeyStep", "ipc", "mcp", "pty"]) &&
      ["ipc", "mcp", "pty"].every((face) => {
        const disposition = entry?.[face];
        return (
          exactKeys(disposition, ["action", "disposition", "seam", "reason"]) &&
          typeof disposition?.action === "string" &&
          disposition.action.length > 0 &&
          ["route", "compatibility_no_a7_authority", "no_a7_authority"].includes(disposition.disposition) &&
          typeof disposition?.seam === "string" &&
          disposition.seam.length > 0 &&
          typeof disposition?.reason === "string" &&
          disposition.reason.length > 0
        );
      }),
  ) &&
  a7ScopeLock.faceDisposition.some((entry) =>
    [entry.ipc, entry.mcp, entry.pty].some(
      (face) =>
        face.disposition === "compatibility_no_a7_authority" &&
        face.reason.includes("still") &&
        face.reason.includes("execute"),
    ),
  );

const expectedA7AcceptanceClauses = [
  "A7-FIX-01: add exactly the named deterministic regression test",
  "A7-FIX-02: preserve production behavior unless the test first demonstrates a defect",
  "A7-FIX-03: the declared focused test passes at the exact candidate OID",
  "A7-FIX-04: the owned diff contains no path outside src-tauri/src/task/graph.rs",
];
const expectedA7TestArgv = [
  "cargo",
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--lib",
  "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order",
  "--",
  "--exact",
];
const expectedA7ReviewerDifferences = ["principal_id", "logical_session_id", "fork_lineage"];
const expectedA7OidInvariants = [
  "testedOid equals candidateOid",
  "reviewedOid equals testedOid",
  "mergeIntentSourceOid equals reviewedOid",
  "integratedOid is the exact merge receipt OID for the frozen target",
  "any OID or contract version change invalidates settlement and requires fresh test and review",
];
const fixture = a7ScopeLock?.fixture;
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fixturePersistentIds = [
  fixture?.requestId,
  fixture?.missionId,
  fixture?.workUnitId,
  fixture?.acceptedPlan?.planId,
];
const a7FixtureValid =
  exactKeys(a7ScopeLock, [
    "schema",
    "contractVersion",
    "runtimeClaimsImplemented",
    "fixture",
    "journey",
    "ownerInventory",
    "schemaCatalogRef",
    "schemaCatalog",
    "minimumContracts",
    "oidInvariants",
    "faceDisposition",
    "negativeScenario",
    "deferredDestinations",
    "forbiddenNewOwners",
  ]) &&
  exactKeys(fixture, [
    "fixtureId",
    "requestId",
    "request",
    "missionId",
    "missionRevision",
    "workUnitId",
    "workUnitDefinitionRevision",
    "acceptedPlan",
    "revisionRecovery",
    "baseOidSource",
    "ownedTargets",
    "acceptanceClauses",
    "declaredTest",
    "reviewer",
    "mergeOutcome",
  ]) &&
  fixture?.fixtureId === "a7-core-taskgraph-stable-order-v1" &&
  fixturePersistentIds.every((id) => typeof id === "string" && uuidV7Pattern.test(id)) &&
  new Set(fixturePersistentIds).size === fixturePersistentIds.length &&
  fixture?.requestId === "0197c000-0000-7000-8000-000000000001" &&
  typeof fixture?.request === "string" &&
  fixture.request.includes("equal_priority_ready_tasks_preserve_insertion_order") &&
  fixture.request.includes("src-tauri/src/task/graph.rs") &&
  fixture?.missionId === "0197c000-0000-7000-8000-000000000002" &&
  fixture?.missionRevision === 1 &&
  exactKeys(fixture?.revisionRecovery, [
    "appliesBeforeAcceptance",
    "headDriftAction",
    "nextRevision",
    "alignedVersions",
    "previewedOrAcceptedPredecessorMayBeBypassed",
  ]) &&
  fixture.revisionRecovery.appliesBeforeAcceptance === true &&
  fixture.revisionRecovery.headDriftAction === "reject_or_cancel_current_preview" &&
  fixture.revisionRecovery.nextRevision === "previous + 1" &&
  exactSequence(fixture.revisionRecovery.alignedVersions, [
    "planRevision",
    "missionRevision",
    "workGraphDefinitionRevision",
    "workUnitDefinitionRevision",
  ]) &&
  fixture.revisionRecovery.previewedOrAcceptedPredecessorMayBeBypassed === false &&
  fixture?.workUnitId === "0197c000-0000-7000-8000-000000000003" &&
  fixture?.workUnitDefinitionRevision === 1 &&
  exactKeys(fixture?.acceptedPlan, ["planId", "planRevision", "status", "canonicalization", "workUnitIds"]) &&
  fixture?.acceptedPlan?.planId === "0197c000-0000-7000-8000-000000000004" &&
  fixture?.acceptedPlan?.planRevision === 1 &&
  fixture?.acceptedPlan?.status === "accepted" &&
  fixture?.acceptedPlan?.canonicalization === "rfc8785_json_utf8" &&
  exactSequence(fixture?.acceptedPlan?.workUnitIds, [fixture?.workUnitId]) &&
  fixture?.baseOidSource === "accepted_mission_head" &&
  exactSequence(fixture?.ownedTargets, ["src-tauri/src/task/graph.rs"]) &&
  exactSequence(fixture?.acceptanceClauses, expectedA7AcceptanceClauses) &&
  exactKeys(fixture?.declaredTest, ["commandArgv", "cwd", "requiredResult"]) &&
  exactSequence(fixture?.declaredTest?.commandArgv, expectedA7TestArgv) &&
  fixture?.declaredTest?.cwd === "mission_worktree" &&
  fixture?.declaredTest?.requiredResult === "passed_exact_oid" &&
  exactKeys(fixture?.reviewer, ["role", "policyId", "mustDifferFromImplementerBy", "requiredVerdict"]) &&
  fixture?.reviewer?.role === "independent_reviewer" &&
  fixture?.reviewer?.policyId === "a7-core-reviewer-independence/v1" &&
  exactSequence(fixture?.reviewer?.mustDifferFromImplementerBy, expectedA7ReviewerDifferences) &&
  fixture?.reviewer?.requiredVerdict === "accepted_exact_oid" &&
  exactKeys(fixture?.mergeOutcome, ["result", "targetBranchRole", "automaticMainMerge"]) &&
  fixture?.mergeOutcome?.result === "merged_exact_oid" &&
  fixture?.mergeOutcome?.targetBranchRole === "isolated_mission_acceptance_target" &&
  fixture?.mergeOutcome?.automaticMainMerge === false;
const missingA7OwnerPaths = [...new Set(a7OwnerPaths)].filter((path) => !existsSync(fullPath(path)));
const a7OwnerInventoryValid =
  exactSet([...a7OwnerMap.keys()], expectedA7OwnerIds) &&
  uniqueBy(a7ScopeLock?.ownerInventory, "ownerId") &&
  [...a7OwnerMap.values()].every(
    (owner) =>
      exactKeys(owner, ["ownerId", "responsibility", "existingPaths", "a7Gap"]) &&
      typeof owner?.responsibility === "string" &&
      owner.responsibility.length > 0 &&
      Array.isArray(owner?.existingPaths) &&
      owner.existingPaths.length > 0 &&
      typeof owner?.a7Gap === "string" &&
      owner.a7Gap.length > 0,
  ) &&
  missingA7OwnerPaths.length === 0;
const a7BoundaryValid =
  exactSequence(a7ScopeLock?.journey, expectedA7Journey) &&
  exactSequence(a7ScopeLock?.oidInvariants, expectedA7OidInvariants) &&
  a7ScopeLock?.negativeScenario?.scenarioId === "a7-core-stale-tested-oid-v1" &&
  a7ScopeLock?.negativeScenario?.mutation ===
    "candidate OID changes after the declared test and before independent review" &&
  a7ScopeLock?.negativeScenario?.requiredPacket === "aelyris.blocked_work_packet/v1" &&
  a7ScopeLock?.negativeScenario?.blockerClass === "repo" &&
  a7ScopeLock?.negativeScenario?.exactNextAction ===
    "run the declared focused test and independent review again at the changed OID" &&
  a7ScopeLock?.negativeScenario?.completionCredit === false &&
  a7ScopeLock?.negativeScenario?.missionState === "blocked" &&
  exactKeys(a7ScopeLock?.negativeScenario, [
    "scenarioId",
    "mutation",
    "requiredPacket",
    "blockerClass",
    "exactNextAction",
    "completionCredit",
    "missionState",
  ]) &&
  exactSet(a7ScopeLock?.deferredDestinations, expectedDeferredDestinations) &&
  exactSet(a7ScopeLock?.forbiddenNewOwners, expectedForbiddenA7Owners);
const duplicateKeyMutation = files.design.replace(
  '"contractVersion": 1,',
  '"contractVersion": 1,\n  "contractVersion": 1,',
);
const duplicateLogicalMutation = structuredClone(a7ScopeLock);
duplicateLogicalMutation?.ownerInventory?.push(structuredClone(a7ScopeLock?.ownerInventory?.[0]));
const fieldDriftMutation = structuredClone(a7ScopeLock?.schemaCatalog ?? {});
delete fieldDriftMutation.MissionDefinitionRevision?.fields?.acceptance;
const missingTypeMutation = structuredClone(a7ScopeLock?.schemaCatalog ?? {});
if (missingTypeMutation.MissionDefinitionRevision?.fields) {
  missingTypeMutation.MissionDefinitionRevision.fields.acceptance = "MissingCatalogType[]";
}
const unknownFieldMutation = structuredClone(a7ScopeLock);
if (unknownFieldMutation) unknownFieldMutation.unknownA7Authority = true;
const a7VerifierNegativeMutations = {
  duplicateJsonKeyRejected: markedJson(duplicateKeyMutation, "A7_CORE_SCOPE_LOCK_V1").error?.includes(
    "duplicate JSON keys",
  ),
  duplicateLogicalEntryRejected: !uniqueBy(duplicateLogicalMutation?.ownerInventory, "ownerId"),
  owningFieldDriftRejected: sha256(canonicalJson(fieldDriftMutation)) !== expectedA7SchemaCatalogDigest,
  missingCatalogTypeRejected: unresolvedCatalogTypeRefs(missingTypeMutation).includes("MissingCatalogType"),
  unknownFieldRejected: !exactKeys(unknownFieldMutation, Object.keys(a7ScopeLock ?? {})),
};
const a7VerifierNegativeMutationsValid = Object.values(a7VerifierNegativeMutations).every(Boolean);
const a7AcceptedFrontierValid = currentFrontier.activeSlice === "A7.4" && currentFrontier.lastCompletedSlice === "A7.3";
const a7ScopeLockStillActive = currentFrontier.activeSlice === "A7.0";

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
    "external-goal-synthesis-owner-safe",
    missing.decisions.length === 0 &&
      missing.design.length === 0 &&
      missing.roadmap.length === 0 &&
      missing.plan.length === 0 &&
      missingFrom(files.design, [
        "not a `CompletionBarrier` table or owner",
        "Result Capsule is only a coordination projection",
        "message read/ack never fulfills an obligation",
      ]).length === 0 &&
      missingFrom(files.roadmap, ["cannot mutate Aelyris owners", "issue a lease", "cannot replace the Tauri"])
        .length === 0,
    "External team/runtime patterns extend existing Mission, packet, Control, Qralis, and Proofbook owners without changing the active audit-remediation frontier",
    {
      missingDecisionClauses: missing.decisions,
      missingDesignClauses: missing.design,
      missingRoadmapClauses: missing.roadmap,
      missingPlanClauses: missing.plan,
    },
  ),
  check(
    "proof-preserving-distillation-contract",
    missing.proofbook.length === 0 &&
      missingFrom(files.spec, ["Aelyris design hypothesis", "capability assumptions become stale"]).length === 0 &&
      missingFrom(files.design, ["Repeated and held-out differential replay", "Capability delta"]).length === 0,
    "PB-6 remains proposal-only and requires proof-equivalence, capability non-broadening, canary, rollback, and stale invalidation",
    { missingProofbookClauses: missing.proofbook },
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
    "Tracked plan contains A6.2v1, the finite canonical A7.0-A7.5 Core, and separately gated deferred/Apex work",
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
    "Design, roadmap, and tracked plan each define the canonical A7.0-A7.5 sequence exactly once and in order",
    { expectedA7Ids, a7Headings },
  ),
  check(
    "a7-core-scope-and-deferral",
    missingCanonicalA7Scope.length === 0 && missingDeferredA7Scope.length === 0,
    "A7 Core contains one canonical request-to-settlement journey while deferred product requirements remain explicit",
    {
      missingCanonicalClauses: missingCanonicalA7Scope,
      missingDeferredClauses: missingDeferredA7Scope,
    },
  ),
  check(
    "a7-scope-lock-machine-record",
    a7ScopeLockParse.error === null &&
      a7ScopeLock?.schema === "aelyris.a7_core_scope_lock/v1" &&
      a7ScopeLock?.contractVersion === 1 &&
      a7ScopeLock?.runtimeClaimsImplemented === false,
    "A7.0 has one parseable, versioned, design-only machine record and keeps runtime claims false",
    {
      parseError: a7ScopeLockParse.error,
      schema: a7ScopeLock?.schema,
      contractVersion: a7ScopeLock?.contractVersion,
      runtimeClaimsImplemented: a7ScopeLock?.runtimeClaimsImplemented,
    },
  ),
  check(
    "a7-fixed-request-plan-test-review-merge-fixture",
    a7FixtureValid,
    "The fixed fixture names one request, accepted versioned plan, owned path, exact test, independent reviewer policy, and exact-OID isolated merge outcome",
    {
      fixtureId: fixture?.fixtureId,
      requestId: fixture?.requestId,
      acceptedPlan: fixture?.acceptedPlan,
      ownedTargets: fixture?.ownedTargets,
      declaredTest: fixture?.declaredTest,
      reviewer: fixture?.reviewer,
      mergeOutcome: fixture?.mergeOutcome,
    },
  ),
  check(
    "a7-existing-owner-inventory",
    a7OwnerInventoryValid,
    "Every A7 Core responsibility maps to an existing owner path with an explicit gap and no completion-specific second owner",
    {
      expectedOwnerIds: expectedA7OwnerIds,
      actualOwnerIds: [...a7OwnerMap.keys()],
      missingOwnerPaths: missingA7OwnerPaths,
      completionContractOwners: [
        a7ScopeLock?.minimumContracts?.completedWork?.ownerId,
        a7ScopeLock?.minimumContracts?.blockedWork?.ownerId,
        a7ScopeLock?.minimumContracts?.missionCompletion?.ownerId,
      ],
    },
  ),
  check(
    "a7-minimum-type-owner-closure",
    a7TypeInventoryValid,
    "The digested A7.0 field catalog exhaustively defines every section 3.2 type and aligned owning contract with one existing owner",
    {
      expectedTypes: Object.keys(expectedMinimumTypeOwners),
      actualTypes: Object.keys(a7ScopeLock?.schemaCatalog ?? {}),
      expectedCatalogDigest: expectedA7SchemaCatalogDigest,
      declaredCatalogDigest: a7ScopeLock?.schemaCatalogRef?.catalogDigest,
      computedCatalogDigest: schemaCatalogDigest,
      unresolvedCatalogTypes: unresolvedA7CatalogTypes,
    },
  ),
  check(
    "a7-minimum-contract-closure",
    a7MinimumContractsValid,
    "Minimum contracts reference the canonical catalog definitions and their existing owners instead of inventing parallel field lists",
    {
      expectedContracts: Object.keys(expectedMinimumContracts),
      actualContracts: Object.keys(a7ScopeLock?.minimumContracts ?? {}),
    },
  ),
  check(
    "a7-enabled-face-disposition",
    a7FaceDispositionValid,
    "Every journey step classifies IPC, MCP, and PTY only for A7 authority; compatibility actions may still execute while granting no A7 authority or completion",
    {
      expectedJourneySteps: expectedA7FaceSteps,
      actualJourneySteps: [...a7FaceMap.keys()],
    },
  ),
  check(
    "a7-verifier-negative-mutations",
    a7VerifierNegativeMutationsValid,
    "In-process mutations prove duplicate keys/entries, owning-field drift, missing catalog types, and unknown fields fail closed",
    a7VerifierNegativeMutations,
  ),
  check(
    "a7-exact-oid-blocked-and-deferred-boundary",
    a7BoundaryValid,
    "Exact-OID drift fails to BlockedWorkPacket with zero completion credit while deferred destinations and forbidden second owners remain exact",
    {
      oidInvariants: a7ScopeLock?.oidInvariants,
      negativeScenario: a7ScopeLock?.negativeScenario,
      deferredDestinations: a7ScopeLock?.deferredDestinations,
      forbiddenNewOwners: a7ScopeLock?.forbiddenNewOwners,
    },
  ),
  check(
    "apex-structure-exact",
    exactSequence(apexHeadings, expectedApexIds) && exactSequence(apexGateRows, expectedApexIds),
    "Roadmap defines Apex V1-V9 exactly once and gives every wave entry, measure, reversibility/data, and claim-boundary fields",
    { expectedApexIds, apexHeadings, apexGateRows },
  ),
  check(
    "work-order-frontier",
    missing.workOrder.length === 0 &&
      Object.values(currentFrontier).every(Boolean) &&
      currentFrontier.phase === "A7" &&
      currentFrontier.activeSlice === currentFrontier.nextImplementationSlice &&
      a7AcceptedFrontierValid,
    "Work order records A7.3 complete and exposes exactly one A7.4 implementation frontier",
    { missingClauses: missing.workOrder, currentFrontier },
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
    !a7ScopeLockStillActive || runtimeDirty.length === 0,
    "The no-runtime-diff boundary applies while A7.0 scope lock is active, not after implementation slices begin",
    { a7ScopeLockStillActive, dirtyPaths: dirty, runtimeDirty },
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const contractPass = failed.length === 0;
const committedAtHead = contractPass && sourceDirtyPaths.length === 0;
const report = {
  schema: "aelyris.verifiable-agent-work-os-spec/v6",
  contractVersion: "verifiable-agent-work-os-roadmap/v6",
  version: 6,
  ok: contractPass,
  status: !contractPass
    ? "fail-verifiable-agent-work-os-spec"
    : committedAtHead
      ? "pass-verifiable-agent-work-os-spec-committed"
      : "pass-verifiable-agent-work-os-spec-ready-to-commit",
  phase: currentFrontier.phase,
  attemptedSlice: "A7.0",
  lastCompletedSlice: currentFrontier.lastCompletedSlice,
  completedSlice: committedAtHead ? "A7.0" : null,
  nextImplementationSlice: currentFrontier.nextImplementationSlice,
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
