import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance, currentGitHead, validateEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const verifierPath = "scripts/verify-a6-combined-acceptance.mjs";
const workflowPath = ".github/workflows/ci.yml";
const workflowName = "CI";
const inventoryArtifactPath = ".codex-auto/quality/a6-modularity-inventory.json";
const artifactPath = join(root, ".codex-auto", "quality", "a6-combined-acceptance.json");
const modularityAggregateTimeoutMs = 720_000;
const requiredDependencyJobs = ["frontend", "rendered-ui-trust", "a6-frontend-acceptance", "rust"];
const combinedJobDisplayName = "A6.8 combined hosted candidate";
const requiredJobDisplayNames = {
  frontend: "Frontend (tsc + vitest)",
  "rendered-ui-trust": "Rendered UI trust (Playwright)",
  "a6-frontend-acceptance": "A6.2 combined frontend acceptance",
  rust: "Rust (cargo test --lib)",
  "a6-combined-acceptance": combinedJobDisplayName,
};
const expectedOwnerPaths = [
  "src/App.tsx",
  "src/features/right-rail/rightRailModel.tsx",
  "src-tauri/src/ipc/commands.rs",
  "src-tauri/src/api/mcp.rs",
  "src-tauri/src/db/queries.rs",
  "src-tauri/src/aelyris_native.rs",
];
const head = currentGitHead(root);
const scenarios = [];
let failed = false;

function parseCliArgs(args) {
  if (args.length === 0) return { ok: true, mode: "normal", runId: null, error: null };
  if (args.length !== 2 || args[0] !== "--github-run-id" || !/^[1-9]\d*$/.test(args[1])) {
    return {
      ok: false,
      mode: "invalid",
      runId: null,
      error: "Expected no arguments or --github-run-id <positive numeric id>.",
    };
  }
  try {
    if (BigInt(args[1]) <= 0n) throw new Error("non-positive");
  } catch {
    return { ok: false, mode: "invalid", runId: null, error: "GitHub run id must be a positive integer." };
  }
  return { ok: true, mode: "github-closeout", runId: args[1], error: null };
}

const cli = parseCliArgs(process.argv.slice(2));
if (!cli.ok) {
  console.error(cli.error);
  process.exit(2);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function record(id, ok, evidence = {}) {
  scenarios.push({ id, status: ok ? "pass" : "fail", ...evidence });
  failed ||= !ok;
}

function runModularityAggregate() {
  const startedAt = Date.now();
  const program = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm.cmd verify:a6:modularity-inventory"]
      : ["verify:a6:modularity-inventory"];
  const result = spawnSync(program, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    timeout: modularityAggregateTimeoutMs,
  });
  const ok = result.status === 0 && !result.error;
  record("current-default-modularity-aggregate", ok, {
    command: "pnpm verify:a6:modularity-inventory",
    timeoutMs: modularityAggregateTimeoutMs,
    durationMs: Date.now() - startedAt,
    exitCode: result.status,
    signal: result.signal,
    error: result.error instanceof Error ? result.error.message : result.error ? String(result.error) : null,
  });
}

