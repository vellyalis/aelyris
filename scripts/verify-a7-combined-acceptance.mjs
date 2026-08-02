import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createEvidenceProvenance, currentGitHead } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const verifierPath = "scripts/verify-a7-combined-acceptance.mjs";
const workflowPath = ".github/workflows/ci.yml";
const workflowName = "CI";
const designPath = "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md";
const artifactPath = join(root, ".codex-auto", "quality", "a7-combined-acceptance.json");
const combinedJobId = "a7-combined-acceptance";
const combinedJobDisplayName = "A7.5 Core Mission combined hosted candidate";
const requiredDependencyJobs = ["frontend", "rust"];
const requiredJobDisplayNames = {
  frontend: "Frontend (tsc + vitest)",
  rust: "Rust (cargo test --lib)",
  [combinedJobId]: combinedJobDisplayName,
};
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

function readOptionalJson(path) {
  try {
    return { exists: true, value: readJson(path), error: null };
  } catch (error) {
    return {
      exists: existsSync(join(root, path)),
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function record(id, ok, evidence = {}) {
  scenarios.push({ id, status: ok ? "pass" : "fail", ...evidence });
  failed ||= !ok;
}

function git(args, options = {}) {
  return spawnSync("git", args, {
    cwd: root,
    env: process.env,
    encoding: options.encoding ?? "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function gitText(args) {
  const result = git(args);
  if (result.error || result.status !== 0) return null;
  return String(result.stdout).trim();
}

function exact(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function parseContract() {
  const match = read(designPath).match(
    /<!-- A7_5_COMBINED_ACCEPTANCE_CONTRACT_V1_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- A7_5_COMBINED_ACCEPTANCE_CONTRACT_V1_END -->/,
  );
  if (!match) return { contract: null, error: "missing A7.5 combined acceptance contract" };
  try {
    return { contract: JSON.parse(match[1]), error: null };
  } catch (error) {
    return { contract: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function validateContract(contract, error) {
  const expectedCommand = [
    "cargo",
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "a7_",
    "--",
    "--nocapture",
  ];
  const expectedSequence = [
    "accepted_versioned_plan_preview",
    "visible_pty_implementation",
    "fresh_exact_oid_test",
    "independent_exact_oid_review",
    "isolated_exact_oid_accept_merge",
    "immutable_completed_work_packet",
    "exact_mission_completion_packet",
  ];
  const checks = {
    parsed: error === null,
    schema: contract?.schema === "aelyris.a7_5_combined_acceptance_contract/v1",
    version: contract?.contractVersion === 1,
    proofCommand: contract?.proofCommand === "pnpm verify:a7:combined-acceptance",
    sequence: exact(contract?.requiredSequence, expectedSequence),
    sourceCommand: exact(contract?.currentSourceProof?.commandArgv, expectedCommand),
    minimumTests:
      Number.isSafeInteger(contract?.currentSourceProof?.minimumExecutedTests) &&
      contract.currentSourceProof.minimumExecutedTests >= 35,
    namedPositive:
      contract?.currentSourceProof?.positiveTest ===
      "task::manager::tests::a7_4_completed_settlement_consumes_latest_a7_3_evidence_atomically",
    namedNegative:
      contract?.currentSourceProof?.negativeTest ===
      "task::manager::tests::a7_5_changed_candidate_after_test_emits_zero_credit_blocked_continuation",
    liveEvidenceRequired: contract?.historicalLiveEvidence?.localEvidenceRequiredForAuthoritativeCloseout === true,
    ciJob:
      contract?.blockingCi?.workflow === workflowName &&
      contract?.blockingCi?.jobId === combinedJobId &&
      contract?.blockingCi?.jobDisplayName === combinedJobDisplayName,
    ciDependencies: exact(contract?.blockingCi?.requiredDependencyJobs, requiredDependencyJobs),
    ciCloseout: contract?.blockingCi?.authoritativeCompletionRequiresExternalCloseout === true,
    negativeScenario:
      contract?.negativeScenario?.scenarioId === "a7-core-stale-tested-oid-v1" &&
      contract?.negativeScenario?.requiredPacket === "aelyris.blocked_work_packet/v1" &&
      contract?.negativeScenario?.blockerClass === "repo" &&
      contract?.negativeScenario?.exactNextActionKind === "reprove" &&
      contract?.negativeScenario?.exactNextActionOwner === "task-manager" &&
      contract?.negativeScenario?.completionCredit === false &&
      contract?.negativeScenario?.missionState === "blocked" &&
      contract?.negativeScenario?.a7PhaseComplete === false,
    noPrematureClaims: contract?.phaseComplete === false && contract?.releaseReady === false,
  };
  return { ok: Object.values(checks).every(Boolean), checks, error };
}

function runCurrentSourceProof(contract) {
  const commandArgv = contract.currentSourceProof.commandArgv;
  const program = process.platform === "win32" ? "cargo.exe" : commandArgv[0];
  const args = commandArgv.slice(1);
  const startedAt = Date.now();
  const result = spawnSync(program, args, {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 900_000,
    maxBuffer: 30 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const executedTests = [...stdout.matchAll(/running (\d+) tests?/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  const passedNames = [...stdout.matchAll(/^test ([^\r\n]+) \.\.\. ok$/gm)].map((match) => match[1]);
  const requiredTests = [
    "task::manager::tests::a7_preview_accept_and_restart_are_durable_but_leave_taskgraph_inert",
    "agent::interactive::tests::a7_2_visible_codex_route_disables_user_hooks",
    "review::mission::tests::a7_3_exact_clause_coverage_accepts_only_fresh_tested_oid",
    contract.currentSourceProof.positiveTest,
    contract.currentSourceProof.negativeTest,
  ];
  const missingTests = requiredTests.filter((name) => !passedNames.includes(name));
  return {
    ok:
      result.status === 0 &&
      !result.error &&
      executedTests >= contract.currentSourceProof.minimumExecutedTests &&
      missingTests.length === 0,
    command: commandArgv.join(" "),
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    executedTests,
    requiredTests,
    missingTests,
    error: result.error instanceof Error ? result.error.message : result.error ? String(result.error) : null,
    stdoutTail: stdout.trim().split(/\r?\n/).slice(-24),
    stderrTail: stderr.trim().split(/\r?\n/).slice(-24),
  };
}

function extractJobBlock(workflow, jobId) {
  const header = `  ${jobId}:`;
  const lines = workflow.split(/\r?\n/);
  const starts = lines.map((line, index) => (line === header ? index : -1)).filter((index) => index >= 0);
  if (starts.length !== 1) return { count: starts.length, block: "" };
  const start = starts[0];
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
  const { count, block } = extractJobBlock(workflow, combinedJobId);
  const needsMatch = block.match(/^ {4}needs:\s*\[([^\]]+)\]\s*$/m);
  const needs = needsMatch?.[1].split(",").map((value) => value.trim()) ?? [];
  const checks = {
    exactlyOneJob: count === 1,
    displayName: block.split("\n").includes(`    name: ${combinedJobDisplayName}`),
    exactNeeds: exact(needs, requiredDependencyJobs),
    runsAfterAllOutcomes: /^ {4}if: always\(\)$/m.test(block),
    nonAdvisory: !block.includes("continue-on-error:"),
    contextFlag: block.includes('AELYRIS_A7_COMBINED_CI_CONTEXT: "1"'),
    needsPayload: block.includes("AELYRIS_A7_COMBINED_NEEDS_JSON: $" + "{{ toJSON(needs) }}"),
    packageCommand: block.includes("run: pnpm verify:a7:combined-acceptance") && !block.includes("--github-run-id"),
    pinnedRust: block.includes("uses: dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30 # stable"),
    rustCache: block.includes("uses: Swatinem/rust-cache@42dc69e1aa15d09112580998cf2ef0119e2e91ae # v2"),
    exactShaArtifact: block.includes("name: a7-combined-acceptance-$" + "{{ github.sha }}"),
    pinnedUpload: block.includes("uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4"),
    artifactUploaded: block.includes(".codex-auto/quality/a7-combined-acceptance.json"),
    missingArtifactFails: block.includes("if-no-files-found: error"),
  };
  return { ok: Object.values(checks).every(Boolean), checks, needs, jobCount: count };
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
    const expected = [...requiredDependencyJobs].sort();
    if (!exact(keys, expected)) {
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
  const needs = parseNeedsPayload(env.AELYRIS_A7_COMBINED_NEEDS_JSON);
  const checks = {
    githubActions: env.GITHUB_ACTIONS === "true",
    workflow: env.GITHUB_WORKFLOW === workflowName,
    a75Context: env.AELYRIS_A7_COMBINED_CI_CONTEXT === "1",
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

function inspectGitWorktree() {
  const result = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (result.error || result.status !== 0) {
    return { checked: true, clean: false, entryCount: null, error: "git-worktree-status-command-failed" };
  }
  const output = String(result.stdout ?? "");
  return {
    checked: true,
    clean: output === "",
    entryCount: output === "" ? 0 : output.replace(/\r?\n$/, "").split(/\r?\n/).length,
    error: output === "" ? null : "git-worktree-dirty",
  };
}

function fileHash(path) {
  try {
    return sha256(readFileSync(join(root, path)));
  } catch {
    return null;
  }
}

function commitFileHash(commit, path) {
  const result = git(["show", `${commit}:${path}`], { encoding: null });
  if (result.error || result.status !== 0) return null;
  return sha256(result.stdout);
}

function provenanceMatchesCommit(artifact, commit, generatedPaths = new Set()) {
  if (!Array.isArray(artifact?.provenance?.inputs)) return false;
  return artifact.provenance.inputs.every((input) => {
    if (generatedPaths.has(input.path)) return fileHash(input.path) === input.sha256;
    if (commitFileHash(commit, input.path) === input.sha256) return true;
    const unchanged = git(["diff", "--quiet", commit, head, "--", input.path]).status === 0;
    return unchanged && fileHash(input.path) === input.sha256;
  });
}

function findMaterializationCommit(artifact) {
  const commits = gitText(["rev-list", "--first-parent", "--max-count=48", head])?.split(/\r?\n/) ?? [];
  return commits.find((commit) => provenanceMatchesCommit(artifact, commit)) ?? null;
}

function worktreeForBranch(branch) {
  const lines = gitText(["worktree", "list", "--porcelain"])?.split(/\r?\n/) ?? [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== `branch refs/heads/${branch}`) continue;
    for (let cursor = index - 1; cursor >= 0 && lines[cursor] !== ""; cursor -= 1) {
      if (lines[cursor].startsWith("worktree ")) return lines[cursor].slice(9);
    }
  }
  return null;
}

function validateHistoricalEvidence(contract) {
  const paths = contract.historicalLiveEvidence;
  const visible = readOptionalJson(paths.visibleArtifact);
  const aggregate = readOptionalJson(paths.visibleAggregateArtifact);
  const review = readOptionalJson(paths.reviewArtifact);
  const observed = visible.exists || aggregate.exists || review.exists;
  if (!observed) return { observed: false, valid: false, detail: "not-observed-on-this-host" };
  if (!visible.value || !aggregate.value || !review.value) {
    return {
      observed: true,
      valid: false,
      detail: "partial-or-invalid-local-live-evidence",
      errors: [visible.error, aggregate.error, review.error].filter(Boolean),
    };
  }

  const oidPattern = /^[0-9a-f]{40}$/;
  const candidateOid = visible.value?.candidate?.candidateOid;
  const sourceBranch = review.value?.candidate?.sourceBranch;
  const targetBranch = review.value?.merge?.targetBranch;
  const sourceWorktree = worktreeForBranch(sourceBranch);
  const sourceStatus = sourceWorktree
    ? spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: sourceWorktree,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
      })
    : null;
  const aggregateLiveInput = aggregate.value.provenance?.inputs?.find((input) => input.path === paths.visibleArtifact);
  const aggregateHead = aggregate.value.provenance?.gitHead;
  const aggregateAnchored =
    oidPattern.test(aggregateHead ?? "") &&
    git(["merge-base", "--is-ancestor", aggregateHead, head]).status === 0 &&
    provenanceMatchesCommit(aggregate.value, aggregateHead, new Set([paths.visibleArtifact]));
  const reviewMaterializationCommit = findMaterializationCommit(review.value);
  const checks = {
    visibleShape:
      visible.value.schema === "aelyris.a7-visible-implementation-live/v1" &&
      visible.value.status === "pass" &&
      visible.value.attemptedSlice === "A7.2" &&
      visible.value.visibleImplementation?.realAgentCount === 1 &&
      visible.value.visibleImplementation?.runtimeDomainId === "visible_pty" &&
      visible.value.visibleImplementation?.hooksEnabled === false &&
      visible.value.candidate?.cleanWorktree === true &&
      visible.value.gate?.result === "passed" &&
      visible.value.boundary?.independentReviewStarted === false &&
      visible.value.boundary?.merged === false &&
      visible.value.boundary?.completionPacketCreated === false,
    visibleAggregateShape:
      aggregate.value.schema === "aelyris.a7-visible-implementation/v1" &&
      aggregate.value.status === "pass-a7.2-visible-implementation" &&
      aggregate.value.completedSlice === "A7.2" &&
      aggregate.value.sliceComplete === true &&
      aggregate.value.phaseComplete === false,
    visibleArtifactDigestBound:
      aggregateLiveInput?.sha256 === fileHash(paths.visibleArtifact) &&
      aggregate.value.scenarios?.some(
        (scenario) => scenario.id === "real-visible-pty-exact-oid-test" && scenario.status === "pass",
      ),
    visibleAggregateAnchored: aggregateAnchored,
    reviewShape:
      review.value.schema === "aelyris.a7-review-acceptance-live/v1" &&
      review.value.status === "pass" &&
      review.value.completedSlice === "A7.3" &&
      review.value.review?.verdict === "accepted_exact_oid" &&
      review.value.review?.clauseCoverageCount === 4 &&
      review.value.review?.findingCount === 0 &&
      review.value.merge?.result === "merged_exact_oid" &&
      review.value.boundaries?.taskStatus === "review" &&
      review.value.boundaries?.completionPacketCreated === false &&
      review.value.boundaries?.automaticMainMerge === false,
    reviewInputsAnchored: reviewMaterializationCommit !== null,
    exactOidChain:
      oidPattern.test(candidateOid ?? "") &&
      visible.value.candidate?.testedOid === candidateOid &&
      review.value.candidate?.sourceOid === candidateOid &&
      review.value.review?.reviewedOid === candidateOid &&
      review.value.merge?.bindingSourceOid === candidateOid &&
      review.value.merge?.integratedOid === candidateOid,
    orderedReceipts:
      Date.parse(visible.value.generatedAt) < Date.parse(review.value.generatedAt) &&
      visible.value.gate?.endedAtUnixMs <= Date.parse(review.value.generatedAt),
    candidateRefCurrent: gitText(["rev-parse", `refs/heads/${sourceBranch}`]) === candidateOid,
    targetRefCurrent: gitText(["rev-parse", `refs/heads/${targetBranch}`]) === candidateOid,
    candidateWorktreeCurrent:
      sourceWorktree !== null &&
      sourceWorktree.replaceAll("\\", "/") === String(review.value.candidate?.worktree).replaceAll("\\", "/") &&
      sourceStatus?.status === 0 &&
      String(sourceStatus.stdout ?? "") === "",
    mainAndRemoteUnchanged:
      review.value.boundaries?.mainBefore === review.value.boundaries?.mainAfter &&
      review.value.boundaries?.remoteBefore === review.value.boundaries?.remoteAfter,
  };
  return {
    observed: true,
    valid: Object.values(checks).every(Boolean),
    checks,
    candidateOid,
    sourceBranch,
    targetBranch,
    sourceWorktree,
    aggregateHead,
    reviewMaterializationCommit,
    capturedAt: {
      visible: visible.value.generatedAt,
      review: review.value.generatedAt,
    },
  };
}

function authoritativeCompletion({ localComplete, historicalEvidence, externalRunVerified, worktreeClean }) {
  return localComplete && historicalEvidence && externalRunVerified && worktreeClean;
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
    return { ok: false, value: null, error: `${stage}-command-failed` };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout), error: null };
  } catch {
    return { ok: false, value: null, error: `${stage}-invalid-json` };
  }
}

function verifyExternalGithubRun(runId, expectedHead) {
  const worktree = inspectGitWorktree();
  if (!worktree.clean) {
    return { verified: false, error: worktree.error, worktree, checks: { worktreeClean: false }, jobs: [] };
  }
  const repoResult = runGhJson(["repo", "view", "--json", "nameWithOwner,url"], "github-repository");
  if (!repoResult.ok) {
    return { verified: false, error: repoResult.error, worktree, checks: { worktreeClean: true }, jobs: [] };
  }
  const nameWithOwner = repoResult.value?.nameWithOwner;
  if (typeof nameWithOwner !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(nameWithOwner)) {
    return { verified: false, error: "github-repository-shape-mismatch", worktree, checks: {}, jobs: [] };
  }
  const apiRepository = nameWithOwner.split("/").map(encodeURIComponent).join("/");
  const runResult = runGhJson(["api", `repos/${apiRepository}/actions/runs/${runId}`], "github-run");
  const jobsResult = runGhJson(
    ["api", `repos/${apiRepository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`],
    "github-run-jobs",
  );
  if (!runResult.ok || !jobsResult.ok) {
    return {
      verified: false,
      error: runResult.error ?? jobsResult.error,
      worktree,
      checks: { worktreeClean: true },
      jobs: [],
    };
  }
  const run = runResult.value;
  const jobsPayload = jobsResult.value;
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  const runAttempt = run?.run_attempt;
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
        job.run_attempt === runAttempt,
    };
  });
  const checks = {
    worktreeClean: worktree.clean,
    repositoryIdentity: String(run?.repository?.full_name ?? "").toLowerCase() === nameWithOwner.toLowerCase(),
    workflowName: run?.name === workflowName,
    workflowPath: run?.path === workflowPath,
    runId: String(run?.id ?? "") === runId,
    completed: run?.status === "completed",
    exactHead: run?.head_sha === expectedHead,
    attempt: Number.isInteger(runAttempt) && runAttempt > 0,
    completeJobList:
      Number.isInteger(jobsPayload?.total_count) &&
      jobsPayload.total_count === jobs.length &&
      jobsPayload.total_count <= 100,
    requiredJobs: jobResults.every((job) => job.accepted),
  };
  return {
    verified: Object.values(checks).every(Boolean),
    error: Object.values(checks).every(Boolean) ? null : "github-run-verification-failed",
    worktree,
    checks,
    repository: { nameWithOwner, url: repoResult.value?.url ?? null },
    run: {
      id: String(run?.id ?? ""),
      attempt: Number.isInteger(runAttempt) ? runAttempt : null,
      url: run?.html_url ?? null,
      workflowName: run?.name ?? null,
      workflowPath: run?.path ?? null,
      status: run?.status ?? null,
      conclusion: run?.conclusion ?? null,
      headSha: run?.head_sha ?? null,
    },
    jobs: jobResults,
  };
}

const { contract, error: contractError } = parseContract();
const contractValidation = validateContract(contract, contractError);
record("tracked-a7.5-contract", contractValidation.ok, contractValidation);

let sourceProof = { ok: false, error: "contract-invalid" };
if (contractValidation.ok) sourceProof = runCurrentSourceProof(contract);
record("current-a7-core-source-proof", sourceProof.ok, sourceProof);

const workflowContract = inspectBlockingCiJob(read(workflowPath));
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

const historicalEvidence = contractValidation.ok
  ? validateHistoricalEvidence(contract)
  : { observed: false, valid: false, detail: "contract-invalid" };
if (historicalEvidence.observed) {
  record("preserved-local-live-evidence", historicalEvidence.valid, historicalEvidence);
} else {
  scenarios.push({ id: "preserved-local-live-evidence", status: "not-observed", ...historicalEvidence });
}

const successfulNeeds = Object.fromEntries(requiredDependencyJobs.map((job) => [job, { result: "success" }]));
const validHostedEnvironment = {
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: workflowName,
  GITHUB_SHA: head,
  AELYRIS_A7_COMBINED_CI_CONTEXT: "1",
  AELYRIS_A7_COMBINED_NEEDS_JSON: JSON.stringify(successfulNeeds),
};
const missingNeeds = structuredClone(successfulNeeds);
delete missingNeeds.rust;
const failedNeeds = structuredClone(successfulNeeds);
failedNeeds.rust.result = "failure";
const extraNeeds = { ...successfulNeeds, advisory: { result: "success" } };
const syntheticHostedCandidate = evaluateHostedCandidate(validHostedEnvironment, head);
const negativeProof = {
  validHostedCandidateAccepted: syntheticHostedCandidate.accepted,
  missingDependencyRejected: !evaluateHostedCandidate(
    { ...validHostedEnvironment, AELYRIS_A7_COMBINED_NEEDS_JSON: JSON.stringify(missingNeeds) },
    head,
  ).accepted,
  failedDependencyRejected: !evaluateHostedCandidate(
    { ...validHostedEnvironment, AELYRIS_A7_COMBINED_NEEDS_JSON: JSON.stringify(failedNeeds) },
    head,
  ).accepted,
  extraDependencyRejected: !evaluateHostedCandidate(
    { ...validHostedEnvironment, AELYRIS_A7_COMBINED_NEEDS_JSON: JSON.stringify(extraNeeds) },
    head,
  ).accepted,
  nonGithubContextRejected: !evaluateHostedCandidate({ ...validHostedEnvironment, GITHUB_ACTIONS: "false" }, head)
    .accepted,
  shaMismatchRejected: !evaluateHostedCandidate({ ...validHostedEnvironment, GITHUB_SHA: "0".repeat(40) }, head)
    .accepted,
  hostedCandidateAloneCannotComplete: !authoritativeCompletion({
    localComplete: true,
    historicalEvidence: false,
    externalRunVerified: true,
    worktreeClean: true,
  }),
  localProofFailureCannotComplete: !authoritativeCompletion({
    localComplete: false,
    historicalEvidence: true,
    externalRunVerified: true,
    worktreeClean: true,
  }),
  dirtyWorktreeCannotComplete: !authoritativeCompletion({
    localComplete: true,
    historicalEvidence: true,
    externalRunVerified: true,
    worktreeClean: false,
  }),
  blockedScenarioNeverCompletes: contract?.negativeScenario?.a7PhaseComplete === false,
};
record("aggregate-negative-proof", Object.values(negativeProof).every(Boolean), { negativeProof });

const hostedCandidate = evaluateHostedCandidate(process.env, head);
if (hostedCandidate.hostedAttempt) {
  record("hosted-ci-candidate-context", hostedCandidate.accepted, hostedCandidate);
} else {
  scenarios.push({
    id: "hosted-ci-candidate-context",
    status: "not-observed",
    ...hostedCandidate,
    detail: "Local execution cannot claim hosted exact-SHA evidence.",
  });
}

const localComplete = !failed;
let externalCloseout = {
  requested: cli.mode === "github-closeout",
  verified: false,
  error: null,
  worktree: { checked: false, clean: false, entryCount: null, error: null },
  checks: {},
  jobs: [],
};
if (externalCloseout.requested && localComplete && historicalEvidence.valid) {
  externalCloseout = { requested: true, ...verifyExternalGithubRun(cli.runId, head) };
  record("external-github-run-closeout", externalCloseout.verified, externalCloseout);
} else if (externalCloseout.requested) {
  externalCloseout.error = !localComplete
    ? "local-proof-failed-before-external-closeout"
    : "preserved-local-live-evidence-required";
  record("external-github-run-closeout", false, externalCloseout);
} else {
  scenarios.push({
    id: "external-github-run-closeout",
    status: "not-run",
    ...externalCloseout,
    detail: "Authoritative A7 closeout requires --github-run-id after the hosted run concludes.",
  });
}

const hostedCandidateAccepted = localComplete && hostedCandidate.accepted;
const phaseComplete = authoritativeCompletion({
  localComplete,
  historicalEvidence: historicalEvidence.valid,
  externalRunVerified: externalCloseout.verified,
  worktreeClean: externalCloseout.worktree.clean,
});
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a7-combined-acceptance/v1",
  status: failed
    ? "failed"
    : phaseComplete
      ? "pass-a7.5-externally-verified"
      : hostedCandidateAccepted
        ? "pass-hosted-candidate-awaiting-run-conclusion"
        : "pass-local-awaiting-hosted-ci",
  localComplete,
  historicalEvidenceObserved: historicalEvidence.observed,
  historicalEvidenceValid: historicalEvidence.valid,
  hostedCandidateAccepted,
  sliceComplete: phaseComplete,
  completedSlice: phaseComplete ? "A7.5" : "A7.4",
  activeSlice: phaseComplete ? "A8.0" : "A7.5",
  nextImplementationSlice: phaseComplete ? "A8.0" : "A7.5",
  phaseComplete,
  releaseReady: false,
  claimBoundary:
    "A7 Core Mission combined acceptance only. A7 completion does not imply A8, A9, external/operator proof, deferred product features, or release readiness.",
  currentSourceProof: sourceProof,
  historicalEvidence,
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
      workflowPath,
      designPath,
      "src-tauri/src/task/manager.rs",
    ],
    generatedAt,
  }),
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: artifactPath, ...report }, null, 2));
if (failed) process.exit(1);
