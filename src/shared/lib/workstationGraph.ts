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
  | "used_tool";

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
  if (watchdogLog?.metadata?.decision === "manual") return `Awaiting approval for ${watchdogLog.metadata.toolName ?? "tool"}`;
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
      metadata: { model: session.model, tokensUsed: session.tokensUsed },
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
      addNode(nodes, { id: fileNodeId, kind: "file", label: fileName(filePath), path: filePath, status: detail.action });
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

  const selectedNodeIds = new Set(seedIds);
  const selectedEdges: WorkstationGraphEdge[] = [];
  for (const edge of graph.edges) {
    if (!seedIds.has(edge.source) && !seedIds.has(edge.target)) continue;
    selectedEdges.push(edge);
    selectedNodeIds.add(edge.source);
    selectedNodeIds.add(edge.target);
  }

  const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id));
  if (selectedNodes.length === 0) return graph;
  return summarizeWorkstationGraph(selectedNodes, selectedEdges);
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
