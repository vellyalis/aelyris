import type { AgentCloseState, AgentFinalReportStatus, AgentSession } from "../types/agent";
import { extractToolName, type ToolName } from "../types/toolBadge";
import { parseToolUse } from "./agentLogParser";
import { agentContextPercent, agentFileCount, isLiveAgentStatus } from "./workstationSummary";

export type RunGraphState = "blocked" | "stale" | "live" | "done" | "idle";
export type RunGraphContextBand = "ok" | "warn" | "critical";

export interface RunGraphNode {
  id: string;
  name: string;
  status: AgentSession["status"];
  state: RunGraphState;
  role?: AgentSession["role"];
  parentId?: string;
  parentName?: string;
  owner: string;
  workspaceScope: string;
  childCount: number;
  depth: number;
  contextPct: number;
  contextBand: RunGraphContextBand;
  tokensUsed: number;
  filesChanged: number;
  writeSet: string[];
  latestTool: ToolName | null;
  latestSummary: string;
  lastActivity: number;
  finalReportStatus: AgentFinalReportStatus;
  closeState: AgentCloseState;
  blockedReason?: string;
  nextActor?: string;
}

export interface RunGraphSummary {
  nodes: RunGraphNode[];
  edgeCount: number;
  rootCount: number;
  tracedCount: number;
  roleCount: number;
  roleCoveragePct: number;
  maxRoleFanout: number;
  orphanCount: number;
  maxDepth: number;
  liveCount: number;
  staleCount: number;
  blockedCount: number;
  doneCount: number;
  collectableCount: number;
  finalReportCount: number;
  peakContextPct: number;
}

export interface RunGraphOptions {
  now?: number;
  staleAfterMs?: number;
}

export type WorkstationGraphNodeKind =
  | "workspace"
  | "thread"
  | "pane"
  | "terminal"
  | "process"
  | "agent"
  | "workflow"
  | "phase"
  | "tool"
  | "command_block"
  | "file"
  | "test"
  | "blocker"
  | "risk"
  | "notification"
  | "final_report"
  | "context_pack";

export type WorkstationGraphEdgeKind =
  | "spawned"
  | "owns"
  | "wrote"
  | "read"
  | "changed"
  | "tested"
  | "blocked_by"
  | "retried_by"
  | "reviewed_by"
  | "reports_to"
  | "attached_to"
  | "derived_from"
  | "used_tool"
  | "ran";

