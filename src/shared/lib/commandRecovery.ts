import type { AgentSession } from "../types/agent";
import type { AuditEventRecord } from "../types/audit";
import { type AuditRecoveryHint, deriveAuditRecoveryHint, getAuditCorrelationId } from "./auditRecovery";
import {
  buildRightRailActionAuditPayload,
  deriveRightRailActions,
  type RightRailAction,
  type RightRailActionAuditPayload,
  type RightRailMode,
} from "./rightRailAdvisor";
import {
  buildWorkstationGraph,
  type FileProvenanceTrace,
  traceFileProvenance,
  type WorkstationGraph,
  type WorkstationGraphCommandBlock,
} from "./workstationGraph";

export type CommandRecoveryStatus = "ready" | "blocked";
export type CommandRecoveryGuard =
  | "failed-command-visible"
  | "manual-confirmation-required"
  | "no-silent-retry"
  | "fallback-visible"
  | "stale-state-visible";

export interface CommandRecoveryRetry {
  label: string;
  command: string;
  cwd: string;
  paneId: string | null;
  terminalId: string | null;
  processId: number | string | null;
  expectedResult: string;
}

export interface CommandRecoveryHandoff {
  label: string;
  prompt: string;
  files: string[];
  ownerIds: string[];
  commandIds: string[];
}

export interface CommandRecoveryAuditPayload extends RightRailActionAuditPayload {
  recovery: {
    failedCommandId: string;
    failedCommand: string;
    exitCode: number | null;
    auditEventId: number | null;
    correlationId: string | null;
    recoveryKind: AuditRecoveryHint["kind"];
    retryCommand: string;
    affectedFiles: string[];
    guards: CommandRecoveryGuard[];
  };
}

export interface CommandRecoveryPlan {
  status: CommandRecoveryStatus;
  failedCommand: WorkstationGraphCommandBlock | null;
  recoveryHint: AuditRecoveryHint;
  actions: RightRailAction[];
  retry: CommandRecoveryRetry | null;
  handoff: CommandRecoveryHandoff | null;
  auditPayloads: CommandRecoveryAuditPayload[];
  guards: CommandRecoveryGuard[];
  provenance: FileProvenanceTrace[];
  checks: {
    failedCommandDetected: boolean;
    recoveryHintReady: boolean;
    retryReady: boolean;
    handoffReady: boolean;
    auditPayloadsReady: boolean;
    noSilentFallback: boolean;
  };
}

export interface CommandRecoveryPlanInput {
  workspaceId: string;
  sessions: readonly AgentSession[];
  commandBlocks: readonly WorkstationGraphCommandBlock[];
  auditEvents?: readonly AuditEventRecord[];
  workstationGraph?: WorkstationGraph;
  changedFilesCount?: number;
  pendingDecisionCount?: number;
  previousMode?: RightRailMode;
  contextWarnPct?: number;
}

function isFailedCommand(command: WorkstationGraphCommandBlock): boolean {
  if (typeof command.exitCode === "number" && command.exitCode !== 0) return true;
  return String(command.status ?? "").toLowerCase() === "failed";
}

function commandFiles(command: WorkstationGraphCommandBlock): string[] {
  return [...new Set((command.filePaths ?? []).map((path) => path.replace(/\\/g, "/")).filter(Boolean))];
}

function findAuditEvent(
  command: WorkstationGraphCommandBlock | null,
  auditEvents: readonly AuditEventRecord[],
): AuditEventRecord | null {
  if (!command) return auditEvents.find((event) => event.severity === "error" || event.severity === "warn") ?? null;
  const commandId = command.id.toLowerCase();
  return (
    auditEvents.find((event) => {
      const metadata = event.metadata ?? {};
      return (
        String(metadata.commandBlockId ?? "").toLowerCase() === commandId ||
        String(metadata.commandId ?? "").toLowerCase() === commandId ||
        String(metadata.failedCommandId ?? "").toLowerCase() === commandId ||
        String(metadata.command ?? "") === command.command ||
        String(event.entityId ?? "").toLowerCase() === commandId
      );
    }) ??
    auditEvents.find((event) => event.severity === "error" || event.severity === "warn") ??
    null
  );
}

function synthesizeAuditEvent(command: WorkstationGraphCommandBlock | null): AuditEventRecord {
  return {
    id: 0,
    timestamp: new Date(0).toISOString(),
    category: "terminal",
    action: command ? "command_failed" : "command_recovery_missing_failed_command",
    severity: command ? "error" : "warn",
    entityType: command ? "command_block" : null,
    entityId: command?.id ?? null,
    summary: command ? `Command failed: ${command.command}` : "No failed command block was available",
    metadata: {
      commandBlockId: command?.id,
      command: command?.command,
      exitCode: command?.exitCode,
      paneId: command?.paneId,
      terminalId: command?.terminalId,
    },
  };
}

function recoveryGuards(
  command: WorkstationGraphCommandBlock | null,
  auditEvent: AuditEventRecord | null,
): CommandRecoveryGuard[] {
  const source = `${auditEvent?.action ?? ""} ${auditEvent?.summary ?? ""} ${JSON.stringify(auditEvent?.metadata ?? {})}`;
  const guards: CommandRecoveryGuard[] = ["failed-command-visible", "manual-confirmation-required", "no-silent-retry"];
  if (/fallback|native/i.test(source)) guards.push("fallback-visible");
  if (/stale|orphan|expired/i.test(source)) guards.push("stale-state-visible");
  if (!command) guards.push("stale-state-visible");
  return [...new Set(guards)];
}

