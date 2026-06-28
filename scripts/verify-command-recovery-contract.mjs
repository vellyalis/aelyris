import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, ".codex-auto", "production-smoke", "command-recovery-contract.json");
const TMP = resolve(ROOT, ".codex-auto", "tmp", "command-recovery-contract");
const TEST = "src/__tests__/commandRecoveryContract.test.ts";
const ENTRY_MODULES = [
  resolve(ROOT, "src/shared/lib/commandRecovery.ts"),
  resolve(ROOT, "src/shared/lib/workstationGraph.ts"),
];

function writeReport(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ version: 1, ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
}

function emitRecoveryCheck(name, value) {
  console.log(`AETHER_COMMAND_RECOVERY_CHECK ${JSON.stringify({ name, value })}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertIncludes(value, expected, message) {
  assert(value?.includes?.(expected), `${message}: missing ${expected}`);
}

function assertIncludesAll(values, expectedValues, message) {
  for (const expected of expectedValues) assertIncludes(values, expected, message);
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

function session(id, overrides = {}) {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "gpt-5.5",
    prompt: "work",
    startedAt: 1,
    logs: [],
    cost: 0,
    tokensUsed: 12_000,
    ...overrides,
  };
}

function audit(overrides = {}) {
  return {
    id: 42,
    timestamp: "2026-05-19T12:00:00.000Z",
    category: "terminal",
    action: "send_keys_failed",
    severity: "warn",
    entityType: "command_block",
    entityId: "cmd-fail",
    summary: "Failed to send retry input to stale native fallback pane",
    metadata: {
      commandBlockId: "cmd-fail",
      correlationId: "terminal:pane-impl:cmd-fail",
      error: "writer unavailable",
      backend: "native-fallback",
      stale: true,
      redacted: true,
    },
    ...overrides,
  };
}

function hasRuntimeImport(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function resolveTsModule(sourcePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(sourcePath), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function outputPathFor(sourcePath) {
  const relPath = relative(ROOT, sourcePath);
  if (relPath.startsWith("..")) throw new Error(`source path escaped workspace: ${sourcePath}`);
  return resolve(TMP, relPath.replace(/\.tsx?$/, ".mjs"));
}

function toGeneratedSpecifier(sourcePath, outPath, specifier) {
  const resolvedModule = resolveTsModule(sourcePath, specifier);
  if (!resolvedModule) return specifier;
  let generated = relative(dirname(outPath), outputPathFor(resolvedModule)).replace(/\\/g, "/");
  if (!generated.startsWith(".")) generated = `./${generated}`;
  return generated;
}

function rewriteImports(js, sourcePath, outPath) {
  return js
    .replace(/(\bfrom\s*["'])(\.[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${toGeneratedSpecifier(sourcePath, outPath, specifier)}${suffix}`;
    })
    .replace(/(^\s*import\s*["'])(\.[^"']+)(["'];?)/gm, (_match, prefix, specifier, suffix) => {
      return `${prefix}${toGeneratedSpecifier(sourcePath, outPath, specifier)}${suffix}`;
    });
}

function collectRuntimeModules(entryModules) {
  const pending = [...entryModules];
  const visited = new Set();

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);

    const source = readFileSync(sourcePath, "utf8");
    const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
    sourceFile.forEachChild(function visit(node) {
      if (ts.isImportDeclaration(node) && hasRuntimeImport(node)) {
        const specifier = node.moduleSpecifier?.text;
        if (typeof specifier === "string" && specifier.startsWith(".")) {
          const resolvedModule = resolveTsModule(sourcePath, specifier);
          if (!resolvedModule) throw new Error(`cannot resolve runtime import ${specifier} from ${sourcePath}`);
          pending.push(resolvedModule);
        }
      }
      ts.forEachChild(node, visit);
    });
  }

  return [...visited].sort();
}

function compileProductionModules() {
  rmSync(TMP, { recursive: true, force: true });
  const modules = collectRuntimeModules(ENTRY_MODULES);
  const formatHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => "\n",
  };

  for (const sourcePath of modules) {
    const outPath = outputPathFor(sourcePath);
    mkdirSync(dirname(outPath), { recursive: true });
    const result = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
      fileName: sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        verbatimModuleSyntax: false,
      },
      reportDiagnostics: true,
    });
    const errors =
      result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length > 0) {
      throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, formatHost));
    }
    writeFileSync(outPath, rewriteImports(result.outputText, sourcePath, outPath));
  }

  return {
    commandRecoveryUrl: pathToFileURL(outputPathFor(resolve(ROOT, "src/shared/lib/commandRecovery.ts"))).href,
    workstationGraphUrl: pathToFileURL(outputPathFor(resolve(ROOT, "src/shared/lib/workstationGraph.ts"))).href,
    modules: modules.map((modulePath) => relative(ROOT, modulePath).replace(/\\/g, "/")),
  };
}

