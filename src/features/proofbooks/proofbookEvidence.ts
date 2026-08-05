import type {
  ProofbookGateDecision,
  ProofbookResidualBlocker,
  ProofbookRunLedger,
  ProofbookRunStatus,
  ProofbookStepStatus,
  ProofbookStepSummary,
} from "../../shared/types/proofbook";

export interface ProofbookRiskEvidence {
  readonly severity: string | null;
  readonly classes: string[];
  readonly requiresApproval: boolean | null;
  readonly allowExecution: boolean | null;
  readonly confidence: string | null;
}

export interface ProofbookGateEvidence {
  readonly kind: "manualGate" | "commandRisk" | "mcpTool";
  readonly gateId: string | null;
  readonly defaultOption: string | null;
  readonly risk: string | null;
  readonly summary: string | null;
  readonly commandPreview: string | null;
}

export interface ProofbookDecisionEvidence {
  readonly decision: string;
  readonly actor: string;
  readonly decidedAt: string;
}

export interface ProofbookStepEvidence {
  readonly stepId: string;
  readonly kind: string;
  readonly status: ProofbookStepStatus;
  readonly attempt: number;
  readonly durationMs: number | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly risk: ProofbookRiskEvidence | null;
  readonly gate: ProofbookGateEvidence | null;
  readonly decision: ProofbookDecisionEvidence | null;
  readonly artifactRefs: string[];
  readonly artifactOverflow: number;
  readonly redactionCount: number;
}

export interface ProofbookRunEvidence {
  readonly runId: string;
  readonly revision: number;
  readonly status: ProofbookRunStatus;
  readonly terminal: boolean;
  readonly steps: ProofbookStepEvidence[];
  readonly blockers: ProofbookResidualBlocker[];
}

const TERMINAL_RUN_STATUSES = new Set<ProofbookRunStatus>([
  "passed",
  "failed",
  "blocked-by-policy",
  "blocked-by-external-gates",
  "cancelled",
]);

const MAX_TEXT_LENGTH = 220;
const MAX_ARTIFACT_REFS = 4;
const MAX_RISK_CLASSES = 6;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function boundedText(value: unknown, max = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 3))}...` : compact;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function safeStringArray(value: unknown, max = MAX_RISK_CLASSES): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => boundedText(entry, 48))
    .filter((entry): entry is string => entry != null)
    .slice(0, max);
}

function deriveRisk(value: unknown): ProofbookRiskEvidence | null {
  const source = record(value);
  if (!source) return null;
  const evidence: ProofbookRiskEvidence = {
    severity: boundedText(source.severity, 32),
    classes: safeStringArray(source.classes),
    requiresApproval: booleanValue(source.requiresApproval),
    allowExecution: booleanValue(source.allowExecution),
    confidence: boundedText(source.confidence, 32),
  };
  return evidence.severity != null ||
    evidence.classes.length > 0 ||
    evidence.requiresApproval != null ||
    evidence.allowExecution != null ||
    evidence.confidence != null
    ? evidence
    : null;
}

function deriveGate(value: unknown): ProofbookGateEvidence | null {
  const source = record(value);
  if (!source) return null;
  const kind = source.kind;
  if (kind !== "manualGate" && kind !== "commandRisk" && kind !== "mcpTool") return null;
  const summary =
    kind === "manualGate"
      ? boundedText(source.evidence)
      : boundedText(source.reason) ?? boundedText(source.summary);
  return {
    kind,
    gateId: boundedText(source.gateId, 96),
    defaultOption: boundedText(source.default, 48),
    risk: boundedText(source.risk, 32),
    summary,
    commandPreview: kind === "commandRisk" ? boundedText(source.commandPreview) : null,
  };
}

function deriveDecision(value: ProofbookGateDecision | null | undefined): ProofbookDecisionEvidence | null {
  if (!value) return null;
  const decision = boundedText(value.decision, 48);
  const actor = boundedText(value.actor, 96);
  const decidedAt = boundedText(value.decidedAt, 64);
  if (!decision || !actor || !decidedAt) return null;
  return { decision, actor, decidedAt };
}

function finiteNonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function finiteNonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function deriveStep(step: ProofbookStepSummary): ProofbookStepEvidence {
  const artifactRefs = step.artifactRefs
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, MAX_ARTIFACT_REFS);
  return {
    stepId: step.stepId,
    kind: step.kind,
    status: step.status,
    attempt: finiteNonnegativeInteger(step.attempt),
    durationMs: finiteNonnegativeNumber(step.durationMs),
    startedAt: boundedText(step.startedAt, 64),
    completedAt: boundedText(step.completedAt, 64),
    error: step.error
      ? {
          code: boundedText(step.error.code, 96) ?? "unknown_error",
          message: boundedText(step.error.message) ?? "No durable error message.",
        }
      : null,
    risk: deriveRisk(step.risk),
    gate: deriveGate(step.structuredOutput),
    decision: deriveDecision(step.gateDecision),
    artifactRefs,
    artifactOverflow: Math.max(0, step.artifactRefs.length - artifactRefs.length),
    redactionCount: finiteNonnegativeInteger(step.redactionCount),
  };
}

export function deriveProofbookRunEvidence(run: ProofbookRunLedger): ProofbookRunEvidence {
  return {
    runId: run.runId,
    revision: finiteNonnegativeInteger(run.revision),
    status: run.status,
    terminal: TERMINAL_RUN_STATUSES.has(run.status),
    steps: run.steps.map(deriveStep),
    blockers: run.residualBlockers.map((blocker) => ({
      code: boundedText(blocker.code, 96) ?? "unknown_blocker",
      stepId: boundedText(blocker.stepId, 96),
      message: boundedText(blocker.message) ?? "No durable blocker message.",
    })),
  };
}