function extractJobBlock(workflow, jobId) {
  const header = `  ${jobId}:`;
  const lines = workflow.split(/\r?\n/);
  const startIndexes = lines.map((line, index) => (line === header ? index : -1)).filter((index) => index >= 0);
  if (startIndexes.length !== 1) return { count: startIndexes.length, block: "" };
  const start = startIndexes[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { count: 1, block: lines.slice(start, end).join("\n") };
}

function inspectBlockingCiJob(workflow) {
  const { count, block } = extractJobBlock(workflow, "a6-combined-acceptance");
  const needsMatch = block.match(/^ {4}needs:\s*\[([^\]]+)\]\s*$/m);
  const needs = needsMatch?.[1].split(",").map((value) => value.trim()) ?? [];
  const exactNeeds =
    needs.length === requiredDependencyJobs.length &&
    requiredDependencyJobs.every((job, index) => needs[index] === job);
  const checks = {
    exactlyOneJob: count === 1,
    candidateDisplayName: block.split("\n").includes(`    name: ${combinedJobDisplayName}`),
    exactNeeds,
    runsAfterAllOutcomes: /^ {4}if: always\(\)$/m.test(block),
    nonAdvisory: !block.includes("continue-on-error:"),
    contextFlag: block.includes('AELYRIS_A6_COMBINED_CI_CONTEXT: "1"'),
    needsPayload: block.includes("AELYRIS_A6_COMBINED_NEEDS_JSON: $" + "{{ toJSON(needs) }}"),
    candidateStepName: block.includes("- name: Hosted A6.8 candidate validation"),
    ordinaryPackageCommand:
      block.includes("run: pnpm verify:a6:combined-acceptance") && !block.includes("--github-run-id"),
    pinnedRustToolchain: block.includes(
      "uses: dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30 # stable",
    ),
    rustCache: block.includes("uses: Swatinem/rust-cache@42dc69e1aa15d09112580998cf2ef0119e2e91ae # v2"),
    exactShaArtifactName: block.includes("name: a6-combined-acceptance-$" + "{{ github.sha }}"),
    pinnedArtifactUpload: block.includes("uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4"),
    combinedArtifactUploaded: block.includes(".codex-auto/quality/a6-combined-acceptance.json"),
    modularityArtifactUploaded: block.includes(".codex-auto/quality/a6-modularity-inventory.json"),
    missingArtifactFails: block.includes("if-no-files-found: error"),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    needs,
    jobCount: count,
  };
}

function parseNeedsPayload(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, results: {}, error: "missing-needs-payload" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, results: {}, error: "invalid-needs-payload-shape" };
    }
    const keys = Object.keys(parsed).sort();
    const expectedKeys = [...requiredDependencyJobs].sort();
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
      return {
        ok: false,
        results: Object.fromEntries(keys.map((key) => [key, parsed[key]?.result ?? null])),
        error: "dependency-job-set-mismatch",
      };
    }
    const results = Object.fromEntries(requiredDependencyJobs.map((job) => [job, parsed[job]?.result ?? null]));
    if (requiredDependencyJobs.some((job) => results[job] !== "success")) {
      return { ok: false, results, error: "dependency-job-not-successful" };
    }
    return { ok: true, results, error: null };
  } catch {
    return { ok: false, results: {}, error: "invalid-needs-payload-json" };
  }
}

function evaluateHostedCandidate(env, expectedHead) {
  const needs = parseNeedsPayload(env.AELYRIS_A6_COMBINED_NEEDS_JSON);
  const checks = {
    githubActions: env.GITHUB_ACTIONS === "true",
    workflow: env.GITHUB_WORKFLOW === "CI",
    a68Context: env.AELYRIS_A6_COMBINED_CI_CONTEXT === "1",
    exactHead: env.GITHUB_SHA === expectedHead,
    dependencies: needs.ok,
  };
  return {
    accepted: Object.values(checks).every(Boolean),
    hostedAttempt: checks.githubActions,
    checks,
    dependencyResults: needs.results,
    error: needs.error,
  };
}

function authoritativeCompletion({ localComplete, closeoutRequested, externalRunVerified, worktreeClean }) {
  return localComplete && closeoutRequested && externalRunVerified && worktreeClean;
}

function inspectGitWorktree() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return {
      checked: true,
      clean: false,
      entryCount: null,
      error: "git-worktree-status-command-failed",
      exitCode: result.status,
      failureCode: result.error?.code ?? null,
    };
  }
  const output = typeof result.stdout === "string" ? result.stdout : "";
  const clean = output === "";
  return {
    checked: true,
    clean,
    entryCount: clean ? 0 : output.replace(/\r?\n$/, "").split(/\r?\n/).length,
    error: clean ? null : "git-worktree-dirty",
    exitCode: result.status,
    failureCode: null,
  };
}