export interface WorkstationGraphNode {
  id: string;
  kind: WorkstationGraphNodeKind;
  label: string;
  status?: string;
  role?: string;
  path?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkstationGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: WorkstationGraphEdgeKind;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkstationGraphPane {
  paneId: string;
  terminalId?: string | null;
  processId?: number | string | null;
  title?: string;
  role?: string;
  status?: string;
}

export interface WorkstationGraphTest {
  id: string;
  name: string;
  status: "pass" | "fail" | "skip" | "unknown" | string;
  filePath?: string;
  agentId?: string;
}

export interface WorkstationGraphCommandBlock {
  id: string;
  command: string;
  cwd: string;
  status?: "passed" | "failed" | "running" | "unknown" | string;
  exitCode?: number | null;
  shell?: string;
  startedAt?: number | string;
  endedAt?: number | string;
  paneId?: string | null;
  terminalId?: string | null;
  processId?: number | string | null;
  agentId?: string | null;
  filePaths?: readonly string[];
  validationKind?: "test" | "lint" | "typecheck" | "build" | "format" | "smoke" | "unknown" | string;
  outputPreview?: string;
  commandSequence?: number | null;
  outputSequence?: number | null;
  endSequence?: number | null;
  commandHistorySize?: number | null;
  outputHistorySize?: number | null;
  endHistorySize?: number | null;
  commandScreenLine?: number | null;
  outputScreenLine?: number | null;
  endScreenLine?: number | null;
}

export interface WorkstationGraphRisk {
  id: string;
  title: string;
  status: "open" | "mitigated" | "closed" | string;
  severity?: string;
  filePath?: string;
  agentId?: string;
}

export interface WorkstationGraphBlocker {
  id: string;
  title: string;
  kind: string;
  status: string;
  agentId?: string;
  riskId?: string;
}

export interface WorkstationGraphArtifact {
  id: string;
  title: string;
  status?: string;
  agentId?: string;
}

export interface WorkstationGraphInput {
  workspaceId: string;
  threadId?: string;
  sessions?: readonly AgentSession[];
  panes?: readonly WorkstationGraphPane[];
  changedFiles?: readonly { path: string; status?: string }[];
  commandBlocks?: readonly WorkstationGraphCommandBlock[];
  tests?: readonly WorkstationGraphTest[];
  risks?: readonly WorkstationGraphRisk[];
  blockers?: readonly WorkstationGraphBlocker[];
  notifications?: readonly WorkstationGraphArtifact[];
  finalReports?: readonly WorkstationGraphArtifact[];
  contextPacks?: readonly WorkstationGraphArtifact[];
}

export interface WorkstationGraph {
  nodes: WorkstationGraphNode[];
  edges: WorkstationGraphEdge[];
  nodeCountByKind: Record<WorkstationGraphNodeKind, number>;
  edgeCountByKind: Partial<Record<WorkstationGraphEdgeKind, number>>;
  integrity: {
    danglingEdgeCount: number;
  };
}

export interface AgentImpactTrace {
  agentId: string;
  files: string[];
  tests: string[];
  risks: string[];
  blockers: string[];
  notifications: string[];
  finalReports: string[];
  contextPacks: string[];
}

export interface FileProvenanceTrace {
  path: string;
  owners: Array<{ id: string; name: string; role?: string; status?: string }>;
  tools: Array<{ id: string; label: string; status?: string }>;
  commands: Array<{
    id: string;
    label: string;
    command: string;
    status?: string;
    exitCode?: number | null;
    cwd?: string;
    shell?: string;
    validationKind?: string;
    terminalId?: string;
    commandSequence?: number | null;
    outputSequence?: number | null;
    endSequence?: number | null;
    commandHistorySize?: number | null;
    outputHistorySize?: number | null;
    endHistorySize?: number | null;
    commandScreenLine?: number | null;
    outputScreenLine?: number | null;
    endScreenLine?: number | null;
  }>;
  tests: Array<{ id: string; label: string; status?: string }>;
  risks: Array<{ id: string; label: string; status?: string; severity?: string }>;
  blockers: Array<{ id: string; label: string; status?: string }>;
  worktrees: string[];
  hasEvidence: boolean;
}

export interface WorkstationGraphFilter {
  agentId?: string | null;
  paneId?: string | null;
  workflowId?: string | null;
}

function latestActivity(session: AgentSession): number {
  return session.logs.at(-1)?.timestamp ?? session.startedAt;
}

function latestTool(session: AgentSession): ToolName | null {
  const log = session.logs.at(-1);
  if (!log) return null;
  const metadataTool = log.metadata?.toolName ? extractToolName(`${log.metadata.toolName}(`) : null;
  return metadataTool ?? (log.type === "tool_use" || log.type === "tool_result" ? extractToolName(log.content) : null);
}

function latestSummary(session: AgentSession): string {
  const log = session.logs.at(-1);
  const source = log?.content.trim() || session.prompt.trim() || session.status;
  const compact = source.replace(/\s+/g, " ");
  return compact.length > 86 ? `${compact.slice(0, 83)}...` : compact;
}

function runState(session: AgentSession, lastActivity: number, options?: RunGraphOptions): RunGraphState {
  if (session.status === "waiting" || session.status === "error") return "blocked";
  if (
    options?.staleAfterMs != null &&
    options.staleAfterMs >= 0 &&
    isLiveAgentStatus(session.status) &&
    (options.now ?? Date.now()) - lastActivity > options.staleAfterMs
  ) {
    return "stale";
  }
  if (isLiveAgentStatus(session.status)) return "live";
  if (session.status === "done") return "done";
  return "idle";
}

function uniqueWriteSet(session: AgentSession): string[] {
  const paths = session.writeSet?.length
    ? session.writeSet
    : (session.changedFileDetails ?? []).map((detail) => detail.path);
  return [...new Set(paths.filter(Boolean))].sort();
}

function contextBand(contextPct: number): RunGraphContextBand {
  if (contextPct >= 85) return "critical";
  if (contextPct >= 60) return "warn";
  return "ok";
}

function finalReportStatus(session: AgentSession): AgentFinalReportStatus {
  if (session.finalReport?.status) return session.finalReport.status;
  return session.status === "done" ? "missing" : "pending";
}

function closeState(session: AgentSession, reportStatus: AgentFinalReportStatus): AgentCloseState {
  if (session.closeState) return session.closeState;
  if (session.status === "done") return reportStatus === "collected" ? "collected" : "collectable";
  return "active";
}

function blockedReason(session: AgentSession): string | undefined {
  if (session.blockedReason) return session.blockedReason;
  const watchdogLog = [...session.logs]
    .reverse()
    .find((log) => log.metadata?.event === "watchdog_decision" || log.type === "error");
  if (watchdogLog?.metadata?.decision === "manual")
    return `Awaiting approval for ${watchdogLog.metadata.toolName ?? "tool"}`;
  if (watchdogLog?.metadata?.decision === "denied") return `Denied ${watchdogLog.metadata.toolName ?? "tool"}`;
  if (watchdogLog?.type === "error") return watchdogLog.content;
  if (session.status === "waiting") return "Waiting for approval";
  if (session.status === "error") return "Agent error";
  return undefined;
}

function nextActor(session: AgentSession): string | undefined {
  if (session.nextActor) return session.nextActor;
  if (session.status === "waiting") return "human";
  if (session.status === "error") return "owner";
  return undefined;
}

function ownerFor(session: AgentSession): string {
  return session.owner ?? session.role ?? "unassigned";
}

function workspaceScope(session: AgentSession): string {
  return session.workspaceScope ?? session.worktree?.path ?? session.worktree?.branch ?? "workspace";
}

export function buildRunGraph(sessions: readonly AgentSession[], options?: RunGraphOptions): RunGraphSummary {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map<string, AgentSession[]>();
  let edgeCount = 0;
  let orphanCount = 0;

  for (const session of sessions) {
    if (!session.handoffFrom) continue;
    const parent = byId.get(session.handoffFrom);
    if (!parent) {
      orphanCount += 1;
      continue;
    }
    edgeCount += 1;
    const list = children.get(parent.id) ?? [];
    list.push(session);
    children.set(parent.id, list);
  }

  const depthCache = new Map<string, number>();
  const depthFor = (session: AgentSession, seen = new Set<string>()): number => {
    const cached = depthCache.get(session.id);
    if (cached != null) return cached;
    if (!session.handoffFrom || seen.has(session.id)) {
      depthCache.set(session.id, 0);
      return 0;
    }
    const parent = byId.get(session.handoffFrom);
    if (!parent) {
      depthCache.set(session.id, 0);
      return 0;
    }
    seen.add(session.id);
    const depth = depthFor(parent, seen) + 1;
    depthCache.set(session.id, depth);
    return depth;
  };

  const nodes = sessions.map<RunGraphNode>((session) => {
    const parent = session.handoffFrom ? byId.get(session.handoffFrom) : undefined;
    const lastActivity = latestActivity(session);
    const state = runState(session, lastActivity, options);
    const reportStatus = finalReportStatus(session);
    const pct = agentContextPercent(session);
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      state,
      role: session.role,
      parentId: session.handoffFrom,
      parentName: parent?.name,
      owner: ownerFor(session),
      workspaceScope: workspaceScope(session),
      childCount: children.get(session.id)?.length ?? 0,
      depth: depthFor(session),
      contextPct: pct,
      contextBand: contextBand(pct),
      tokensUsed: session.tokensUsed,
      filesChanged: agentFileCount(session),
      writeSet: uniqueWriteSet(session),
      latestTool: latestTool(session),
      latestSummary: latestSummary(session),
      lastActivity,
      finalReportStatus: reportStatus,
      closeState: closeState(session, reportStatus),
      blockedReason: blockedReason(session),
      nextActor: nextActor(session),
    };
  });

