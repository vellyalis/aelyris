import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "git-finalization-readiness.json");
const TARGET_BRANCH = process.env.AELYRIS_GIT_FINALIZATION_TARGET ?? "master";
const ACL_DIAGNOSTIC_COMMANDS = [
  "pnpm verify:goal:git-finalization:shell",
  "whoami /user",
  "whoami /groups",
  "Get-Acl .git, .git\\index, .git\\objects | Format-List Path, Owner, AccessToString",
  "icacls .git",
  "icacls .git\\index",
  "icacls .git\\objects",
  "git add -A --dry-run",
];
const ACL_REPAIR_RUNBOOK = [
  "Review the ACL diagnostic output first; Deny ACEs override owner/Admin allow entries on Windows.",
  "Compare whoami /user and whoami /groups against the Deny SIDs before deciding what to remove.",
  "If git add -A --dry-run still reports index.lock Permission denied after SID review, run finalization from a non-sandbox owner/admin shell or repair the repository metadata ACL there.",
  "If Deny ACEs are present on .git metadata, remove only the intentional-blocking Deny ACEs from .git with an owner/admin PowerShell.",
  "Example shape: icacls .git /remove:d <SID_OR_ACCOUNT_WITH_DENY_ACE> /t",
  "Rerun pnpm verify:goal:git-finalization before staging.",
];
const COMMIT_MESSAGE = "Harden native terminal final quality gates";

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    command: `git ${args.join(" ")}`,
    ok: result.status === 0,
    exitCode: result.status ?? null,
    timedOut: result.error?.code === "ETIMEDOUT",
    spawnBlocked: result.error?.code === "EPERM" || result.error?.code === "EACCES",
    stdout: String(result.stdout ?? "").trim(),
    stderr: [result.stderr, result.error?.message].filter(Boolean).join("\n").trim(),
  };
}

function probeCreateAndDelete(path) {
  if (existsSync(path)) {
    return { ok: false, status: "already-exists", path, error: "probe path already exists; refusing to overwrite" };
  }
  let fd = null;
  try {
    fd = openSync(path, "wx");
    closeSync(fd);
    fd = null;
    unlinkSync(path);
    return { ok: true, status: "write-delete-ok", path, error: null };
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best effort cleanup after a partial probe.
      }
    }
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Preserve the original failure as the useful diagnostic.
    }
    return {
      ok: false,
      status: "write-delete-failed",
      path,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
    };
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function branchFromHead(gitDir) {
  const head = readText(join(gitDir, "HEAD"));
  const match = /^ref:\s+refs\/heads\/(.+)\s*$/m.exec(head ?? "");
  return match?.[1] ?? null;
}

