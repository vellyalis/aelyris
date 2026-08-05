import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  extractYamlBlock,
  scalarField,
  validateCurrentWorklogPath,
  validateHandoff,
  validateWorkRecord,
} from "./audit-remediation-continuation-contract.mjs";
import {
  hasProductDeliverySliceAnchor,
  parseProductDeliveryContinuationContract,
  parseProductDeliveryFrontier,
  productDeliverySliceId,
} from "./product-delivery-continuation-contract.mjs";

const ROOT = resolve(process.cwd());
const WORK_ORDER = "product-delivery-instructions.md";
const OUT = join(ROOT, ".codex-auto", "quality", "product-delivery-continuation.json");

function fullPath(path) {
  return join(ROOT, path);
}

function readText(path) {
  const target = fullPath(path);
  return existsSync(target) && statSync(target).isFile() ? readFileSync(target, "utf8") : "";
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
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

function missingTrackedPaths(paths) {
  const output = git(["ls-files", "--", ...paths]);
  const trackedSet = new Set(output.split(/\r?\n/).filter(Boolean).map((path) => path.replace(/\\/g, "/")));
  return paths.filter((path) => !trackedSet.has(path));
}

const workOrderSource = readText(WORK_ORDER);
const frontier = parseProductDeliveryFrontier(workOrderSource);
const contract = parseProductDeliveryContinuationContract(workOrderSource);
const fields = contract.fields;
const protocolPath = "docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md";
const agentsPath = "AGENTS.md";
const packagePath = "package.json";
const requiredTracked = [
  WORK_ORDER,
  protocolPath,
  agentsPath,
  packagePath,
  fields.tracked_plan,
  fields.root_work_order,
  "scripts/product-delivery-continuation-contract.mjs",
  "scripts/verify-product-delivery-continuation.mjs",
].filter((value, index, values) => typeof value === "string" && values.indexOf(value) === index);

const checks = [];
checks.push(
  check("frontier-contract", frontier.ok, "product delivery exposes one exact active continuation frontier", frontier),
);
checks.push(
  check("continuation-contract", contract.ok, "product delivery declares safe canonical continuation owners", contract),
);

const missingFiles = requiredTracked.filter((path) => !existsSync(fullPath(path)));
const missingTracked = missingFiles.length === 0 ? missingTrackedPaths(requiredTracked) : requiredTracked;
checks.push(
  check(
    "portable-contract-files",
    missingFiles.length === 0 && missingTracked.length === 0,
    "the active work order, plan, protocol, verifier, and package contract are tracked",
    { requiredTracked, missingFiles, missingTracked },
  ),
);

checks.push(
  check(
    "slice-anchors",
    frontier.ok &&
      hasProductDeliverySliceAnchor(workOrderSource, frontier.activeSlice) &&
      hasProductDeliverySliceAnchor(workOrderSource, frontier.completedSlice) &&
      hasProductDeliverySliceAnchor(workOrderSource, frontier.nextSlice),
    "active, completed, and next product slices have exact tracked anchors",
    {
      activeSlice: frontier.activeSlice,
      completedSlice: frontier.completedSlice,
      nextSlice: frontier.nextSlice,
    },
  ),
);

let packageJson = {};
try {
  packageJson = JSON.parse(readText(packagePath));
} catch {
  // Reported by package-script below.
}
checks.push(
  check(
    "package-script",
    packageJson.scripts?.["verify:product-delivery:continuation"] ===
      "node scripts/verify-product-delivery-continuation.mjs",
    "package scripts expose the active product continuation verifier",
  ),
);

const protocol = readText(protocolPath);
const agents = readText(agentsPath);
checks.push(
  check(
    "routing-contract",
    protocol.includes("Fresh Clone And Cross-PC Continuation") &&
      protocol.includes("Local Handoff Minimum") &&
      agents.includes("Cross-PC Git Continuity Invariant") &&
      agents.includes(WORK_ORDER),
    "repository policy routes portable continuation through tracked Git truth",
  ),
);

const head = git(["rev-parse", "--short", "HEAD"]);
const headSubject = git(["log", "-1", "--pretty=%s"]);
const branch = git(["branch", "--show-current"]);
const shortStatus = git(["status", "--short", "--branch", "--untracked-files=all"]);
const changedPaths = statusPaths();
const handoffSource = fields.local_handoff ? readText(fields.local_handoff) : "";
const handoffBlock = extractYamlBlock(handoffSource, "program");
const handoffWorklog = handoffBlock ? scalarField(handoffBlock, "worklog") : null;
const worklogPathResult = validateCurrentWorklogPath(handoffWorklog, fields.worklog_dir ?? "");
const worklogPath = worklogPathResult.path;
const worklogExists = worklogPathResult.ok && existsSync(fullPath(worklogPath));
const worklogIgnored = worklogExists && isIgnored(worklogPath);
checks.push(
  check(
    "current-worklog-pointer",
    worklogPathResult.ok && worklogExists && worklogIgnored,
    "handoff selects one safe ignored product-delivery worklog",
    { path: worklogPath, problems: worklogPathResult.problems, exists: worklogExists, ignored: worklogIgnored },
  ),
);

const expectedCommit = changedPaths.length === 0 ? `${head} ${headSubject}` : null;
const workRecord = validateWorkRecord({
  source: worklogExists ? readText(worklogPath) : "",
  expectedProgram: frontier.program,
  expectedPhase: frontier.activePhase,
  expectedActiveSlice: frontier.activeSlice,
  expectedCompletedSlice: frontier.completedSlice,
  expectedNextSlice: frontier.nextSlice,
  expectedBranch: branch,
  expectedHead: head,
  expectedGitStatus: shortStatus,
  expectedCommit,
  sliceIdParser: productDeliverySliceId,
});
checks.push(
  check("current-worklog-schema", workRecord.ok, "current product worklog matches Git and the exact frontier", {
    path: worklogPath,
    missing: workRecord.missing,
    commandCount: workRecord.commandCount,
  }),
);

const handoff = validateHandoff({
  source: handoffSource,
  expectedProgram: frontier.program,
  expectedPhase: frontier.activePhase,
  expectedActiveSlice: frontier.activeSlice,
  expectedCompletedSlice: frontier.completedSlice,
  expectedNextSlice: frontier.nextSlice,
  expectedBranch: branch,
  expectedHead: head,
  expectedGitStatus: shortStatus,
  expectedWorklog: worklogPath,
  expectedChangedPaths: changedPaths,
  sliceIdParser: productDeliverySliceId,
});
checks.push(
  check("handoff-schema", handoff.ok, "canonical product handoff matches the exact frontier and dirty paths", {
    missing: handoff.missing,
    fields: handoff.fields,
  }),
);

const localPaths = [fields.local_handoff, fields.worklog_dir].filter(Boolean);
const notIgnored = localPaths.filter((path) => !isIgnored(path));
checks.push(
  check("local-evidence-ignored", notIgnored.length === 0, "product worklogs and handoff stay outside Git", {
    paths: localPaths,
    notIgnored,
  }),
);

const failed = checks.filter((entry) => entry.status === "failed");
const result = {
  version: 1,
  contractVersion: "product-delivery-continuation/v1",
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? "pass-current-product-delivery-continuation" : "failed",
  ok: failed.length === 0,
  program: frontier.program,
  activePhase: frontier.activePhase,
  activeSlice: frontier.activeSlice,
  completedSlice: frontier.completedSlice,
  nextImplementationSlice: frontier.nextSlice,
  branch,
  head,
  gitStatus: shortStatus,
  workOrder: WORK_ORDER,
  worklog: worklogPath,
  handoff: fields.local_handoff ?? null,
  checkCount: checks.length,
  failedCount: failed.length,
  checks,
  nextAction:
    failed.length === 0
      ? `Continue exact slice ${frontier.nextSlice} from the canonical product handoff.`
      : "Repair the failed product continuation checks before session clear or cross-PC claims.",
};

writeJsonAtomic(OUT, result);
console.log(JSON.stringify({ artifact: OUT, ...result }, null, 2));
if (!result.ok) process.exitCode = 1;