  const stateRank: Record<RunGraphState, number> = {
    blocked: 0,
    stale: 1,
    live: 2,
    idle: 3,
    done: 4,
  };

  nodes.sort((a, b) => {
    const state = stateRank[a.state] - stateRank[b.state];
    if (state !== 0) return state;
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.lastActivity !== b.lastActivity) return b.lastActivity - a.lastActivity;
    return a.name.localeCompare(b.name);
  });

  const roles = new Set(nodes.map((node) => node.role).filter(Boolean));
  const roleCounts = new Map<string, number>();
  for (const node of nodes) {
    if (!node.role) continue;
    roleCounts.set(node.role, (roleCounts.get(node.role) ?? 0) + 1);
  }
  const peakContextPct = nodes.reduce((max, node) => Math.max(max, node.contextPct), 0);

  return {
    nodes,
    edgeCount,
    rootCount: sessions.filter((session) => !session.handoffFrom || !byId.has(session.handoffFrom)).length,
    tracedCount: sessions.filter((session) => session.role || session.handoffFrom).length,
    roleCount: roles.size,
    roleCoveragePct:
      sessions.length === 0
        ? 0
        : Math.round((sessions.filter((session) => session.role).length / sessions.length) * 100),
    maxRoleFanout: Math.max(0, ...roleCounts.values()),
    orphanCount,
    maxDepth: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
    liveCount: nodes.filter((node) => node.state === "live").length,
    staleCount: nodes.filter((node) => node.state === "stale").length,
    blockedCount: nodes.filter((node) => node.state === "blocked").length,
    doneCount: nodes.filter((node) => node.state === "done").length,
    collectableCount: nodes.filter((node) => node.closeState === "collectable").length,
    finalReportCount: nodes.filter(
      (node) => node.finalReportStatus === "ready" || node.finalReportStatus === "collected",
    ).length,
    peakContextPct,
  };
}

