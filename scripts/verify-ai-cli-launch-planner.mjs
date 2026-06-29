// Production smoke for the AI CLI Launch Planner.
//
// This verifier consumes the real CLI binary probe artifact and executes the
// actual TypeScript planner source. It proves the planner can turn current
// Codex/Claude/Gemini launcher evidence into a reconstructable launch trace.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve(process.cwd());
const SOURCE = join(ROOT, "src", "shared", "lib", "aiCliLaunchPlanner.ts");
const REAL_PROBE =
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_REAL_PROBE ??
  join(ROOT, ".codex-auto", "production-smoke", "real-ai-cli-binary-probe.json");
const NATIVE_INPUT_HOST =
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_NATIVE_INPUT_HOST ??
  join(ROOT, ".codex-auto", "production-smoke", "native-terminal-input-host.json");
const IME_PROOF =
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_IME ?? join(ROOT, ".codex-auto", "production-smoke", "verify-ime.json");
const PROCESS_RECONNECT =
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_PROCESS_RECONNECT ??
  join(ROOT, ".codex-auto", "production-smoke", "process-reconnect-command-evidence.json");
const MUX_LIVE_PROCESS_PRESERVATION =
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_MUX_LIVE_PROCESS_PRESERVATION ??
  join(ROOT, ".codex-auto", "quality", "mux-live-process-preservation.json");
const INTERACTIVE_BOUNDARY =
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_INTERACTIVE_BOUNDARY ??
  join(ROOT, ".codex-auto", "production-smoke", "interactive-ai-cli-boundary.json");
const OUT =
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_OUT ??
  join(ROOT, ".codex-auto", "production-smoke", "ai-cli-launch-planner.json");
const TMP = join(ROOT, ".codex-auto", "tmp", "aiCliLaunchPlanner.mjs");
const PREFERRED_PROVIDER = process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_PROVIDER ?? "claude";
const MAX_EVIDENCE_AGE_MS = Number.parseInt(
  process.env.AELYRIS_AI_CLI_LAUNCH_PLANNER_MAX_EVIDENCE_AGE_MS ?? String(24 * 60 * 60 * 1000),
  10,
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function mtimeMs(path) {
  if (!existsSync(path)) return 0;
  return statSync(path).mtimeMs;
}

function writeArtifact(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
}

async function loadPlanner() {
  const source = readFileSync(SOURCE, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      sourceMap: false,
    },
    fileName: SOURCE,
  });
  mkdirSync(dirname(TMP), { recursive: true });
  writeFileSync(TMP, compiled.outputText);
  return await import(`${pathToFileURL(TMP).href}?v=${Date.now()}`);
}

function assertPlan(plan, realProbe) {
  const providers = new Set(plan.trace?.cliMatrix?.map((entry) => entry.provider));
  const allProvidersPresent = ["codex", "claude", "gemini"].every((provider) => providers.has(provider));
  const allProvidersReady = plan.trace?.cliMatrix?.every(
    (entry) =>
      entry.status === "ready" &&
      typeof entry.launcher === "string" &&
      entry.launcher.length > 0 &&
      typeof entry.executablePath === "string" &&
      entry.executablePath.length > 0 &&
      Number.isInteger(entry.attemptCount) &&
      entry.attemptCount >= 1,
  );
  const realProbeEntries = Array.isArray(realProbe?.checks?.clis) ? realProbe.checks.clis : [];
  const realProbeProvenanceReady =
    realProbe?.maxAttempts >= 2 &&
    realProbeEntries.length >= 3 &&
    realProbeEntries.every(
      (entry) =>
        typeof entry?.executablePath === "string" &&
        entry.executablePath.length > 0 &&
        Number.isInteger(entry?.attemptCount) &&
        entry.attemptCount >= 1 &&
        Array.isArray(entry?.attempts) &&
        entry.attempts.length === entry.attemptCount,
    );
  return {
    sourceLoaded: typeof plan?.trace === "object" && plan.trace.kind === "ai-cli-launch-plan",
    realProbePass:
      realProbe?.ok === true &&
      realProbe?.status === "pass" &&
      realProbe?.checks?.commandSessionCapability === true &&
      realProbe?.checks?.passCount === 3 &&
      realProbeProvenanceReady,
    planReady:
      plan?.status === "ready" &&
      plan?.recommendedBackend === "sidecar-command-session" &&
      plan?.trace?.recommendedBackend === "sidecar-command-session",
    traceComplete:
      plan?.trace?.schemaVersion === 1 &&
      plan?.trace?.kind === "ai-cli-launch-plan" &&
      typeof plan?.trace?.selectedLauncher === "string" &&
      plan.trace.selectedLauncher.length > 0 &&
      typeof plan?.trace?.selectedVersion === "string" &&
      plan.trace.selectedVersion.length > 0 &&
      Array.isArray(plan?.trace?.expectedArtifacts) &&
      plan.trace.expectedArtifacts.includes("run trace with provider, role, backend, and launcher") &&
      plan.trace.expectedArtifacts.includes("executable path and bounded retry provenance for every AI CLI") &&
      typeof plan.trace.selectedExecutablePath === "string" &&
      plan.trace.selectedExecutablePath.length > 0 &&
      Number.isInteger(plan.trace.selectedAttemptCount) &&
      plan.trace.selectedAttemptCount >= 1,
    contextPackReady:
      plan?.trace?.contextPack?.id === "launch-planner-smoke-context" &&
      plan?.trace?.contextPack?.source === "smoke" &&
      plan?.trace?.contextPack?.includeCount >= 2 &&
      plan?.trace?.contextPack?.excludeCount >= 3 &&
      plan?.trace?.contextPack?.changedFileCount >= 1 &&
      typeof plan?.trace?.contextPack?.redactionCount === "number" &&
      plan.trace.expectedArtifacts.includes(
        "machine-readable context pack trace with inclusion, exclusion, redaction, and changed-file counts",
      ),
    providerMatrix: {
      allProvidersPresent,
      allProvidersReady,
      entries: plan.trace?.cliMatrix ?? [],
    },
    preflightReady:
      Array.isArray(plan.trace?.preflightChecks) &&
      plan.trace.preflightChecks.length >= 4 &&
      plan.trace.preflightChecks.every((check) => check.status === "ready"),
    promptContractReady:
      Array.isArray(plan.trace?.promptContractChecks) &&
      plan.trace.promptContractChecks.length >= 5 &&
      plan.trace.promptContractChecks.every((check) => check.status === "ready"),
  };
}

