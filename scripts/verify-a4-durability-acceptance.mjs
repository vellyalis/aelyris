import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a4-durability-acceptance.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const scenarios = [
  {
    id: "numbered-upgrade-and-newer-schema",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "db::migrations::tests", "--lib"],
  },
  {
    id: "restart-and-mutation-rollback",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "agent::interactive::tests", "--lib"],
  },
  {
    id: "context-store-authoritative-mutation-rollback",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "context_store::manager::tests", "--lib"],
  },
  {
    id: "task-graph-authoritative-mutation-rollback",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "task::manager::tests", "--lib"],
  },
  {
    id: "work-execution-attempt-generation-and-load-integrity",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "persistence::work_execution_repo::tests", "--lib"],
  },
  {
    id: "execution-fence-crash-boundaries-and-stale-token",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "control::loop_ports::tests", "--lib"],
  },
  {
    id: "all-authority-startup-reconciliation-and-dispatch-admission",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "startup_reconciliation", "--lib"],
  },
  {
    id: "a4-12-cross-process-and-effectful-start-admission",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "a4_12_", "--lib"],
    minimumPassed: 12,
    requiredOutputMarkers: [
      "a4_12_proofbook_mcp_status_dispatch_remains_available_while_startup_is_blocked",
      "a4_12_proofbook_mcp_effectful_tools_call_adapters_deny_pending_and_failed_startup",
    ],
  },
  {
    id: "a4-12-live-sidecar-process-http-admission",
    command: cargo,
    args: [
      "test",
      "--manifest-path",
      "src-tauri/pty-server/Cargo.toml",
      "--test",
      "startup_admission_http",
      "--",
      "--test-threads=1",
    ],
    minimumPassed: 1,
  },
  {
    id: "event-outbox-append-query-gap-and-consumer-ack",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "persistence::event_repo::tests", "--lib"],
  },
  {
    id: "event-bus-restart-redelivery-and-buffer-pressure",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "event_bus::manager::tests", "--lib"],
  },
  {
    id: "event-consumer-mcp-adapter",
    command: cargo,
    args: [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "api::mcp::tests::durable_event_consumer_poll_and_ack_use_at_least_once_identity",
      "--lib",
    ],
  },
  {
    id: "event-mcp-structured-error-and-catalog-contract",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "api::mcp::tests", "--lib"],
  },
  {
    id: "session-lifecycle-event-publish-failure-truth",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "ipc::session_lifecycle_commands::tests", "--lib"],
  },
  {
    id: "structured-handoff-acceptance-and-successor-quarantine",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "structured_handoff_", "--lib"],
    minimumPassed: 16,
  },
  {
    id: "locked-db-and-multi-connection",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "persistence::session_checkpoint_repo::tests", "--lib"],
  },
  {
    id: "corrupt-db-fail-closed",
    command: cargo,
    args: [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "corrupt_database_fails_closed_without_replacing_source_bytes",
      "--lib",
    ],
  },
  {
    id: "event-typescript-wire-mirror",
    command: process.execPath,
    args: ["node_modules/typescript/bin/tsc", "--noEmit"],
  },
  {
    id: "power-loss-and-disk-quota",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "durable_file::tests", "--lib"],
  },
  {
    id: "file-store-round-trips",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "mux::store::tests", "--lib"],
  },
  {
    id: "workflow-durable-restore",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "workflow::executor::tests", "--lib"],
  },
  {
    id: "proofbook-durable-restore",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "proofbook::runner::tests", "--lib"],
  },
  {
    id: "settings-round-trip",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "config::settings::tests", "--lib"],
  },
  {
    id: "session-checkpoint-contract",
    command: process.execPath,
    args: ["scripts/verify-session-checkpoint-restore.mjs"],
  },
  {
    id: "session-resume-idempotence",
    command: process.execPath,
    args: ["scripts/verify-session-resume-idempotent.mjs"],
  },
];