export function buildWorkstationGraph(input: WorkstationGraphInput): WorkstationGraph {
  const nodes = new Map<string, WorkstationGraphNode>();
  const edges = new Map<string, WorkstationGraphEdge>();
  const sessionsById = new Map((input.sessions ?? []).map((session) => [session.id, session]));
  const workspaceId = nodeId("workspace", input.workspaceId);
  const threadId = input.threadId ? nodeId("thread", input.threadId) : null;

  addNode(nodes, { id: workspaceId, kind: "workspace", label: input.workspaceId });
  if (threadId) {
    addNode(nodes, { id: threadId, kind: "thread", label: input.threadId ?? "thread" });
    addEdge(edges, workspaceId, threadId, "owns");
  }

  for (const pane of input.panes ?? []) {
    const paneNodeId = nodeId("pane", pane.paneId);
    addNode(nodes, {
      id: paneNodeId,
      kind: "pane",
      label: pane.title || pane.role || pane.paneId,
      role: pane.role,
      status: pane.status,
      metadata: { paneId: pane.paneId },
    });
    addEdge(edges, threadId ?? workspaceId, paneNodeId, "owns");
    if (pane.terminalId) {
      const terminalNodeId = nodeId("terminal", pane.terminalId);
      addNode(nodes, { id: terminalNodeId, kind: "terminal", label: pane.terminalId });
      addEdge(edges, paneNodeId, terminalNodeId, "attached_to");
    }
    if (pane.processId != null) {
      const processNodeId = nodeId("process", String(pane.processId));
      addNode(nodes, { id: processNodeId, kind: "process", label: String(pane.processId) });
      addEdge(edges, paneNodeId, processNodeId, "owns");
    }
  }

  for (const file of input.changedFiles ?? []) {
    const filePath = normalizePath(file.path);
    addNode(nodes, {
      id: nodeId("file", filePath),
      kind: "file",
      label: fileName(filePath),
      path: filePath,
      status: file.status,
    });
  }

  for (const session of input.sessions ?? []) {
    const agentNodeId = nodeId("agent", session.id);
    addNode(nodes, {
      id: agentNodeId,
      kind: "agent",
      label: session.name,
      status: session.status,
      role: session.role,
      metadata: {
        model: session.model,
        tokensUsed: session.tokensUsed,
        workspaceScope: session.workspaceScope,
        worktreePath: session.worktree?.path,
        worktreeBranch: session.worktree?.branch,
      },
    });
    const parentSession = session.handoffFrom ? sessionsById.get(session.handoffFrom) : undefined;
    addEdge(edges, threadId ?? workspaceId, agentNodeId, "owns", {
      relationship: parentSession ? "subagent" : session.handoffFrom ? "orphan_handoff" : "root",
      handoffFrom: session.handoffFrom,
    });
    if (parentSession && session.handoffFrom) {
      addEdge(edges, nodeId("agent", session.handoffFrom), agentNodeId, "spawned");
      addEdge(edges, agentNodeId, nodeId("agent", session.handoffFrom), "derived_from");
    }

    for (const detail of session.changedFileDetails ?? []) {
      const filePath = normalizePath(detail.path);
      const fileNodeId = nodeId("file", filePath);
      addNode(nodes, {
        id: fileNodeId,
        kind: "file",
        label: fileName(filePath),
        path: filePath,
        status: detail.action,
      });
      addEdge(edges, agentNodeId, fileNodeId, detail.action === "create" ? "wrote" : "changed", {
        toolName: detail.toolName,
        timestamp: detail.timestamp,
      });
    }

    for (const log of session.logs) {
      const parsed = log.type === "tool_use" ? parseToolUse(log.content) : null;
      const tool = parsed?.tool && parsed.tool !== "unknown" ? parsed.tool : latestToolFromLog(log);
      if (!tool) continue;
      const toolNodeId = nodeId("tool", `${session.id}:${log.timestamp}:${tool}`);
      addNode(nodes, {
        id: toolNodeId,
        kind: "tool",
        label: tool,
        status: log.type,
        metadata: { timestamp: log.timestamp, summary: parsed?.summary ?? log.content.slice(0, 100) },
      });
      addEdge(edges, agentNodeId, toolNodeId, "used_tool");
      if (parsed?.filePath) {
        const filePath = normalizePath(parsed.filePath);
        const fileNodeId = nodeId("file", filePath);
        addNode(nodes, { id: fileNodeId, kind: "file", label: fileName(filePath), path: filePath });
        addEdge(edges, toolNodeId, fileNodeId, parsed.isFileChange ? "changed" : "read");
      }
    }
  }

  for (const command of input.commandBlocks ?? []) {
    const commandNodeId = nodeId("command_block", command.id);
    const status = commandBlockStatus(command);
    const validationKind = inferValidationKind(command);
    addNode(nodes, {
      id: commandNodeId,
      kind: "command_block",
      label: commandLabel(command.command),
      status,
      metadata: {
        command: command.command,
        cwd: normalizePath(command.cwd),
        shell: command.shell,
        exitCode: command.exitCode,
        startedAt: command.startedAt,
        endedAt: command.endedAt,
        paneId: command.paneId,
        terminalId: command.terminalId,
        processId: command.processId,
        validationKind,
        outputPreview: command.outputPreview,
        commandSequence: command.commandSequence,
        outputSequence: command.outputSequence,
        endSequence: command.endSequence,
        commandHistorySize: command.commandHistorySize,
        outputHistorySize: command.outputHistorySize,
        endHistorySize: command.endHistorySize,
        commandScreenLine: command.commandScreenLine,
        outputScreenLine: command.outputScreenLine,
        endScreenLine: command.endScreenLine,
      },
    });

    if (command.agentId && nodes.has(nodeId("agent", command.agentId))) {
      addEdge(edges, nodeId("agent", command.agentId), commandNodeId, "ran", { command: command.command, status });
    }
    if (command.paneId) {
      const paneNodeId = nodeId("pane", command.paneId);
      if (!nodes.has(paneNodeId)) {
        addNode(nodes, { id: paneNodeId, kind: "pane", label: command.paneId, metadata: { paneId: command.paneId } });
        addEdge(edges, threadId ?? workspaceId, paneNodeId, "owns");
      }
      addEdge(edges, paneNodeId, commandNodeId, "ran", { command: command.command, status });
    }
    if (command.terminalId) {
      const terminalNodeId = nodeId("terminal", command.terminalId);
      if (!nodes.has(terminalNodeId))
        addNode(nodes, { id: terminalNodeId, kind: "terminal", label: command.terminalId });
      addEdge(edges, terminalNodeId, commandNodeId, "ran", { command: command.command, status });
    }
    if (command.processId != null) {
      const processNodeId = nodeId("process", String(command.processId));
      if (!nodes.has(processNodeId))
        addNode(nodes, { id: processNodeId, kind: "process", label: String(command.processId) });
      addEdge(edges, processNodeId, commandNodeId, "ran", { command: command.command, status });
    }

    for (const path of command.filePaths ?? []) {
      const filePath = normalizePath(path);
      const fileNodeId = nodeId("file", filePath);
      addNode(nodes, {
        id: fileNodeId,
        kind: "file",
        label: fileName(filePath),
        path: filePath,
        status: nodes.get(fileNodeId)?.status ?? "validated",
      });
      addEdge(edges, commandNodeId, fileNodeId, isValidationCommandBlock(command) ? "tested" : "read", {
        validationKind,
        exitCode: command.exitCode,
        status,
      });
    }
  }

  for (const test of input.tests ?? []) {
    const testNodeId = nodeId("test", test.id);
    addNode(nodes, { id: testNodeId, kind: "test", label: test.name, status: test.status });
    if (test.agentId) addEdge(edges, nodeId("agent", test.agentId), testNodeId, "tested");
    if (test.filePath) addEdge(edges, nodeId("file", normalizePath(test.filePath)), testNodeId, "tested");
  }

  for (const risk of input.risks ?? []) {
    const riskNodeId = nodeId("risk", risk.id);
    addNode(nodes, {
      id: riskNodeId,
      kind: "risk",
      label: risk.title,
      status: risk.status,
      severity: risk.severity,
    });
    if (risk.agentId) addEdge(edges, nodeId("agent", risk.agentId), riskNodeId, "blocked_by");
    if (risk.filePath) addEdge(edges, nodeId("file", normalizePath(risk.filePath)), riskNodeId, "blocked_by");
  }

  for (const blocker of input.blockers ?? []) {
    const blockerNodeId = nodeId("blocker", blocker.id);
    addNode(nodes, {
      id: blockerNodeId,
      kind: "blocker",
      label: blocker.title,
      status: blocker.status,
      metadata: { kind: blocker.kind },
    });
    if (blocker.agentId) addEdge(edges, nodeId("agent", blocker.agentId), blockerNodeId, "blocked_by");
    if (blocker.riskId) addEdge(edges, blockerNodeId, nodeId("risk", blocker.riskId), "derived_from");
  }

  for (const notification of input.notifications ?? []) {
    addArtifact(nodes, edges, notification, "notification", threadId ?? workspaceId);
  }
  for (const report of input.finalReports ?? []) {
    addArtifact(nodes, edges, report, "final_report", threadId ?? workspaceId);
  }
  for (const pack of input.contextPacks ?? []) {
    addArtifact(nodes, edges, pack, "context_pack", threadId ?? workspaceId);
  }

  return summarizeWorkstationGraph([...nodes.values()], [...edges.values()]);
}

