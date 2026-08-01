import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifactPath = join(root, ".codex-auto", "quality", "a7-visible-implementation-live.json");
const CDP = process.env.AELYRIS_CDP_URL || "http://127.0.0.1:9222";
const ids = {
  request: "0197c000-0000-7000-8000-000000000001",
  mission: "0197c000-0000-7000-8000-000000000002",
  work: "0197c000-0000-7000-8000-000000000003",
  plan: "0197c000-0000-7000-8000-000000000004",
  workspace: "0197c000-0000-7000-8000-000000000005",
  project: "0197c000-0000-7000-8000-000000000006",
  actor: "0197c000-0000-7000-8000-000000000007",
  repository: "0197c000-0000-7000-8000-000000000008",
  clauses: [
    "0197c000-0000-7000-8000-000000000009",
    "0197c000-0000-7000-8000-00000000000a",
    "0197c000-0000-7000-8000-00000000000b",
    "0197c000-0000-7000-8000-00000000000c",
  ],
  unlock: "0197c000-0000-7000-8000-00000000000d",
};
const request =
  "Add a Rust regression test named equal_priority_ready_tasks_preserve_insertion_order in src-tauri/src/task/graph.rs. It must insert two Medium root tasks in order, recompute readiness, and prove ready_tasks() preserves insertion order. Change no production behavior unless the new test first demonstrates a defect.";
const ownedTarget = "src-tauri/src/task/graph.rs";
const testArgv = [
  "cargo",
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--lib",
  "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order",
  "--",
  "--exact",
];
const maxEvidenceAgeMs = 300_000;
const statements = [
  "A7-FIX-01: add exactly the named deterministic regression test",
  "A7-FIX-02: preserve production behavior unless the test first demonstrates a defect",
  "A7-FIX-03: the declared focused test passes at the exact candidate OID",
  "A7-FIX-04: the owned diff contains no path outside src-tauri/src/task/graph.rs",
];
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();

function previewInput(baseOid) {
  const freshnessPolicy = {
    policyId: "a7-exact-oid/v1",
    maxAgeMs: String(maxEvidenceAgeMs),
    requireSameHeadOid: true,
    requireSameContractVersion: true,
    requireSameEnvironmentFingerprint: true,
  };
  return {
    requestId: ids.request,
    request,
    planId: ids.plan,
    planRevision: 1,
    missionDefinition: {
      schema: "aelyris.mission_definition/v1",
      missionId: ids.mission,
      revision: 1,
      workspaceId: ids.workspace,
      projectId: ids.project,
      goal: "Add the named deterministic TaskGraph regression test",
      desiredOutcome: "Insertion order remains proven",
      capabilityOutcome: "One bounded test-only change is reviewable",
      nonGoals: ["No production behavior change without demonstrated defect"],
      baseOid,
      acceptance: statements.map((statement, index) => ({
        clauseId: ids.clauses[index],
        statement,
        requiredGateIds: index === 2 ? ["a7-fixed-test"] : [],
        requiredArtifactIds: [],
        completionBlocking: true,
      })),
      riskPolicy: {
        policyId: "a7-core-risk/v1",
        policyVersion: "1",
        maximumRiskClass: "moderate",
        humanApprovalRiskClasses: ["high", "irreversible"],
        reconciliationPolicyId: "a7-reconcile/v1",
      },
      budgetPolicy: {
        policyId: "a7-budget/v1",
        policyVersion: "1",
        limits: [{ kind: "wall_time_ms", unit: "ms", amount: "600000", currencyIsoCode: null, hard: true }],
        exhaustionResult: "blocked",
      },
      runtimePolicy: {
        policyId: "visible-pty/v1",
        policyVersion: "1",
        allowedRuntimeDomainIds: ["visible_pty"],
        requiredAdapterCapabilities: ["prompt"],
        visiblePtyRequired: true,
      },
      teamPolicy: {
        roles: [
          {
            roleId: "implementer",
            capabilityProfileIds: ["a7-impl/v1"],
            budgetProfileId: "bounded/v1",
            proofProfileId: "exact-oid/v1",
            mayImplement: true,
            mayReview: false,
            mayAuthorizeCompletion: false,
          },
          {
            roleId: "independent_reviewer",
            capabilityProfileIds: ["a7-review/v1"],
            budgetProfileId: "bounded/v1",
            proofProfileId: "exact-oid/v1",
            mayImplement: false,
            mayReview: true,
            mayAuthorizeCompletion: true,
          },
        ],
        reviewerIndependencePolicyId: "a7-core-reviewer-independence/v1",
        ownershipPolicyId: "a7-exact-path/v1",
        governancePolicyId: "a7-core/v1",
      },
      workGraphDefinitionRevision: 1,
      createdBy: ids.actor,
      approvedBy: null,
      createdAt: "2026-08-01T00:00:00Z",
    },
    workUnits: [
      {
        workUnitId: ids.work,
        missionId: ids.mission,
        definitionRevision: 1,
        title: "Add stable-order regression test",
        objective: "Prove equal-priority roots preserve insertion order",
        dependsOn: [],
        requiredRole: "implementer",
        completionAuthorityRoleIds: ["independent_reviewer"],
        requiredAdapterCapabilities: ["prompt"],
        fileIntents: [
          {
            resourceRef: {
              repositoryId: ids.repository,
              repoRelativePath: ownedTarget,
              baseOid,
              headOid: baseOid,
              blobOid: null,
            },
            operation: "update",
            expectedBaseDigest: null,
          },
        ],
        symbolIntents: [],
        requiredCapabilityTemplates: [],
        requiredGates: [
          {
            gateId: "a7-fixed-test",
            contractVersion: "1",
            commandArgv: testArgv,
            cwdRole: "mission_worktree",
            requiredResult: "passed",
            freshnessPolicy,
          },
        ],
        requiredArtifacts: [],
        riskClass: "low",
        capabilityUnlock: {
          unlockId: ids.unlock,
          capability: "a7.2.activate_visible_implementation",
          conditionClauseIds: ids.clauses,
          availableAfterWorkUnitId: ids.work,
        },
      },
    ],
    reviewRequirement: {
      role: "independent_reviewer",
      policyId: "a7-core-reviewer-independence/v1",
      mustDifferFromImplementerBy: ["principal_id", "logical_session_id", "fork_lineage"],
      requiredVerdict: "accepted_exact_oid",
    },
    mergePolicy: {
      result: "merged_exact_oid",
      targetBranchRole: "isolated_mission_acceptance_target",
      automaticMainMerge: false,
    },
    explicitRisks: ["TaskGraph ordering regression"],
  };
}

