import type { AgentLog, AgentSession } from "../types/agent";
import type { AuditEventRecord } from "../types/audit";
import type { AgentFleetSession } from "./agentFleet";
import type { CommandRiskClass } from "./shellSafety";

export type HumanDecisionType =
  | "permission_required"
  | "product_direction"
  | "destructive_operation"
  | "external_account_login"
  | "merge_conflict_strategy"
  | "test_expectation_changed"
  | "security_exception";

export type HumanDecisionRisk = "critical" | "high" | "medium" | "low";
export type HumanDecisionSource = "agent" | "workflow" | "audit";
export type HumanDecisionStatus = "pending" | "decided";

export interface HumanDecisionHistoryEntry {
  at: number;
  actor: string;
  action: string;
  note: string;
}

export interface HumanDecisionItem {
  id: string;
  type: HumanDecisionType;
  status: HumanDecisionStatus;
  source: HumanDecisionSource;
  title: string;
  context: string;
  recommendedOption: string;
  risk: HumanDecisionRisk;
  consequence: string;
  timeoutPolicy: string;
  requestedAt: number;
  actor: "human";
  sessionId?: string;
  /**
   * PTY id of a live interactive agent terminal this decision can be resolved
   * against by writing an approve/deny keystroke. Present only for
   * keystroke-resolvable agent items; absent for workflow/audit/headless items.
   */
  ptyId?: string;
  workflowId?: string;
  taskId?: string;
  evidence: string[];
  history: HumanDecisionHistoryEntry[];
}

export interface DecisionInboxSummary {
  items: HumanDecisionItem[];
  pendingItems: HumanDecisionItem[];
  historyItems: HumanDecisionItem[];
  pendingCount: number;
  highRiskCount: number;
  byType: Record<HumanDecisionType, number>;
  newestPendingAt: number | null;
}

export interface DecisionWorkflowPhase {
  name: string;
  status: string;
  decision_request?: {
    kind: string;
    reason: string;
    options?: string[];
    default_option?: string | null;
    requested_at: string;
  } | null;
  gate_decision?: {
    decision: string;
    comment?: string;
    decided_at: string;
  } | null;
  blocked_reason?: string | null;
}

export interface DecisionWorkflowStatus {
  id: string;
  workflow_name?: string;
  task_title: string;
  current_phase: number;
  phases: DecisionWorkflowPhase[];
}

export interface DecisionInboxInput {
  /**
   * The unified fleet sessions the cockpit projects from. `AgentFleetSession`
   * carries the canonical `runStatus` plus `runtime`/`ptyId`, which the
   * interactive-approval source below needs to surface keystroke-resolvable
   * gates. `AgentFleetSession extends AgentSession`, so headless-only callers
   * still type-check.
   */
  sessions?: readonly AgentFleetSession[];
  auditEvents?: readonly AuditEventRecord[];
  workflows?: readonly DecisionWorkflowStatus[];
  now?: number;
}

const HUMAN_TYPES: HumanDecisionType[] = [
  "permission_required",
  "product_direction",
  "destructive_operation",
  "external_account_login",
  "merge_conflict_strategy",
  "test_expectation_changed",
  "security_exception",
];

const SELF_HEALABLE_BLOCKERS = new Set([
  "external_dependency",
  "validation_failed",
  "oversized_task",
  "timeout",
  "environment_down",
  "test_flake",
  "not_blocked",
  "unknown",
]);

const TYPE_LABELS: Record<HumanDecisionType, string> = {
  permission_required: "Permission Required",
  product_direction: "Product Direction",
  destructive_operation: "Destructive Operation",
  external_account_login: "External Account",
  merge_conflict_strategy: "Merge Conflict",
  test_expectation_changed: "Test Expectation",
  security_exception: "Security Exception",
};

