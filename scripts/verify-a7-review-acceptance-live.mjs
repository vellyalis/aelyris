import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifactPath = join(root, ".codex-auto", "quality", "a7-review-acceptance-live.json");
const CDP = process.env.AELYRIS_CDP_URL || "http://127.0.0.1:9222";
const planId = "0197c000-0000-7000-8000-000000000004";
const workUnitId = "0197c000-0000-7000-8000-000000000003";
const planRevision = 1;
const sourceBranch = "a7-preview/0197c000-0000-7000-8000-000000000003";
const targetBranch = "a7-acceptance";
const reviewerReceiptContract = "aelyris.mission_reviewer_invocation_receipt/v1";
const oidPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();

function optionalRef(ref) {
  try {
    return git("rev-parse", "--verify", ref);
  } catch {
    return null;
  }
}

function worktreeForBranch(branch) {
  const lines = git("worktree", "list", "--porcelain").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== `branch refs/heads/${branch}`) continue;
    for (let cursor = index - 1; cursor >= 0 && lines[cursor] !== ""; cursor -= 1) {
      if (lines[cursor].startsWith("worktree ")) return lines[cursor].slice(9);
    }
  }
  return null;
}

async function main() {
  const mainBefore = git("rev-parse", "HEAD");
  const remoteBefore = optionalRef("refs/remotes/origin/main");
  const sourceOid = git("rev-parse", `refs/heads/${sourceBranch}`);
  const sourceWorktree = worktreeForBranch(sourceBranch);
  if (!sourceWorktree) throw new Error("A7 source worktree is unavailable");
  const sourceCleanBefore =
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: sourceWorktree,
      encoding: "utf8",
      windowsHide: true,
    }).trim() === "";

  const browser = await chromium.connectOverCDP(CDP);
  let report;
  let task;
  let pendingIntents;
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("localhost:1420"));
    if (!page) throw new Error("no Aelyris Tauri webview found over CDP");
    const invoke = (command, args = {}) =>
      page.evaluate(
        ([name, payload]) => window.__TAURI_INTERNALS__.invoke(name, payload),
        [command, args],
      );

    report = await invoke("mission_plan_review_accept", { planId, planRevision });
    const tasks = await invoke("task_list");
    task = (tasks || []).find((candidate) => candidate.id === workUnitId);
    pendingIntents = await invoke("merge_intents_pending").catch(() => []);
  } finally {
    await browser.close();
  }

  const mainAfter = git("rev-parse", "HEAD");
  const remoteAfter = optionalRef("refs/remotes/origin/main");
  const sourceAfter = git("rev-parse", `refs/heads/${sourceBranch}`);
  const targetAfter = optionalRef(`refs/heads/${targetBranch}`);
  const sourceCleanAfter =
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: sourceWorktree,
      encoding: "utf8",
      windowsHide: true,
    }).trim() === "";

  const review = report?.review;
  const binding = report?.mergeBinding;
  const receipt = report?.mergeReceipt;
  const reviewerReceiptRef = review?.reviewerInvocationReceiptRef;
  const assertions = {
    mergedExactOid: report?.status === "merged_exact_oid",
    exactAcceptedPlan:
      report?.activation?.planId === planId &&
      report?.activation?.planRevision === planRevision &&
      report?.activation?.taskId === workUnitId,
    exactFreshGate:
      report?.gateEvidence?.candidateOid === sourceOid &&
      report?.gateEvidence?.testedOid === sourceOid &&
      report?.gateEvidence?.result === "passed" &&
      digestPattern.test(report?.gateEvidence?.evidenceDigest ?? ""),
    independentReceiptBound:
      review?.verdict === "accepted_exact_oid" &&
      review?.reviewedOid === sourceOid &&
      reviewerReceiptRef?.id &&
      reviewerReceiptRef?.contractVersion === reviewerReceiptContract &&
      digestPattern.test(reviewerReceiptRef?.contentDigest ?? "") &&
      review?.reviewerIndependence?.eligible === true &&
      digestPattern.test(review?.reviewerIndependence?.digest ?? "") &&
      digestPattern.test(review?.reviewDigest ?? ""),
    exactMergeBinding:
      binding?.workUnitId === workUnitId &&
      binding?.reviewId === review?.reviewId &&
      binding?.testedEvidenceId === report?.gateEvidence?.evidenceId &&
      binding?.sourceOid === sourceOid,
    exactMergeReceipt:
      receipt?.intentId === binding?.intentId &&
      receipt?.integratedOid === sourceOid &&
      receipt?.mergeResult === "merged_exact_oid",
    isolatedTargetOnly: targetAfter === sourceOid,
    candidateUnchanged: sourceAfter === sourceOid && sourceCleanBefore && sourceCleanAfter,
    mainUnchanged: mainAfter === mainBefore,
    remoteUnchanged: remoteAfter === remoteBefore,
    stoppedBeforeCompletionPacket: task?.status === "review",
    noPendingMergeIntent: Array.isArray(pendingIntents) && pendingIntents.length === 0,
  };
  const failures = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failures.length > 0) {
    const reviewSummary = JSON.stringify({
      status: report?.status ?? null,
      verdict: review?.verdict ?? null,
      findings: review?.findings ?? [],
    });
    throw new Error(
      `A7.3 live assertions failed: ${failures.join(", ")}; review=${reviewSummary}`,
    );
  }
  if (!oidPattern.test(sourceOid)) throw new Error("invalid A7 source OID");

  const generatedAt = new Date().toISOString();
  const artifact = {
    schema: "aelyris.a7-review-acceptance-live/v1",
    status: "pass",
    attemptedSlice: "A7.3",
    completedSlice: "A7.3",
    nextImplementationSlice: "A7.4",
    phaseComplete: false,
    plan: { planId, planRevision, workUnitId },
    candidate: {
      sourceBranch,
      sourceOid,
      worktree: sourceWorktree,
      cleanBefore: sourceCleanBefore,
      cleanAfter: sourceCleanAfter,
    },
    review: {
      reviewId: review.reviewId,
      reviewerInvocationReceiptRef: reviewerReceiptRef,
      reviewedOid: review.reviewedOid,
      verdict: review.verdict,
      independenceDigest: review.reviewerIndependence.digest,
      reviewDigest: review.reviewDigest,
      clauseCoverageCount: review.clauseCoverage.length,
      findingCount: review.findings.length,
    },
    merge: {
      targetBranch,
      intentId: binding.intentId,
      bindingSourceOid: binding.sourceOid,
      receiptId: receipt.receiptId,
      integratedOid: receipt.integratedOid,
      result: receipt.mergeResult,
    },
    boundaries: {
      mainBefore,
      mainAfter,
      remoteBefore,
      remoteAfter,
      taskStatus: task.status,
      completionPacketCreated: false,
      automaticMainMerge: false,
    },
    generatedAt,
    provenance: createEvidenceProvenance({
      root,
      verifierPath: "scripts/verify-a7-review-acceptance-live.mjs",
      inputPaths: [
        "src-tauri/src/agent/oneshot.rs",
        "src-tauri/src/review/mission.rs",
        "src-tauri/src/persistence/review_repo.rs",
        "src-tauri/src/persistence/merge_repo.rs",
        "src-tauri/src/db/migrations.rs",
        "src-tauri/src/git/merge.rs",
        "src-tauri/src/ipc/orchestrator_commands.rs",
        "src-tauri/src/task/manager.rs",
        "src-tauri/src/startup_reconciliation.rs",
        "scripts/verify-a7-review-acceptance-live.mjs",
      ],
      generatedAt,
    }),
  };
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ artifact: artifactPath, ...artifact }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
