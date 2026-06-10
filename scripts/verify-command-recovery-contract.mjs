import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, ".codex-auto", "production-smoke", "command-recovery-contract.json");
const TEST = "src/__tests__/commandRecoveryContract.test.ts";

function writeReport(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ version: 1, ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
}

function parseChecks(output) {
  const checks = {};
  const pattern = /AETHER_COMMAND_RECOVERY_CHECK\s+({.*})/g;
  let match = pattern.exec(output);
  while (match) {
    const parsed = JSON.parse(match[1]);
    checks[parsed.name] = parsed.value;
    match = pattern.exec(output);
  }
  return checks;
}

function validate(checks) {
  const failed = checks.failedCommandRecovery ?? {};
  const denied = checks.deniedToolRecovery ?? {};
  const failures = [];
  const requiredChecks = [
    "failedCommandDetected",
    "recoveryHintReady",
    "retryReady",
    "handoffReady",
    "auditPayloadsReady",
    "noSilentFallback",
  ];
  for (const key of requiredChecks) {
    if (failed.checks?.[key] !== true) failures.push(`failed command recovery missing check: ${key}`);
  }
  if (!failed.actionIds?.includes?.("recover-attention") || !failed.actionIds?.includes?.("inspect-risk")) {
    failures.push("failed command recovery does not expose recover-attention and inspect-risk actions");
  }
  if (!failed.guardIds?.includes?.("fallback-visible") || !failed.guardIds?.includes?.("stale-state-visible")) {
    failures.push("failed command recovery does not expose stale/fallback guards");
  }
  if (failed.auditPayloadCount < 1 || failed.provenanceHasEvidence !== true) {
    failures.push("failed command recovery does not prove audit payloads and file provenance");
  }
  if (denied.recoveryKind !== "review-denial" || denied.checks?.noSilentFallback !== true) {
    failures.push("denied tool recovery is not routed through review denial without silent retry");
  }
  if (denied.auditPayloadCount < 1) failures.push("denied tool recovery does not emit audit payload proof");
  return failures;
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  rmSync(OUT, { force: true });

  const result = spawnSync(`pnpm exec vitest run ${TEST} --reporter=dot`, {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const checks = parseChecks(output);
  if (result.status !== 0) {
    writeReport({
      ok: false,
      status: "failed",
      test: TEST,
      exitCode: result.status,
      checks,
      errors: [
        result.error
          ? `command recovery contract test failed: ${result.error.message}`
          : "command recovery contract test failed",
      ],
      stdoutTail: String(result.stdout ?? "").slice(-4000),
      stderrTail: String(result.stderr ?? "").slice(-4000),
    });
    process.exit(result.status ?? 1);
  }

  const failures = validate(checks);
  if (failures.length > 0) {
    writeReport({
      ok: false,
      status: "failed",
      test: TEST,
      checks,
      errors: failures,
    });
    console.error(`command recovery contract failed: ${OUT}`);
    process.exit(1);
  }

  writeReport({
    ok: true,
    status: "pass",
    test: TEST,
    checks,
    errors: [],
  });
  console.log(`command recovery contract passed: ${OUT}`);
}

main();