const RECOMMENDED_OPTIONS: Record<HumanDecisionType, string> = {
  permission_required: "Approve only after command scope and paths are clear.",
  product_direction: "Choose the narrowest product-safe option.",
  destructive_operation: "Reject unless the exact target and rollback are known.",
  external_account_login: "Use a user-owned login session outside automation.",
  merge_conflict_strategy: "Pick an explicit merge or rebase strategy before retry.",
  test_expectation_changed: "Update expectations only with a product reason.",
  security_exception: "Deny unless the exception is documented and bounded.",
};

const CONSEQUENCES: Record<HumanDecisionType, string> = {
  permission_required: "Automation remains paused for the gated action.",
  product_direction: "The implementation may choose the wrong behavior.",
  destructive_operation: "Files, processes, or repository state can be lost.",
  external_account_login: "The run cannot access required external state.",
  merge_conflict_strategy: "Retries can overwrite or duplicate work.",
  test_expectation_changed: "Validation may mask a regression.",
  security_exception: "Secrets or unsafe access can leak into logs or state.",
};

const TIMEOUTS: Record<HumanDecisionType, string> = {
  permission_required: "No auto-approval; keep paused.",
  product_direction: "No auto-choice; request direction.",
  destructive_operation: "No auto-run; require explicit confirmation.",
  external_account_login: "No credential retry; wait for login.",
  merge_conflict_strategy: "No merge retry; wait for strategy.",
  test_expectation_changed: "No snapshot update; wait for approval.",
  security_exception: "No exception retry; keep blocked.",
};

export function buildDecisionInbox(input: DecisionInboxInput): DecisionInboxSummary {
  const items = new Map<string, HumanDecisionItem>();
  const now = input.now ?? Date.now();

  for (const session of input.sessions ?? []) {
    for (const item of decisionsFromSession(session, now)) {
      upsertDecision(items, item);
    }
  }

  for (const event of input.auditEvents ?? []) {
    const item = decisionFromAuditEvent(event);
    if (item) upsertDecision(items, item);
  }

  for (const workflow of input.workflows ?? []) {
    for (const item of decisionsFromWorkflow(workflow, now)) {
      upsertDecision(items, item);
    }
  }

  const sorted = [...items.values()].sort(compareDecisions);
  const pendingItems = sorted.filter((item) => item.status === "pending");
  const historyItems = sorted.filter((item) => item.status === "decided");
  const byType = Object.fromEntries(HUMAN_TYPES.map((type) => [type, 0])) as Record<HumanDecisionType, number>;
  for (const item of pendingItems) byType[item.type] += 1;

  return {
    items: sorted,
    pendingItems,
    historyItems,
    pendingCount: pendingItems.length,
    highRiskCount: pendingItems.filter((item) => item.risk === "critical" || item.risk === "high").length,
    byType,
    newestPendingAt: pendingItems[0]?.requestedAt ?? null,
  };
}

export function isTrueHumanDecisionKind(kind: string | null | undefined): boolean {
  if (!kind) return false;
  const normalized = normalizeKind(kind);
  if (SELF_HEALABLE_BLOCKERS.has(normalized)) return false;
  return typeFromKind(normalized) !== null;
}