function runGhJson(args, stage) {
  const result = spawnSync("gh", args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      value: null,
      error: `${stage}-command-failed`,
      exitCode: result.status,
      failureCode: result.error?.code ?? null,
    };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout), error: null, exitCode: result.status, failureCode: null };
  } catch {
    return {
      ok: false,
      value: null,
      error: `${stage}-invalid-json`,
      exitCode: result.status,
      failureCode: null,
    };
  }
}

function verifyExternalGithubRun(runId, expectedHead) {
  const worktree = inspectGitWorktree();
  if (!worktree.clean) {
    return {
      verified: false,
      error: worktree.error,
      worktree,
      checks: { worktreeClean: false },
      repository: null,
      run: null,
      jobs: [],
    };
  }

  const repoResult = runGhJson(["repo", "view", "--json", "nameWithOwner,url"], "github-repository");
  if (!repoResult.ok)
    return {
      verified: false,
      error: repoResult.error,
      worktree,
      checks: { worktreeClean: true },
      repository: null,
      run: null,
      jobs: [],
    };

  const repository = repoResult.value;
  const nameWithOwner = repository?.nameWithOwner;
  if (
    typeof nameWithOwner !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(nameWithOwner) ||
    typeof repository?.url !== "string"
  ) {
    return {
      verified: false,
      error: "github-repository-shape-mismatch",
      worktree,
      checks: { worktreeClean: true },
      repository: null,
      run: null,
      jobs: [],
    };
  }

  const [owner, repo] = nameWithOwner.split("/");
  const apiRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const runResult = runGhJson(["api", `repos/${apiRepository}/actions/runs/${runId}`], "github-run");
  if (!runResult.ok) {
    return {
      verified: false,
      error: runResult.error,
      worktree,
      checks: { worktreeClean: true },
      repository: { nameWithOwner, url: repository.url },
      run: null,
      jobs: [],
    };
  }
  const jobsResult = runGhJson(
    ["api", `repos/${apiRepository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`],
    "github-run-jobs",
  );
  if (!jobsResult.ok) {
    return {
      verified: false,
      error: jobsResult.error,
      worktree,
      checks: { worktreeClean: true },
      repository: { nameWithOwner, url: repository.url },
      run: null,
      jobs: [],
    };
  }

  const run = runResult.value;
  const jobsPayload = jobsResult.value;
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  const runAttempt = run?.run_attempt;
  const repositoryIdentity = String(run?.repository?.full_name ?? "").toLowerCase() === nameWithOwner.toLowerCase();
  const runChecks = {
    repositoryIdentity,
    workflowName: run?.name === workflowName,
    workflowPath: run?.path === workflowPath,
    runId: String(run?.id ?? "") === runId,
    completed: run?.status === "completed",
    exactHead: run?.head_sha === expectedHead,
    attempt: Number.isInteger(runAttempt) && runAttempt > 0,
    runUrl: typeof run?.html_url === "string" && run.html_url.length > 0,
    completeJobList:
      Number.isInteger(jobsPayload?.total_count) &&
      jobsPayload.total_count === jobs.length &&
      jobsPayload.total_count <= 100,
  };
  const jobResults = Object.entries(requiredJobDisplayNames).map(([jobId, displayName]) => {
    const matches = jobs.filter((job) => job?.name === displayName);
    const job = matches[0];
    return {
      jobId,
      displayName,
      matchCount: matches.length,
      id: Number.isSafeInteger(job?.id) ? job.id : null,
      status: job?.status ?? null,
      conclusion: job?.conclusion ?? null,
      runAttempt: job?.run_attempt ?? null,
      url: typeof job?.html_url === "string" ? job.html_url : null,
      accepted:
        matches.length === 1 &&
        Number.isSafeInteger(job?.id) &&
        job.status === "completed" &&
        job.conclusion === "success" &&
        job.run_attempt === runAttempt &&
        typeof job.html_url === "string" &&
        job.html_url.length > 0,
    };
  });
  const checks = {
    worktreeClean: worktree.clean,
    ...runChecks,
    requiredJobs: jobResults.every((job) => job.accepted),
  };
  return {
    verified: Object.values(checks).every(Boolean),
    error: Object.values(checks).every(Boolean) ? null : "github-run-verification-failed",
    worktree,
    checks,
    repository: { nameWithOwner, url: repository.url },
    run: {
      id: String(run?.id ?? ""),
      attempt: Number.isInteger(runAttempt) ? runAttempt : null,
      url: typeof run?.html_url === "string" ? run.html_url : null,
      workflowName: run?.name ?? null,
      workflowPath: run?.path ?? null,
      status: run?.status ?? null,
      conclusion: run?.conclusion ?? null,
      headSha: run?.head_sha ?? null,
      repository: run?.repository?.full_name ?? null,
    },
    jobs: jobResults,
  };
}