async function main() {
  const report = {
    version: 1,
    ok: false,
    startedAt: new Date().toISOString(),
    source: SOURCE,
    realProbe: REAL_PROBE,
    preferredProvider: PREFERRED_PROVIDER,
    checks: {},
    errors: [],
  };

  try {
    if (!existsSync(REAL_PROBE)) {
      throw new Error(`Real AI CLI probe artifact missing: ${REAL_PROBE}`);
    }
    const realProbe = readJson(REAL_PROBE);
    const preflight = {
      nativeInputHost: readJson(NATIVE_INPUT_HOST),
      ime: readJson(IME_PROOF),
      processReconnect: readJson(PROCESS_RECONNECT),
      muxLiveProcessPreservation: readJson(MUX_LIVE_PROCESS_PRESERVATION),
      interactiveBoundary: readJson(INTERACTIVE_BOUNDARY),
    };
    const { deriveAiCliLaunchPlan } = await loadPlanner();
    if (typeof deriveAiCliLaunchPlan !== "function") {
      throw new Error("deriveAiCliLaunchPlan export was not found after transpiling source");
    }

    const plan = deriveAiCliLaunchPlan({
      evidence: realProbe,
      preflight,
      requirePreflight: true,
      promptContract: {
        objective: "Launch an AI CLI session from the audited sidecar plan without blind prompt-pasting.",
        contextSummary: "Use the prepared project context pack and the selected worktree or pane owner.",
        contextPack: {
          id: "launch-planner-smoke-context",
          title: "Launch planner smoke context",
          source: "smoke",
          generatedAt: new Date().toISOString(),
          summary:
            "Non-token context pack contract for launch planning, including source scope, exclusions, redaction count, and changed files.",
          include: [
            "src/shared/lib/aiCliLaunchPlanner.ts",
            "scripts/verify-ai-cli-launch-planner.mjs",
            ".codex-auto/production-smoke/real-ai-cli-binary-probe.json",
          ],
          exclude: ["node_modules", "src-tauri/target", ".env"],
          changedFiles: ["src/shared/lib/aiCliLaunchPlanner.ts"],
          redactionCount: 0,
        },
        expectedOutput: "Produce a concise implementation report with commands, files, validation, and residual risks.",
        doneCriteria: ["Return changed files, validation evidence, and any unresolved risks."],
        guardrails: ["Do not bypass sidecar-command-session, provenance, or human decision gates."],
        artifacts: ["ai-cli-launch-plan trace"],
      },
      requirePromptContract: true,
      preferredProvider: PREFERRED_PROVIDER,
      currentTimeMs: Date.now(),
      maxEvidenceAgeMs: MAX_EVIDENCE_AGE_MS,
    });
    report.plan = plan;
    report.checks = assertPlan(plan, realProbe);
    report.checks.realProbeFresh = mtimeMs(REAL_PROBE) > 0 && Date.now() - mtimeMs(REAL_PROBE) <= MAX_EVIDENCE_AGE_MS;
    report.checks.sourceMtimeMs = mtimeMs(SOURCE);
    report.checks.realProbeMtimeMs = mtimeMs(REAL_PROBE);
    report.checks.preflightArtifacts = {
      nativeInputHost: NATIVE_INPUT_HOST,
      ime: IME_PROOF,
      processReconnect: PROCESS_RECONNECT,
      muxLiveProcessPreservation: MUX_LIVE_PROCESS_PRESERVATION,
      interactiveBoundary: INTERACTIVE_BOUNDARY,
    };

    const failureReasons = [];
    if (!report.checks.sourceLoaded) failureReasons.push("planner source did not produce a launch trace");
    if (!report.checks.realProbePass) failureReasons.push("real CLI probe is not a clean 3-provider pass");
    if (!report.checks.realProbeFresh) failureReasons.push("real CLI probe is stale for launch planning");
    if (!report.checks.planReady) failureReasons.push("launch plan is not ready on sidecar-command-session");
    if (!report.checks.traceComplete) failureReasons.push("launch trace is incomplete");
    if (!report.checks.contextPackReady) failureReasons.push("machine-readable context pack trace is incomplete");
    if (!report.checks.preflightReady) failureReasons.push("launch preflight checks are not all ready");
    if (!report.checks.promptContractReady) failureReasons.push("launch prompt contract checks are not all ready");
    if (!report.checks.providerMatrix.allProvidersPresent) failureReasons.push("provider matrix is incomplete");
    if (!report.checks.providerMatrix.allProvidersReady) failureReasons.push("provider matrix is not fully ready");

    if (failureReasons.length > 0) {
      throw new Error(failureReasons.join("; "));
    }
    report.ok = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  } finally {
    writeArtifact(report);
  }

  if (report.ok) {
    console.log(`AI CLI launch planner smoke passed: ${OUT}`);
  } else {
    console.error(`AI CLI launch planner smoke failed: ${OUT}`);
  }
}

await main();