function decisionsFromSession(session: AgentFleetSession, now: number): HumanDecisionItem[] {
  const decisions: HumanDecisionItem[] = [];
  const decisionLog = latestWatchdogDecisionLog(session.logs);
  if (decisionLog?.metadata?.decision === "manual") {
    const type = typeFromRiskClasses(decisionLog.metadata.riskClasses) ?? typeFromText(decisionLog.content);
    if (type) {
      decisions.push(
        createDecision({
          id: `agent:${session.id}:manual:${decisionLog.timestamp}`,
          type,
          status: "pending",
          source: "agent",
          title: `${TYPE_LABELS[type]} · ${session.name}`,
          context: shortText(decisionLog.content),
          requestedAt: decisionLog.timestamp,
          sessionId: session.id,
          evidence: [decisionLog.metadata.toolName ?? "watchdog", decisionLog.metadata.rule ?? "manual approval"],
          history: historyEntry(decisionLog.timestamp, "watchdog", "requested", decisionLog.content),
        }),
      );
    }
  } else if (decisionLog?.metadata?.decision === "denied") {
    const type = typeFromRiskClasses(decisionLog.metadata.riskClasses) ?? typeFromText(decisionLog.content);
    if (type) {
      decisions.push(
        createDecision({
          id: `agent:${session.id}:denied:${decisionLog.timestamp}`,
          type,
          status: "decided",
          source: "agent",
          title: `${TYPE_LABELS[type]} · ${session.name}`,
          context: shortText(decisionLog.content),
          requestedAt: decisionLog.timestamp,
          sessionId: session.id,
          evidence: [decisionLog.metadata.toolName ?? "watchdog", decisionLog.metadata.rule ?? "auto-denied"],
          history: historyEntry(decisionLog.timestamp, "watchdog", "denied", decisionLog.content),
        }),
      );
    }
  }

  const actor = session.nextActor?.trim().toLowerCase();
  const blockedReason = session.blockedReason?.trim();
  // Interactive runs are surfaced by the keystroke-resolvable branch below
  // (which carries a ptyId). Excluding them here prevents a double row if a
  // backend ever populates nextActor/blockedReason on an interactive session.
  if ((actor === "human" || actor === "user") && blockedReason && session.runtime !== "interactive") {
    const type = typeFromText(blockedReason);
    if (type) {
      decisions.push(
        createDecision({
          id: `agent:${session.id}:blocked:${stableTextKey(blockedReason)}`,
          type,
          status: "pending",
          source: "agent",
          title: `${TYPE_LABELS[type]} · ${session.name}`,
          context: shortText(blockedReason),
          requestedAt: latestSessionTimestamp(session) ?? now,
          sessionId: session.id,
          evidence: ["nextActor=human"],
          history: historyEntry(latestSessionTimestamp(session) ?? now, "agent", "blocked", blockedReason),
        }),
      );
    }
  }

  // Interactive fleet sessions carry no per-event log; `startedAt` is the
  // process start (and seconds-based), so use the inbox build time `now` for a
  // fresh, correctly-scaled epoch-ms timestamp that sorts among current gates.
  if (
    session.runtime === "interactive" &&
    session.runStatus === "waiting_approval" &&
    session.ptyId &&
    session.approvalPrompt
  ) {
    // A confirmed Claude permission MENU on a live PTY → keystroke-resolvable.
    // The backend captures `approvalPrompt` ONLY for a real selectable menu
    // (never for ordinary prose), so its presence is what makes this row safe to
    // resolve. Show the captured command as the context so the human sees WHAT
    // they approve (no blind approval), and carry the `ptyId` so Approve/Deny can
    // write the menu keystroke into the agent TUI. A `waiting_approval` run with
    // no captured menu is intentionally NOT surfaced: there is nothing confirmed
    // to approve, and offering a blind keystroke would be the anti-pattern.
    const prompt = session.approvalPrompt;
    // Match the backend's own cap (it head/tail-elides to 300 chars so a dangerous
    // tail like `…; rm -rf /` is never lost) so the command is not truncated a
    // SECOND time below it here. The panel adds a hover tooltip for the full text
    // when the row visually clips it.
    const context = shortText(prompt, 300);
    // Classify by the captured command so a destructive/secret-bearing gate
    // (e.g. `Bash(rm -rf dist)`) keeps its critical risk badge instead of a flat
    // medium "permission" — the existing classifiers already encode that policy.
    const type = typeFromText(prompt) ?? "permission_required";
    decisions.push(
      createDecision({
        // The prompt fingerprint is part of the id so a NEW menu on the same
        // session remounts the inbox row (fresh Approve/Deny latch) instead of
        // reusing the stale, post-delivery disabled state of the previous gate.
        id: `agent:${session.id}:interactive-approval:${stableTextKey(prompt)}`,
        type,
        status: "pending",
        source: "agent",
        title: `${TYPE_LABELS[type]} · ${session.name}`,
        context,
        requestedAt: now,
        sessionId: session.id,
        ptyId: session.ptyId,
        evidence: [`runStatus=${session.runStatus}`, ...(session.cli ? [`cli=${session.cli}`] : [])],
        history: historyEntry(now, "agent", "waiting", context),
      }),
    );
  } else if (session.runtime === "interactive" && session.runStatus === "blocked") {
    // `blocked` is broader than an approval prompt (it may need typed direction),
    // so surface it for inspection ONLY — no `ptyId` means the row offers Focus
    // (to the live TUI) but no Approve/Deny, so we never write a blind keystroke.
    const reason = blockedReason || "Interactive agent is blocked and needs a human decision.";
    const type = typeFromText(reason) ?? "permission_required";
    decisions.push(
      createDecision({
        id: `agent:${session.id}:interactive-blocked`,
        type,
        status: "pending",
        source: "agent",
        title: `${TYPE_LABELS[type]} · ${session.name}`,
        context: shortText(reason),
        requestedAt: now,
        sessionId: session.id,
        evidence: [`runStatus=${session.runStatus}`, ...(session.cli ? [`cli=${session.cli}`] : [])],
        history: historyEntry(now, "agent", "blocked", reason),
      }),
    );
  }

  return decisions;
}