export function filterWorkstationGraph(graph: WorkstationGraph, filter: WorkstationGraphFilter): WorkstationGraph {
  const seedIds = new Set<string>();
  if (filter.agentId) seedIds.add(nodeId("agent", filter.agentId));
  if (filter.paneId) seedIds.add(nodeId("pane", filter.paneId));
  if (filter.workflowId) seedIds.add(nodeId("workflow", filter.workflowId));
  if (seedIds.size === 0) return graph;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedNodeIds = new Set(seedIds);
  const expansionNodeIds = new Set<string>();
  const selectedEdges: WorkstationGraphEdge[] = [];
  const selectedEdgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!seedIds.has(edge.source) && !seedIds.has(edge.target)) continue;
    selectedEdges.push(edge);
    selectedEdgeIds.add(edge.id);
    selectedNodeIds.add(edge.source);
    selectedNodeIds.add(edge.target);
    addExpandable(edge.source);
    addExpandable(edge.target);
  }
  for (const edge of graph.edges) {
    if (selectedEdgeIds.has(edge.id)) continue;
    if (!expansionNodeIds.has(edge.source) && !expansionNodeIds.has(edge.target)) continue;
    selectedEdges.push(edge);
    selectedEdgeIds.add(edge.id);
    selectedNodeIds.add(edge.source);
    selectedNodeIds.add(edge.target);
  }

  const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
  if (selectedNodes.length === 0) return graph;
  return summarizeWorkstationGraph(selectedNodes, selectedEdges);

  function addExpandable(id: string): void {
    const kind = nodesById.get(id)?.kind;
    if (kind && kind !== "workspace" && kind !== "thread") expansionNodeIds.add(id);
  }
}

