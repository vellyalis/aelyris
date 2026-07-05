import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "differentiation-polish-spec.json");

const paths = {
  spec: "docs/specs/AELYRIS_DIFFERENTIATION_POLISH_SPEC.md",
  design: "docs/specs/AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md",
  remoteSpec: "docs/specs/AELYRIS_REMOTE_CONTINUITY_SPEC.md",
  remoteDesign: "docs/specs/AELYRIS_REMOTE_CONTINUITY_DESIGN.md",
  remoteDetailedDesign: "docs/specs/AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md",
  index: "docs/specs/README.md",
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

// Strip backticks, collapse whitespace, and lowercase so required clauses
// match natural prose instead of forcing duplicated verbatim sentences.
function normalize(text) {
  return text.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function missingFrom(text, needles) {
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
const design = readText(paths.design);
const remoteSpec = readText(paths.remoteSpec);
const remoteDesign = readText(paths.remoteDesign);
const remoteDetailedDesign = readText(paths.remoteDetailedDesign);
const remoteDocs = `${remoteSpec}\n${remoteDesign}\n${remoteDetailedDesign}`;
const index = readText(paths.index);
const packageJson = readText(paths.packageJson);

const requiredSpecClauses = [
  "BridgeSpace-plus",
  "Scape-plus",
  "center terminal pane tree",
  "1 agent = 1 visible PTY pane",
  "no `-p` / `--print`",
  "bounded shared brain",
  "evidence refs",
  "symbol/function ownership",
  "Proofbook canvas + run timeline + proof inspector",
  "append-only ledger",
  "no duplicate runner",
  "no second dispatcher",
  "claim boundary",
  "not release-ready",
  "releaseCandidateReady=false",
  "src/App.tsx must not grow",
  "Remote Continuity",
  "SSH attach",
  "tab/pane state sync",
  "read-only remote fleet monitor",
  "fingerprint-checked approval",
  "attach leases",
  "scoped principals",
  "D2R",
];

const requiredDesignClauses = [
  "D0 - Spec And Verifier Gate",
  "D1 - Center-Pane Agent Fleet",
  "D2 - Durable Visible Runtime",
  "D2R - Remote Continuity And SSH Attach",
  "D3 - Live Activity And Symbol Ownership",
  "D4 - Bounded Shared Brain",
  "D5 - Proofbook Canvas, Run Timeline, Proof Inspector",
  "D6 - Proofbook Automation Depth",
  "D7 - Governed Merge-Ready Lane",
  "D8 - Differentiation Claim Gate",
  "BridgeSpace-plus",
  "Scape-plus",
  "center terminal pane tree",
  "1 agent = 1 visible PTY pane",
  "no `-p` / `--print`",
  "bounded shared brain",
  "evidence refs",
  "symbol/function ownership",
  "Proofbook canvas + run timeline + proof inspector",
  "no duplicate runner",
  "no second dispatcher",
  "append-only ledger",
  "not release-ready",
  "releaseCandidateReady=false",
  "src/App.tsx must not grow",
  "RemoteWorkspaceSnapshot",
  "aelys attach",
  "SSH must not own workspace state",
];

const requiredRemoteClauses = [
  "Remote Continuity",
  "SSH attach",
  "tab/pane state sync",
  "read-only remote fleet monitor",
  "fingerprint-checked remote approval",
  "fingerprint-checked approval",
  "expectedPromptKey",
  "attach lease",
  "RemoteAttachLease",
  "scoped principal",
  "scoped principals",
  "forced command",
  "aelys attach",
  "Tailscale",
  "RemoteWorkspaceSnapshot",
  "RemotePaneProjection",
  "RemoteApprovalProjection",
  "SSH is a transport",
  "SSH must not own workspace state",
  "not implemented",
  "not release-ready",
  "RC0",
  "RC7",
];

const requiredIndexClauses = [
  "[AELYRIS_DIFFERENTIATION_POLISH_SPEC.md](./AELYRIS_DIFFERENTIATION_POLISH_SPEC.md)",
  "[AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md](./AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md)",
  "[AELYRIS_REMOTE_CONTINUITY_SPEC.md](./AELYRIS_REMOTE_CONTINUITY_SPEC.md)",
  "[AELYRIS_REMOTE_CONTINUITY_DESIGN.md](./AELYRIS_REMOTE_CONTINUITY_DESIGN.md)",
  "[AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md](./AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md)",
  "BridgeSpace-plus",
  "Scape-plus",
  "SSH attach",
  "tab/pane state sync",
  "not release-ready",
];

const forbiddenClaims = [
  /\bBridgeSpace-plus\s+(?:is|are)\s+(?:implemented|shipped|complete|release-ready)\b/i,
  /\bScape-plus\s+(?:is|are)\s+(?:implemented|shipped|complete|release-ready)\b/i,
  /\bdifferentiation\s+(?:is|are)\s+(?:implemented|shipped|complete|release-ready)\b/i,
  /\bRemote Continuity\s+(?:is|are)\s+(?:implemented|shipped|complete|release-ready)\b/i,
  /\bSSH attach\s+(?:is|are)\s+(?:implemented|shipped|complete|release-ready)\b/i,
];

const claimHits = [];
for (const [path, text] of Object.entries({
  [paths.spec]: spec,
  [paths.design]: design,
  [paths.remoteSpec]: remoteSpec,
  [paths.remoteDesign]: remoteDesign,
  [paths.remoteDetailedDesign]: remoteDetailedDesign,
  [paths.index]: index,
})) {
  for (const pattern of forbiddenClaims) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(globalPattern)) {
      claimHits.push({ path, pattern: pattern.toString(), match: match[0] });
    }
  }
}

const missingSpecClauses = missingFrom(spec, requiredSpecClauses);
const missingDesignClauses = missingFrom(design, requiredDesignClauses);
const missingRemoteClauses = missingFrom(remoteDocs, requiredRemoteClauses);
const missingIndexClauses = missingFrom(index, requiredIndexClauses);

const checks = [
  check(
    "files-exist",
    existsSync(fullPath(paths.spec)) &&
      existsSync(fullPath(paths.design)) &&
      existsSync(fullPath(paths.remoteSpec)) &&
      existsSync(fullPath(paths.remoteDesign)) &&
      existsSync(fullPath(paths.remoteDetailedDesign)) &&
      existsSync(fullPath(paths.index)) &&
      existsSync(fullPath(paths.packageJson)),
    "Differentiation and Remote Continuity spec/design/index/package files exist",
    { paths },
  ),
  check(
    "functional-spec-contract",
    missingSpecClauses.length === 0,
    "Functional differentiation spec contains the BridgeSpace-plus, Scape-plus, Remote Continuity, no-debt, and claim-boundary requirements",
    { missingSpecClauses },
  ),
  check(
    "detailed-design-contract",
    missingDesignClauses.length === 0,
    "Detailed design contains D0-D8 plus D2R implementation gates and anti-debt constraints",
    { missingDesignClauses },
  ),
  check(
    "remote-continuity-contract",
    missingRemoteClauses.length === 0,
    "Remote Continuity specs define SSH attach, tab/pane state sync, remote approvals, attach leases, scoped principals, and no shipped/release-ready claim",
    { missingRemoteClauses },
  ),
  check(
    "spec-indexed",
    missingIndexClauses.length === 0,
    "Spec index exposes differentiation and Remote Continuity docs without release-ready overclaiming",
    { missingIndexClauses },
  ),
  check(
    "package-script-present",
    packageJson.includes('"verify:differentiation-polish-spec": "node scripts/verify-differentiation-polish-spec.mjs"'),
    "package.json exposes pnpm verify:differentiation-polish-spec",
  ),
  check(
    "no-shipped-differentiation-claim",
    claimHits.length === 0,
    "Docs do not claim BridgeSpace-plus, Scape-plus, Remote Continuity, or SSH attach as shipped/release-ready",
    { claimHits },
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  schema: "aelyris.differentiation-polish-spec/v1",
  version: 1,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-differentiation-polish-spec" : "fail-differentiation-polish-spec",
  generatedAt: new Date().toISOString(),
  sourcePaths: [
    paths.spec,
    paths.design,
    paths.remoteSpec,
    paths.remoteDesign,
    paths.remoteDetailedDesign,
    paths.index,
    paths.packageJson,
    "scripts/verify-differentiation-polish-spec.mjs",
  ],
  sourceCutoffMs: Math.max(
    mtime(paths.spec),
    mtime(paths.design),
    mtime(paths.remoteSpec),
    mtime(paths.remoteDesign),
    mtime(paths.remoteDetailedDesign),
    mtime(paths.index),
    mtime(paths.packageJson),
    mtime("scripts/verify-differentiation-polish-spec.mjs"),
  ),
  summary:
    failed.length === 0
      ? "Differentiation polish and Remote Continuity specs are indexed, bounded by current alpha truth, and machine-checked against anti-debt requirements."
      : `${failed.length} differentiation polish contract checks failed`,
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
