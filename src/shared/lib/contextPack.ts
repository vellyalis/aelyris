import type { GitChangedFile } from "./reviewQueue";
import {
  listWorkstationGraphChangedFiles,
  type WorkstationGraph,
  type WorkstationGraphPane,
} from "./workstationGraph";
import type { AgentSession } from "../types/agent";
import type { AuditEventRecord } from "../types/audit";

export interface ContextPackWorkspace {
  name: string;
  path: string;
  branch?: string | null;
  threadId?: string | null;
}

export interface ContextPackActiveTask {
  id: string;
  title: string;
  status?: string;
  nextAction?: string;
  parentRoadmapId?: string;
  reason?: string;
}

export interface ContextPackCommand {
  command: string;
  result?: string;
  status?: string;
  at?: string;
  source?: string;
}

export interface ContextPackValidation {
  command: string;
  result: string;
  evidence?: string;
  at?: string;
}

export interface ContextPackBlocker {
  id: string;
  kind: string;
  status: string;
  reason: string;
  nextAction?: string;
  retryable?: boolean;
}

export interface ContextPackDecision {
  id: string;
  decision: string;
  rationale?: string;
  at?: string;
  evidence?: readonly string[];
}

export interface ContextPackRisk {
  id: string;
  title: string;
  status?: string;
  severity?: string;
  mitigation?: string;
  evidence?: string;
}

export interface ContextPackFinalReport {
  title?: string;
  summary: string;
  markdown?: string;
  path?: string;
  generatedAt?: string;
  json?: unknown;
}

export interface ContextPackInput {
  workspace: ContextPackWorkspace;
  generatedAt?: string;
  activeTask?: ContextPackActiveTask | null;
  changedFiles?: readonly GitChangedFile[];
  diffSummary?: string;
  sessions?: readonly AgentSession[];
  panes?: readonly WorkstationGraphPane[];
  auditEvents?: readonly AuditEventRecord[];
  commandsRun?: readonly ContextPackCommand[];
  validations?: readonly ContextPackValidation[];
  blockers?: readonly ContextPackBlocker[];
  decisions?: readonly ContextPackDecision[];
  risks?: readonly ContextPackRisk[];
  finalReport?: ContextPackFinalReport | null;
  dashboardState?: unknown;
  workstationGraph?: WorkstationGraph | null;
}

export interface ContextPackTranscript {
  sessionId: string;
  name: string;
  status: AgentSession["status"];
  model: string;
  role?: AgentSession["role"];
  handoffFrom?: string;
  tokensUsed: number;
  filesChanged: number;
  latestLogs: Array<{ timestamp: number; type: AgentSession["logs"][number]["type"]; summary: string }>;
}

export interface ContextPackJson {
  version: 1;
  generatedAt: string;
  workspace: ContextPackWorkspace;
  activeTask: ContextPackActiveTask | null;
  summary: {
    threadSummary: string;
    nextActions: string[];
    changedFileCount: number;
    sessionCount: number;
    paneCount: number;
    validationCount: number;
    blockerCount: number;
    openRiskCount: number;
    finalReportIncluded: boolean;
    redactionCount: number;
  };
  changedFiles: GitChangedFile[];
  diffSummary: string;
  agentTranscripts: ContextPackTranscript[];
  panes: WorkstationGraphPane[];
  commandsRun: ContextPackCommand[];
  validations: ContextPackValidation[];
  blockers: ContextPackBlocker[];
  decisions: ContextPackDecision[];
  risks: ContextPackRisk[];
  finalReport: ContextPackFinalReport | null;
  dashboardState: unknown;
  workstationGraph: {
    nodeCount: number;
    edgeCount: number;
    danglingEdgeCount: number;
    nodeCountByKind: WorkstationGraph["nodeCountByKind"] | null;
  };
}

export interface BuiltContextPack {
  markdown: string;
  json: ContextPackJson;
  threadSummary: string;
}

interface RedactionResult {
  text: string;
  count: number;
}

const BLOCKER_PATTERN = /(blocked|blocker|needs_attention|permission|denied|failed|error|timeout)/i;
const DECISION_PATTERN = /(decision|approve|approved|denied|gate|watchdog|policy)/i;
const FINAL_REPORT_PATTERN = /(final[_ -]?report|final report written|report_written)/i;
const VALIDATION_PATTERN = /(test|validation|vitest|playwright|tsc|cargo|passed|failed)/i;
const MAX_TRANSCRIPT_LOGS = 3;
const MAX_LOG_SUMMARY = 360;

