import { AlertTriangle, CheckCircle2, Clock3, FileStack, ListChecks, ShieldAlert } from "lucide-react";
import type { ProofbookRunLedger, ProofbookRunStatus, ProofbookStepStatus } from "../../shared/types/proofbook";
import styles from "./ProofbookPanel.module.css";
import { deriveProofbookRunEvidence } from "./proofbookEvidence";

interface ProofbookEvidenceInspectorProps {
  readonly run: ProofbookRunLedger;
}

const RUN_STATUS_LABEL: Record<ProofbookRunStatus, string> = {
  pending: "Pending",
  running: "Running",
  waiting_gate: "Waiting gate",
  passed: "Passed",
  failed: "Failed",
  "blocked-by-policy": "Policy blocked",
  "blocked-by-external-gates": "External gate",
  cancelled: "Cancelled",
};

const STEP_STATUS_LABEL: Record<ProofbookStepStatus, string> = {
  pending: "Pending",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  waiting_gate: "Waiting gate",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function statusIcon(status: ProofbookStepStatus) {
  if (status === "passed") return <CheckCircle2 size={12} aria-hidden="true" />;
  if (status === "failed" || status === "blocked") return <AlertTriangle size={12} aria-hidden="true" />;
  return <Clock3 size={12} aria-hidden="true" />;
}

export function ProofbookEvidenceInspector({ run }: ProofbookEvidenceInspectorProps) {
  const evidence = deriveProofbookRunEvidence(run);

  return (
    <section
      className={styles.evidenceInspector}
      aria-label={`Evidence for ${evidence.runId}`}
      data-terminal={evidence.terminal || undefined}
      data-status={evidence.status}
    >
      <div className={styles.evidenceHeading}>
        <span>
          <ListChecks size={13} aria-hidden="true" />
          <strong>Durable step evidence</strong>
        </span>
        <span className={styles.evidenceRunStatus} data-status={evidence.status}>
          {RUN_STATUS_LABEL[evidence.status]}
        </span>
      </div>

      <dl className={styles.evidenceSummary}>
        <div>
          <dt>Run</dt>
          <dd title={evidence.runId}>{evidence.runId}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{evidence.revision}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{evidence.steps.length}</dd>
        </div>
        <div>
          <dt>Blockers</dt>
          <dd>{evidence.blockers.length}</dd>
        </div>
      </dl>

      <ol className={styles.evidenceSteps} aria-label="Durable Proofbook steps">
        {evidence.steps.map((step) => (
          <li key={step.stepId} className={styles.evidenceStep} data-status={step.status}>
            <div className={styles.evidenceStepHeading}>
              <span className={styles.evidenceStepIcon}>{statusIcon(step.status)}</span>
              <span className={styles.evidenceStepTitle}>
                <strong>{step.stepId}</strong>
                <small>{step.kind}</small>
              </span>
              <span className={styles.evidenceStepStatus}>{STEP_STATUS_LABEL[step.status]}</span>
            </div>

            <dl className={styles.evidenceStepMeta}>
              <div>
                <dt>Attempt</dt>
                <dd>{step.attempt}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(step.durationMs)}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd title={step.startedAt ?? undefined}>{formatTimestamp(step.startedAt)}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd title={step.completedAt ?? undefined}>{formatTimestamp(step.completedAt)}</dd>
              </div>
              <div>
                <dt>Artifacts</dt>
                <dd>{step.artifactRefs.length + step.artifactOverflow}</dd>
              </div>
              <div>
                <dt>Redactions</dt>
                <dd>{step.redactionCount}</dd>
              </div>
            </dl>

            {step.error && (
              <div className={styles.evidenceError} role="note">
                <strong>{step.error.code}</strong>
                <span>{step.error.message}</span>
              </div>
            )}

            {step.risk && (
              <section className={styles.evidenceRisk} aria-label={`Risk for ${step.stepId}`}>
                <div className={styles.evidenceSubheading}>
                  <ShieldAlert size={11} aria-hidden="true" />
                  <span>Risk</span>
                </div>
                <div className={styles.evidenceChips}>
                  {step.risk.severity && <span>severity {step.risk.severity}</span>}
                  {step.risk.confidence && <span>confidence {step.risk.confidence}</span>}
                  {step.risk.requiresApproval != null && (
                    <span>approval {step.risk.requiresApproval ? "required" : "not required"}</span>
                  )}
                  {step.risk.allowExecution != null && (
                    <span>execution {step.risk.allowExecution ? "allowed" : "blocked"}</span>
                  )}
                  {step.risk.classes.map((riskClass) => (
                    <span key={riskClass}>{riskClass}</span>
                  ))}
                </div>
              </section>
            )}

            {step.gate && (
              <section className={styles.evidenceGate} aria-label={`Gate for ${step.stepId}`}>
                <div className={styles.evidenceSubheading}>
                  <ShieldAlert size={11} aria-hidden="true" />
                  <span>{step.gate.kind}</span>
                </div>
                <dl className={styles.evidenceGateMeta}>
                  <div>
                    <dt>Gate</dt>
                    <dd>{step.gate.gateId ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Default</dt>
                    <dd>{step.gate.defaultOption ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Risk</dt>
                    <dd>{step.gate.risk ?? "—"}</dd>
                  </div>
                </dl>
                {step.gate.summary && <p>{step.gate.summary}</p>}
                {step.gate.commandPreview && <code>{step.gate.commandPreview}</code>}
              </section>
            )}

            {step.decision && (
              <div className={styles.evidenceDecision}>
                <strong>{step.decision.decision}</strong>
                <span>by {step.decision.actor}</span>
                <time dateTime={step.decision.decidedAt}>{formatTimestamp(step.decision.decidedAt)}</time>
              </div>
            )}

            {step.artifactRefs.length > 0 && (
              <div className={styles.evidenceArtifactRefs}>
                <div className={styles.evidenceSubheading}>
                  <FileStack size={11} aria-hidden="true" />
                  <span>Artifact references</span>
                </div>
                {step.artifactRefs.map((artifactRef) => (
                  <code key={artifactRef}>{artifactRef}</code>
                ))}
                {step.artifactOverflow > 0 && <span>+{step.artifactOverflow} more</span>}
              </div>
            )}
          </li>
        ))}
      </ol>

      {evidence.blockers.length > 0 && (
        <section className={styles.evidenceBlockers} aria-label="Residual Proofbook blockers">
          <div className={styles.evidenceSubheading}>
            <AlertTriangle size={11} aria-hidden="true" />
            <span>Residual blockers</span>
          </div>
          {evidence.blockers.map((blocker) => (
            <div key={`${blocker.code}:${blocker.stepId ?? "run"}:${blocker.message}`}>
              <strong>{blocker.code}</strong>
              {blocker.stepId && <code>{blocker.stepId}</code>}
              <span>{blocker.message}</span>
            </div>
          ))}
        </section>
      )}

      <p className={styles.evidenceDisclosure}>
        This inspector shows bounded durable ledger fields only. Gate comments, arbitrary structured JSON, command output, inputs, and secrets are not rendered here.
      </p>
    </section>
  );
}