function validateInventory(inventory) {
  const provenance = validateEvidenceProvenance({ root, artifact: inventory, gitHead: head });
  const ownerPaths = inventory.owners?.map((owner) => owner.path) ?? [];
  const ownersCurrent =
    ownerPaths.length === expectedOwnerPaths.length &&
    expectedOwnerPaths.every((path, index) => ownerPaths[index] === path) &&
    inventory.owners.every(
      (owner) =>
        owner.status === "pass" &&
        Number.isInteger(owner.lines) &&
        Number.isInteger(owner.baselineLines) &&
        owner.lines <= owner.baselineLines,
    );
  const sliceFields = [
    ["A6.2", inventory.frontendSlice],
    ["A6.3", inventory.ipcSlice],
    ["A6.4", inventory.mcpSlice],
    ["A6.5", inventory.dbSlice],
    ["A6.6", inventory.nativeSlice],
    ["A6.7", inventory.a67Slice],
  ];
  const slicesCurrent = sliceFields.every(
    ([id, slice]) =>
      slice?.id === id && slice.status === "pass" && slice.sliceComplete === true && slice.phaseComplete !== true,
  );
  const sliceNegativeProofsCurrent =
    Object.values(inventory.mcpSlice?.negativeDriftProof ?? {}).length > 0 &&
    Object.values(inventory.mcpSlice.negativeDriftProof).every(Boolean) &&
    Object.values(inventory.dbSlice?.negativeTopologyProof ?? {}).length > 0 &&
    Object.values(inventory.dbSlice.negativeTopologyProof).every(Boolean) &&
    Object.values(inventory.nativeSlice?.negativeTopologyProof ?? {}).length > 0 &&
    Object.values(inventory.nativeSlice.negativeTopologyProof).every(Boolean) &&
    Object.values(inventory.a67Slice?.negativeReachabilityProof ?? {}).length > 0 &&
    Object.values(inventory.a67Slice.negativeReachabilityProof).every(Boolean);
  const globalCurrent =
    inventory.schema === "aelyris.a6-modularity-inventory/v3" &&
    inventory.status === "pass-a6.1-inventory-frozen" &&
    inventory.sliceComplete === true &&
    inventory.phaseComplete === false &&
    inventory.evaluation?.mode === "global" &&
    inventory.evaluation?.requestedSlice === null &&
    inventory.evaluation?.commandStatus === "passed" &&
    inventory.evaluation?.globalStatus === "passed" &&
    inventory.globalAggregation?.status === "pass";
  const negativeProofCurrent =
    inventory.globalAggregation?.negativeProof?.sameLineCountIpcEventRegistryMutationRejected === true &&
    inventory.globalAggregation?.negativeProof?.mutation?.target === "ipc.eventRegistry.complete" &&
    inventory.globalAggregation?.negativeProof?.mutation?.before === true &&
    inventory.globalAggregation?.negativeProof?.mutation?.after === false &&
    inventory.globalAggregation?.negativeProof?.mutation?.commandsLinesBefore ===
      inventory.globalAggregation?.negativeProof?.mutation?.commandsLinesAfter;
  return {
    ok:
      provenance.ok &&
      ownersCurrent &&
      slicesCurrent &&
      sliceNegativeProofsCurrent &&
      globalCurrent &&
      negativeProofCurrent,
    provenance,
    ownersCurrent,
    slicesCurrent,
    sliceNegativeProofsCurrent,
    globalCurrent,
    negativeProofCurrent,
    sliceStatuses: Object.fromEntries(sliceFields.map(([id, slice]) => [id, slice?.status ?? "missing"])),
  };
}

