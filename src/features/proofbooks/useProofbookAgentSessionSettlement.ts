import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import type {
  ProofbookAgentSessionSettlementCandidate,
  ProofbookRunLedger,
  ProofbookStepSummary,
} from "../../shared/types/proofbook";
import { proofbookErrorCode, proofbookErrorMessage } from "./proofbookUiError";

export interface ProofbookSettlementStatus {
  readonly tone: "success" | "warn" | "error";
  readonly text: string;
}

interface UseProofbookAgentSessionSettlementOptions {
  readonly projectPath: string;
  readonly refresh: () => Promise<void>;
  readonly onLedger: (ledger: ProofbookRunLedger) => void;
  readonly isOtherEffectActive: () => boolean;
}

function settlementKey(runId: string, stepId: string, revision: number): string {
  return `${runId}:${stepId}:${revision}`;
}

export function useProofbookAgentSessionSettlement({
  projectPath,
  refresh,
  onLedger,
  isOtherEffectActive,
}: UseProofbookAgentSessionSettlementOptions) {
  const checkingRef = useRef<string | null>(null);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);
  const settlingRef = useRef<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ProofbookAgentSessionSettlementCandidate | null>(null);
  const [status, setStatus] = useState<ProofbookSettlementStatus | null>(null);

  const reset = useCallback(() => {
    checkingRef.current = null;
    settlingRef.current = null;
    setCheckingKey(null);
    setSettlingKey(null);
    setCandidate(null);
    setStatus(null);
  }, []);

  const isBusy = useCallback(() => Boolean(checkingRef.current || settlingRef.current), []);

  const reconcileLedger = useCallback((ledger: ProofbookRunLedger) => {
    setCandidate((current) =>
      current && current.runId === ledger.runId && current.ledgerRevision !== ledger.revision ? null : current,
    );
  }, []);

  const inspect = useCallback(
    async (run: ProofbookRunLedger, step: ProofbookStepSummary) => {
      const key = settlementKey(run.runId, step.stepId, run.revision);
      if (
        checkingRef.current ||
        settlingRef.current ||
        isOtherEffectActive() ||
        step.kind !== "agentSession" ||
        step.status !== "running"
      ) {
        return;
      }
      checkingRef.current = key;
      setCheckingKey(key);
      setCandidate(null);
      setStatus(null);
      try {
        const next = await invoke<ProofbookAgentSessionSettlementCandidate>(
          "proofbook_agent_session_settlement_candidate",
          {
            projectPath,
            runId: run.runId,
            stepId: step.stepId,
            expectedRevision: run.revision,
          },
        );
        if (next.runId !== run.runId || next.stepId !== step.stepId || next.ledgerRevision !== run.revision) {
          throw new Error("Runtime evidence response did not match the displayed Proofbook revision.");
        }
        setCandidate(next);
        setStatus({
          tone: next.eligible ? "success" : "warn",
          text: next.eligible
            ? `Current runtime evidence can settle ${step.stepId} as ${next.resultingStatus}.`
            : `Current runtime evidence cannot settle ${step.stepId}: ${next.blockers.join(", ")}.`,
        });
      } catch (cause) {
        const code = proofbookErrorCode(cause);
        setCandidate(null);
        if (code === "stale_ledger_revision" || code === "run_not_found" || code === "validation_failed") {
          await refresh();
          setStatus({
            tone: "error",
            text: `Run ${run.runId} or its agentSession identity changed. Durable history was refreshed; inspect current evidence again.`,
          });
        } else {
          setStatus({
            tone: "error",
            text: `Could not inspect runtime completion evidence: ${proofbookErrorMessage(cause)}`,
          });
        }
        reportInvokeFailure({
          source: "proofbooks",
          operation: "agent_session_settlement_candidate",
          err: cause,
          userVisible: true,
        });
      } finally {
        checkingRef.current = null;
        setCheckingKey(null);
      }
    },
    [isOtherEffectActive, projectPath, refresh],
  );

  const settle = useCallback(
    async (current: ProofbookAgentSessionSettlementCandidate) => {
      const key = settlementKey(current.runId, current.stepId, current.ledgerRevision);
      if (!current.eligible || settlingRef.current || checkingRef.current || isOtherEffectActive()) return;
      settlingRef.current = key;
      setSettlingKey(key);
      setStatus(null);
      try {
        const ledger = await invoke<ProofbookRunLedger>("settle_current_proofbook_agent_session", {
          projectPath,
          runId: current.runId,
          stepId: current.stepId,
          expectedRevision: current.ledgerRevision,
          expectedSessionId: current.sessionId,
        });
        onLedger(ledger);
        setCandidate(null);
        setStatus({
          tone: "success",
          text: `Settled ${current.stepId} from current Aelyris-owned runtime evidence at ledger revision ${ledger.revision}. Process termination, review acceptance, and merge are not claimed.`,
        });
      } catch (cause) {
        const code = proofbookErrorCode(cause);
        setCandidate(null);
        if (code === "stale_ledger_revision" || code === "run_not_found" || code === "validation_failed") {
          await refresh();
          setStatus({
            tone: "error",
            text: "Completion evidence changed before settlement. Durable history was refreshed; inspect the current session again.",
          });
        } else {
          setStatus({
            tone: "error",
            text: `Could not settle ${current.stepId}: ${proofbookErrorMessage(cause)}`,
          });
        }
        reportInvokeFailure({
          source: "proofbooks",
          operation: "settle_current_agent_session",
          err: cause,
          userVisible: true,
        });
      } finally {
        settlingRef.current = null;
        setSettlingKey(null);
      }
    },
    [isOtherEffectActive, onLedger, projectPath, refresh],
  );

  return {
    candidate,
    status,
    checkingKey,
    settlingKey,
    isBusy,
    inspect,
    settle,
    reset,
    reconcileLedger,
  };
}
