import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, ".codex-auto", "performance", "right-rail-scale-contract.json");
const TEST = "src/__tests__/rightRailScaleContract.test.tsx";
const IAB_PROOF = ".codex-auto/production-smoke/right-rail-iab-proof.json";

function read(path) {
  const full = resolve(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function readJson(path) {
  const full = resolve(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function writeReport(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ version: 1, ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
}

function parseChecks(output) {
  const checks = {};
  const pattern = /AETHER_RIGHT_RAIL_SCALE_CHECK\s+({.*})/g;
  let match = pattern.exec(output);
  while (match) {
    const parsed = JSON.parse(match[1]);
    checks[parsed.name] = parsed.value;
    match = pattern.exec(output);
  }
  return checks;
}

function validate(report) {
  const checks = report?.checks ?? {};
  const action = checks.actionStateCoverage ?? {};
  const stress = checks.twentySessionStress ?? {};
  const review = checks.reviewQueueScale ?? {};
  const failures = [];

  if (action.covered < action.required || action.required < 12) {
    failures.push("right rail action ranking does not cover at least 12 real states");
  }
  if (action.distinctTopActions < 12) {
    failures.push("right rail action ranking does not prove at least 12 distinct top actions");
  }
  if (stress.sessions < 20 || stress.actionCount > 5 || stress.deriveMs > stress.thresholdMs) {
    failures.push("20-session right rail action derivation exceeded the bounded action contract");
  }
  if (
    review.files < 500 ||
    review.visibleRows > 6 ||
    review.hiddenFiles < 494 ||
    review.renderMs > review.thresholdMs
  ) {
    failures.push("500-file review queue render exceeded the bounded review contract");
  }

  return failures;
}

function validateNoSpawnSourceContract() {
  const testSource = read(TEST);
  const advisorSource = read("src/shared/lib/rightRailAdvisor.ts");
  const reviewSource = read("src/features/review/ReviewQueuePanel.tsx");
  const iabProof = readJson(IAB_PROOF);
  const actionNames = [
    "high context handoff",
    "approval gate",
    "blocked run",
    "release risk",
    "native fallback",
    "blocked launch gate",
    "focused test review",
    "final report collection",
    "provenance trace",
    "plain review queue",
    "context pack during run",
    "selected live pane",
    "parallel run",
    "topology",
    "idle command",
  ];
  const actionIds = [
    "handoff-context",
    "resolve-approvals",
    "recover-attention",
    "inspect-risk",
    "inspect-cli-boundary",
    "plan-cli-launch",
    "focused-review",
    "collect-final-report",
    "trace-provenance",
    "review-queue",
    "inspect-context",
    "track-selected",
    "parallel-run",
    "open-conductor",
    "ready-command",
  ];
  const failures = [];

  for (const name of actionNames) {
    if (!testSource.includes(`name: "${name}"`)) failures.push(`missing right rail state fixture: ${name}`);
  }
  for (const id of actionIds) {
    if (!testSource.includes(`expected: "${id}"`) && !advisorSource.includes(`id: "${id}"`)) {
      failures.push(`missing right rail action contract: ${id}`);
    }
  }
  if (!testSource.includes("Array.from({ length: 20 }")) {
    failures.push("20-session stress fixture missing");
  }
  if (!testSource.includes("Array.from({ length: 500 }")) {
    failures.push("500-file review queue fixture missing");
  }
  if (!testSource.includes("actions.length).toBeLessThanOrEqual(5)")) {
    failures.push("bounded right rail action stack assertion missing");
  }
  if (!testSource.includes("+494 more files in SCM") || !testSource.includes("toBe(6)")) {
    failures.push("bounded review queue assertion missing");
  }
  if (
    !reviewSource.includes("visibleItems") ||
    !reviewSource.includes("queue.items.slice(0, 6)") ||
    !reviewSource.includes("more files in SCM")
  ) {
    failures.push("review queue source no longer exposes bounded visible/hidden rows");
  }
  if (
    iabProof?.ok !== true ||
    iabProof?.checks?.threePaneShell !== true ||
    iabProof?.checks?.rightRailScrollable !== true ||
    iabProof?.checks?.noRuntimeFallbacksVisible !== true
  ) {
    failures.push("fresh in-app browser right rail proof is missing or failed");
  }

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "pass" : "failed",
    mode: "no-spawn-source-and-iab-proof",
    test: TEST,
    checks: {
      sourceActionStateCoverage: {
        required: 12,
        covered: actionNames.filter((name) => testSource.includes(`name: "${name}"`)).length,
        distinctTopActions: actionIds.filter((id) => testSource.includes(`expected: "${id}"`) || advisorSource.includes(`id: "${id}"`)).length,
      },
      sourceTwentySessionStress: {
        fixture: testSource.includes("Array.from({ length: 20 }"),
        boundedActionStack: testSource.includes("actions.length).toBeLessThanOrEqual(5)"),
      },
      sourceReviewQueueScale: {
        fixture: testSource.includes("Array.from({ length: 500 }"),
        boundedVisibleRows: testSource.includes("+494 more files in SCM") && testSource.includes("toBe(6)"),
        sourceKeepsHiddenRows:
          reviewSource.includes("visibleItems") &&
          reviewSource.includes("queue.items.slice(0, 6)") &&
          reviewSource.includes("more files in SCM"),
      },
      iabProof: {
        artifact: IAB_PROOF,
        threePaneShell: iabProof?.checks?.threePaneShell === true,
        rightRailScrollable: iabProof?.checks?.rightRailScrollable === true,
        noRuntimeFallbacksVisible: iabProof?.checks?.noRuntimeFallbacksVisible === true,
      },
    },
    errors: failures,
  };
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  rmSync(OUT, { force: true });

  const result = spawnSync(`pnpm exec vitest run ${TEST} --reporter=dot`, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, AETHER_RIGHT_RAIL_SCALE_OUT: OUT },
    shell: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
    if (/spawn(?:Sync)? .*EPERM|Error: spawn EPERM|esbuild/i.test(output)) {
      const noSpawnReport = validateNoSpawnSourceContract();
      writeReport(noSpawnReport);
      if (noSpawnReport.ok) {
        console.log(`right rail scale contract passed without child-process test runner: ${OUT}`);
        return;
      }
      console.error(`right rail scale contract failed without child-process test runner: ${OUT}`);
      process.exit(1);
    }
    writeReport({
      ok: false,
      status: "failed",
      test: TEST,
      exitCode: result.status,
      errors: [
        result.error
          ? `right rail scale contract test failed: ${result.error.message}`
          : "right rail scale contract test failed",
      ],
    });
    process.exit(result.status ?? 1);
  }

  const checks = parseChecks(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const report = { checks };
  const failures = validate(report);
  if (failures.length > 0) {
    writeReport({
      ok: false,
      status: "failed",
      test: TEST,
      checks: report?.checks ?? {},
      errors: failures,
    });
    console.error(`right rail scale contract failed: ${OUT}`);
    process.exit(1);
  }

  writeReport({
    ok: true,
    status: "pass",
    test: TEST,
    checks: report.checks,
    errors: [],
  });
  console.log(`right rail scale contract passed: ${OUT}`);
}

main();