export function buildContextPack(input: ContextPackInput): BuiltContextPack {
  const redactions = { count: 0 };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sessions = [...(input.sessions ?? [])];
  const auditEvents = [...(input.auditEvents ?? [])].sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
  const changedFiles = collectChangedFiles(input, sessions);
  const finalReport = redactFinalReport(input.finalReport ?? finalReportFromAudit(auditEvents), redactions);
  const blockers = redactBlockers([...deriveBlockers(sessions, auditEvents), ...(input.blockers ?? [])], redactions);
  const decisions = redactDecisions([...deriveDecisions(auditEvents), ...(input.decisions ?? [])], redactions);
  const risks = redactRisks([...(input.risks ?? []), ...deriveRisks(auditEvents)], redactions);
  const validations = redactValidations([...(input.validations ?? []), ...deriveValidations(auditEvents)], redactions);
  const commandsRun = redactCommands(input.commandsRun ?? [], redactions);
  const diffSummary = redactText(input.diffSummary ?? diffSummaryFromFiles(changedFiles), redactions).text;
  const transcripts = sessions.map((session) => transcriptForSession(session, redactions));
  const dashboardState = redactUnknown(input.dashboardState ?? null, redactions);
  const workspace = redactUnknown(input.workspace, redactions) as ContextPackWorkspace;
  const activeTask = input.activeTask ? redactActiveTask(input.activeTask, redactions) : null;
  const panes = (input.panes ?? []).map((pane) => redactUnknown(pane, redactions) as WorkstationGraphPane);
  const nextActions = collectNextActions({ activeTask, blockers, validations, changedFiles, finalReport });
  const openRiskCount = risks.filter((risk) => risk.status !== "mitigated" && risk.status !== "closed").length;

  const threadSummary = buildThreadSummary({
    workspace: input.workspace,
    activeTask,
    changedFileCount: changedFiles.length,
    sessionCount: sessions.length,
    paneCount: panes.length,
    validationCount: validations.length,
    blockerCount: blockers.length,
    openRiskCount,
    finalReportIncluded: Boolean(finalReport),
    nextActions,
  });

  const graph = input.workstationGraph;
  const json: ContextPackJson = {
    version: 1,
    generatedAt,
    workspace,
    activeTask,
    summary: {
      threadSummary,
      nextActions,
      changedFileCount: changedFiles.length,
      sessionCount: sessions.length,
      paneCount: panes.length,
      validationCount: validations.length,
      blockerCount: blockers.length,
      openRiskCount,
      finalReportIncluded: Boolean(finalReport),
      redactionCount: redactions.count,
    },
    changedFiles,
    diffSummary,
    agentTranscripts: transcripts,
    panes,
    commandsRun,
    validations,
    blockers,
    decisions,
    risks,
    finalReport,
    dashboardState,
    workstationGraph: {
      nodeCount: graph?.nodes.length ?? 0,
      edgeCount: graph?.edges.length ?? 0,
      danglingEdgeCount: graph?.integrity.danglingEdgeCount ?? 0,
      nodeCountByKind: graph?.nodeCountByKind ?? null,
    },
  };

  return {
    markdown: buildContextPackMarkdown(json),
    json,
    threadSummary,
  };
}

