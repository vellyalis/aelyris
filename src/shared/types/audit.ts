export type AuditSeverity = "info" | "warn" | "error" | string;

export interface AuditEventFilters {
  category?: string;
  severity?: AuditSeverity;
  entityId?: string;
}

export interface AuditEventRecord {
  id: number;
  timestamp: string;
  category: string;
  action: string;
  severity: AuditSeverity;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface AuditJournalEventRecord {
  id: number;
  workspaceId: string;
  threadId?: string | null;
  sessionId?: string | null;
  paneId?: string | null;
  terminalId?: string | null;
  agentId?: string | null;
  workflowId?: string | null;
  taskId?: string | null;
  correlationId: string;
  sequence: number;
  kind: string;
  severity: AuditSeverity;
  source: string;
  confidence: number;
  createdAt: string;
  redactedPayloadJson: unknown;
  hash: string;
}