export function listWorkstationGraphChangedFiles(
  graph: WorkstationGraph | null | undefined,
): { path: string; status: string }[] {
  if (!graph) return [];
  return graph.nodes
    .filter((node) => node.kind === "file")
    .map((node) => ({
      path: node.path ?? node.label,
      status: node.status ?? "modified",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function listWorkstationGraphAgentIds(graph: WorkstationGraph | null | undefined): string[] {
  return listWorkstationGraphNodeIds(graph, "agent");
}

export function listWorkstationGraphPaneIds(graph: WorkstationGraph | null | undefined): string[] {
  return listWorkstationGraphNodeIds(graph, "pane", "paneId");
}

export function listWorkstationGraphTerminalIds(graph: WorkstationGraph | null | undefined): string[] {
  return listWorkstationGraphNodeIds(graph, "terminal", "terminalId");
}

export function listWorkstationGraphRiskIds(graph: WorkstationGraph | null | undefined): string[] {
  return listWorkstationGraphNodeIds(graph, "risk");
}

export function traceAgentImpact(graph: WorkstationGraph, agentId: string): AgentImpactTrace {
  const agentNodeId = nodeId("agent", agentId);
  const files = new Set<string>();
  const tests = new Set<string>();
  const risks = new Set<string>();
  const blockers = new Set<string>();
  const notifications = new Set<string>();
  const finalReports = new Set<string>();
  const contextPacks = new Set<string>();
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const edge of graph.edges) {
    if (edge.source === agentNodeId) collectDirectImpact(edge.target);
    const source = nodesById.get(edge.source);
    if (source?.kind === "file" && files.has(source.path ?? source.label)) collectFileImpact(edge.target);
  }

  return {
    agentId,
    files: [...files].sort(),
    tests: [...tests].sort(),
    risks: [...risks].sort(),
    blockers: [...blockers].sort(),
    notifications: [...notifications].sort(),
    finalReports: [...finalReports].sort(),
    contextPacks: [...contextPacks].sort(),
  };

  function collectDirectImpact(targetId: string): void {
    const node = nodesById.get(targetId);
    if (!node) return;
    if (node.kind === "file") files.add(node.path ?? node.label);
    if (node.kind === "test") tests.add(node.id);
    if (node.kind === "risk") risks.add(node.id);
    if (node.kind === "blocker") blockers.add(node.id);
    if (node.kind === "notification") notifications.add(node.id);
    if (node.kind === "final_report") finalReports.add(node.id);
    if (node.kind === "context_pack") contextPacks.add(node.id);
  }

  function collectFileImpact(targetId: string): void {
    const node = nodesById.get(targetId);
    if (!node) return;
    if (node.kind === "test") tests.add(node.id);
    if (node.kind === "risk") risks.add(node.id);
  }
}

export function traceFileProvenance(graph: WorkstationGraph, path: string): FileProvenanceTrace {
  const normalizedPath = normalizePath(path);
  const fileNodeId = nodeId("file", normalizedPath);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const owners = new Map<string, { id: string; name: string; role?: string; status?: string }>();
  const tools = new Map<string, { id: string; label: string; status?: string }>();
  const commands = new Map<string, FileProvenanceTrace["commands"][number]>();
  const tests = new Map<string, { id: string; label: string; status?: string }>();
  const risks = new Map<string, { id: string; label: string; status?: string; severity?: string }>();
  const blockers = new Map<string, { id: string; label: string; status?: string }>();
  const worktrees = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.target === fileNodeId) {
      const source = nodesById.get(edge.source);
      if (source?.kind === "agent") collectOwner(source);
      if (source?.kind === "tool") {
        tools.set(source.id, { id: source.id, label: source.label, status: source.status });
        for (const ownerEdge of graph.edges) {
          if (ownerEdge.target !== source.id) continue;
          const owner = nodesById.get(ownerEdge.source);
          if (owner?.kind === "agent") collectOwner(owner);
        }
      }
      if (source?.kind === "command_block") {
        collectCommand(source);
        for (const ownerEdge of graph.edges) {
          if (ownerEdge.target !== source.id) continue;
          const owner = nodesById.get(ownerEdge.source);
          if (owner?.kind === "agent") collectOwner(owner);
        }
      }
    }

    if (edge.source === fileNodeId) {
      const target = nodesById.get(edge.target);
      if (target?.kind === "test") tests.set(target.id, { id: target.id, label: target.label, status: target.status });
      if (target?.kind === "command_block") collectCommand(target);
      if (target?.kind === "risk") {
        risks.set(target.id, {
          id: target.id,
          label: target.label,
          status: target.status,
          severity: target.severity,
        });
      }
      if (target?.kind === "blocker") {
        blockers.set(target.id, { id: target.id, label: target.label, status: target.status });
      }
    }
  }

  return {
    path: normalizedPath,
    owners: [...owners.values()].sort((a, b) => a.name.localeCompare(b.name)),
    tools: [...tools.values()].sort((a, b) => a.label.localeCompare(b.label)),
    commands: [...commands.values()].sort((a, b) => a.label.localeCompare(b.label)),
    tests: [...tests.values()].sort((a, b) => a.label.localeCompare(b.label)),
    risks: [...risks.values()].sort((a, b) => a.label.localeCompare(b.label)),
    blockers: [...blockers.values()].sort((a, b) => a.label.localeCompare(b.label)),
    worktrees: [...worktrees].sort(),
    hasEvidence:
      owners.size > 0 ||
      tools.size > 0 ||
      commands.size > 0 ||
      tests.size > 0 ||
      risks.size > 0 ||
      blockers.size > 0 ||
      worktrees.size > 0,
  };

  function collectCommand(node: WorkstationGraphNode): void {
    const rawExitCode = node.metadata?.exitCode;
    const exitCode = typeof rawExitCode === "number" || rawExitCode === null ? rawExitCode : undefined;
    commands.set(node.id, {
      id: node.id,
      label: node.label,
      command: readStringMetadata(node, "command") ?? node.label,
      status: node.status,
      exitCode,
      cwd: readStringMetadata(node, "cwd") ?? undefined,
      shell: readStringMetadata(node, "shell") ?? undefined,
      validationKind: readStringMetadata(node, "validationKind") ?? undefined,
      terminalId: readStringMetadata(node, "terminalId") ?? undefined,
      commandSequence: readNumberMetadata(node, "commandSequence"),
      outputSequence: readNumberMetadata(node, "outputSequence"),
      endSequence: readNumberMetadata(node, "endSequence"),
      commandHistorySize: readNumberMetadata(node, "commandHistorySize"),
      outputHistorySize: readNumberMetadata(node, "outputHistorySize"),
      endHistorySize: readNumberMetadata(node, "endHistorySize"),
      commandScreenLine: readNumberMetadata(node, "commandScreenLine"),
      outputScreenLine: readNumberMetadata(node, "outputScreenLine"),
      endScreenLine: readNumberMetadata(node, "endScreenLine"),
    });
  }

  function collectOwner(node: WorkstationGraphNode): void {
    const id = node.id.startsWith("agent:") ? node.id.slice("agent:".length) : node.id;
    owners.set(id, { id, name: node.label, role: node.role, status: node.status });
    const worktreePath = readStringMetadata(node, "worktreePath");
    const worktreeBranch = readStringMetadata(node, "worktreeBranch");
    const workspaceScope = readStringMetadata(node, "workspaceScope");
    if (worktreePath) worktrees.add(worktreePath);
    else if (worktreeBranch) worktrees.add(worktreeBranch);
    else if (workspaceScope) worktrees.add(workspaceScope);
  }
}

function addArtifact(
  nodes: Map<string, WorkstationGraphNode>,
  edges: Map<string, WorkstationGraphEdge>,
  artifact: WorkstationGraphArtifact,
  kind: "notification" | "final_report" | "context_pack",
  ownerId: string,
): void {
  const artifactNodeId = nodeId(kind, artifact.id);
  addNode(nodes, {
    id: artifactNodeId,
    kind,
    label: artifact.title,
    status: artifact.status,
  });
  addEdge(edges, artifact.agentId ? nodeId("agent", artifact.agentId) : ownerId, artifactNodeId, "reports_to");
}

function commandBlockStatus(command: WorkstationGraphCommandBlock): string {
  if (command.status) return command.status;
  if (command.exitCode == null) return "unknown";
  return command.exitCode === 0 ? "passed" : "failed";
}

function isValidationCommandBlock(command: WorkstationGraphCommandBlock): boolean {
  return inferValidationKind(command) !== "unknown";
}

function inferValidationKind(command: WorkstationGraphCommandBlock): string {
  if (command.validationKind && command.validationKind !== "unknown") return command.validationKind;
  const value = command.command.toLowerCase();
  if (/\b(vitest|jest|playwright|pytest|cargo test|cargo nextest|go test|pnpm test|npm test|yarn test)\b/.test(value)) {
    return "test";
  }
  if (/\b(biome check|eslint|clippy|cargo clippy|npm run lint|pnpm lint|yarn lint)\b/.test(value)) return "lint";
  if (/\b(tsc|typecheck|type-check|cargo check)\b/.test(value)) return "typecheck";
  if (/\b(pnpm build|npm run build|yarn build|cargo build|tauri build)\b/.test(value)) return "build";
  if (/\b(biome format|prettier|cargo fmt|rustfmt)\b/.test(value)) return "format";
  if (/\b(smoke|verify|qa|playwright screenshot)\b/.test(value)) return "smoke";
  return "unknown";
}

function commandLabel(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  return compact.length > 46 ? `${compact.slice(0, 43)}...` : compact || "command";
}

function summarizeWorkstationGraph(nodes: WorkstationGraphNode[], edges: WorkstationGraphEdge[]): WorkstationGraph {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeCountByKind = Object.fromEntries(
    [
      "workspace",
      "thread",
      "pane",
      "terminal",
      "process",
      "agent",
      "workflow",
      "phase",
      "tool",
      "command_block",
      "file",
      "test",
      "blocker",
      "risk",
      "notification",
      "final_report",
      "context_pack",
    ].map((kind) => [kind, 0]),
  ) as Record<WorkstationGraphNodeKind, number>;
  for (const node of nodes) nodeCountByKind[node.kind] += 1;

  const edgeCountByKind: Partial<Record<WorkstationGraphEdgeKind, number>> = {};
  for (const edge of edges) edgeCountByKind[edge.kind] = (edgeCountByKind[edge.kind] ?? 0) + 1;
  const danglingEdgeCount = edges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target)).length;
  return { nodes, edges, nodeCountByKind, edgeCountByKind, integrity: { danglingEdgeCount } };
}

