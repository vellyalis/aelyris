import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "proofbook-spec.json");

const paths = {
  spec: "docs/specs/PROOFBOOK_AUTOMATION_SPEC.md",
  specIndex: "docs/specs/README.md",
  packageJson: "package.json",
};

const stepTypes = [
  "`shell`",
  "`verifier`",
  "`mcpTool`",
  "`agentSession`",
  "`http`",
  "`manualGate`",
  "`waitFor`",
  "`fanOut`",
  "`subProofbook`",
  "`evidence.write` / `evidence.read`",
];

const mcpVerbs = [
  "aelyris.proofbook.list",
  "aelyris.proofbook.get",
  "aelyris.proofbook.validate",
  "aelyris.proofbook.run",
  "aelyris.proofbook.status",
  "aelyris.proofbook.cancel",
  "aelyris.proofbook.approve_gate",
  "aelyris.proofbook.reject_gate",
  "aelyris.proofbook.create",
  "aelyris.proofbook.update",
  "aelyris.proofbook.distill",
];

const roadmapIds = ["PB-0", "PB-1", "PB-2", "PB-3", "PB-4", "PB-5", "PB-6", "PB-7"];
const detailedDesignIds = ["PB-1D", "PB-2D", "PB-3D", "PB-4D", "PB-5D", "PB-6D", "PB-7D"];

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

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function missingFrom(text, needles) {
  return needles.filter((needle) => !text.includes(needle));
}

function missingFromNormalized(text, needles) {
  const normalized = normalize(text);
  return needles.filter((needle) => !normalized.includes(normalize(needle)));
}