function decisionsFromWorkflow(workflow: DecisionWorkflowStatus, now: number): HumanDecisionItem[] {
  const decisions: HumanDecisionItem[] = [];
  for (const phase of workflow.phases) {
    const request = phase.decision_request;
    if (!request || phase.status !== "waiting_gate" || phase.gate_decision) continue;
    const type = typeFromKind(request.kind) ?? typeFromText(request.reason, phase.blocked_reason);
    if (!type) continue;
    const requestedAt = Number.parseInt(request.requested_at, 10);
    const time = Number.isFinite(requestedAt) ? requestedAt : now;
    decisions.push(
      createDecision({
        id: `workflow:${workflow.id}:${phase.name}:${request.requested_at}`,
        type,
        status: "pending",
        source: "workflow",
        title: `${TYPE_LABELS[type]} · ${workflow.task_title || workflow.workflow_name || workflow.id}`,
        context: shortText(request.reason || phase.blocked_reason || "Workflow gate requires a human decision."),
        requestedAt: time,
        workflowId: workflow.id,
        evidence: [
          `phase=${phase.name}`,
          `kind=${request.kind}`,
          request.default_option ? `default=${request.default_option}` : "",
        ],
        history: historyEntry(time, "workflow", "requested", request.reason || phase.blocked_reason || phase.name),
      }),
    );
  }
  return decisions;
}

function decisionFromAuditEvent(event: AuditEventRecord): HumanDecisionItem | null {
  const metadata = asRecord(event.metadata);
  const nestedDecision = firstRecord(metadata.decisionRequest, metadata.decision_request, metadata.decision);
  const nestedBlocker = firstRecord(metadata.blockerAnalysis, metadata.blocker, metadata.blocker_analysis);
  const kindCandidate = firstString(
    nestedDecision.kind,
    metadata.decisionKind,
    metadata.decision_kind,
    nestedBlocker.kind,
    metadata.blockerKind,
    metadata.blocker_kind,
    metadata.kind,
    event.action,
  );
  const type =
    typeFromKind(kindCandidate) ??
    typeFromText(joinText(event.summary, event.action, metadata.reason, nestedDecision.reason));
  if (!type) return null;
  if (!isExplicitHumanAudit(event, metadata, nestedDecision, nestedBlocker, type)) return null;

  const decided = /decided|approved|rejected|denied|resolved|gate_decision|approve_gate|reject_gate/i.test(
    joinText(event.action, metadata.action, metadata.status, metadata.decision),
  );
  const requestedAt = Date.parse(event.timestamp);
  const time = Number.isFinite(requestedAt) ? requestedAt : Date.now();
  const workflowId = firstString(
    metadata.workflowId,
    metadata.workflow_id,
    event.entityType === "workflow" ? event.entityId : null,
  );
  const taskId = firstString(metadata.taskId, metadata.task_id);
  const reason = firstString(nestedDecision.reason, metadata.reason, event.summary, event.action) ?? TYPE_LABELS[type];

  return createDecision({
    id: `audit:${event.id}:${workflowId ?? taskId ?? type}`,
    type,
    status: decided ? "decided" : "pending",
    source: workflowId ? "workflow" : "audit",
    title: `${TYPE_LABELS[type]} · ${workflowId ?? taskId ?? event.entityId ?? "audit"}`,
    context: shortText(reason),
    requestedAt: time,
    workflowId: workflowId ?? undefined,
    taskId: taskId ?? undefined,
    evidence: [
      event.action,
      kindCandidate ? `kind=${kindCandidate}` : "",
      typeof metadata.correlationId === "string" ? `trace=${metadata.correlationId}` : "",
    ],
    history: historyEntry(time, workflowId ? "workflow" : "audit", decided ? "decided" : "requested", reason),
  });
}

