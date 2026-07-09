import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "ai-decision-knowledge.json");

const paths = {
  agents: "AGENTS.md",
  claude: "CLAUDE.md",
  goal: "GOAL.md",
  aiGuide: "AI_GUIDE.md",
  decisionFramework: "DECISION_FRAMEWORK.md",
  delegationFramework: "DELEGATION_FRAMEWORK.md",
  architecture: "ARCHITECTURE.md",
  contracts: "contracts/README.md",
  tasks: "tasks/README.md",
  decisions: "DECISIONS.md",
  style: "STYLE.md",
  docsReadme: "docs/README.md",
  agentWorkflows: "docs/AGENT_WORKFLOWS.md",
  packageJson: "package.json",
};

function fullPath(path) {
  return join(ROOT, path);
}

function readText(path) {
  const full = fullPath(path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function mtime(path) {
  const full = fullPath(path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

// Normalization strips backticks, collapses whitespace, and lowercases so that
// required clauses match natural prose. Do not add a needle whose only match
// would be an unnatural duplicated sentence; loosen the needle instead
// (see STYLE.md, Verifier Style).
function normalize(text) {
  return text.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function missingFrom(text, needles) {
  const normalized = normalize(text);
  return needles.filter((needle) => !normalized.includes(normalize(needle)));
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const sourceTexts = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, readText(path)]));

const requiredGoalClauses = [
  "Aelyris Goal",
  "Target Users",
  "North Star",
  "Current Claim Boundary",
  "proof-first AI-team OS",
  "Remote Continuity",
  "releaseCandidateReady=false",
  "not release-ready",
];

const requiredAiGuideClauses = [
  "Principles -> Goal -> Decision Framework -> Delegation Framework -> Architecture -> Contracts -> Tasks -> Source inspection -> Tests",
  "Principles -> Knowledge -> Contracts -> Tasks -> Source inspection -> Tests",
  "Contracts are rigid; implementations are disposable.",
  "Optimize for machine editability and context economy.",
  "If uncertain, inspect.",
  "Never infer file contents.",
  "DECISION_FRAMEWORK.md`: what to choose",
  "DELEGATION_FRAMEWORK.md`: who chooses or investigates",
  "Placement Decision Matrix",
  "One owner per state",
  "src-tauri/src/proofbook",
  "src-tauri/src/api/mcp.rs",
  "src/features/<domain>",
  "Remote Continuity",
  "SSH is a transport",
  "src/App.tsx must not grow",
  "releaseCandidateReady=false",
  "Do Not Break",
  "Decision Procedure",
  "Task Router",
  "cannot skip",
  "selected_spec_or_work_unit_only",
];

const requiredDecisionFrameworkClauses = [
  "Aelyris Decision Framework",
  "What To Choose",
  "Delegation Framework answers who should explore or review",
  "Maintainability over short-term implementation speed",
  "Contracts first",
  "Abstraction Decisions",
  "up to 3 similar call sites",
  "Dependency Decisions",
  "Standard library and existing dependencies first",
  "Performance Decisions",
  "Measure before optimizing",
  "Safety Decisions",
  "Type safety first",
  "If uncertain, inspect.",
  "Never infer file contents.",
  "Placement Algorithm",
  "Tie Breakers",
];

const requiredDelegationFrameworkClauses = [
  "Aelyris Delegation Framework",
  "Who Chooses",
  "Decision Framework answers what to choose.",
  "Delegation Framework answers who should choose, explore, review, or verify.",
  "Delegate When",
  "independent exploration",
  "parallelizable",
  "large-context inspection",
  "Do Not Delegate When",
  "Implementation stays with the current owner agent",
  "Role Routing",
  "Strong models are not default implementers.",
  "high ambiguity, high blast radius, or long-term architectural cost",
  "Cost And Capability Discipline",
  "Use strong models for design, contract, governance, architecture, delegation",
  "Use mid-tier models for scoped implementation",
  "Use fast or cheap models, scripts, or deterministic tools",
  "Rule improvement / meta-audit",
  "Sonnet-class researcher",
  "Opus-class designer",
  "Delegation Packet",
  "Do Not Edit:",
  "The conductor owns final decisions",
];

const requiredArchitectureClauses = [
  "Aelyris Architecture",
  "Responsibility Map",
  "Domain/runtime state has one owner",
  "Dependency Direction",
  "src/features/<domain>",
  "src-tauri/src/proofbook",
  "src-tauri/src/api/mcp.rs",
  "Remote Continuity",
  "SSH must not own workspace state",
  "src/App.tsx",
  "Architecture Stop Conditions",
];

const requiredContractsClauses = [
  "Aelyris Contract Index",
  "Contracts are rigid; implementations are disposable.",
  "Contract Map",
  "MCP_TOOL_SURFACE_SPEC.md",
  "VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
  "PROOFBOOK_AUTOMATION_SPEC.md",
  "AELYRIS_REMOTE_CONTINUITY_SPEC.md",
  "verify:differentiation-polish-spec",
  "contract, implementation, verifier, and claim boundary",
  "Hard Blocks",
];

const requiredTasksClauses = [
  "Aelyris Task Layer",
  "AGENTS.md -> GOAL.md -> AI_GUIDE.md -> DECISION_FRAMEWORK.md -> DELEGATION_FRAMEWORK.md -> ARCHITECTURE.md -> contracts/README.md -> task packet -> owning spec -> source files",
  "If uncertain, inspect. Never infer file contents.",
  "Task Packet Shape",
  "Goal:",
  "Scope:",
  "Owner Contract:",
  "Done:",
  "Forbidden:",
  "Gates:",
  "Handoff:",
  "One work unit at a time.",
  "Done Report Minimum",
  "Handoff Minimum",
];

const requiredDecisionsClauses = [
  "Aelyris Decisions",
  "Promotion Rule",
  "not authority",
  "ADR-001 Tauri + Rust Backend",
  "ADR-002 Visible PTY For Human-Visible Agents",
  "ADR-003 Worktree Isolation",
  "ADR-004 Contracts Before UI",
  "ADR-005 Proofbooks Over Generic Playbooks",
  "ADR-006 MCP Is An Adapter, Not A Second Runtime",
  "ADR-007 Remote Continuity Uses Daemon-Owned State",
  "SSH attach is a transport",
  "ADR-008 No Premature Abstraction",
  "ADR-009 Verifier-Backed Claims",
];

const requiredStyleClauses = [
  "Aelyris Style",
  "Naming",
  "Type And Contract Style",
  "React / Frontend Style",
  "Rust / Backend Style",
  "Verifier Style",
  "Documentation Style",
  "Dependency Style",
  "Performance Style",
];

const requiredAgentsClauses = [
  "GOAL.md",
  "AI_GUIDE.md",
  "DECISION_FRAMEWORK.md",
  "DELEGATION_FRAMEWORK.md",
  "ARCHITECTURE.md",
  "contracts/README.md",
  "tasks/README.md",
  "DECISIONS.md",
  "STYLE.md",
];

const requiredClaudeClauses = [
  "GOAL.md",
  "AI_GUIDE.md",
  "DECISION_FRAMEWORK.md",
  "DELEGATION_FRAMEWORK.md",
  "ARCHITECTURE.md",
  "contracts/README.md",
  "tasks/README.md",
  "DECISIONS.md",
  "STYLE.md",
  "Contracts are rigid; implementations are disposable.",
  "Optimize for machine editability and context economy.",
  "If uncertain, inspect.",
  "Never infer file contents.",
];

const requiredDocsReadmeClauses = [
  "../GOAL.md",
  "../AI_GUIDE.md",
  "../DECISION_FRAMEWORK.md",
  "../DELEGATION_FRAMEWORK.md",
  "../ARCHITECTURE.md",
  "../contracts/README.md",
  "../tasks/README.md",
  "../DECISIONS.md",
  "../STYLE.md",
  "AI Decision Knowledge",
  "Principles",
  "Goal",
  "Decision Framework",
  "Delegation Framework",
  "Architecture",
  "Contracts",
  "Tasks",
];

const requiredAgentWorkflowsClauses = ["GOAL.md", "AI_GUIDE.md", "Task Router", "relevant knowledge docs"];

// Volatile machine-truth literals (scores, grades) belong to generated
// artifacts and the freshness-gated current-state docs
// (verify-goal-documentation-freshness.mjs), never to stable knowledge files.
const volatileScorePattern = /\b\d{1,3}\/100\b|\bgrade `?[A-F]`?\b/;
const volatileScoreScope = [
  "goal",
  "aiGuide",
  "decisionFramework",
  "delegationFramework",
  "architecture",
  "contracts",
  "tasks",
  "decisions",
  "style",
];

// Affirmative product-completion claims are forbidden in knowledge files.
// Negated boundary language ("is not shipped", "not release-ready") does not
// match because the negation breaks the subject-predicate adjacency.
const affirmativeClaimPattern =
  /\b(?:Aelyris|Proofbooks?|Remote Continuity|SSH attach|BridgeSpace-plus|Scape-plus)\s+(?:is|are)\s+(?:production-ready|release-ready|shipped|complete)\b/gi;

// Repo paths cited as owners by the knowledge stack must exist; a broken
// placement reference is worse than a missing one.
const referencedOwnerPaths = [
  "src-tauri/src/proofbook",
  "src-tauri/src/api/mcp.rs",
  "src-tauri/src/ipc",
  "src/features",
  "src/shared",
  "src/App.tsx",
  "docs/specs/MCP_TOOL_SURFACE_SPEC.md",
  "docs/specs/PROOFBOOK_AUTOMATION_SPEC.md",
  "docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
  "docs/specs/AELYRIS_REMOTE_CONTINUITY_SPEC.md",
  "docs/specs/AELYRIS_DIFFERENTIATION_POLISH_SPEC.md",
  "docs/AGENT_WORKFLOWS.md",
  "docs/requirements.md",
  "docs/PUBLICATION_READINESS.md",
];

// The knowledge entrypoint is now task-routed. AGENTS.md owns mandatory
// preflight; AI_GUIDE.md section 0 owns retrieval routing; older linear read
// order language may remain in downstream task packets, but entry docs must not
// hide the mandatory preflight behind relevance-only routing.
const routerConsistencyClauses = {
  agents: ["Task-Routed Reading", "mandatory_preflight", "task_routed_expansion", "Fable override", "active work-order safety"],
  aiGuide: ["## 0. Task Router", "cannot skip", "Active Work Orders preflight", "## 1. Layer Model"],
  agentWorkflows: ["Task routing starts only after", "Task Router for selecting only the relevant knowledge docs"],
};
function duplicateSentences(text) {
  const seen = new Map();
  const duplicates = new Set();
  const sentences = normalize(text)
    .split(/[.!?](?:\s|$)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 25);
  for (const sentence of sentences) {
    seen.set(sentence, (seen.get(sentence) ?? 0) + 1);
    if (seen.get(sentence) > 1) duplicates.add(sentence);
  }
  return [...duplicates];
}

const missing = {
  goal: missingFrom(sourceTexts.goal, requiredGoalClauses),
  aiGuide: missingFrom(sourceTexts.aiGuide, requiredAiGuideClauses),
  decisionFramework: missingFrom(sourceTexts.decisionFramework, requiredDecisionFrameworkClauses),
  delegationFramework: missingFrom(sourceTexts.delegationFramework, requiredDelegationFrameworkClauses),
  architecture: missingFrom(sourceTexts.architecture, requiredArchitectureClauses),
  contracts: missingFrom(sourceTexts.contracts, requiredContractsClauses),
  tasks: missingFrom(sourceTexts.tasks, requiredTasksClauses),
  decisions: missingFrom(sourceTexts.decisions, requiredDecisionsClauses),
  style: missingFrom(sourceTexts.style, requiredStyleClauses),
  agents: missingFrom(sourceTexts.agents, requiredAgentsClauses),
  claude: missingFrom(sourceTexts.claude, requiredClaudeClauses),
  docsReadme: missingFrom(sourceTexts.docsReadme, requiredDocsReadmeClauses),
  agentWorkflows: missingFrom(sourceTexts.agentWorkflows, requiredAgentWorkflowsClauses),
};

const volatileScoreHits = volatileScoreScope
  .map((id) => ({ path: paths[id], match: sourceTexts[id].match(volatileScorePattern)?.[0] ?? null }))
  .filter((entry) => entry.match !== null);

const affirmativeClaimHits = [];
for (const [id, text] of Object.entries(sourceTexts)) {
  if (id === "packageJson") continue;
  for (const match of text.matchAll(affirmativeClaimPattern)) {
    affirmativeClaimHits.push({ path: paths[id], match: match[0] });
  }
}

const missingOwnerPaths = referencedOwnerPaths.filter((path) => !existsSync(fullPath(path)));

const routerConsistencyProblems = Object.entries(routerConsistencyClauses)
  .map(([id, clauses]) => ({ path: paths[id], missingClauses: missingFrom(sourceTexts[id], clauses) }))
  .filter((entry) => entry.missingClauses.length > 0);

const duplicateClauseWarnings = Object.entries(sourceTexts)
  .filter(([id]) => id !== "packageJson")
  .map(([id, text]) => ({ path: paths[id], duplicates: duplicateSentences(text) }))
  .filter((entry) => entry.duplicates.length > 0);

const checks = [
  check(
    "files-exist",
    Object.values(paths).every((path) => existsSync(fullPath(path))),
    "AI decision knowledge, goal, architecture, contracts, tasks, decisions, style, workflow, task-router, and package files exist",
    { paths },
  ),
  check(
    "goal-contract",
    missing.goal.length === 0,
    "GOAL.md defines product purpose, users, north star, alpha claim boundary, and proof-first direction",
    { missingGoalClauses: missing.goal },
  ),
  check(
    "ai-guide-router-contract",
    missing.aiGuide.length === 0,
    "AI_GUIDE.md routes agents through principles, goal, decision, delegation, architecture, contracts, tasks, source inspection, and tests",
    { missingAiGuideClauses: missing.aiGuide },
  ),
  check(
    "decision-framework-contract",
    missing.decisionFramework.length === 0,
    "DECISION_FRAMEWORK.md defines what to choose across architecture, abstraction, dependencies, performance, and safety",
    { missingDecisionFrameworkClauses: missing.decisionFramework },
  ),
  check(
    "delegation-framework-contract",
    missing.delegationFramework.length === 0,
    "DELEGATION_FRAMEWORK.md defines who should explore, review, verify, or implement",
    { missingDelegationFrameworkClauses: missing.delegationFramework },
  ),
  check(
    "architecture-placement-contract",
    missing.architecture.length === 0,
    "ARCHITECTURE.md defines owner modules, dependency direction, remote architecture, and stop conditions",
    { missingArchitectureClauses: missing.architecture },
  ),
  check(
    "contracts-index-contract",
    missing.contracts.length === 0,
    "contracts/README.md indexes rigid contracts and their verifier owners",
    { missingContractsClauses: missing.contracts },
  ),
  check(
    "tasks-layer-contract",
    missing.tasks.length === 0,
    "tasks/README.md defines a reusable task packet and handoff contract",
    { missingTasksClauses: missing.tasks },
  ),
  check(
    "decisions-log-contract",
    missing.decisions.length === 0,
    "DECISIONS.md preserves durable design decisions, reasons, and the memory promotion rule",
    { missingDecisionsClauses: missing.decisions },
  ),
  check(
    "style-contract",
    missing.style.length === 0,
    "STYLE.md defines naming, contract, frontend, backend, verifier, dependency, and performance style",
    { missingStyleClauses: missing.style },
  ),
  check(
    "read-order-wired",
    missing.agents.length === 0 && missing.claude.length === 0 && missing.docsReadme.length === 0,
    "AGENTS.md, CLAUDE.md, and docs/README.md route agents through the decision knowledge entrypoints",
    {
      missingAgentsClauses: missing.agents,
      missingClaudeClauses: missing.claude,
      missingDocsReadmeClauses: missing.docsReadme,
    },
  ),
  check(
    "workflows-wired",
    missing.agentWorkflows.length === 0,
    "docs/AGENT_WORKFLOWS.md routes workflow decisions through GOAL.md and the AI_GUIDE.md Task Router",
    { missingAgentWorkflowsClauses: missing.agentWorkflows },
  ),
  check(
    "task-router-consistent",
    routerConsistencyProblems.length === 0,
    "Entry files preserve mandatory preflight while routing knowledge through AI_GUIDE.md section 0",
    { routerConsistencyClauses, routerConsistencyProblems },
  ),
  check(
    "no-volatile-score-literal",
    volatileScoreHits.length === 0,
    "Stable knowledge files carry boundary language and regeneration commands, not volatile score/grade literals",
    { volatileScoreHits },
  ),
  check(
    "no-affirmative-product-claim",
    affirmativeClaimHits.length === 0,
    "Knowledge files do not claim Aelyris, Proofbooks, Remote Continuity, or SSH attach as shipped/complete/release-ready",
    { affirmativeClaimHits },
  ),
  check(
    "referenced-owner-paths-exist",
    missingOwnerPaths.length === 0,
    "Owner modules and specs referenced by the knowledge stack exist in the repo",
    { referencedOwnerPaths, missingOwnerPaths },
  ),
  check(
    "package-script-present",
    sourceTexts.packageJson.includes('"verify:ai-decision-knowledge": "node scripts/verify-ai-decision-knowledge.mjs"'),
    "package.json exposes pnpm verify:ai-decision-knowledge",
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const sourcePaths = [...Object.values(paths), "scripts/verify-ai-decision-knowledge.mjs"];

const report = {
  schema: "aelyris.ai-decision-knowledge/v3",
  version: 3,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-ai-decision-knowledge" : "fail-ai-decision-knowledge",
  generatedAt: new Date().toISOString(),
  sourcePaths,
  sourceCutoffMs: Math.max(...sourcePaths.map((path) => mtime(path))),
  summary:
    failed.length === 0
      ? "AI principles, goal, decision framework, delegation framework, architecture, contract index, task layer, decisions, style, and workflow routing are present, task-routed, claim-safe, and wired to mandatory preflight."
      : `${failed.length} AI decision knowledge checks failed`,
  warnings: {
    duplicateClauses: duplicateClauseWarnings,
  },
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
