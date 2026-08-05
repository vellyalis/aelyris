import { CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import type { ProofbookAgentSessionSettlementCandidate, ProofbookStepSummary } from "../../shared/types/proofbook";
import styles from "./ProofbookAgentSessionSettlement.module.css";

interface ProofbookAgentSessionSettlementProps {
  readonly runId: string;
  readonly step: ProofbookStepSummary;
  readonly candidate: ProofbookAgentSessionSettlementCandidate | null;
  readonly checking: boolean;
  readonly settling: boolean;
  readonly disabled: boolean;
  readonly onInspect: () => void;
  readonly onSettle: (candidate: ProofbookAgentSessionSettlementCandidate) => void;
}

export function ProofbookAgentSessionSettlement({
  runId,
  step,
  candidate,
  checking,
  settling,
  disabled,
  onInspect,
  onSettle,
}: ProofbookAgentSessionSettlementProps) {
  return (
    <article className={styles.card}>
      <div className={styles.heading}>
        <span>
          <ShieldCheck size={12} aria-hidden="true" />
          <strong>{step.stepId}</strong>
        </span>
        <small>runtime-owned evidence only</small>
      </div>
      <button
        type="button"
        className={styles.inspectButton}
        disabled={disabled}
        onClick={onInspect}
        aria-label={`Inspect runtime completion evidence for ${runId} ${step.stepId}`}
      >
        <RefreshCw size={11} aria-hidden="true" />
        {checking ? "Checking…" : candidate ? "Refresh completion evidence" : "Check completion evidence"}
      </button>
      {candidate && (
        <section
          className={styles.candidate}
          data-eligible={candidate.eligible || undefined}
          aria-label={`Runtime completion candidate for ${step.stepId}`}
        >
          <dl className={styles.details}>
            <div>
              <dt>Session</dt>
              <dd>{candidate.sessionId}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>{candidate.runtimeStatus ?? "missing"}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd>{candidate.resultingStatus ?? "not ready"}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{candidate.ledgerRevision}</dd>
            </div>
            {candidate.worktreePath && (
              <div>
                <dt>Worktree</dt>
                <dd>{candidate.worktreePath}</dd>
              </div>
            )}
            {candidate.proofKind && (
              <div>
                <dt>Proof kind</dt>
                <dd>{candidate.proofKind}</dd>
              </div>
            )}
          </dl>
          {candidate.doneSignal && (
            <code className={styles.doneSignal} title={candidate.doneSignal}>
              {candidate.doneSignal}
            </code>
          )}
          {candidate.proofSources.length > 0 && (
            <p className={styles.proofSources}>Sources: {candidate.proofSources.join(" + ")}</p>
          )}
          {candidate.expectedArtifacts.length > 0 && (
            <ul className={styles.artifacts}>
              {candidate.expectedArtifacts.map((artifact) => (
                <li key={artifact.path} data-present={artifact.present || undefined}>
                  <span>{artifact.present ? "present" : "missing"}</span>
                  <code>{artifact.path}</code>
                </li>
              ))}
            </ul>
          )}
          {candidate.blockers.length > 0 && (
            <p className={styles.blockers}>Unresolved: {candidate.blockers.join(", ")}</p>
          )}
          {candidate.eligible && (
            <button
              type="button"
              className={styles.settleButton}
              disabled={disabled}
              onClick={() => onSettle(candidate)}
              aria-label={`Settle current agent session ${candidate.sessionId}`}
            >
              <CheckCircle2 size={11} aria-hidden="true" />
              {settling ? "Settling…" : `Settle as ${candidate.resultingStatus}`}
            </button>
          )}
        </section>
      )}
    </article>
  );
}
