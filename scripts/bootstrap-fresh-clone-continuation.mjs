import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  backtickField,
  canonicalGitStatus,
  granularSliceId,
  phaseForSlice,
} from "./audit-remediation-continuation-contract.mjs";

const ROOT = resolve(process.cwd());
const WORK_ORDER = "audit-remediation-instructions.md";
const WORKLOG_DIR = ".codex-auto/worklogs/audit-remediation";
const HANDOFF = ".claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md";
const BOOTSTRAP_ARTIFACT = ".codex-auto/quality/fresh-clone-bootstrap.json";
const CONTINUATION_ARTIFACT = ".codex-auto/quality/audit-remediation-continuation.json";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function fullPath(path) {
  return join(ROOT, path);
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

function requireFrontier(source) {
  const program = backtickField(source, "PROGRAM");
  const activePhase = backtickField(source, "CURRENT PHASE");
  const activeSlice = backtickField(source, "ACTIVE SLICE");
  const completedSlice = backtickField(source, "LAST COMPLETED SLICE");
  const nextSlice = backtickField(source, "NEXT IMPLEMENTATION SLICE");
  const valid =
    program === "audit-remediation" &&
    /^A\d+$/.test(activePhase ?? "") &&
    granularSliceId(activeSlice) === activeSlice &&
    granularSliceId(completedSlice) === completedSlice &&
    granularSliceId(nextSlice) === nextSlice &&
    phaseForSlice(activeSlice) === activePhase &&
    phaseForSlice(nextSlice) === activePhase;
  if (!valid) {
    throw new Error("The tracked audit-remediation work order does not expose one valid exact continuation frontier.");
  }
  return { program, activePhase, activeSlice, completedSlice, nextSlice };
}

function renderWorklog(context, continuationResult) {
  const result = continuationResult === "PASS" ? "PASS" : "NOT_RUN";
  const commit = context.changedPaths.length === 0 ? json(`${context.head} ${context.headSubject}`) : "null";
  return `# Fresh-Clone Continuation Bootstrap

\`\`\`yaml
work_record:
  program: audit-remediation
  session_date_jst: ${context.timestamp}
  branch: ${context.branch}
  head_at_start: ${context.head}
  head_at_close: ${context.head}
  worktree_at_start: ${json(context.gitStatus)}
  worktree_at_close: ${json(context.gitStatus)}
  active_phase: ${context.frontier.activePhase}
  active_slice: ${context.frontier.activeSlice}
  completed_slice: ${context.frontier.completedSlice}
  next_implementation_slice: ${context.frontier.nextSlice}
  objective: Reconstruct machine-local continuation state from tracked Git truth without copying secrets, historical generated evidence, or another machine's local state.
  files_read: ${json(["AGENTS.md", WORK_ORDER, "docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md", "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md", "docs/specs/README.md"])}
  files_changed: ${json([context.worklogPath, HANDOFF, BOOTSTRAP_ARTIFACT, CONTINUATION_ARTIFACT])}
  commands:
    - command: pnpm verify:audit-remediation:continuation
      result: ${result}
      artifact: ${CONTINUATION_ARTIFACT}
  decisions: ${json(["Use tracked work-order and current Git state as the portable source; regenerate local-only routing on each machine.", "Do not import another machine's ignored artifacts, credentials, signing material, or secret-bearing transcripts."])}
  commit: ${commit}
  blockers:
    implementation: []
    stale_evidence: ${json(["Fresh clones do not inherit generated live-host evidence; refresh only the focused owner artifact needed for the next action."])}
    policy: ${json(["Aelyris remains alpha, active development, and not release-ready."])}
    external: ${json(["Signing, real Windows sleep/resume, authenticated token prompts, and production endpoints remain operator/external actions."])}
  residual_risk: ${json(["Cross-PC readiness additionally requires this HEAD to exist on the configured remote."])}
  next_exact_action: ${context.frontier.nextSlice} resumes only from current Git and regenerated artifact truth under the tracked work-order boundary.
\`\`\`

This record was generated on the current machine. It contains no transferred local evidence and grants no release credit.
`;
}

function renderHandoff(context, continuationResult) {
  const result = continuationResult === "PASS" ? "PASS" : "NOT_RUN";
  return `# Next Session Handoff - Comprehensive Audit Remediation

LOCAL ONLY. DO NOT COMMIT.

\`\`\`yaml
program: audit-remediation
active_phase: ${context.frontier.activePhase}
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
\`${context.head}\`. Generated artifacts from another machine were not copied. Aelyris
remains alpha / active development / not release-ready; this bootstrap grants no
product, release, signing, live-host, sleep/resume, or authenticated-provider credit.

## Read Order

1. \`AGENTS.md\`
2. \`audit-remediation-instructions.md\`
3. this handoff
4. \`docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md\`
5. \`docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md\` (${context.frontier.activeSlice} only)
6. \`docs/specs/README.md\`
7. \`${context.worklogPath}\`
8. current Git and freshly regenerated owner artifacts

## Current Artifacts And Refresh Commands

- \`${CONTINUATION_ARTIFACT}\`: \`pnpm verify:audit-remediation:continuation\`
- \`.codex-auto/quality/final-goal-safe-no-token.json\`: refresh only after an owner action with \`pnpm verify:goal:safe:no-token\`
- \`.codex-auto/quality/a9-release-lane-closeout.json\`: \`pnpm verify:a9:release-lane-closeout\`

## Commands And Results

- \`pnpm verify:audit-remediation:continuation\`: ${result}
- \`pnpm verify:fresh-clone\`: run by \`scripts/bootstrap-development.ps1\` after this pointer is rebuilt

## Blocker Split

- implementation: none inferred by bootstrap; fresh evidence owns any new diagnosis
- stale evidence: live-host artifacts are intentionally absent on a fresh clone
- policy: alpha / active development / not release-ready
- external/operator: signing, real sleep/resume, authenticated prompts, production endpoints

## Next Exact Action

Resume ${context.frontier.nextSlice} from current Git truth. Run only the focused owner command for the selected action; do not replay historical generated evidence as current proof.

## Forbidden Scope

- no credentials, token values, signing material, \`.env\` contents, or secret-bearing transcripts in Git
- no provider token prompt, signing, real sleep, publication, or other external action without its approval boundary
- no release-ready claim from bootstrap or continuation PASS
- no replacement of tracked work-order truth with machine-local notes

## Pasteable /goal

\`\`\`yaml
continuation_goal:
  program: audit-remediation
  current_phase: ${context.frontier.activePhase}
  active_slice: ${context.frontier.activeSlice}
  next_implementation_slice: ${context.frontier.nextSlice}
  boundary: fresh_clone_reconstructed_from_tracked_git_truth
\`\`\`

Resume from current Git and artifact truth. Preserve the tracked Goal, claim boundary,
and operator/external approval boundaries.
`;
}

function runContinuationVerifier() {
  return spawnSync(process.execPath, ["scripts/verify-audit-remediation-continuation.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

const workOrderSource = readFileSync(fullPath(WORK_ORDER), "utf8");
const frontier = requireFrontier(workOrderSource);
const head = git(["rev-parse", "--short", "HEAD"]);
const headSubject = git(["log", "-1", "--pretty=%s"]);
const branch = git(["branch", "--show-current"]);
if (!branch) throw new Error("Fresh-clone continuation bootstrap requires a named branch.");
const changedPaths = statusPaths();
const gitStatus = canonicalGitStatus(git(["status", "--short", "--branch", "--untracked-files=all"]));
const now = new Date();
const timestamp = jstTimestamp(now);
const sliceSlug = frontier.activeSlice.replace(/\./g, "-").toLowerCase();
const worklogPath = `${WORKLOG_DIR}/${timestamp.slice(0, 10)}T${timestamp.slice(11, 19).replace(/:/g, "-")}JST-${sliceSlug}-fresh-clone-${now.getTime()}.md`;
const context = {
  frontier,
  head,
  headSubject,
  branch,
  changedPaths,
  gitStatus,
  timestamp,
  worklogPath,
};

const baseArtifact = {
  version: 1,
  generatedAt: new Date().toISOString(),
  program: frontier.program,
  activePhase: frontier.activePhase,
  activeSlice: frontier.activeSlice,
  nextImplementationSlice: frontier.nextSlice,
  branch,
  head,
  gitStatus,
  worklog: worklogPath,
  handoff: HANDOFF,
  importedMachineLocalEvidence: false,
  releaseCredit: false,
};

writeJson(BOOTSTRAP_ARTIFACT, { ...baseArtifact, status: "prepared", ok: false });
writeAtomic(worklogPath, renderWorklog(context, "NOT_RUN"));
writeAtomic(HANDOFF, renderHandoff(context, "NOT_RUN"));

let verification = runContinuationVerifier();
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
writeAtomic(HANDOFF, renderHandoff(context, "PASS"));
verification = runContinuationVerifier();
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

writeJson(BOOTSTRAP_ARTIFACT, {
  ...baseArtifact,
  status: "pass-fresh-clone-continuation-bootstrap",
  ok: true,
  verifierStatus: "pass-current-audit-remediation-continuation",
});
console.log(
  JSON.stringify(
    {
      artifact: BOOTSTRAP_ARTIFACT,
      status: "pass-fresh-clone-continuation-bootstrap",
      head,
      branch,
      activeSlice: frontier.activeSlice,
      handoff: HANDOFF,
      worklog: worklogPath,
    },
    null,
    2,
  ),
);