function localBranchExists(gitDir, branchName) {
  if (existsSync(join(gitDir, "refs", "heads", branchName))) return true;
  const packedRefs = readText(join(gitDir, "packed-refs"));
  return new RegExp(`\\srefs/heads/${branchName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(
    packedRefs ?? "",
  );
}

function writeArtifact(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

function summarizeGitStatusShort(statusText) {
  const lines = String(statusText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("##")) ?? null;
  const pathLines = lines.filter((line) => !line.startsWith("##"));
  const summary = {
    branchLine,
    changedPathCount: pathLines.length,
    stagedPathCount: 0,
    unstagedPathCount: 0,
    untrackedPathCount: 0,
    modifiedPathCount: 0,
    deletedPathCount: 0,
    addedPathCount: 0,
    renamedPathCount: 0,
    copiedPathCount: 0,
    otherPathCount: 0,
  };

  for (const line of pathLines) {
    const code = line.slice(0, 2);
    if (code === "??") {
      summary.untrackedPathCount += 1;
      continue;
    }
    const indexCode = code[0] ?? " ";
    const worktreeCode = code[1] ?? " ";
    if (indexCode !== " " && indexCode !== "?") summary.stagedPathCount += 1;
    if (worktreeCode !== " " && worktreeCode !== "?") summary.unstagedPathCount += 1;
    if (code.includes("M")) summary.modifiedPathCount += 1;
    if (code.includes("D")) summary.deletedPathCount += 1;
    if (code.includes("A")) summary.addedPathCount += 1;
    if (code.includes("R")) summary.renamedPathCount += 1;
    if (code.includes("C")) summary.copiedPathCount += 1;
    if (!/[MADRC]/.test(code)) summary.otherPathCount += 1;
  }

  return summary;
}

const gitDir = join(ROOT, ".git");
const repositoryPresent = existsSync(gitDir);
const branch = runGit(["branch", "--show-current"]);
const targetBranch = runGit(["rev-parse", "--verify", TARGET_BRANCH]);
const status = runGit(["status", "--short", "--branch"]);
const remotes = runGit(["remote", "-v"]);
const addDryRun = runGit(["add", "-A", "--dry-run"]);
const fallbackBranch = repositoryPresent ? branchFromHead(gitDir) : null;
const targetBranchExists = targetBranch.ok || (repositoryPresent && localBranchExists(gitDir, TARGET_BRANCH));

const indexLockPath = join(gitDir, "index.lock");
const objectProbePath = join(gitDir, "objects", `.codex-write-probe-${process.pid}-${Date.now()}`);
const indexLockProbe = repositoryPresent
  ? probeCreateAndDelete(indexLockPath)
  : { ok: false, status: "missing-repository", path: indexLockPath, error: ".git directory is missing" };
const objectWriteProbe = repositoryPresent
  ? probeCreateAndDelete(objectProbePath)
  : { ok: false, status: "missing-repository", path: objectProbePath, error: ".git directory is missing" };

const releaseScore = readJson(join(ROOT, ".codex-auto", "quality", "release-quality-score.json"));
const finalAudit = readJson(join(ROOT, ".codex-auto", "quality", "final-goal-audit.json"));
const completionMatrix = readJson(join(ROOT, ".codex-auto", "quality", "goal-completion-matrix.json"));
const externalGateReadiness = readJson(join(ROOT, ".codex-auto", "quality", "goal-external-gate-readiness.json"));
const operatorFinish = readJson(join(ROOT, ".codex-auto", "quality", "goal-operator-finish.json"));
const finalizer = readJson(join(ROOT, ".codex-auto", "quality", "goal-finalize-evidence.json"));
const safe = readJson(join(ROOT, ".codex-auto", "quality", "final-goal-safe-summary.json"));
const shellDiagnostics = readJson(join(ROOT, ".codex-auto", "quality", "git-finalization-shell-diagnostics.json"));

function scoreHasOnlyExternalBlockers(score) {
  const blockers = Array.isArray(score?.blockers) ? score.blockers : [];
  return blockers.every((blocker) =>
    ["real-os-soak", "authenticated-ai-cli-prompt-smoke"].includes(String(blocker?.area ?? "")),
  );
}

const independentEvidenceGreenOrExternalGated =
  releaseScore?.score >= 96 &&
  releaseScore?.total >= 321 &&
  scoreHasOnlyExternalBlockers(releaseScore) &&
  finalAudit?.ok === true &&
  finalAudit?.status === "blocked-by-external-gates" &&
  finalAudit?.evidenceComplete === true &&
  finalAudit?.implementationFixableCount === 0 &&
  completionMatrix?.ok === true &&
  completionMatrix?.status === "blocked-by-external-gates" &&
  completionMatrix?.implementationFixableCount === 0 &&
  externalGateReadiness?.ok === true &&
  externalGateReadiness?.status === "ready-for-external-operator-gates" &&
  operatorFinish?.ok === true &&
  ["ready-for-external-operator-gates", "complete"].includes(operatorFinish?.status);

const checks = {
  repositoryPresent,
  currentBranchKnown: (branch.ok && branch.stdout.length > 0) || Boolean(fallbackBranch),
  targetBranchExists,
  noExistingIndexLock: !existsSync(indexLockPath),
  canCreateIndexLock: indexLockProbe.ok,
  canWriteObjectDatabase: objectWriteProbe.ok,
  gitAddDryRunOk: addDryRun.ok,
  independentEvidenceGreenOrExternalGated,
  finalizerGreenOrExternalGated: finalizer?.ok === true && finalizer?.status === "blocked-by-external-gates",
  safeGreenOrExternalGated: safe?.ok === true && safe?.status === "blocked-by-external-gates",
};

const gitFinalizationReady =
  checks.repositoryPresent &&
  checks.currentBranchKnown &&
  checks.targetBranchExists &&
  checks.noExistingIndexLock &&
  checks.canCreateIndexLock &&
  checks.canWriteObjectDatabase &&
  checks.gitAddDryRunOk;

const blockers = [];
if (!checks.canCreateIndexLock) {
  blockers.push({
    area: "git-index-lock",
    blocker: indexLockProbe.error ?? "cannot create .git/index.lock",
    requiredAction:
      "Run commit/merge from a shell with permission to write the repository index, or inspect/remove blocking Deny ACEs on .git metadata.",
  });
}
if (!checks.canWriteObjectDatabase) {
  blockers.push({
    area: "git-object-database",
    blocker: objectWriteProbe.error ?? "cannot write .git/objects",
    requiredAction:
      "Run commit/merge from a shell with permission to write Git objects, or inspect/remove blocking Deny ACEs on .git metadata.",
  });
}
if (!checks.gitAddDryRunOk) {
  blockers.push({
    area: "git-add-dry-run",
    blocker: addDryRun.stderr || addDryRun.stdout || "git add -A --dry-run failed",
    requiredAction: "Resolve Git metadata write access before staging.",
  });
}

const currentBranch = branch.stdout || fallbackBranch;
const shellGitStatus = shellDiagnostics?.commands?.gitStatus;
const statusTextForHandoff =
  (status.ok && status.stdout) || (shellGitStatus?.ok === true ? shellGitStatus.output : "") || "";
const worktreeStatusSource = status.ok ? "direct-git" : shellGitStatus?.ok === true ? "shell-diagnostics" : "unavailable";
const blockedOnlyByGitMetadata =
  !gitFinalizationReady &&
  checks.repositoryPresent &&
  checks.currentBranchKnown &&
  checks.targetBranchExists &&
  checks.noExistingIndexLock &&
  checks.independentEvidenceGreenOrExternalGated &&
  blockers.length > 0 &&
  blockers.every((item) => item.area.startsWith("git-"));
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: "Asia/Tokyo",
  ok: true,
  status: gitFinalizationReady ? "ready-for-commit-and-merge" : "blocked-by-git-metadata-permissions",
  gitFinalizationReady,
  currentBranch,
  targetBranch: TARGET_BRANCH,
  checks,
  probes: {
    indexLock: indexLockProbe,
    objectDatabase: objectWriteProbe,
    gitAddDryRun: {
      ok: addDryRun.ok,
      exitCode: addDryRun.exitCode,
      spawnBlocked: addDryRun.spawnBlocked,
      stderrTail: addDryRun.stderr.slice(-2000),
      stdoutTail: addDryRun.stdout.slice(-2000),
    },
  },
  proofState: {
    score: releaseScore
      ? {
          score: releaseScore.score,
          total: releaseScore.total,
          max: releaseScore.max,
          grade: releaseScore.grade,
          releaseCandidateReady: releaseScore.releaseCandidateReady,
        }
      : null,
    finalizer: finalizer
      ? {
          ok: finalizer.ok,
          status: finalizer.status,
          failedSteps: Array.isArray(finalizer.failedSteps) ? finalizer.failedSteps.length : null,
        }
      : null,
    safe: safe
      ? {
          ok: safe.ok,
          status: safe.status,
          proofArtifactPassCount: safe.coverage?.proofArtifactPassCount,
          proofArtifactCount: safe.coverage?.proofArtifactCount,
        }
      : null,
    shellDiagnostics: shellDiagnostics
      ? {
          generatedAt: shellDiagnostics.generatedAt,
          status: shellDiagnostics.status,
          gitFinalizationReady: shellDiagnostics.gitFinalizationReady,
          gitAddDryRunOk: shellDiagnostics.checks?.gitAddDryRunOk,
          denyAceCount: shellDiagnostics.checks?.denyAceCount,
        }
      : null,
  },
  blockers,
  handoff: {
    status: gitFinalizationReady
      ? "ready-to-stage-commit-merge"
      : blockedOnlyByGitMetadata
        ? "repair-git-metadata-permissions-then-runbook"
        : "not-ready",
    blockedOnlyByGitMetadata,
    sourceBranch: currentBranch,
    targetBranch: TARGET_BRANCH,
    commitMessage: COMMIT_MESSAGE,
    worktreeStatusSource,
    worktreeSummary: summarizeGitStatusShort(statusTextForHandoff),
    nextCommandsAfterAclRepair: [
      "pnpm verify:goal:git-finalization",
      "git add -A",
      `git commit -m "${COMMIT_MESSAGE}"`,
      `git switch ${TARGET_BRANCH}`,
      `git merge --no-ff ${currentBranch ?? "codex/release-hardening-quality-gates"}`,
    ],
    note: "This handoff is non-destructive. Repair or run from an owner/admin shell first, then rerun readiness before staging.",
  },
  runbook: {
    readiness: "pnpm verify:goal:git-finalization",
    shellDiagnostics: "pnpm verify:goal:git-finalization:shell",
    aclDiagnostics: ACL_DIAGNOSTIC_COMMANDS,
    aclRepair: ACL_REPAIR_RUNBOOK,
    commitAndMerge: [
      "git add -A",
      `git commit -m "${COMMIT_MESSAGE}"`,
      `git switch ${TARGET_BRANCH}`,
      `git merge --no-ff ${currentBranch ?? "codex/release-hardening-quality-gates"}`,
    ],
    safety: "This verifier does not stage, commit, merge, push, mutate ACLs, or remove existing Git lock files.",
  },
  commands: {
    status: status.ok ? status.stdout : status.stderr,
    remotes: remotes.ok ? remotes.stdout : remotes.stderr,
  },
};

writeArtifact(report);
console.log(JSON.stringify(report, null, 2));
