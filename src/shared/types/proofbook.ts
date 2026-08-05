export interface ProofbookError {
  code: string;
  message: string;
  definitionId?: string;
  stepId?: string;
  field?: string;
  path?: string;
}

export interface ProofbookSummary {
  id: string;
  title: string;
  path: string;
  stepCount: number;
  valid: boolean;
  errorCount: number;
}

export interface ProofbookValidationReport {
  definitionId: string | null;
  path: string;
  valid: boolean;
  errors: ProofbookError[];
  startAdmission: ProofbookStartAdmission;
}

export interface ProofbookStartAdmission {
  eligible: boolean;
  definitionHash: string | null;
  inputCount: number;
  secretCount: number;
  unsupportedStepKinds: string[];
  blockers: string[];
}

export type ProofbookStepStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "waiting_gate"
  | "blocked"
  | "cancelled";

export type ProofbookRunStatus =
  | "pending"
  | "running"
  | "waiting_gate"
  | "passed"
  | "failed"
  | "blocked-by-policy"
  | "blocked-by-external-gates"
  | "cancelled";

export interface ProofbookGateDecision {
  gateId: string;
  gateHash: string;
  stepId: string;
  decision: string;
  actor: string;
  comment: string;
  decidedAt: string;
}

export interface ProofbookManualGateOutput {
  gateId: string;
  gateHash: string;
  kind: "manualGate";
  options: string[];
  default: string;
  risk: string;
  evidence: string;
}

export interface ProofbookStepSummary {
  stepId: string;
  kind: string;
  status: ProofbookStepStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  attempt?: number;
  structuredOutput?: unknown;
  artifactRefs: string[];
  gateDecision?: ProofbookGateDecision | null;
  redactionCount: number;
  risk?: unknown;
  error?: { code: string; message: string };
}

export interface ProofbookResidualBlocker {
  code: string;
  stepId?: string | null;
  message: string;
}

export interface ProofbookArtifactRef {
  id: string;
  path: string;
  kind: string;
  sizeBytes: number;
  sha256: string;
  redactionCount: number;
  stepId: string;
}

export interface ProofbookRunLedger {
  schema: string;
  revision: number;
  runId: string;
  proofbookId: string;
  projectPath: string;
  definitionPath: string;
  status: ProofbookRunStatus;
  startedAt: string;
  updatedAt: string;
  definitionHash: string;
  inputHash: string;
  steps: ProofbookStepSummary[];
  artifacts: ProofbookArtifactRef[];
  residualBlockers: ProofbookResidualBlocker[];
}
