import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.cwd());
const PLAN_PATH = join(ROOT, ".codex-auto", "quality", "verification-plan.json");
const JOURNAL_PATH = join(ROOT, ".codex-auto", "learning", "verification-decisions.jsonl");
const MAX_HISTORY = 500;

const HIGH_RISK = new Set(["security", "auth", "persistence", "schema", "public_contract", "concurrency"]);
const REPOSITORY_RISK = new Set(["dependency", "release", "workflow", "cross_owner"]);

const EXPENSIVE_PATTERNS = [
  /\bverify:rust:full\b/i,
  /\bcargo\s+test\b[^\r\n]*\s--all-targets\b/i,
  /\bpnpm\s+(?:run\s+)?(?:test|test:full|verify:full)\b/i,
  /\bplaywright\s+test\b(?![^\r\n]*(?:--grep|\.spec\.|\s-e\s))/i,
  /\bcargo\s+bench\b/i,
  /\bverify:rust:benches\b/i,
  /\bverify:(?:release|quality-score|goal:|a[6-9]:)/i,
];

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function appendJournal(event) {
  mkdirSync(dirname(JOURNAL_PATH), { recursive: true });
  appendFileSync(JOURNAL_PATH, `${JSON.stringify(event)}\n`, "utf8");
}

function readJournal() {
  if (!existsSync(JOURNAL_PATH)) return [];
  return readFileSync(JOURNAL_PATH, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-MAX_HISTORY)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function normalizeCommand(command) {
  return command.replace(/\s+/g, " ").trim().toLowerCase();
}

function boundedText(value, limit = 500) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

export function sanitizeCommand(command) {
  return boundedText(command, 2000)
    .replace(/\b(authorization\s*:\s*bearer)\s+[^\s"']+/gi, "$1 <redacted>")
    .replace(/(--?(?:token|password|secret|api[-_]?key))(?:=|\s+)\S+/gi, "$1 <redacted>")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY))=([^\s]+)/g, "$1=<redacted>");
}