runModularityAggregate();

const workflow = read(workflowPath);
const workflowContract = inspectBlockingCiJob(workflow);
record("blocking-ci-job-contract", workflowContract.ok, workflowContract);

const cliParserProof = {
  normalAccepted: parseCliArgs([]).ok && parseCliArgs([]).mode === "normal",
  numericRunIdAccepted:
    parseCliArgs(["--github-run-id", "123456789"]).ok &&
    parseCliArgs(["--github-run-id", "123456789"]).runId === "123456789",
  missingRunIdRejected: !parseCliArgs(["--github-run-id"]).ok,
  zeroRunIdRejected: !parseCliArgs(["--github-run-id", "0"]).ok,
  nonNumericRunIdRejected: !parseCliArgs(["--github-run-id", "run-123"]).ok,
  extraArgumentRejected: !parseCliArgs(["--github-run-id", "123", "extra"]).ok,
};
record("closeout-cli-parser-proof", Object.values(cliParserProof).every(Boolean), { cliParserProof });

let inventory = null;
try {
  inventory = readJson(inventoryArtifactPath);
  const inventoryValidation = validateInventory(inventory);
  record("current-a6.2-a6.7-inventory", inventoryValidation.ok, inventoryValidation);
} catch (error) {
  record("current-a6.2-a6.7-inventory", false, {
    error: error instanceof Error ? error.message : String(error),
  });
}

const successfulNeeds = Object.fromEntries(
  requiredDependencyJobs.map((job) => [job, { result: "success", outputs: {} }]),
);
const validHostedEnvironment = {
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: "CI",
  GITHUB_SHA: head,
  AELYRIS_A6_COMBINED_CI_CONTEXT: "1",
  AELYRIS_A6_COMBINED_NEEDS_JSON: JSON.stringify(successfulNeeds),
};
const missingDependencyNeeds = structuredClone(successfulNeeds);
delete missingDependencyNeeds.rust;
const failedDependencyNeeds = structuredClone(successfulNeeds);
failedDependencyNeeds.rust.result = "failure";
const extraDependencyNeeds = { ...successfulNeeds, advisory: { result: "success", outputs: {} } };
const syntheticHostedCandidate = evaluateHostedCandidate(validHostedEnvironment, head);
const negativeProof = {
  validHostedCandidateAccepted: syntheticHostedCandidate.accepted,
  missingDependencyRejected: !evaluateHostedCandidate(
    {
      ...validHostedEnvironment,
      AELYRIS_A6_COMBINED_NEEDS_JSON: JSON.stringify(missingDependencyNeeds),
    },
    head,
  ).accepted,
  failedDependencyRejected: !evaluateHostedCandidate(
    {
      ...validHostedEnvironment,
      AELYRIS_A6_COMBINED_NEEDS_JSON: JSON.stringify(failedDependencyNeeds),
    },
    head,
  ).accepted,
  extraDependencyRejected: !evaluateHostedCandidate(
    {
      ...validHostedEnvironment,
      AELYRIS_A6_COMBINED_NEEDS_JSON: JSON.stringify(extraDependencyNeeds),
    },
    head,
  ).accepted,
  nonGithubActionsCandidateRejected: !evaluateHostedCandidate(
    { ...validHostedEnvironment, GITHUB_ACTIONS: "false" },
    head,
  ).accepted,
  shaMismatchRejected: !evaluateHostedCandidate({ ...validHostedEnvironment, GITHUB_SHA: "0".repeat(40) }, head)
    .accepted,
  syntheticHostedCandidateCannotAuthorizeCompletion:
    syntheticHostedCandidate.accepted &&
    !authoritativeCompletion({
      localComplete: true,
      closeoutRequested: false,
      externalRunVerified: false,
      worktreeClean: true,
    }),
  dirtyWorktreeCannotAuthorizeCompletion: !authoritativeCompletion({
    localComplete: true,
    closeoutRequested: true,
    externalRunVerified: true,
    worktreeClean: false,
  }),
};
record("hosted-context-negative-proof", Object.values(negativeProof).every(Boolean), { negativeProof });