function isExplicitHumanAudit(
  event: AuditEventRecord,
  metadata: Record<string, unknown>,
  nestedDecision: Record<string, unknown>,
  nestedBlocker: Record<string, unknown>,
  type: HumanDecisionType,
): boolean {
  const status = joinText(metadata.status, nestedBlocker.status).toLowerCase();
  if (status === "not_blocked") return false;
  const retryAction = joinText(
    asRecord(metadata.retryPolicy).action,
    asRecord(metadata.retry_policy).action,
  ).toLowerCase();
  if (retryAction === "probe" || retryAction === "decompose" || retryAction === "rerun") return false;
  const kind = firstString(nestedDecision.kind, metadata.blockerKind, nestedBlocker.kind, metadata.kind);
  if (kind && !isTrueHumanDecisionKind(kind)) return false;

  const explicitDecision =
    Boolean(firstString(nestedDecision.kind, nestedDecision.reason)) ||
    /decision|gate|needs_attention|permission|approval|destructive|security|merge_conflict|product_decision/i.test(
      joinText(event.action, event.summary, metadata.action, metadata.reason),
    );
  const notifyUser = metadata.notifyUser === true || metadata.nextActor === "human" || metadata.next_actor === "human";
  return explicitDecision || notifyUser || type === "destructive_operation" || type === "security_exception";
}

function createDecision(
  item: Omit<HumanDecisionItem, "actor" | "recommendedOption" | "risk" | "consequence" | "timeoutPolicy">,
): HumanDecisionItem {
  return {
    ...item,
    actor: "human",
    recommendedOption: RECOMMENDED_OPTIONS[item.type],
    risk: riskForType(item.type, item.status),
    consequence: CONSEQUENCES[item.type],
    timeoutPolicy: TIMEOUTS[item.type],
    evidence: item.evidence.filter(Boolean).slice(0, 5),
  };
}

function latestWatchdogDecisionLog(logs: readonly AgentLog[]): AgentLog | null {
  for (let index = logs.length - 1; index >= 0; index--) {
    const log = logs[index];
    if (log.metadata?.event === "watchdog_decision") return log;
  }
  return null;
}

function latestSessionTimestamp(session: AgentSession): number | null {
  const latest = session.logs.reduce<number | null>(
    (max, log) => (max === null ? log.timestamp : Math.max(max, log.timestamp)),
    null,
  );
  return latest ?? session.startedAt ?? null;
}

function typeFromRiskClasses(classes: readonly CommandRiskClass[] | undefined): HumanDecisionType | null {
  if (!classes || classes.length === 0) return null;
  if (classes.includes("secret-bearing") || classes.includes("permission")) return "security_exception";
  if (classes.includes("destructive") || classes.includes("delete") || classes.includes("process kill")) {
    return "destructive_operation";
  }
  return "permission_required";
}

