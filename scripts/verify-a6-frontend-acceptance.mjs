import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance, currentGitHead, validateEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifactPath = join(root, ".codex-auto", "quality", "a6-frontend-acceptance.json");
const workflowPath = ".github/workflows/ci.yml";
const ratchetArtifactPath = ".codex-auto/quality/a6-frontend-ratchet.json";
const inventoryArtifactPath = ".codex-auto/quality/a6-modularity-inventory.json";
const uiTrustArtifactPath = ".codex-auto/quality/ui-trust-contract.json";
const head = currentGitHead(root);
const scenarios = [];
let failed = false;

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function runPnpm(id, args, timeoutMs) {
  const startedAt = Date.now();
  try {
    const program = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", ["pnpm.cmd", ...args].join(" ")] : args;
    execFileSync(program, commandArgs, {
      cwd: root,
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
      timeout: timeoutMs,
    });
    scenarios.push({
      id,
      status: "pass",
      command: `pnpm ${args.join(" ")}`,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    failed = true;
    scenarios.push({
      id,
      status: "fail",
      command: `pnpm ${args.join(" ")}`,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

runPnpm("production-build", ["run", "build"], 300_000);
runPnpm("a3-ui-trust-contract", ["run", "verify:ui:trust"], 180_000);
runPnpm("frontend-ratchet", ["run", "verify:a6:frontend-ratchet"], 300_000);
runPnpm("frontend-modularity-slice", ["run", "verify:a6:modularity-inventory:frontend"], 120_000);

const workflow = read(workflowPath);
const job = workflow.split("\n  a6-frontend-acceptance:")[1]?.split("\n  rust:")[0] ?? "";
const ciContract =
  job.length > 0 &&
  job.includes("needs: [frontend, rendered-ui-trust]") &&
  !job.includes("continue-on-error: true") &&
  job.includes("run: pnpm verify:a6:frontend-acceptance") &&
  job.includes('AELYRIS_A6_BLOCKING_CI_CONTEXT: "1"') &&
  job.includes("name: a6-frontend-acceptance-$" + "{{ github.sha }}") &&
  job.includes("if-no-files-found: error");
scenarios.push({
  id: "blocking-ci-contract",
  status: ciContract ? "pass" : "fail",
  needs: ["frontend", "rendered-ui-trust"],
});
failed ||= !ciContract;

let ratchet = null;
let inventory = null;
let uiTrust = null;
try {
  ratchet = readJson(ratchetArtifactPath);
  inventory = readJson(inventoryArtifactPath);
  uiTrust = readJson(uiTrustArtifactPath);
} catch (error) {
  failed = true;
  scenarios.push({
    id: "child-artifacts-readable",
    status: "fail",
    error: error instanceof Error ? error.message : String(error),
  });
}

if (ratchet && inventory && uiTrust) {
  const ratchetProvenance = validateEvidenceProvenance({ root, artifact: ratchet, gitHead: head });
  const inventoryProvenance = validateEvidenceProvenance({
    root,
    artifact: inventory,
    gitHead: head,
  });
  const uiTrustProvenance = validateEvidenceProvenance({ root, artifact: uiTrust, gitHead: head });
  const ratchetAccepted =
    ratchet.status === "pass-a6.2f-owner-split-stop-audit" &&
    ratchet.completedSlice === "A6.2f" &&
    ratchet.activeSlice === "A6.2g" &&
    ratchet.sliceComplete === false &&
    ratchet.phaseComplete === false &&
    ratchetProvenance.ok;
  const inventoryAccepted =
    inventory.schema === "aelyris.a6-modularity-inventory/v2" &&
    inventory.frontendSlice?.id === "A6.2" &&
    inventory.frontendSlice?.status === "pass" &&
    inventory.frontendSlice?.sliceComplete === true &&
    inventory.evaluation?.requestedSlice === "A6.2" &&
    inventory.evaluation?.commandStatus === "passed" &&
    inventory.phaseComplete === false &&
    inventoryProvenance.ok;
  const failedInventoryOwners = inventory.owners?.filter((owner) => owner.status === "fail") ?? [];
  const globalInventoryTruthPreserved =
    failedInventoryOwners.every((owner) => owner.nextSlice !== "A6.2") &&
    (failedInventoryOwners.length > 0
      ? inventory.status === "failed" &&
        inventory.sliceComplete === false &&
        inventory.evaluation?.globalStatus === "failed"
      : inventory.status === "pass-a6.1-inventory-frozen" &&
        inventory.sliceComplete === true &&
        inventory.evaluation?.globalStatus === "passed");
  const uiTrustAccepted =
    uiTrust.ok === true && uiTrust.status === "passed" && uiTrust.failedChecks?.length === 0 && uiTrustProvenance.ok;

  for (const [id, ok, evidence] of [
    ["frontend-ratchet-artifact", ratchetAccepted, { provenanceErrors: ratchetProvenance.errors }],
    ["frontend-inventory-artifact", inventoryAccepted, { provenanceErrors: inventoryProvenance.errors }],
    [
      "global-inventory-truth-preserved",
      globalInventoryTruthPreserved,
      {
        globalStatus: inventory.status,
        blockedOwners: failedInventoryOwners.map((owner) => owner.path),
      },
    ],
    ["a3-ui-trust-artifact", uiTrustAccepted, { provenanceErrors: uiTrustProvenance.errors }],
  ]) {
    scenarios.push({ id, status: ok ? "pass" : "fail", ...evidence });
    failed ||= !ok;
  }
}

const githubActions = process.env.GITHUB_ACTIONS === "true";
const blockingCiContext =
  githubActions &&
  process.env.AELYRIS_A6_BLOCKING_CI_CONTEXT === "1" &&
  process.env.GITHUB_WORKFLOW === "CI" &&
  process.env.GITHUB_SHA === head;
if (githubActions && !blockingCiContext) {
  failed = true;
  scenarios.push({
    id: "blocking-ci-runtime-context",
    status: "fail",
    detail: "GitHub Actions execution did not match the blocking CI workflow and current HEAD.",
  });
} else {
  scenarios.push({
    id: "blocking-ci-runtime-context",
    status: blockingCiContext ? "pass" : "not-observed",
    detail: blockingCiContext
      ? "The combined gate is running after the blocking frontend and rendered-ui-trust jobs."
      : "Local proof cannot claim hosted CI completion.",
  });
}

const localComplete = !failed;
const frontendComplete = localComplete && blockingCiContext;
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a6-frontend-acceptance/v1",
  status: failed
    ? "failed"
    : frontendComplete
      ? "pass-a6.2g-combined-frontend-acceptance"
      : "pass-local-awaiting-hosted-ci",
  localComplete,
  frontendComplete,
  sliceComplete: frontendComplete,
  completedSlice: frontendComplete ? "A6.2g" : "A6.2f",
  activeSlice: frontendComplete ? "A6.3" : "A6.2g",
  phaseComplete: false,
  hostedCi: {
    required: true,
    observedBlockingRunContext: blockingCiContext,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    sha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
  },
  scenarios,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a6-frontend-acceptance.mjs",
    inputPaths: [
      "package.json",
      "scripts/evidence-provenance.mjs",
      "scripts/verify-a6-frontend-acceptance.mjs",
      "scripts/verify-a6-frontend-ratchet.mjs",
      "scripts/verify-a6-modularity-inventory.mjs",
      "scripts/verify-ui-trust-contract.mjs",
      workflowPath,
      ratchetArtifactPath,
      inventoryArtifactPath,
      uiTrustArtifactPath,
    ],
    generatedAt,
  }),
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: artifactPath, ...report }, null, 2));
if (failed) process.exit(1);