function check(id, passed, detail, evidence = {}) {
  return {
    id,
    status: passed ? "passed" : "failed",
    detail,
    evidence,
  };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const spec = readText(paths.spec);
const specIndex = readText(paths.specIndex);
const packageJson = readText(paths.packageJson);
const normalizedSpec = normalize(spec);
const normalizedIndex = normalize(specIndex);

const missingStepTypes = missingFrom(spec, stepTypes);
const missingMcpVerbs = missingFrom(spec, mcpVerbs);
const missingRoadmapSections = roadmapIds.filter((id) => !new RegExp(`### ${id}\\b`).test(spec));
const missingGoalPackets = roadmapIds.filter((id) => !new RegExp(`### ${id} \`/goal\``).test(spec));
const missingDetailedDesignIds = detailedDesignIds.filter((id) => !spec.includes(id));
const requiredDevelopmentMethodClauses = [
  "PB-1 through PB-7 must not jump directly from roadmap text to implementation.",
  "Each implementation phase has a required **PB-ND detailed design gate** before runtime/UI code for that phase may land.",
  "The design gate is its own phase and keeps the same repo rule: one phase = one explicit commit.",
  "Runtime implementation for PB-N is not in scope until PB-ND is green.",
  "A phase that adds code without its PB-ND design gate is incomplete even if tests pass.",
  "Proofbook development is **contract-first, existing-spine vertical slices**.",
  "The single Proofbook contract spine is `src-tauri/src/proofbook`; IPC, MCP, and UI are adapters only.",
  "No phase may add a second dispatcher, command policy, persistence authority, proof format, frontend-only executable schema, or MCP catalog path.",
  "Unsupported future step types must fail closed with explicit `unsupported_step_type` or `not_implemented` status",
  "UI work must trail backend contracts",
  "Each PB phase exits debt-zero",
  "no orphan stubs",
  "TODO placeholders",
  "duplicate schemas",
  "fake-success paths",
  "alternate dispatchers",
  "owner modules and exact file scope",
  "schema/data model changes and typed error taxonomy",
  "lifecycle or state-machine transitions",
  "verifier commands, artifact paths, and focused test matrix",
  "migration/compatibility/debt boundaries",
  "claim boundary and stop conditions",
];
const missingDevelopmentMethodClauses = missingFromNormalized(spec, requiredDevelopmentMethodClauses);
const requiredAuthorityDelegationClauses = [
  "Authority delegation matrix:",
  "`shell` / `verifier`",
  "Existing command-risk policy plus repo proof artifact chain.",
  "`mcpTool`",
  "Existing schema-enforced `tools/call` path, governance, and audit.",
  "`agentSession`",
  "Existing visible pane/session lifecycle runtime; headless only for planner/reviewer/batch.",
  "`http`",
  "Bounded request path with secret references and GATED external execution unless read-only.",
  "`manualGate`",
  "Existing auditable decision/gate model; no auto-approval replacement.",
  "`waitFor`",
  "Bounded polling over files/artifacts/MCP results with timeout and interval.",
  "`fanOut`",
  "Existing or mirrored ownership/conflict preflight; overlapping write lanes serialize or reject.",
  "`subProofbook`",
  "Child run ledger with lineage and max-depth enforcement.",
  "`evidence.write` / `evidence.read`",
  "Run ledger and artifact refs first; Evidence Store is only a later projection.",
  "Distillation",
  "Proposed diff plus risk summary only; no automatic source mutation.",
  "IPC/MCP/UI adapters",
  "Delegate to Rust proofbook contracts and runner state; no duplicate source of truth.",
];
const missingAuthorityDelegationClauses = missingFromNormalized(spec, requiredAuthorityDelegationClauses);
const requiredPhaseFailClosedClauses = [
  "PB-1 implementation cannot add a runner or execute a Proofbook.",
  "PB-2 executes only `shell`, `verifier`, `waitFor`, and `manualGate`",
  "MCP, HTTP, agent, fan-out, subProofbook, and distill steps remain explicit `not_implemented`/`unsupported_step_type`.",
  "PB-3 may add runtime MCP tool steps and list/get/validate/run/status/cancel verbs, but create/update/distill stay excluded until PB-6.",
  "PB-6 emits patch proposals only",
  "source Proofbooks are never mutated automatically.",
  "PB-7 keeps raw run ledgers as primary evidence",
  "Evidence Store is a projection only",
];
const missingPhaseFailClosedClauses = missingFromNormalized(spec, requiredPhaseFailClosedClauses);
const requiredPb1dClauses = [
  "### PB-1D - Detailed Design Gate: Schema, Parser, And Validation",
  "PB-1D is a docs/verifier gate only.",
  "It does not create `src-tauri/src/proofbook`, IPC handlers, MCP verbs, a runner, run ledgers, UI, DB tables, or executable Proofbooks.",
  "`src-tauri/src/proofbook/types.rs`",
  "`src-tauri/src/proofbook/errors.rs`",
  "`src-tauri/src/proofbook/parser.rs`",
  "`src-tauri/src/proofbook/validator.rs`",
  "`src-tauri/src/ipc/proofbook_commands.rs`",
  "`runner.rs`, `ledger.rs`, `agent_step.rs`, `settlement.rs`, `distill.rs`,",
  "`src-tauri/src/api/mcp.rs`, frontend UI files, database migrations, external command execution, and any Proofbook run state.",
  "`mod.rs` exports the schema/parser/validator contract and typed errors.",
  "`types.rs` owns serializable schema types:",
  "`errors.rs` owns `ProofbookError`, `ProofbookErrorCode`, and structured error fields.",
  "`parser.rs` owns discovery and YAML parsing from `.aelyris/proofbooks/*.proofbook.yaml`",
  "`validator.rs` owns static validation over parsed definitions",
  "Accepted schema version is exactly `aelyris.proofbook.v1`.",
  "Definition ids and step ids are ASCII slug identifiers:",
  "Step kinds are the planned taxonomy:",
  "Secret values are always references.",
  "Typed error taxonomy:",
  "Every error carries `code`, `message`, optional `definitionId`, optional `stepId`, optional `field`, and optional `path`.",
  "No-runner and fail-closed boundary:",
  "PB-1 cannot create `runId`, write `.aelyris/proofbook-runs`, execute",
  "PB-1 IPC may list definitions and return validation reports only.",
  "Recognized future step types are parseable for static validation but remain non-executable until their owning PB phase.",
  "Focused Rust test matrix for PB-1:",
  "valid minimal `.proofbook.yaml` parses and validates with a stable summary",
  "any PB-1 execution-shaped request fails with `runtime_not_available`",
  "Verifier and artifact expectations:",
  "passing `spec-pb1d-detailed-design` check before PB-1 implementation starts.",
  "cargo test --manifest-path src-tauri\\Cargo.toml proofbook --lib",
  "PB-1D claim boundary:",
  "Proofbook definitions still cannot run",
];
const pb1dErrorCodes = [
  "`invalid_project_path`",
  "`path_outside_project`",
  "`proofbook_dir_missing`",
  "`io_error`",
  "`yaml_parse_error`",
  "`unsupported_schema_version`",
  "`missing_required_field`",
  "`invalid_identifier`",
  "`duplicate_id`",
  "`unknown_step_type`",
  "`missing_dependency`",
  "`cycle_detected`",
  "`missing_settlement`",
  "`invalid_secret_ref`",
  "`runtime_not_available`",
];
const missingPb1dClauses = missingFromNormalized(spec, requiredPb1dClauses);
const missingPb1dErrorCodes = missingFrom(spec, pb1dErrorCodes);
const goalPacketsWithoutDesignGate = roadmapIds
  .filter((id) => id !== "PB-0")
  .filter((id) => {
    const phaseNumber = id.slice(3);
    const section =
      spec.match(new RegExp(`### ${id} \`/goal\`([\\s\\S]*?)(?=\\n### PB-\\d+ \`/goal\`|\\n## \\d+\\.|$)`))?.[1] ?? "";
    return !section.includes(`PB-${phaseNumber}D detailed design gate`) || !section.includes("green");
  });
const requiredSafetyClauses = [
  "Proofbooks must not introduce a second authority path.",
  "MCP steps use the MCP governance choke point.",
  "Terminal/agent input steps use the existing command-risk policy.",
  "Secrets are references, not values.",
  "Ledger output must redact known token patterns and secret values before persistence.",
  "manualGate` decisions are append-only and auditable.",
  "Fan-out cannot bypass ownership/conflict checks.",
];
const missingSafetyClauses = missingFromNormalized(spec, requiredSafetyClauses);

const forbiddenImplementedClaims = [
  /\bProofbooks?\s+(?:are|is)\s+(?:implemented|shipped|available|complete|release-ready)\b/i,
  /\bProofbook\s+(?:schema|runner|canvas|distillation|MCP verbs?)\s+(?:is|are)\s+(?:implemented|shipped|complete)\b/i,
  /\bimplemented\s+Proofbooks?\b/i,
  /\bshipped\s+Proofbooks?\b/i,
];
const claimScanSources = [
  paths.spec,
  paths.specIndex,
  "README.md",
  "docs/README.md",
  "docs/PUBLICATION_READINESS.md",
  "docs/requirements.md",
].map((path) => ({ path, text: readText(path) }));
const implementedClaimHits = [];
for (const { path, text } of claimScanSources) {
  for (const pattern of forbiddenImplementedClaims) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(globalPattern)) {
      const lineStart = text.lastIndexOf("\n", match.index ?? 0) + 1;
      const lineEnd = text.indexOf("\n", match.index ?? 0);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const prefix = line.slice(0, Math.max(0, (match.index ?? 0) - lineStart));
      if (/\b(?:do not claim|no product claim says|not claim)\b/i.test(prefix)) continue;
      if (line.includes("before PB gates exist")) continue;
      implementedClaimHits.push({
        path,
        pattern: pattern.toString(),
        match: match[0],
      });
    }
  }
}

