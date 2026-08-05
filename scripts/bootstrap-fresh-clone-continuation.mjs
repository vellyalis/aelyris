import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  backtickField,
  canonicalGitStatus,
  granularSliceId,
  phaseForSlice,
} from "./audit-remediation-continuation-contract.mjs";
import {
  parseProductDeliveryContinuationContract,
  parseProductDeliveryFrontier,
} from "./product-delivery-continuation-contract.mjs";

const ROOT = resolve(process.cwd());
const BOOTSTRAP_ARTIFACT = ".codex-auto/quality/fresh-clone-bootstrap.json";
const PROTOCOL = "docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function fullPath(path) {
  return join(ROOT, path);
}

function readText(path) {
  return readFileSync(fullPath(path), "utf8");
}

function writeAtomic(path, value) {
  const target = fullPath(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, value);
  renameSync(temporary, target);
}

function writeJson(path, value) {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(fullPath(path), "utf8"));
  } catch {
    return null;
  }
}

function json(value) {
  return JSON.stringify(value);
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

function jstTimestamp(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+09:00`;
}

function exactActiveStatus(source) {
  const matches = [...String(source).matchAll(/^STATUS:\s*ACTIVE\s*$/gm)];
  return matches.length === 1;
}

function auditFrontier(source) {
  const program = backtickField(source, "PROGRAM");
  const activePhase = backtickField(source, "CURRENT PHASE");
  const activeSlice = backtickField(source, "ACTIVE SLICE");
  const completedSlice = backtickField(source, "LAST COMPLETED SLICE");
  const nextSlice = backtickField(source, "NEXT IMPLEMENTATION SLICE");
  const ok =
    exactActiveStatus(source) &&
    program === "audit-remediation" &&
    /^A\d+$/.test(activePhase ?? "") &&
    granularSliceId(activeSlice) === activeSlice &&
    granularSliceId(completedSlice) === completedSlice &&
    granularSliceId(nextSlice) === nextSlice &&
    phaseForSlice(activeSlice) === activePhase &&
    phaseForSlice(nextSlice) === activePhase;
  return { ok, program, activePhase, activeSlice, completedSlice, nextSlice };
}

function selectActiveProgram() {
  const productWorkOrder = "product-delivery-instructions.md";
  const auditWorkOrder = "audit-remediation-instructions.md";
  const productSource = readText(productWorkOrder);
  const auditSource = readText(auditWorkOrder);
  const productFrontier = parseProductDeliveryFrontier(productSource);
  const productContract = parseProductDeliveryContinuationContract(productSource);
  const audit = auditFrontier(auditSource);
  const candidates = [];

  if (exactActiveStatus(productSource)) {
    candidates.push({
      source: productSource,
      workOrder: productWorkOrder,
      frontier: productFrontier,
      contract: productContract,
      continuationArtifact: ".codex-auto/quality/product-delivery-continuation.json",
    });
  }
  if (exactActiveStatus(auditSource)) {
    candidates.push({
      source: auditSource,
      workOrder: auditWorkOrder,
      frontier: audit,
      contract: {
        ok: audit.ok,
        fields: {
          tracked_plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
          root_work_order: auditWorkOrder,
          worklog_dir: ".codex-auto/worklogs/audit-remediation",
          local_handoff:
            ".claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md",
          verifier: "pnpm verify:audit-remediation:continuation",
        },
        problems: audit.ok ? [] : ["legacy-audit-frontier"],
      },
      continuationArtifact: ".codex-auto/quality/audit-remediation-continuation.json",
    });
  }

  if (candidates.length !== 1) {
    throw new Error(
      `Fresh-clone continuation requires exactly one STATUS: ACTIVE repo work order; found ${candidates.length}.`,
    );
  }
  const selected = candidates[0];
  if (!selected.frontier.ok || !selected.contract.ok) {
    throw new Error(
      `The active ${selected.frontier.program ?? "unknown"} work order does not expose one valid exact continuation frontier: ${[
        ...(selected.frontier.problems ?? []),
        ...(selected.contract.problems ?? []),
      ].join(", ")}`,
    );
  }
  return selected;
}

function resolveVerifierInvocation(command) {
  const match = String(command ?? "").match(/^pnpm\s+([a-z0-9:-]+)$/i);
  if (!match) throw new Error(`Unsupported continuation verifier command: ${command}`);
  const packageJson = JSON.parse(readText("package.json"));
  const packageCommand = packageJson.scripts?.[match[1]];
  const nodeMatch = String(packageCommand ?? "").match(/^node\s+([^\s]+)(?:\s+(.*))?$/);
  if (!nodeMatch) {
    throw new Error(`Continuation verifier ${match[1]} must be one direct tracked Node script.`);
  }
  const args = [nodeMatch[1], ...(nodeMatch[2]?.trim().split(/\s+/).filter(Boolean) ?? [])];
  return { command: process.execPath, args };
}

function renderWorklog(context, continuationResult) {
  const result = continuationResult === "PASS" ? "PASS" : "NOT_RUN";
  const commit = context.changedPaths.length === 0 ? json(`${context.head} ${context.headSubject}`) : "null";
  return `# Fresh-Clone Continuation Bootstrap

\`\`\`yaml
work_record:
  program: ${context.frontier.program}
  session_date_jst: ${context.timestamp}
  branch: ${context.branch}
  head_at_start: ${context.head}
  head_at_close: ${context.head}
  worktree_at_start: ${json(context.gitStatus)}
  worktree_at_close: ${json(context.gitStatus)}
  active_phase: ${json(context.frontier.activePhase)}
  active_slice: ${context.frontier.activeSlice}
  completed_slice: ${context.frontier.completedSlice}
  next_implementation_slice: ${context.frontier.nextSlice}
  objective: Reconstruct machine-local ${context.frontier.program} continuation from tracked Git truth without importing another machine's local evidence.
  files_read: ${json(context.filesRead)}
  files_changed: ${json([context.worklogPath, context.contract.local_handoff, BOOTSTRAP_ARTIFACT, context.continuationArtifact])}
  commands:
    - command: ${context.contract.verifier}
      result: ${result}
      artifact: ${context.continuationArtifact}
  decisions: ${json(["Select the sole STATUS: ACTIVE repository work order as continuation owner.", "Regenerate ignored worklog and handoff locally; never transfer secrets or host evidence through Git."])}
  commit: ${commit}
  blockers:
    implementation: []
    stale_evidence: ${json(["Historical generated evidence from another machine is not portable proof."])}
    policy: ${json(["Aelyris remains alpha, active development, and not release-ready."])}
    external: ${json(["Signing, real sleep/resume, authenticated prompts, and production endpoints remain separately authorized."])}
  residual_risk: ${json(["Cross-PC readiness additionally requires a clean worktree and this exact HEAD on the configured remote."])}
  next_exact_action: Continue exact slice ${context.frontier.nextSlice} from current tracked ${context.frontier.program} truth.
\`\`\`

This record was generated on the current machine and grants no release or external-service credit.
`;
}

function renderHandoff(context, continuationResult) {
  const result = continuationResult === "PASS" ? "PASS" : "NOT_RUN";
  return `# Next Session Handoff - ${context.frontier.program}

LOCAL ONLY. DO NOT COMMIT.

\`\`\`yaml
program: ${context.frontier.program}
active_phase: ${json(context.frontier.activePhase)}
active_slice: ${context.frontier.activeSlice}
last_completed_slice: ${context.frontier.completedSlice}
next_implementation_slice: ${context.frontier.nextSlice}
status: active
branch: ${context.branch}
head: ${context.head}
git_status: ${json(context.gitStatus)}
worklog: ${context.worklogPath}
tracked_paths: ${json(context.changedPaths)}
\`\`\`

## Current Boundary

This machine reconstructed its local continuation pointer from tracked Git truth at
\`${context.head}\`. Generated artifacts from another machine were not copied.

## Read Order

1. \`AGENTS.md\`
2. \`${context.workOrder}\`
3. this handoff
4. \`${PROTOCOL}\`
5. \`${context.contract.tracked_plan}\`
6. \`${context.worklogPath}\`
7. current Git and freshly regenerated owner artifacts

## Current Artifacts And Refresh Commands

- \`${context.continuationArtifact}\`: \`${context.contract.verifier}\`
- \`${BOOTSTRAP_ARTIFACT}\`: \`pnpm verify:fresh-clone\`

## Commands And Results

- \`${context.contract.verifier}\`: ${result}
- \`pnpm verify:fresh-clone\`: run by \`scripts/bootstrap-development.ps1\` after this pointer is rebuilt

## Blocker Split

- implementation: none inferred by bootstrap; current source and focused gates own diagnosis
- stale evidence: live-host artifacts are intentionally not imported from another machine
- policy: alpha / active development / not release-ready
- external/operator: signing, real sleep/resume, authenticated prompts, production endpoints

## Next Exact Action

Continue exact slice ${context.frontier.nextSlice} from current Git truth and the owner files named by \`${context.workOrder}\`.

## Forbidden Scope

- no credentials, token values, signing material, \`.env\` contents, or secret-bearing transcripts in Git
- no provider token prompt, signing, publication, or other external action without its approval boundary
- no release-ready claim from bootstrap or continuation PASS
- no replacement of tracked work-order truth with machine-local notes

## Pasteable /goal

\`\`\`yaml
continuation_goal:
  program: ${context.frontier.program}
  current_phase: ${json(context.frontier.activePhase)}
  active_slice: ${context.frontier.activeSlice}
  next_implementation_slice: ${context.frontier.nextSlice}
  boundary: fresh_clone_reconstructed_from_tracked_git_truth
\`\`\`

Resume exact slice ${context.frontier.nextSlice} from current Git and artifact truth.
`;
}

function runVerifier(invocation) {
  return spawnSync(invocation.command, invocation.args, { cwd: ROOT, encoding: "utf8" });
}

const selected = selectActiveProgram();
const contract = selected.contract.fields;
const verifierInvocation = resolveVerifierInvocation(contract.verifier);
const head = git(["rev-parse", "--short", "HEAD"]);
const headSubject = git(["log", "-1", "--pretty=%s"]);
const branch = git(["branch", "--show-current"]);
if (!branch) throw new Error("Fresh-clone continuation bootstrap requires a named branch.");
const changedPaths = statusPaths();
const gitStatus = canonicalGitStatus(git(["status", "--short", "--branch", "--untracked-files=all"]));
const now = new Date();
const timestamp = jstTimestamp(now);
const sliceSlug = selected.frontier.activeSlice.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const worklogPath = `${contract.worklog_dir}/${timestamp.slice(0, 10)}T${timestamp
  .slice(11, 19)
  .replace(/:/g, "-")}JST-${sliceSlug}-fresh-clone-${now.getTime()}.md`;
const filesRead = [...new Set(["AGENTS.md", selected.workOrder, PROTOCOL, contract.tracked_plan])];
const context = {
  frontier: selected.frontier,
  contract,
  continuationArtifact: selected.continuationArtifact,
  workOrder: selected.workOrder,
  filesRead,
  head,
  headSubject,
  branch,
  changedPaths,
  gitStatus,
  timestamp,
  worklogPath,
};

const baseArtifact = {
  version: 2,
  generatedAt: new Date().toISOString(),
  program: selected.frontier.program,
  activePhase: selected.frontier.activePhase,
  activeSlice: selected.frontier.activeSlice,
  nextImplementationSlice: selected.frontier.nextSlice,
  branch,
  head,
  gitStatus,
  workOrder: selected.workOrder,
  trackedPlan: contract.tracked_plan,
  worklog: worklogPath,
  handoff: contract.local_handoff,
  verifier: contract.verifier,
  continuationArtifact: selected.continuationArtifact,
  importedMachineLocalEvidence: false,
  releaseCredit: false,
};

writeJson(BOOTSTRAP_ARTIFACT, { ...baseArtifact, status: "prepared", ok: false });
writeAtomic(worklogPath, renderWorklog(context, "NOT_RUN"));
writeAtomic(contract.local_handoff, renderHandoff(context, "NOT_RUN"));

let verification = runVerifier(verifierInvocation);
if (verification.status !== 0) {
  writeJson(BOOTSTRAP_ARTIFACT, {
    ...baseArtifact,
    status: "failed-continuation-bootstrap",
    ok: false,
    verifierExitCode: verification.status,
  });
  process.stderr.write(verification.stdout ?? "");
  process.stderr.write(verification.stderr ?? "");
  process.exit(verification.status ?? 1);
}

writeAtomic(worklogPath, renderWorklog(context, "PASS"));
writeAtomic(contract.local_handoff, renderHandoff(context, "PASS"));
verification = runVerifier(verifierInvocation);
if (verification.status !== 0) {
  writeJson(BOOTSTRAP_ARTIFACT, {
    ...baseArtifact,
    status: "failed-final-continuation-verification",
    ok: false,
    verifierExitCode: verification.status,
  });
  process.stderr.write(verification.stdout ?? "");
  process.stderr.write(verification.stderr ?? "");
  process.exit(verification.status ?? 1);
}

const continuation = readJson(selected.continuationArtifact);
writeJson(BOOTSTRAP_ARTIFACT, {
  ...baseArtifact,
  status: "pass-fresh-clone-continuation-bootstrap",
  ok: true,
  verifierStatus: continuation?.status ?? null,
});
console.log(
  JSON.stringify(
    {
      artifact: BOOTSTRAP_ARTIFACT,
      status: "pass-fresh-clone-continuation-bootstrap",
      program: selected.frontier.program,
      head,
      branch,
      activeSlice: selected.frontier.activeSlice,
      handoff: contract.local_handoff,
      worklog: worklogPath,
      continuationArtifact: selected.continuationArtifact,
    },
    null,
    2,
  ),
);