function buildRetry(command: WorkstationGraphCommandBlock | null): CommandRecoveryRetry | null {
  if (!command) return null;
  return {
    label: "Retry failed command",
    command: command.command,
    cwd: command.cwd,
    paneId: command.paneId ?? null,
    terminalId: command.terminalId ?? null,
    processId: command.processId ?? null,
    expectedResult: "Retry is prepared for the same pane, cwd, and command after the owner confirms recovery.",
  };
}

function buildHandoff(
  command: WorkstationGraphCommandBlock | null,
  provenance: readonly FileProvenanceTrace[],
  recoveryHint: AuditRecoveryHint,
): CommandRecoveryHandoff | null {
  if (!command) return null;
  const files = commandFiles(command);
  const ownerIds = [...new Set(provenance.flatMap((trace) => trace.owners.map((owner) => owner.id)))];
  const commandIds = [...new Set(provenance.flatMap((trace) => trace.commands.map((item) => item.id)))];
  const fileList = files.length > 0 ? files.join(", ") : "no explicit file path";
  const ownerList = ownerIds.length > 0 ? ownerIds.join(", ") : (command.agentId ?? "unknown owner");
  return {
    label: "Create recovery handoff",
    files,
    ownerIds,
    commandIds,
    prompt: [
      "Recover the failed terminal command without losing provenance.",
      `Command: ${command.command}`,
      `Cwd: ${command.cwd}`,
      `Exit: ${command.exitCode ?? "unknown"}`,
      `Files: ${fileList}`,
      `Owner: ${ownerList}`,
      `Recovery hint: ${recoveryHint.label} - ${recoveryHint.detail}`,
      "Before retrying, inspect the audit payload, confirm the target pane is live, and record the outcome.",
    ].join("\n"),
  };
}

function buildGraph(
  input: CommandRecoveryPlanInput,
  failedCommand: WorkstationGraphCommandBlock | null,
): WorkstationGraph {
  return (
    input.workstationGraph ??
    buildWorkstationGraph({
      workspaceId: input.workspaceId,
      sessions: input.sessions,
      commandBlocks: input.commandBlocks,
      changedFiles: commandFiles(failedCommand ?? input.commandBlocks[0]).map((path) => ({ path, status: "modified" })),
    })
  );
}

function enrichAuditPayload(
  payload: RightRailActionAuditPayload,
  command: WorkstationGraphCommandBlock,
  auditEvent: AuditEventRecord | null,
  recoveryHint: AuditRecoveryHint,
  guards: readonly CommandRecoveryGuard[],
): CommandRecoveryAuditPayload {
  return {
    ...payload,
    recovery: {
      failedCommandId: command.id,
      failedCommand: command.command,
      exitCode: command.exitCode ?? null,
      auditEventId: auditEvent?.id ?? null,
      correlationId: getAuditCorrelationId(auditEvent?.metadata),
      recoveryKind: recoveryHint.kind,
      retryCommand: command.command,
      affectedFiles: commandFiles(command),
      guards: [...guards],
    },
  };
}

export function deriveCommandRecoveryPlan(input: CommandRecoveryPlanInput): CommandRecoveryPlan {
  const failedCommand = input.commandBlocks.find(isFailedCommand) ?? null;
  const auditEvent = findAuditEvent(failedCommand, input.auditEvents ?? []);
  const recoveryEvent = auditEvent ?? synthesizeAuditEvent(failedCommand);
  const recoveryHint = deriveAuditRecoveryHint(recoveryEvent);
  const guards = recoveryGuards(failedCommand, auditEvent);
  const graph = buildGraph(input, failedCommand);
  const provenance = failedCommand ? commandFiles(failedCommand).map((path) => traceFileProvenance(graph, path)) : [];
  const changedFilesCount = Math.max(
    input.changedFilesCount ?? 0,
    failedCommand ? commandFiles(failedCommand).length : 0,
  );
  const actions = deriveRightRailActions({
    sessions: [...input.sessions],
    interactiveSessionCount: 0,
    changedFilesCount,
    pendingDecisionCount: input.pendingDecisionCount ?? 0,
    contextWarnPct: input.contextWarnPct ?? 85,
    currentMode: input.previousMode ?? "command",
    workstationGraph: graph,
  });
  const retry = buildRetry(failedCommand);
  const handoff = buildHandoff(failedCommand, provenance, recoveryHint);
  const recoveryActions = actions.filter((action) =>
    ["recover-attention", "inspect-risk", "resolve-approvals", "inspect-cli-boundary", "handoff-context"].includes(
      action.id,
    ),
  );
  const auditPayloads =
    failedCommand == null
      ? []
      : (recoveryActions.length > 0 ? recoveryActions : actions)
          .slice(0, 4)
          .map((action) =>
            enrichAuditPayload(
              buildRightRailActionAuditPayload(action, input.previousMode ?? "command"),
              failedCommand,
              auditEvent,
              recoveryHint,
              guards,
            ),
          );
  const checks = {
    failedCommandDetected: failedCommand != null,
    recoveryHintReady: recoveryHint.recoverable,
    retryReady: retry != null && retry.command.length > 0 && retry.cwd.length > 0,
    handoffReady: Boolean(handoff?.prompt.includes(failedCommand?.command ?? "__missing__")),
    auditPayloadsReady:
      auditPayloads.length > 0 &&
      auditPayloads.every((payload) => payload.recovery.failedCommandId === failedCommand?.id && payload.nextStep),
    noSilentFallback: guards.includes("manual-confirmation-required") && guards.includes("no-silent-retry"),
  };

  return {
    status: Object.values(checks).every(Boolean) ? "ready" : "blocked",
    failedCommand,
    recoveryHint,
    actions,
    retry,
    handoff,
    auditPayloads,
    guards,
    provenance,
    checks,
  };
}