function commandDigest(command) {
  return createHash("sha256").update(normalizeCommand(command)).digest("hex");
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isExpensiveCommand(command) {
  return EXPENSIVE_PATTERNS.some((pattern) => pattern.test(command));
}

export function classifyRisks(paths, explicitRisks = []) {
  const risks = new Set(
    explicitRisks
      .flatMap((risk) => risk.split(","))
      .map((risk) => risk.trim())
      .filter(Boolean),
  );
  for (const rawPath of paths) {
    const path = normalizePath(rawPath);
    if (/(^|\/)(package\.json|pnpm-lock\.yaml|cargo\.toml|cargo\.lock)$/i.test(path)) risks.add("dependency");
    if (/^\.github\/workflows\//i.test(path) || /(release|signing|updater|dist)/i.test(path)) risks.add("release");
    if (/(auth|credential|token|secret|security|governance|command_risk)/i.test(path)) risks.add("security");
    if (/(auth|approval|permission|capability)/i.test(path)) risks.add("auth");
    if (/^src-tauri\/src\/(db|persistence)\//i.test(path) || /migration/i.test(path)) risks.add("persistence");
    if (/^(contracts\/|src\/shared\/types\/|src-tauri\/src\/api\/)/i.test(path)) risks.add("public_contract");
    if (/(schema|contract)/i.test(path)) risks.add("schema");
    if (/(event_bus|pty|mux|orchestrator|startup_reconciliation|task\/manager)/i.test(path)) risks.add("concurrency");
  }
  if (paths.length >= 20) risks.add("cross_owner");
  return [...risks].sort();
}

export function selectLane(paths, risks, mode = "routine") {
  const normalized = paths.map(normalizePath);
  const policyOnly =
    normalized.length > 0 && normalized.every((path) => /^(?:docs\/|\.agents\/skills\/|[^/]+\.md$)/i.test(path));
  if (policyOnly) return "policy_only";
  if (mode === "critical" && risks.some((risk) => REPOSITORY_RISK.has(risk))) return "repository_full";
  if (risks.some((risk) => REPOSITORY_RISK.has(risk))) return "owner_full";
  if (risks.some((risk) => HIGH_RISK.has(risk))) return "owner_full";
  return "local_fast";
}

export function alreadyPassed(history, fingerprint, command) {
  const digest = commandDigest(command);
  const normalized = normalizeCommand(sanitizeCommand(command));
  return history.some(
    (event) =>
      event.type === "verification_run" &&
      event.fingerprint === fingerprint &&
      event.status === "passed" &&
      (event.commandDigest === digest || normalizeCommand(event.command ?? "") === normalized),
  );
}

export function learnedWarnings(history) {
  const counts = new Map();
  for (const event of history) {
    if (event.type !== "verification_note" || event.kind !== "unrelated_failure") continue;
    const key = `${normalizeCommand(event.command ?? "unknown")}\n${boundedText(event.summary)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([key, count]) => {
      const [command, summary] = key.split("\n", 2);
      return { command, summary, count };
    });
}

function changedSnapshot() {
  const changed = git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", "HEAD", "--"]).split(/\r?\n/).filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean);
  const paths = [...new Set([...changed, ...untracked].map(normalizePath))].sort();
  const hash = createHash("sha256");
  hash.update(git(["diff", "--binary", "HEAD", "--"]));
  for (const path of untracked.sort()) {
    const fullPath = join(ROOT, path);
    hash.update(`\nuntracked:${normalizePath(path)}\n`);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) hash.update(readFileSync(fullPath));
  }
  return { paths, fingerprint: hash.digest("hex") };
}

function parseArgs(argv) {
  const result = { _: [], risk: [], focused: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) {
      result._.push(argument);
      continue;
    }
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    const value = next && !next.startsWith("--") ? argv[++index] : true;
    if (key === "risk" || key === "focused") result[key].push(String(value));
    else result[key] = value;
  }
  return result;
}

export function createPlan({
  paths,
  fingerprint,
  claim = "unspecified",
  mode = "routine",
  stage = "implementation",
  explicitRisks = [],
  focusedCommands = [],
  history = [],
}) {
  const risks = classifyRisks(paths, explicitRisks);
  const lane = selectLane(paths, risks, mode);
  const normalizedStage = stage === "final" ? "final" : "implementation";
  const fullGatePolicy =
    normalizedStage !== "final"
      ? "blocked_until_final"
      : lane === "repository_full"
        ? "required_once"
        : lane === "owner_full"
          ? "allowed_once"
          : "not_recommended";
  return {
    schema: "aelyris.verification-plan/v1",
    generatedAt: new Date().toISOString(),
    fingerprint,
    claim: boundedText(claim),
    mode,
    stage: normalizedStage,
    lane,
    risks,
    changedPaths: paths,
    focusedCommands: focusedCommands.map(sanitizeCommand),
    fullGatePolicy,
    learnedWarnings: learnedWarnings(history),
    stopRule:
      "Stop when the claim, changed behavior, and named high-impact boundaries are decided; unrelated failures move to another work unit.",
  };
}

function currentPlan(snapshot, options = {}) {
  if (existsSync(PLAN_PATH)) {
    try {
      const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
      if (plan.fingerprint === snapshot.fingerprint) return plan;
    } catch {
      // Rebuild a corrupt or stale local plan from current Git truth.
    }
  }
  const plan = createPlan({
    paths: snapshot.paths,
    fingerprint: snapshot.fingerprint,
    claim: options.claim,
    mode: options.mode,
    stage: options.stage,
    explicitRisks: options.risk,
    focusedCommands: options.focused,
    history: readJournal(),
  });
  writeJsonAtomic(PLAN_PATH, plan);
  return plan;
}

function planCommand(options) {
  const snapshot = changedSnapshot();
  const plan = createPlan({
    paths: snapshot.paths,
    fingerprint: snapshot.fingerprint,
    claim: String(options.claim ?? "unspecified"),
    mode: String(options.mode ?? "routine"),
    stage: String(options.stage ?? "implementation"),
    explicitRisks: options.risk,
    focusedCommands: options.focused,
    history: readJournal(),
  });
  writeJsonAtomic(PLAN_PATH, plan);
  appendJournal({ type: "verification_plan", ...plan });
  console.log(JSON.stringify({ artifact: PLAN_PATH, ...plan }, null, 2));
}

function runCommand(options) {
  const command = typeof options.command === "string" ? options.command.trim() : "";
  if (!command) throw new Error("verification:run requires --command");
  const snapshot = changedSnapshot();
  const history = readJournal();
  const plan = currentPlan(snapshot, options);
  const expensive = isExpensiveCommand(command);
  const reason = typeof options.reason === "string" ? options.reason.trim() : "";
  const overrideReason = typeof options.overrideReason === "string" ? options.overrideReason.trim() : "";
  const rerunReason = typeof options.rerunReason === "string" ? options.rerunReason.trim() : "";

  if (expensive && plan.stage !== "final" && !overrideReason) {
    throw new Error(
      "expensive verification is blocked during implementation stage; refresh the plan with --stage final or provide --override-reason",
    );
  }
  if (expensive && plan.fullGatePolicy === "not_recommended" && !overrideReason) {
    throw new Error(
      "the current lane does not recommend a full gate; provide --override-reason with a concrete failure hypothesis",
    );
  }
  if (expensive && !reason && !overrideReason) {
    throw new Error("expensive verification requires --reason");
  }
  if (expensive && alreadyPassed(history, snapshot.fingerprint, command) && !rerunReason) {
    const event = {
      type: "verification_skip",
      timestamp: new Date().toISOString(),
      fingerprint: snapshot.fingerprint,
      command: sanitizeCommand(command),
      commandDigest: commandDigest(command),
      status: "duplicate_pass_suppressed",
    };
    appendJournal(event);
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd: ROOT,
    env: process.env,
    shell: true,
    stdio: "inherit",
  });
  const exitCode = result.status ?? 1;
  const event = {
    type: "verification_run",
    timestamp: new Date().toISOString(),
    fingerprint: snapshot.fingerprint,
    command: sanitizeCommand(command),
    commandDigest: commandDigest(command),
    lane: plan.lane,
    stage: plan.stage,
    expensive,
    reason: boundedText(reason || overrideReason) || null,
    rerunReason: boundedText(rerunReason) || null,
    durationMs: Date.now() - startedAt,
    exitCode,
    status: exitCode === 0 ? "passed" : "failed",
  };
  appendJournal(event);
  if (result.error) console.error(result.error.message);
  process.exitCode = exitCode;
}

function noteCommand(options) {
  const kind = String(options.kind ?? "").trim();
  const summary = String(options.summary ?? "").trim();
  if (!kind || !summary) throw new Error("verification:note requires --kind and --summary");
  const snapshot = changedSnapshot();
  const event = {
    type: "verification_note",
    timestamp: new Date().toISOString(),
    fingerprint: snapshot.fingerprint,
    kind,
    command: typeof options.command === "string" ? sanitizeCommand(options.command) : null,
    commandDigest: typeof options.command === "string" ? commandDigest(options.command) : null,
    summary: boundedText(summary),
  };
  appendJournal(event);
  console.log(JSON.stringify(event, null, 2));
}

function summaryCommand() {
  const history = readJournal();
  const summary = {
    schema: "aelyris.verification-learning-summary/v1",
    events: history.length,
    plans: history.filter((event) => event.type === "verification_plan").length,
    runs: history.filter((event) => event.type === "verification_run").length,
    expensiveRuns: history.filter((event) => event.type === "verification_run" && event.expensive).length,
    duplicatePassesSuppressed: history.filter(
      (event) => event.type === "verification_skip" && event.status === "duplicate_pass_suppressed",
    ).length,
    learnedWarnings: learnedWarnings(history),
  };
  console.log(JSON.stringify(summary, null, 2));
}

function main(argv = process.argv.slice(2)) {
  const [action = "plan", ...rest] = argv.filter((argument) => argument !== "--");
  const options = parseArgs(rest);
  if (action === "plan") planCommand(options);
  else if (action === "run") runCommand(options);
  else if (action === "note") noteCommand(options);
  else if (action === "summary") summaryCommand();
  else throw new Error(`unknown verification-budget action: ${action}`);
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  try {
    main();
  } catch (error) {
    console.error(`[verification-budget] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