const results = [];
let failed = false;
for (const scenario of scenarios) {
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(scenario.command, scenario.args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 240_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (scenario.minimumPassed !== undefined) {
      const passed = [...stdout.matchAll(/test result: ok\.\s+(\d+) passed/g)].reduce(
        (maximum, match) => Math.max(maximum, Number.parseInt(match[1], 10)),
        0,
      );
      if (passed < scenario.minimumPassed) {
        throw new Error(
          `${scenario.id} executed ${passed} matching tests; expected at least ${scenario.minimumPassed}`,
        );
      }
    }
    for (const marker of scenario.requiredOutputMarkers ?? []) {
      if (!stdout.includes(marker)) {
        throw new Error(`${scenario.id} did not execute required adapter proof ${marker}`);
      }
    }
    results.push({
      id: scenario.id,
      status: "pass",
      command: [scenario.command, ...scenario.args].join(" "),
      durationMs: Date.now() - startedAt,
      outputTail: stdout.trim().split(/\r?\n/).slice(-8),
    });
  } catch (error) {
    failed = true;
    results.push({
      id: scenario.id,
      status: "fail",
      command: [scenario.command, ...scenario.args].join(" "),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdoutTail: String(error?.stdout ?? "")
        .trim()
        .split(/\r?\n/)
        .slice(-12),
      stderrTail: String(error?.stderr ?? "")
        .trim()
        .split(/\r?\n/)
        .slice(-12),
    });
    break;
  }
}

const passedScenarioIds = new Set(
  results.filter((scenario) => scenario.status === "pass").map((scenario) => scenario.id),
);
const combinedDimensions = [
  {
    id: "authoritative_mutation",
    scenarioIds: [
      "context-store-authoritative-mutation-rollback",
      "task-graph-authoritative-mutation-rollback",
    ],
  },
  {
    id: "event_bus_delivery",
    scenarioIds: [
      "event-outbox-append-query-gap-and-consumer-ack",
      "event-bus-restart-redelivery-and-buffer-pressure",
      "event-consumer-mcp-adapter",
      "event-mcp-structured-error-and-catalog-contract",
    ],
  },
  {
    id: "execution_fencing",
    scenarioIds: [
      "work-execution-attempt-generation-and-load-integrity",
      "execution-fence-crash-boundaries-and-stale-token",
    ],
  },
  {
    id: "startup_reconciliation",
    scenarioIds: [
      "all-authority-startup-reconciliation-and-dispatch-admission",
      "a4-12-cross-process-and-effectful-start-admission",
      "a4-12-live-sidecar-process-http-admission",
    ],
  },
  {
    id: "handoff_acceptance",
    scenarioIds: ["structured-handoff-acceptance-and-successor-quarantine"],
  },
  {
    id: "admission_surfaces",
    scenarioIds: [
      "a4-12-cross-process-and-effectful-start-admission",
      "a4-12-live-sidecar-process-http-admission",
    ],
  },
].map((dimension) => ({
  ...dimension,
  status: dimension.scenarioIds.every((id) => passedScenarioIds.has(id)) ? "pass" : "fail",
}));
const combinedMatrixPassed =
  !failed && combinedDimensions.every((dimension) => dimension.status === "pass");
const expandedAdmissionUnitProofPassed = passedScenarioIds.has(
  "a4-12-cross-process-and-effectful-start-admission",
);
const proofbookEffectAdapterProofPassed =
  expandedAdmissionUnitProofPassed &&
  scenarios
    .find((scenario) => scenario.id === "a4-12-cross-process-and-effectful-start-admission")
    ?.requiredOutputMarkers?.includes(
      "a4_12_proofbook_mcp_status_dispatch_remains_available_while_startup_is_blocked",
    ) &&
  scenarios
    .find((scenario) => scenario.id === "a4-12-cross-process-and-effectful-start-admission")
    ?.requiredOutputMarkers?.includes(
      "a4_12_proofbook_mcp_effectful_tools_call_adapters_deny_pending_and_failed_startup",
    );