export function buildContextPackMarkdown(pack: ContextPackJson): string {
  const lines: string[] = [];
  lines.push(`# Context Pack: ${pack.workspace.name || "Workspace"}`);
  lines.push("");
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push(`Workspace: ${pack.workspace.path || "unknown"}`);
  if (pack.workspace.branch) lines.push(`Branch: ${pack.workspace.branch}`);
  if (pack.workspace.threadId) lines.push(`Thread: ${pack.workspace.threadId}`);
  lines.push("");
  lines.push("## Thread Summary");
  lines.push(pack.summary.threadSummary);
  lines.push("");
  if (pack.activeTask) {
    lines.push("## Active Task");
    lines.push(`- ${pack.activeTask.id}: ${pack.activeTask.title}`);
    if (pack.activeTask.status) lines.push(`- Status: ${pack.activeTask.status}`);
    if (pack.activeTask.parentRoadmapId) lines.push(`- Parent roadmap: ${pack.activeTask.parentRoadmapId}`);
    if (pack.activeTask.reason) lines.push(`- Reason: ${pack.activeTask.reason}`);
    lines.push("");
  }
  appendList(lines, "Next Actions", pack.summary.nextActions);
  appendFiles(lines, pack.changedFiles);
  lines.push("## Diff Summary");
  lines.push(pack.diffSummary || "No diff summary supplied.");
  lines.push("");
  appendTranscripts(lines, pack.agentTranscripts);
  appendPanes(lines, pack.panes);
  appendCommands(lines, pack.commandsRun);
  appendValidations(lines, pack.validations);
  appendBlockers(lines, pack.blockers);
  appendDecisions(lines, pack.decisions);
  appendRisks(lines, pack.risks);
  appendFinalReport(lines, pack.finalReport);
  lines.push("## Graph And Redaction");
  lines.push(
    `- Graph: ${pack.workstationGraph.nodeCount} nodes, ${pack.workstationGraph.edgeCount} edges, ${pack.workstationGraph.danglingEdgeCount} dangling`,
  );
  lines.push(`- Redactions applied: ${pack.summary.redactionCount}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function redactSensitiveText(value: string): string {
  return redactText(value, { count: 0 }).text;
}

function collectChangedFiles(input: ContextPackInput, sessions: readonly AgentSession[]): GitChangedFile[] {
  const byPath = new Map<string, GitChangedFile>();
  for (const file of input.workstationGraph ? listWorkstationGraphChangedFiles(input.workstationGraph) : []) {
    byPath.set(normalizePath(file.path).toLowerCase(), { path: normalizePath(file.path), status: file.status });
  }
  for (const file of input.changedFiles ?? []) {
    byPath.set(normalizePath(file.path).toLowerCase(), { path: normalizePath(file.path), status: file.status });
  }
  for (const session of sessions) {
    for (const detail of session.changedFileDetails ?? []) {
      const path = normalizePath(detail.path);
      byPath.set(path.toLowerCase(), { path, status: detail.action });
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function transcriptForSession(session: AgentSession, redactions: { count: number }): ContextPackTranscript {
  const logs = session.logs
    .filter((log) => log.content.trim().length > 0)
    .slice(-MAX_TRANSCRIPT_LOGS)
    .map((log) => ({
      timestamp: log.timestamp,
      type: log.type,
      summary: truncate(redactText(log.content.replace(/\s+/g, " ").trim(), redactions).text, MAX_LOG_SUMMARY),
    }));
  return {
    sessionId: session.id,
    name: redactText(session.name, redactions).text,
    status: session.status,
    model: redactText(session.model, redactions).text,
    role: session.role,
    handoffFrom: session.handoffFrom,
    tokensUsed: session.tokensUsed,
    filesChanged: session.filesChanged ?? session.changedFileDetails?.length ?? 0,
    latestLogs: logs,
  };
}

function deriveBlockers(sessions: readonly AgentSession[], auditEvents: readonly AuditEventRecord[]): ContextPackBlocker[] {
  const sessionBlockers = sessions
    .filter((session) => session.status === "waiting" || session.status === "error")
    .map<ContextPackBlocker>((session) => ({
      id: `session-${session.id}`,
      kind: session.status === "error" ? "validation_failed" : "unknown",
      status: session.status,
      reason: `${session.name} is ${session.status}`,
      nextAction: "Inspect agent output and resolve the blocking condition.",
      retryable: session.status !== "waiting",
    }));
  const auditBlockers = auditEvents.filter(isBlockingAudit).map<ContextPackBlocker>((event) => ({
    id: `audit-${event.id}`,
    kind: event.category || "unknown",
    status: event.severity,
    reason: event.summary || event.action,
    nextAction: "Review the related audit event before resuming.",
    retryable: event.severity !== "error",
  }));
  return uniqueById([...sessionBlockers, ...auditBlockers]);
}

function deriveDecisions(auditEvents: readonly AuditEventRecord[]): ContextPackDecision[] {
  return auditEvents.filter(isDecisionAudit).map((event) => ({
    id: `audit-${event.id}`,
    at: event.timestamp,
    decision: event.summary || event.action,
    rationale: event.category,
    evidence: [event.action],
  }));
}

function deriveRisks(auditEvents: readonly AuditEventRecord[]): ContextPackRisk[] {
  return auditEvents
    .filter((event) => event.severity === "warn" || event.severity === "error")
    .map((event) => ({
      id: `audit-${event.id}`,
      title: event.summary || event.action,
      severity: event.severity,
      status: "open",
      evidence: event.category,
    }));
}

function deriveValidations(auditEvents: readonly AuditEventRecord[]): ContextPackValidation[] {
  return auditEvents.filter(isValidationAudit).map((event) => ({
    at: event.timestamp,
    command: event.summary || event.action,
    result: event.severity === "error" ? "fail" : "pass",
    evidence: event.category,
  }));
}

function finalReportFromAudit(auditEvents: readonly AuditEventRecord[]): ContextPackFinalReport | null {
  const event = auditEvents.find(isFinalReportAudit);
  if (!event) return null;
  return {
    title: event.action || "Final report",
    summary: event.summary,
    generatedAt: event.timestamp,
    json: event.metadata,
  };
}

function collectNextActions({
  activeTask,
  blockers,
  validations,
  changedFiles,
  finalReport,
}: {
  activeTask: ContextPackActiveTask | null;
  blockers: readonly ContextPackBlocker[];
  validations: readonly ContextPackValidation[];
  changedFiles: readonly GitChangedFile[];
  finalReport: ContextPackFinalReport | null;
}): string[] {
  const actions = new Set<string>();
  if (activeTask?.nextAction) actions.add(activeTask.nextAction);
  for (const blocker of blockers) {
    if (blocker.nextAction) actions.add(blocker.nextAction);
  }
  if (changedFiles.length > 0) actions.add(`Review ${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"}.`);
  if (validations.some((validation) => validation.result !== "pass")) actions.add("Re-run failed or partial validation.");
  if (!finalReport) actions.add("Write or attach the latest final report before handoff.");
  return [...actions].slice(0, 6);
}

function buildThreadSummary({
  workspace,
  activeTask,
  changedFileCount,
  sessionCount,
  paneCount,
  validationCount,
  blockerCount,
  openRiskCount,
  finalReportIncluded,
  nextActions,
}: {
  workspace: ContextPackWorkspace;
  activeTask: ContextPackActiveTask | null;
  changedFileCount: number;
  sessionCount: number;
  paneCount: number;
  validationCount: number;
  blockerCount: number;
  openRiskCount: number;
  finalReportIncluded: boolean;
  nextActions: readonly string[];
}): string {
  const task = activeTask ? `${activeTask.id} ${activeTask.title}` : "no active task";
  const next = nextActions[0] ?? "continue from the recorded active task";
  return [
    `${workspace.name || "Workspace"} is at ${task}.`,
    `${changedFileCount} changed files, ${sessionCount} agent sessions, ${paneCount} panes, ${validationCount} validation entries.`,
    `${blockerCount} blockers and ${openRiskCount} open risks are recorded.`,
    `Final report included: ${finalReportIncluded ? "yes" : "no"}.`,
    `Next: ${next}`,
  ].join(" ");
}

function diffSummaryFromFiles(files: readonly GitChangedFile[]): string {
  if (files.length === 0) return "No changed files reported.";
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.status || "modified", (counts.get(file.status || "modified") ?? 0) + 1);
  return [...counts.entries()]
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
}

function redactCommands(commands: readonly ContextPackCommand[], redactions: { count: number }): ContextPackCommand[] {
  return commands.map((command) => ({
    ...command,
    command: redactText(command.command, redactions).text,
    result: command.result ? redactText(command.result, redactions).text : command.result,
    source: command.source ? redactText(command.source, redactions).text : command.source,
  }));
}

function redactValidations(
  validations: readonly ContextPackValidation[],
  redactions: { count: number },
): ContextPackValidation[] {
  return uniqueById(
    validations.map((validation, index) => ({
      ...validation,
      id: String(index),
      command: redactText(validation.command, redactions).text,
      evidence: validation.evidence ? redactText(validation.evidence, redactions).text : validation.evidence,
    })),
  ).map(({ id: _id, ...validation }) => validation);
}

function redactBlockers(blockers: readonly ContextPackBlocker[], redactions: { count: number }): ContextPackBlocker[] {
  return uniqueById(
    blockers.map((blocker) => ({
      ...blocker,
      reason: redactText(blocker.reason, redactions).text,
      nextAction: blocker.nextAction ? redactText(blocker.nextAction, redactions).text : blocker.nextAction,
    })),
  );
}

function redactDecisions(
  decisions: readonly ContextPackDecision[],
  redactions: { count: number },
): ContextPackDecision[] {
  return uniqueById(
    decisions.map((decision) => ({
      ...decision,
      decision: redactText(decision.decision, redactions).text,
      rationale: decision.rationale ? redactText(decision.rationale, redactions).text : decision.rationale,
      evidence: decision.evidence?.map((item) => redactText(item, redactions).text),
    })),
  );
}

function redactRisks(risks: readonly ContextPackRisk[], redactions: { count: number }): ContextPackRisk[] {
  return uniqueById(
    risks.map((risk) => ({
      ...risk,
      title: redactText(risk.title, redactions).text,
      mitigation: risk.mitigation ? redactText(risk.mitigation, redactions).text : risk.mitigation,
      evidence: risk.evidence ? redactText(risk.evidence, redactions).text : risk.evidence,
    })),
  );
}

function redactFinalReport(
  report: ContextPackFinalReport | null,
  redactions: { count: number },
): ContextPackFinalReport | null {
  if (!report) return null;
  return {
    ...report,
    title: report.title ? redactText(report.title, redactions).text : report.title,
    summary: redactText(report.summary, redactions).text,
    markdown: report.markdown ? redactText(report.markdown, redactions).text : report.markdown,
    path: report.path ? redactText(report.path, redactions).text : report.path,
    json: report.json == null ? report.json : redactUnknown(report.json, redactions),
  };
}

function redactActiveTask(task: ContextPackActiveTask, redactions: { count: number }): ContextPackActiveTask {
  return {
    ...task,
    title: redactText(task.title, redactions).text,
    nextAction: task.nextAction ? redactText(task.nextAction, redactions).text : task.nextAction,
  };
}

function redactUnknown(value: unknown, redactions: { count: number }, key = ""): unknown {
  if (typeof value === "string") {
    if (isSensitivePayloadKey(key)) {
      redactions.count += 1;
      return "[redacted]";
    }
    return redactText(value, redactions).text;
  }
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, redactions, key));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) out[entryKey] = redactUnknown(entryValue, redactions, entryKey);
  return out;
}