async function loadProductionContracts() {
  const compiled = compileProductionModules();
  const commandRecovery = await import(compiled.commandRecoveryUrl);
  const workstationGraph = await import(compiled.workstationGraphUrl);
  return {
    deriveCommandRecoveryPlan: commandRecovery.deriveCommandRecoveryPlan,
    buildWorkstationGraph: workstationGraph.buildWorkstationGraph,
    modules: compiled.modules,
  };
}

function runFailedCommandRecovery({ deriveCommandRecoveryPlan, buildWorkstationGraph }) {
  const owner = session("impl", {
    name: "Implementer",
    status: "error",
    role: "implementer",
    worktree: {
      name: "native-edge",
      path: "C:/repo/.aether/worktrees/native-edge",
      branch: "codex/native-edge",
      is_main: false,
      head_sha: "abc123",
      status: "Modified",
    },
    changedFileDetails: [
      { path: "src/features/terminal/NativeTerminalArea.tsx", action: "edit", toolName: "apply_patch", timestamp: 2 },
    ],
    logs: [{ timestamp: 3, type: "error", content: "pnpm test failed" }],
  });
  const command = {
    id: "cmd-fail",
    command: "pnpm test -- NativeTerminalArea",
    cwd: "C:/repo",
    status: "failed",
    exitCode: 1,
    paneId: "pane-impl",
    terminalId: "term-impl",
    processId: 4242,
    agentId: "impl",
    filePaths: ["src/features/terminal/NativeTerminalArea.tsx"],
    validationKind: "test",
    endSequence: 99,
    endHistorySize: 200,
  };
  const graph = buildWorkstationGraph({
    workspaceId: "C:/repo",
    sessions: [owner],
    panes: [{ paneId: "pane-impl", terminalId: "term-impl", role: "work", status: "stale" }],
    commandBlocks: [command],
    risks: [
      {
        id: "cmd-risk",
        title: "Failed terminal validation",
        status: "open",
        severity: "high",
        filePath: "src/features/terminal/NativeTerminalArea.tsx",
        agentId: "impl",
      },
    ],
  });

  const plan = deriveCommandRecoveryPlan({
    workspaceId: "C:/repo",
    sessions: [owner],
    commandBlocks: [command],
    auditEvents: [audit()],
    workstationGraph: graph,
    pendingDecisionCount: 1,
  });

  assert(plan.status === "ready", "failed command recovery status is not ready");
  assertDeepEqual(
    plan.checks,
    {
      failedCommandDetected: true,
      recoveryHintReady: true,
      retryReady: true,
      handoffReady: true,
      auditPayloadsReady: true,
      noSilentFallback: true,
    },
    "failed command recovery checks changed",
  );
  assert(plan.retry?.command === "pnpm test -- NativeTerminalArea", "retry command mismatch");
  assert(plan.retry?.cwd === "C:/repo", "retry cwd mismatch");
  assert(plan.retry?.paneId === "pane-impl", "retry pane mismatch");
  assert(plan.retry?.terminalId === "term-impl", "retry terminal mismatch");
  assertIncludes(plan.handoff?.prompt ?? "", "Before retrying, inspect the audit payload", "handoff prompt");
  assertDeepEqual(
    plan.handoff?.files,
    ["src/features/terminal/NativeTerminalArea.tsx"],
    "handoff file provenance changed",
  );
  assert(plan.provenance[0]?.hasEvidence === true, "file provenance does not have evidence");
  assert(plan.provenance[0]?.path === "src/features/terminal/NativeTerminalArea.tsx", "file provenance path mismatch");
  assertIncludesAll(
    plan.actions.map((action) => action.id),
    ["resolve-approvals", "recover-attention", "inspect-risk"],
    "recovery action list",
  );
  assertIncludesAll(
    plan.guards,
    [
      "failed-command-visible",
      "manual-confirmation-required",
      "no-silent-retry",
      "fallback-visible",
      "stale-state-visible",
    ],
    "recovery guard list",
  );
  assertDeepEqual(
    {
      recovery: {
        failedCommandId: plan.auditPayloads[0]?.recovery.failedCommandId,
        failedCommand: plan.auditPayloads[0]?.recovery.failedCommand,
        exitCode: plan.auditPayloads[0]?.recovery.exitCode,
        auditEventId: plan.auditPayloads[0]?.recovery.auditEventId,
        correlationId: plan.auditPayloads[0]?.recovery.correlationId,
        recoveryKind: plan.auditPayloads[0]?.recovery.recoveryKind,
        retryCommand: plan.auditPayloads[0]?.recovery.retryCommand,
        affectedFiles: plan.auditPayloads[0]?.recovery.affectedFiles,
      },
    },
    {
      recovery: {
        failedCommandId: "cmd-fail",
        failedCommand: "pnpm test -- NativeTerminalArea",
        exitCode: 1,
        auditEventId: 42,
        correlationId: "terminal:pane-impl:cmd-fail",
        recoveryKind: "restart-pane",
        retryCommand: "pnpm test -- NativeTerminalArea",
        affectedFiles: ["src/features/terminal/NativeTerminalArea.tsx"],
      },
    },
    "audit recovery payload changed",
  );

  const value = {
    status: plan.status,
    checks: plan.checks,
    actionIds: plan.actions.map((action) => action.id),
    guardIds: plan.guards,
    auditPayloadCount: plan.auditPayloads.length,
    retryCommand: plan.retry?.command,
    handoffFiles: plan.handoff?.files,
    provenanceHasEvidence: plan.provenance.every((trace) => trace.hasEvidence),
  };
  emitRecoveryCheck("failedCommandRecovery", value);
  return value;
}