function missionWorktree(sourceBranch) {
  const lines = git("worktree", "list", "--porcelain").split(/\r?\n/);
  let path = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === `branch refs/heads/${sourceBranch}`) {
      for (let cursor = index - 1; cursor >= 0 && lines[cursor] !== ""; cursor -= 1) {
        if (lines[cursor].startsWith("worktree ")) return lines[cursor].slice(9);
      }
    }
  }
  return path;
}

async function main() {
  const baseOid = git("rev-parse", "HEAD");
  const browser = await chromium.connectOverCDP(CDP);
  let page;
  try {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes("localhost:1420"));
    if (!page) throw new Error("no Aelyris Tauri webview found over CDP");
    const invoke = (command, args = {}) =>
      page.evaluate(
        ([name, payload]) => window.__TAURI_INTERNALS__.invoke(name, payload),
        [command, args],
      );

    const preview = await invoke("mission_plan_preview", {
      input: previewInput(baseOid),
      repoPath: root,
    });
    if (preview.status !== "previewed" || preview.acceptedMissionHeadOid !== baseOid) {
      throw new Error(`unexpected Mission preview: ${JSON.stringify(preview)}`);
    }
    const accepted = await invoke("mission_plan_accept", {
      planId: ids.plan,
      planRevision: 1,
      decisionPrincipalId: ids.actor,
    });
    if (accepted.status !== "accepted") throw new Error("Mission plan was not accepted");

    let report = await invoke("mission_plan_run", { planId: ids.plan, planRevision: 1 });
    const activationId = report.activation?.activationId;
    if (
      !activationId ||
      report.gateEvidence ||
      JSON.stringify(report.step?.dispatched) !== JSON.stringify([ids.work])
    ) {
      throw new Error(`Mission did not dispatch exactly once: ${JSON.stringify(report)}`);
    }

    const deadline = Date.now() + 12 * 60 * 1000;
    while (!report.gateEvidence && Date.now() < deadline) {
      await sleep(4000);
      report = await invoke("mission_plan_run", { planId: ids.plan, planRevision: 1 });
    }
    const gate = report.gateEvidence;
    if (!gate) throw new Error("Mission visible agent did not produce gate evidence before timeout");

    const events = await invoke("event_recent");
    const spawns = (events || []).filter(
      (event) => event.kind === "agent_spawned" && event.payload?.activationId === activationId,
    );
    const tasks = await invoke("task_list");
    const task = (tasks || []).find((candidate) => candidate.id === ids.work);
    const claims = await invoke("ownership_claims");
    const claim = (claims || []).find(
      (candidate) =>
        (candidate.task_id ?? candidate.taskId) === ids.work && candidate.pattern === ownedTarget,
    );
    const worktree = missionWorktree(report.activation.sourceBranch);
    if (!worktree) throw new Error("Mission isolated worktree could not be resolved");
    const candidateOid = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktree,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const parentOid = execFileSync("git", ["rev-parse", "HEAD^"], {
      cwd: worktree,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    const clean =
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: worktree,
        encoding: "utf8",
        windowsHide: true,
      }).trim() === "";
    const pendingIntents = await invoke("merge_intents_pending").catch(() => []);
    const freshnessObservedAtUnixMs = Date.now();
    const startedAtUnixMs = Number(gate.startedAtUnixMs);
    const endedAtUnixMs = Number(gate.endedAtUnixMs);

    const assertions = {
      oneRealVisibleAgent:
        spawns.length === 1 &&
        Boolean(spawns[0]?.payload?.terminalId) &&
        spawns[0]?.payload?.model === "codex-no-hooks",
      isolatedWorktree: worktree !== root && report.activation.sourceBranch.startsWith("a7-preview/"),
      acceptedPlanBound:
        report.activation.planId === ids.plan &&
        report.activation.planContentDigest === gate.planContentDigest &&
        report.activation.acceptedBaseOid === baseOid,
      generationBound: gate.executionGeneration > 0 && Boolean(gate.agentRunId) && Boolean(gate.ptySessionId),
      ownershipBound: claim?.agent_id === gate.agentRunId || claim?.agentId === gate.agentRunId,
      candidateBound:
        parentOid === baseOid &&
        candidateOid === gate.candidateOid &&
        gate.testedOid === candidateOid &&
        clean,
      gatePassed:
        JSON.stringify(gate.commandArgv) === JSON.stringify(testArgv) &&
        gate.runtimeDomainId === "visible_pty" &&
        gate.result === "passed" &&
        /^[0-9a-f]{64}$/.test(gate.environmentFingerprint ?? "") &&
        /^[0-9a-f]{64}$/.test(gate.evidenceDigest ?? ""),
      freshExecutionEvidence:
        Number.isSafeInteger(startedAtUnixMs) &&
        Number.isSafeInteger(endedAtUnixMs) &&
        endedAtUnixMs >= startedAtUnixMs &&
        freshnessObservedAtUnixMs >= endedAtUnixMs &&
        freshnessObservedAtUnixMs - startedAtUnixMs <= maxEvidenceAgeMs,
      stoppedBeforeReviewMerge:
        task?.status === "review" &&
        report.step?.merged?.length === 0 &&
        pendingIntents.length === 0,
    };
    const failures = Object.entries(assertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    if (failures.length > 0) {
      throw new Error(`A7.2 live assertions failed: ${failures.join(", ")}`);
    }

    const generatedAt = new Date().toISOString();
    const artifact = {
      schema: "aelyris.a7-visible-implementation-live/v1",
      status: "pass",
      attemptedSlice: "A7.2",
      visibleImplementation: {
        realAgentCount: spawns.length,
        runtimeDomainId: gate.runtimeDomainId,
        isolatedWorktree: true,
        acceptedPlanBound: true,
        generationBound: true,
        ownershipBound: true,
        freshActivation: true,
        hooksEnabled: false,
        terminalId: spawns[0].payload.terminalId,
        agentRunId: gate.agentRunId,
        executionGeneration: gate.executionGeneration,
      },
      candidate: {
        baseOid,
        candidateOid,
        testedOid: gate.testedOid,
        cleanWorktree: clean,
        worktree,
      },
      gate: {
        gateId: gate.gateId,
        contractVersion: gate.contractVersion,
        planContentDigest: gate.planContentDigest,
        commandArgv: gate.commandArgv,
        commandFingerprint: gate.commandFingerprint,
        environmentFingerprint: gate.environmentFingerprint,
        result: gate.result,
        evidenceDigest: gate.evidenceDigest,
        startedAtUnixMs,
        endedAtUnixMs,
        freshnessObservedAtUnixMs,
        freshnessMaxAgeMs: maxEvidenceAgeMs,
      },
      boundary: {
        independentReviewStarted: false,
        mergeIntentCreated: false,
        merged: false,
        completionPacketCreated: false,
        taskStatus: task.status,
      },
      generatedAt,
      provenance: createEvidenceProvenance({
        root,
        verifierPath: "scripts/verify-a7-visible-implementation-live.mjs",
        inputPaths: [
          "src-tauri/src/task/mission.rs",
          "src-tauri/src/task/manager.rs",
          "src-tauri/src/persistence/task_repo.rs",
          "src-tauri/src/db/mod.rs",
          "src-tauri/src/db/migrations.rs",
          "src-tauri/src/control/loop_ports.rs",
          "src-tauri/src/control/gate_runner.rs",
          "src-tauri/src/control/pane_fleet.rs",
          "src-tauri/src/control/worktree.rs",
          "src-tauri/src/git/worktree.rs",
          "src-tauri/src/agent/interactive.rs",
          "src-tauri/src/ipc/orchestrator_commands.rs",
          "src-tauri/src/lib.rs",
          "src-tauri/src/startup_reconciliation.rs",
          "src-tauri/src/task/mod.rs",
          "scripts/verify-a7-visible-implementation-live.mjs",
        ],
        generatedAt,
      }),
    };
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(JSON.stringify({ artifact: artifactPath, ...artifact }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