const checks = [
  check(
    "pb0-files-exist",
    existsSync(fullPath(paths.spec)) &&
      existsSync(fullPath(paths.specIndex)) &&
      existsSync(fullPath(paths.packageJson)),
    "PB-0 authority files exist",
    { paths },
  ),
  check(
    "spec-claim-boundary",
    includesAll(normalizedSpec, [
      "Status: proposal / design target. Not a shipped capability.",
      "## 0. Claim Boundary",
      "Do not claim Proofbooks as implemented until the matching verifier is green.",
      "It does not yet have the Proofbook schema, runner, canvas, distillation, or Proofbook MCP verbs described here.",
    ]),
    "Proofbook spec keeps the proposal/not-shipped claim boundary explicit",
  ),
  check(
    "spec-step-taxonomy",
    missingStepTypes.length === 0 && spec.includes("## 5. Step Types"),
    "Proofbook spec defines the required step taxonomy",
    { missingStepTypes },
  ),
  check(
    "spec-safety-governance",
    missingSafetyClauses.length === 0 && spec.includes("## 7. Safety And Governance"),
    "Proofbook spec ties execution to existing governance, audit, redaction, and ownership safety",
    { missingSafetyClauses },
  ),
  check(
    "spec-mcp-verbs",
    missingMcpVerbs.length === 0 && spec.includes("## 8. MCP Face"),
    "Proofbook spec lists the planned MCP verbs without making them PB-0 implementation claims",
    { missingMcpVerbs },
  ),
  check(
    "spec-roadmap",
    missingRoadmapSections.length === 0 && spec.includes("## 11. Roadmap"),
    "Proofbook spec has PB-0 through PB-7 roadmap sections",
    { missingRoadmapSections },
  ),
  check(
    "spec-design-first-development-method",
    missingDevelopmentMethodClauses.length === 0 && missingDetailedDesignIds.length === 0,
    "Proofbook spec requires contract-first PB-ND detailed design gates before PB-1 through PB-7 implementation",
    { missingDevelopmentMethodClauses, missingDetailedDesignIds },
  ),
  check(
    "spec-authority-delegation-matrix",
    missingAuthorityDelegationClauses.length === 0,
    "Proofbook spec maps each step/surface to an existing Aelyris authority path instead of a parallel stack",
    { missingAuthorityDelegationClauses },
  ),
  check(
    "spec-phase-fail-closed-contract",
    missingPhaseFailClosedClauses.length === 0,
    "Proofbook roadmap keeps unsupported future behavior fail-closed and prevents fake success across PB-1 through PB-7",
    { missingPhaseFailClosedClauses },
  ),
  check(
    "spec-pb1d-detailed-design",
    missingPb1dClauses.length === 0 && missingPb1dErrorCodes.length === 0,
    "Proofbook spec defines PB-1D schema/parser/validator ownership, typed errors, no-runner boundary, test matrix, verifier artifact, and claim boundary before PB-1 runtime code",
    { missingPb1dClauses, missingPb1dErrorCodes },
  ),
  check(
    "spec-goal-packets",
    missingGoalPackets.length === 0 &&
      goalPacketsWithoutDesignGate.length === 0 &&
      spec.includes("## 12. Pasteable `/goal` Packets"),
    "Proofbook spec includes pasteable /goal packets for each roadmap phase and routes PB-1 through PB-7 through PB-ND detailed design gates first",
    { missingGoalPackets, goalPacketsWithoutDesignGate },
  ),
  check(
    "spec-indexed-as-proposal",
    includesAll(specIndex, [
      "[PROOFBOOK_AUTOMATION_SPEC.md](./PROOFBOOK_AUTOMATION_SPEC.md)",
      "proposal / automation roadmap",
      "未実装の設計 target",
      "実装済みclaimではない",
    ]),
    "spec index lists Proofbooks as an unimplemented proposal/automation roadmap, not a shipped capability",
  ),
  check(
    "package-script-present",
    packageJson.includes('"verify:proofbook:spec": "node scripts/verify-proofbook-spec.mjs"'),
    "package.json exposes pnpm verify:proofbook:spec",
  ),
  check(
    "no-implemented-product-claim",
    implementedClaimHits.length === 0 &&
      normalizedSpec.includes("Proofbook automation design proposal") &&
      normalizedSpec.includes("UI remain planned until their gates are implemented.") &&
      normalizedIndex.includes("未実装の設計 target"),
    "public docs do not claim Proofbooks are implemented after PB-0",
    { implementedClaimHits },
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  schema: "aelyris.proofbook-spec/v1",
  version: 1,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-proofbook-spec-contract" : "fail-proofbook-spec-contract",
  generatedAt: new Date().toISOString(),
  sourcePaths: [paths.spec, paths.specIndex, paths.packageJson, "scripts/verify-proofbook-spec.mjs"],
  sourceCutoffMs: Math.max(
    mtime(paths.spec),
    mtime(paths.specIndex),
    mtime(paths.packageJson),
    mtime("scripts/verify-proofbook-spec.mjs"),
  ),
  summary:
    failed.length === 0
      ? "Proofbook PB-0 spec/index/package contract is present and keeps Proofbooks as a proposal, not an implemented capability."
      : `${failed.length} Proofbook PB-0 contract checks failed`,
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