function runDeniedToolRecovery({ deriveCommandRecoveryPlan }) {
  const command = {
    id: "cmd-denied",
    command: "npm run deploy",
    cwd: "C:/repo",
    status: "failed",
    exitCode: 1,
    agentId: "review",
    filePaths: ["package.json"],
  };
  const plan = deriveCommandRecoveryPlan({
    workspaceId: "C:/repo",
    sessions: [session("review", { status: "waiting", role: "reviewer" })],
    commandBlocks: [command],
    auditEvents: [
      audit({
        id: 43,
        action: "watchdog_decision",
        summary: "Deploy denied by owner policy",
        metadata: { commandBlockId: "cmd-denied", decision: "denied", correlationId: "watchdog:cmd-denied" },
      }),
    ],
    pendingDecisionCount: 1,
  });

  assert(plan.recoveryHint.kind === "review-denial", "denied recovery kind is not review-denial");
  assert(plan.recoveryHint.recoverable === true, "denied recovery is not recoverable");
  assert(plan.recoveryHint.label === "Review denial", "denied recovery label changed");
  assert(plan.checks.noSilentFallback === true, "denied recovery allows silent fallback");
  assertIncludes(plan.retry?.expectedResult ?? "", "owner confirms recovery", "denied recovery retry expectation");
  assert(
    plan.auditPayloads.every((payload) => payload.recovery.recoveryKind === "review-denial"),
    "denied recovery emitted a non-review-denial audit payload",
  );

  const value = {
    status: plan.status,
    checks: plan.checks,
    recoveryKind: plan.recoveryHint.kind,
    auditPayloadCount: plan.auditPayloads.length,
    guardIds: plan.guards,
  };
  emitRecoveryCheck("deniedToolRecovery", value);
  return value;
}

async function runChecks() {
  const contracts = await loadProductionContracts();
  const checks = {
    failedCommandRecovery: runFailedCommandRecovery(contracts),
    deniedToolRecovery: runDeniedToolRecovery(contracts),
  };
  return { checks, modules: contracts.modules };
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  rmSync(OUT, { force: true });

  let result;
  try {
    result = await runChecks();
  } catch (error) {
    writeReport({
      ok: false,
      status: "failed",
      test: TEST,
      runner: "in-process-production-module",
      checks: {},
      errors: [
        error instanceof Error
          ? `command recovery contract direct run failed: ${error.message}`
          : "command recovery contract direct run failed",
      ],
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }

  const { checks, modules } = result;
  const failures = validate(checks);
  if (failures.length > 0) {
    writeReport({
      ok: false,
      status: "failed",
      test: TEST,
      runner: "in-process-production-module",
      compiledModules: modules,
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
    runner: "in-process-production-module",
    compiledModules: modules,
    checks,
    errors: [],
  });
  console.log(`command recovery contract passed: ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