const hostedCandidate = evaluateHostedCandidate(process.env, head);
if (hostedCandidate.hostedAttempt) {
  record("hosted-ci-candidate-context", hostedCandidate.accepted, hostedCandidate);
} else {
  scenarios.push({
    id: "hosted-ci-candidate-context",
    status: "not-observed",
    ...hostedCandidate,
    detail: "Local execution cannot claim a hosted CI candidate or authoritative completion.",
  });
}

const localComplete = !failed;
let externalCloseout = {
  requested: cli.mode === "github-closeout",
  verified: false,
  error: null,
  worktree: {
    checked: false,
    clean: false,
    entryCount: null,
    error: null,
    exitCode: null,
    failureCode: null,
  },
  checks: {},
  repository: null,
  run: null,
  jobs: [],
};
if (externalCloseout.requested && localComplete) {
  externalCloseout = {
    requested: true,
    ...verifyExternalGithubRun(cli.runId, head),
  };
  record("external-github-run-closeout", externalCloseout.verified, externalCloseout);
} else if (externalCloseout.requested) {
  externalCloseout.error = "local-proof-failed-before-external-closeout";
  record("external-github-run-closeout", false, externalCloseout);
} else {
  scenarios.push({
    id: "external-github-run-closeout",
    status: "not-run",
    ...externalCloseout,
    detail: "External closeout requires --github-run-id <numeric id> after the hosted run concludes.",
  });
}

const hostedCandidateAccepted = localComplete && hostedCandidate.accepted;
const hostedComplete = authoritativeCompletion({
  localComplete,
  closeoutRequested: externalCloseout.requested,
  externalRunVerified: externalCloseout.verified,
  worktreeClean: externalCloseout.worktree.clean,
});
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a6-combined-acceptance/v1",
  status: failed
    ? "failed"
    : hostedComplete
      ? "pass-a6.8-externally-verified"
      : hostedCandidateAccepted
        ? "pass-hosted-candidate-awaiting-run-conclusion"
        : "pass-local-awaiting-hosted-ci",
  localComplete,
  hostedCandidateAccepted,
  hostedComplete,
  sliceComplete: hostedComplete,
  completedSlice: hostedComplete ? "A6.8" : "A6.7",
  activeSlice: hostedComplete ? "A7.0" : "A6.8",
  phaseComplete: hostedComplete,
  a6ModularityPhaseComplete: inventory?.phaseComplete ?? null,
  requiredDependencyJobs,
  requiredJobDisplayNames,
  hostedCi: {
    required: true,
    observedCandidateContext: hostedCandidate.accepted,
    authoritativeCompletionRequiresExternalCloseout: true,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    sha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    dependencyResults: hostedCandidate.dependencyResults,
    checks: hostedCandidate.checks,
  },
  externalCloseout,
  negativeProof,
  scenarios,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath,
    inputPaths: [
      "package.json",
      "scripts/evidence-provenance.mjs",
      verifierPath,
      "scripts/verify-a6-modularity-inventory.mjs",
      workflowPath,
      inventoryArtifactPath,
    ],
    generatedAt,
  }),
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: artifactPath, ...report }, null, 2));
if (failed) process.exit(1);