function addNode(nodes: Map<string, WorkstationGraphNode>, node: WorkstationGraphNode): void {
  const existing = nodes.get(node.id);
  nodes.set(node.id, existing ? { ...existing, ...node, metadata: { ...existing.metadata, ...node.metadata } } : node);
}

function addEdge(
  edges: Map<string, WorkstationGraphEdge>,
  source: string,
  target: string,
  kind: WorkstationGraphEdgeKind,
  metadata?: Record<string, unknown>,
): void {
  const id = `${kind}:${source}->${target}`;
  edges.set(id, { id, source, target, kind, metadata });
}

function nodeId(kind: WorkstationGraphNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function listWorkstationGraphNodeIds(
  graph: WorkstationGraph | null | undefined,
  kind: WorkstationGraphNodeKind,
  metadataKey?: string,
): string[] {
  if (!graph) return [];
  const prefix = `${kind}:`;
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== kind) continue;
    const metadataId = metadataKey ? readStringMetadata(node, metadataKey) : null;
    const id = metadataId ?? (node.id.startsWith(prefix) ? node.id.slice(prefix.length) : node.label);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

function readStringMetadata(node: WorkstationGraphNode, key: string): string | null {
  const value = node.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberMetadata(node: WorkstationGraphNode, key: string): number | null {
  const value = node.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function latestToolFromLog(log: AgentSession["logs"][number]): string | null {
  const metadataTool = log.metadata?.toolName ? extractToolName(`${log.metadata.toolName}(`) : null;
  return metadataTool ?? (log.type === "tool_use" || log.type === "tool_result" ? extractToolName(log.content) : null);
}
