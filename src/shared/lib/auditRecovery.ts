export function isAuditRestartCandidate(action: string): boolean {
  return (
    action.includes("force_restart") ||
    action.includes("lagged") ||
    action.includes("write") ||
    action.includes("send_keys") ||
    action.includes("resize")
  );
}

export type AuditRecoveryKind = "restart-pane" | "inspect-target" | "review-gate" | "review-denial" | "none";

export interface AuditRecoveryHint {
  kind: AuditRecoveryKind;
  label: string;
  detail: string;
  recoverable: boolean;
}

interface AuditRecoveryEventLike {
  category: string;
  action: string;
  severity: string;
  metadata?: Record<string, unknown> | null;
}

export function deriveAuditRecoveryHint(entry: AuditRecoveryEventLike): AuditRecoveryHint {
  const action = entry.action.toLowerCase();
  const category = entry.category.toLowerCase();
  const decision = typeof entry.metadata?.decision === "string" ? entry.metadata.decision.toLowerCase() : "";

  if (decision === "denied") {
    return {
      kind: "review-denial",
      label: "Review denial",
      detail: "Inspect the matched watchdog rule before retrying.",
      recoverable: true,
    };
  }

  if (category === "workflow" && (action.includes("gate_rejected") || action.includes("rejected"))) {
    return {
      kind: "review-gate",
      label: "Review gate",
      detail: "Review the rejected gate and rerun the failed phase.",
      recoverable: true,
    };
  }

  if (action.includes("no_pane") || action.includes("target") || action.includes("role")) {
    return {
      kind: "inspect-target",
      label: "Inspect target",
      detail: "Check pane name, role, and live terminal id before sending again.",
      recoverable: true,
    };
  }

  if ((entry.severity === "warn" || entry.severity === "error") && isAuditRestartCandidate(action)) {
    return {
      kind: "restart-pane",
      label: "Restart pane",
      detail: "Restart the referenced pane if it no longer accepts input.",
      recoverable: true,
    };
  }

  return {
    kind: "none",
    label: "Recorded",
    detail: "No recovery action is required.",
    recoverable: false,
  };
}

const AUDIT_METADATA_LABELS: Record<string, string> = {
  accepted: "accepted",
  bytes: "bytes",
  cols: "cols",
  containsEnter: "enter",
  correlationId: "trace",
  error: "error",
  hasCwd: "cwd",
  oldCloseOk: "old close",
  redacted: "redacted",
  rows: "rows",
  shell: "shell",
  targetCount: "targets",
  targets: "targets",
};

const AUDIT_METADATA_ORDER = [
  "error",
  "correlationId",
  "shell",
  "cols",
  "rows",
  "accepted",
  "targets",
  "targetCount",
  "bytes",
  "containsEnter",
  "oldCloseOk",
  "hasCwd",
  "redacted",
];

const MAX_METADATA_VALUE_LENGTH = 44;
const MAX_METADATA_ITEMS = 4;

export function formatAuditMetadataSummary(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata) return "";

  const items = AUDIT_METADATA_ORDER.flatMap((key) => {
    if (!(key in metadata)) return [];
    const value = formatAuditMetadataValue(metadata[key]);
    if (!value) return [];
    return `${AUDIT_METADATA_LABELS[key]}:${value}`;
  }).slice(0, MAX_METADATA_ITEMS);

  return items.join(" · ");
}

export function getAuditCorrelationId(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata?.correlationId;
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function formatAuditMetadataValue(value: unknown): string {
  if (typeof value === "string") return truncateMetadataValue(value.replace(/\s+/g, " ").trim());
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return "";
}

function truncateMetadataValue(value: string): string {
  if (value.length <= MAX_METADATA_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_METADATA_VALUE_LENGTH - 1)}…`;
}