const liveSidecarHttpProofPassed = passedScenarioIds.has(
  "a4-12-live-sidecar-process-http-admission",
);
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a4-durability-acceptance/v8",
  status: failed ? "failed" : "pass-current-a4-durability-evidence",
  completedThrough: combinedMatrixPassed ? "A4.12" : "A4.11",
  repoOwnedComplete: combinedMatrixPassed,
  phaseComplete: combinedMatrixPassed,
  remainingSlices: combinedMatrixPassed ? [] : ["A4.12"],
  scenarios: results,
  combinedRuntimeIntegrityMatrix: {
    schema: "aelyris.a4-runtime-integrity-matrix/v1",
    status: combinedMatrixPassed ? "pass" : "fail",
    dimensions: combinedDimensions,
    guarantees: {
      noAcknowledgedStateOrEffectSilentlyLost: combinedMatrixPassed,
      noStaleGenerationCanCommit: combinedMatrixPassed,
      uncertaintyIsBlockedOrExplicitlyDegraded:
        combinedMatrixPassed && expandedAdmissionUnitProofPassed && liveSidecarHttpProofPassed,
      beginAndProcessSpawnAreSerialized: expandedAdmissionUnitProofPassed,
      allProofbookEffectContinuationsAreAdmissionGated: proofbookEffectAdapterProofPassed,
      liveSidecarHttpAdmissionIsFailClosed: liveSidecarHttpProofPassed,
    },
  },
  externalProof: {
    realOsSleepResumeExecuted: false,
    abruptHostPowerLossExecuted: false,
    codexWatchdogSleepGapExecuted: false,
    codexWatchdogSleepGapStatus: "excluded-non-product-helper",
    status: "deferred-to-a9-operator-proof",
    requiredArtifact: ".codex-auto/operator-evidence/real-sleep-power-loss-durability.json",
    protocolCompatibilityResidual: {
      currentProtocolVersion: 4,
      legacyLiveSidecarVersion: 3,
      status: "nonblocking-restart-required",
      claim: "current v4 host-sidecar pairs only",
    },
  },
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a4-durability-acceptance.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "scripts/verify-a4-durability-contract.mjs",
      "src-tauri/src/db/migrations.rs",
      "src-tauri/src/db/queries.rs",
      "src-tauri/src/persistence/session_checkpoint_repo.rs",
      "src-tauri/src/agent/interactive.rs",
      "src-tauri/src/context_store/manager.rs",
      "src-tauri/src/task/manager.rs",
      "src-tauri/src/task/graph.rs",
      "src-tauri/src/task/execution.rs",
      "src-tauri/src/persistence/work_execution_repo.rs",
      "src-tauri/src/control/loop_ports.rs",
      "src-tauri/src/control/pane_fleet.rs",
      "src-tauri/src/persistence/ownership_repo.rs",
      "src-tauri/src/event_bus/mod.rs",
      "src-tauri/src/event_bus/manager.rs",
      "src-tauri/src/persistence/event_repo.rs",
      "src-tauri/src/ipc/context_commands.rs",
      "src-tauri/src/ipc/event_commands.rs",
      "src-tauri/src/ipc/session_lifecycle_commands.rs",
      "src-tauri/src/command_risk/authority.rs",
      "src-tauri/src/api/mcp.rs",
      "src-tauri/src/api/mod.rs",
      "src-tauri/src/ipc/orchestrator_commands.rs",
      "src/shared/types/eventBus.ts",
      "src/shared/hooks/useEventBus.ts",
      "src/__tests__/useEventBus.test.ts",
      "src/features/orchestrator/OrchestratorPanel.tsx",
      "docs/specs/MCP_TOOL_SURFACE_SPEC.md",
      "docs/hardening/00_README.md",
      "docs/hardening/02_SPEC.md",
      "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
      "src-tauri/src/lib.rs",
      "src-tauri/src/startup_reconciliation.rs",
      "src-tauri/src/pty_sidecar.rs",
      "src-tauri/pty-server/src/main.rs",
      "src-tauri/src/ipc/workflow_commands.rs",
      "src-tauri/src/ipc/proofbook_commands.rs",
      "src-tauri/src/durable_file.rs",
      "src-tauri/src/mux/store.rs",
      "src-tauri/src/workflow/executor.rs",
      "src-tauri/src/proofbook/ledger.rs",
      "src-tauri/src/config/settings.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