function typeFromKind(kind: unknown): HumanDecisionType | null {
  const normalized = normalizeKind(firstString(kind) ?? "");
  if (!normalized || SELF_HEALABLE_BLOCKERS.has(normalized)) return null;
  if (normalized === "permission" || normalized === "permission_required" || normalized === "human_review") {
    return "permission_required";
  }
  if (normalized === "product_decision" || normalized === "product_direction") return "product_direction";
  if (normalized === "destructive" || normalized === "destructive_operation") return "destructive_operation";
  if (normalized === "external_account" || normalized === "external_account_login" || normalized === "login_required") {
    return "external_account_login";
  }
  if (normalized === "code_conflict" || normalized === "merge_conflict" || normalized === "merge_conflict_strategy") {
    return "merge_conflict_strategy";
  }
  if (normalized === "test_expectation_changed" || normalized === "expectation_changed")
    return "test_expectation_changed";
  if (normalized === "security_exception" || normalized === "secret" || normalized === "unsafe_path")
    return "security_exception";
  return typeFromText(normalized);
}

function typeFromText(...parts: unknown[]): HumanDecisionType | null {
  const text = joinText(...parts).toLowerCase();
  if (!text) return null;
  if (/\b(security|secret|token|credential|unsafe path|policy exception|exception)\b/.test(text)) {
    return "security_exception";
  }
  if (/\b(destructive|delete|remove-item|rm -rf|process kill|kill process|wipe|reset --hard)\b/.test(text)) {
    return "destructive_operation";
  }
  if (/\b(merge conflict|code conflict|conflict strategy|rebase|merge strategy)\b/.test(text)) {
    return "merge_conflict_strategy";
  }
  if (/\b(test expectation|expectation changed|snapshot update|golden update|fixture update)\b/.test(text)) {
    return "test_expectation_changed";
  }
  if (/\b(login|external account|account|authenticate|oauth|credential prompt)\b/.test(text)) {
    return "external_account_login";
  }
  if (/\b(product|direction|scope decision|requirement|behavior choice|ux decision)\b/.test(text)) {
    return "product_direction";
  }
  if (/\b(permission|approval|approve|manual|human review|gate)\b/.test(text)) {
    return "permission_required";
  }
  return null;
}

function riskForType(type: HumanDecisionType, status: HumanDecisionStatus): HumanDecisionRisk {
  if (status === "decided") return "low";
  if (type === "destructive_operation" || type === "security_exception") return "critical";
  if (type === "merge_conflict_strategy") return "high";
  if (type === "test_expectation_changed" || type === "external_account_login") return "medium";
  return "medium";
}

function upsertDecision(items: Map<string, HumanDecisionItem>, item: HumanDecisionItem): void {
  const existing = items.get(item.id);
  if (!existing) {
    items.set(item.id, item);
    return;
  }
  const status: HumanDecisionStatus =
    existing.status === "pending" || item.status === "pending" ? "pending" : "decided";
  items.set(item.id, {
    ...existing,
    ...item,
    status,
    evidence: [...new Set([...existing.evidence, ...item.evidence])].slice(0, 5),
    history: [...existing.history, ...item.history].sort((a, b) => b.at - a.at).slice(0, 6),
  });
}

function compareDecisions(left: HumanDecisionItem, right: HumanDecisionItem): number {
  if (left.status !== right.status) return left.status === "pending" ? -1 : 1;
  const riskRank: Record<HumanDecisionRisk, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const risk = riskRank[left.risk] - riskRank[right.risk];
  if (risk !== 0) return risk;
  return right.requestedAt - left.requestedAt;
}

function historyEntry(at: number, actor: string, action: string, note: string): HumanDecisionHistoryEntry[] {
  return [{ at, actor, action, note: shortText(note, 140) }];
}

function shortText(value: string, max = 160): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

function joinText(...parts: unknown[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(" ");
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

function normalizeKind(kind: string): string {
  return kind
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function stableTextKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