function redactText(value: string, redactions: { count: number }): RedactionResult {
  let text = value;
  let count = 0;
  const replacements: Array<[RegExp, string]> = [
    [/\b(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]"],
    [/\b(AETHER_API_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|TOKEN|API_KEY|SECRET|PASSWORD)\s*=\s*("[^"]+"|'[^']+'|[^\s;&]+)/gi, "$1=[redacted]"],
    [/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted:api_key]"],
    [/\b(gh[pousr]_[A-Za-z0-9_]{8,})\b/g, "[redacted:token]"],
    [/\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, "[redacted:token]"],
    [/(--(?:token|api-key|password|secret)\s+)(?:"[^"]+"|'[^']+'|\S+)/gi, "$1[redacted]"],
    [/\b(token|api_key|apikey|secret|password)=("[^"]+"|'[^']+'|[^\s;&]+)/gi, "$1=[redacted]"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, (match: string) => {
      count += 1;
      return match.replace(pattern, replacement);
    });
  }
  redactions.count += count;
  return { text, count };
}

function isSensitivePayloadKey(key: string): boolean {
  return /^(rawPayload|payloadJson|fileContent|rawContent|environment|env|authorization|password|secret|token|apiKey|api_key)$/i.test(
    key,
  );
}

function isBlockingAudit(event: AuditEventRecord): boolean {
  const source = `${event.category} ${event.action} ${event.summary}`;
  return (event.severity === "warn" || event.severity === "error") && BLOCKER_PATTERN.test(source);
}

function isDecisionAudit(event: AuditEventRecord): boolean {
  const source = `${event.category} ${event.action} ${event.summary}`;
  return DECISION_PATTERN.test(source);
}

function isValidationAudit(event: AuditEventRecord): boolean {
  const source = `${event.category} ${event.action} ${event.summary}`;
  return VALIDATION_PATTERN.test(source);
}

function isFinalReportAudit(event: AuditEventRecord): boolean {
  const source = `${event.category} ${event.action} ${event.summary}`;
  return FINAL_REPORT_PATTERN.test(source);
}

function appendList(lines: string[], title: string, items: readonly string[]): void {
  lines.push(`## ${title}`);
  if (items.length === 0) lines.push("- None recorded.");
  for (const item of items) lines.push(`- ${item}`);
  lines.push("");
}

function appendFiles(lines: string[], files: readonly GitChangedFile[]): void {
  lines.push("## Changed Files");
  if (files.length === 0) lines.push("- None reported.");
  for (const file of files.slice(0, 40)) lines.push(`- ${file.status || "modified"} ${file.path}`);
  if (files.length > 40) lines.push(`- ... ${files.length - 40} more`);
  lines.push("");
}

function appendTranscripts(lines: string[], transcripts: readonly ContextPackTranscript[]): void {
  lines.push("## Agent Transcripts");
  if (transcripts.length === 0) lines.push("- No agent transcripts recorded.");
  for (const transcript of transcripts) {
    lines.push(
      `- ${transcript.name} (${transcript.model}, ${transcript.status}): ${transcript.tokensUsed} tokens, ${transcript.filesChanged} files`,
    );
    for (const log of transcript.latestLogs) lines.push(`  - ${log.type}: ${log.summary}`);
  }
  lines.push("");
}

function appendPanes(lines: string[], panes: readonly WorkstationGraphPane[]): void {
  lines.push("## Pane State");
  if (panes.length === 0) lines.push("- No pane state supplied.");
  for (const pane of panes) {
    const label = pane.title || pane.role || pane.paneId;
    lines.push(`- ${pane.paneId}: ${label} / ${pane.status ?? "unknown"} / terminal ${pane.terminalId ?? "none"}`);
  }
  lines.push("");
}

function appendCommands(lines: string[], commands: readonly ContextPackCommand[]): void {
  lines.push("## Commands Run");
  if (commands.length === 0) lines.push("- No commands supplied.");
  for (const command of commands.slice(0, 20)) {
    const suffix = command.result || command.status ? ` -> ${command.result ?? command.status}` : "";
    lines.push(`- ${command.command}${suffix}`);
  }
  lines.push("");
}

function appendValidations(lines: string[], validations: readonly ContextPackValidation[]): void {
  lines.push("## Validation");
  if (validations.length === 0) lines.push("- No validation entries supplied.");
  for (const validation of validations) {
    lines.push(`- ${validation.result}: ${validation.command}${validation.evidence ? ` (${validation.evidence})` : ""}`);
  }
  lines.push("");
}

function appendBlockers(lines: string[], blockers: readonly ContextPackBlocker[]): void {
  lines.push("## Blockers");
  if (blockers.length === 0) lines.push("- None recorded.");
  for (const blocker of blockers) lines.push(`- ${blocker.kind}/${blocker.status}: ${blocker.reason}`);
  lines.push("");
}

function appendDecisions(lines: string[], decisions: readonly ContextPackDecision[]): void {
  lines.push("## Decisions");
  if (decisions.length === 0) lines.push("- None recorded.");
  for (const decision of decisions.slice(0, 12)) {
    lines.push(`- ${decision.decision}${decision.rationale ? ` (${decision.rationale})` : ""}`);
  }
  lines.push("");
}

function appendRisks(lines: string[], risks: readonly ContextPackRisk[]): void {
  lines.push("## Risks");
  if (risks.length === 0) lines.push("- None recorded.");
  for (const risk of risks.slice(0, 16)) lines.push(`- ${risk.severity ?? "risk"}/${risk.status ?? "open"}: ${risk.title}`);
  lines.push("");
}

function appendFinalReport(lines: string[], finalReport: ContextPackFinalReport | null): void {
  lines.push("## Final Report");
  if (!finalReport) {
    lines.push("- Not included.");
  } else {
    if (finalReport.title) lines.push(`- ${finalReport.title}`);
    lines.push(finalReport.summary);
    if (finalReport.path) lines.push(`Path: ${finalReport.path}`);
  }
  lines.push("");
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
