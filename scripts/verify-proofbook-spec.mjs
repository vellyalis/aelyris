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
    "spec-goal-packets",
    missingGoalPackets.length === 0 && spec.includes("## 12. Pasteable `/goal` Packets"),
    "Proofbook spec includes pasteable /goal packets for each roadmap phase",
    { missingGoalPackets },
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
