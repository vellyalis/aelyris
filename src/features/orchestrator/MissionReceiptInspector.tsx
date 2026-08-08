import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./OrchestratorPanel.module.css";

interface MissionCompletionResponse {
  outcome: "not_found" | "pending" | "blocked" | "completed";
  completed: boolean;
  mission?: {
    missionId: string;
    missionRevision: number;
    planId: string;
    planRevision: number;
    status: string;
  };
  taskSummary?: {
    taskCount: number;
    statusCounts: Record<string, number>;
  };
  completion: null | {
    packetBacked: boolean;
    workPacketIds?: string[];
    workPacketCount: number;
    missionCompletionPacketId?: string;
    missionCompletionPacketPresent: boolean;
    receiptDigest: string | null;
    exactPacketReferencesReturned?: boolean;
  };
  continuity: {
    source: string;
    readOnly: boolean;
    restartSafe: boolean;
    settlementReplayed: boolean;
    reviewerInvoked: boolean;
    mergeInvoked: boolean;
    eventAckInvoked: boolean;
    gitMutated: boolean;
  };
  exposure: {
    packetContentsExposed: boolean;
    taskIdentityExposed: boolean;
    oidValuesExposed: boolean;
  };
}

interface MissionReceiptInspectorProps {
  repoPath: string;
  expectedMissionId: string;
  expectedPlanId: string;
  expectedReceiptDigest: string;
  onClose: () => void;
}

type CopyState = { value: string; status: "copied" | "failed" } | null;

function shortId(value: string): string {
  return value.length > 16 ? value.slice(0, 16) : value;
}

function validateReceipt(
  response: MissionCompletionResponse,
  expectedMissionId: string,
  expectedPlanId: string,
  expectedReceiptDigest: string,
): MissionCompletionResponse {
  const completion = response.completion;
  if (
    response.outcome !== "completed" ||
    response.completed !== true ||
    response.mission?.missionId !== expectedMissionId ||
    response.mission?.planId !== expectedPlanId ||
    completion?.packetBacked !== true ||
    completion.receiptDigest !== expectedReceiptDigest ||
    completion.missionCompletionPacketPresent !== true ||
    !completion.missionCompletionPacketId ||
    completion.exactPacketReferencesReturned !== true ||
    !Array.isArray(completion.workPacketIds) ||
    completion.workPacketIds.length !== completion.workPacketCount ||
    response.continuity?.readOnly !== true ||
    response.continuity?.restartSafe !== true ||
    response.continuity?.settlementReplayed !== false ||
    response.continuity?.reviewerInvoked !== false ||
    response.continuity?.mergeInvoked !== false ||
    response.continuity?.gitMutated !== false ||
    response.exposure?.packetContentsExposed !== false
  ) {
    throw new Error("The current durable receipt no longer matches this Mission history entry.");
  }
  return response;
}

export function MissionReceiptInspector({
  repoPath,
  expectedMissionId,
  expectedPlanId,
  expectedReceiptDigest,
  onClose,
}: MissionReceiptInspectorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<MissionCompletionResponse | null>(null);
  const [copyState, setCopyState] = useState<CopyState>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReceipt(null);
    try {
      const response = validateReceipt(
        await invoke<MissionCompletionResponse>("cockpit_mission_completion", {
          repoPath,
        }),
        expectedMissionId,
        expectedPlanId,
        expectedReceiptDigest,
      );
      setReceipt(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [expectedMissionId, expectedPlanId, expectedReceiptDigest, repoPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const workPacketIds = useMemo(
    () => [...(receipt?.completion?.workPacketIds ?? [])].sort(),
    [receipt],
  );

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState({ value, status: "copied" });
    } catch {
      setCopyState({ value, status: "failed" });
    }
  }, []);

  const copyLabel = useCallback(
    (value: string, fallback: string) => {
      if (copyState?.value !== value) return fallback;
      return copyState.status === "copied" ? "Copied" : "Copy failed";
    },
    [copyState],
  );

  const completion = receipt?.completion;
  const missionPacketId = completion?.missionCompletionPacketId ?? "";
  const receiptDigest = completion?.receiptDigest ?? "";

  return (
    <section className={styles.receiptInspector} aria-labelledby="mission-receipt-title">
      <div className={styles.receiptHeading}>
        <div>
          <h3 id="mission-receipt-title">Completion receipt</h3>
          <p>Immutable references only. Packet and proof contents stay closed.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close completion receipt">
          Close
        </button>
      </div>

      {loading ? (
        <div className={styles.receiptState} role="status">
          Reading the durable completion receipt…
        </div>
      ) : null}

      {error ? (
        <div className={`${styles.receiptState} ${styles.receiptStateError}`} role="alert">
          <strong>Receipt unavailable</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      {receipt && completion ? (
        <div className={styles.receiptContent}>
          <dl className={styles.receiptSummary}>
            <div>
              <dt>Mission</dt>
              <dd title={receipt.mission?.missionId}>{shortId(receipt.mission?.missionId ?? "")}</dd>
            </div>
            <div>
              <dt>Plan revision</dt>
              <dd>{receipt.mission?.planRevision}</dd>
            </div>
            <div>
              <dt>Tasks</dt>
              <dd>{receipt.taskSummary?.taskCount ?? completion.workPacketCount}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>Packet-backed</dd>
            </div>
          </dl>

          <div className={styles.receiptReference}>
            <div>
              <span>MissionCompletionPacket</span>
              <code title={missionPacketId}>{shortId(missionPacketId)}</code>
            </div>
            <button type="button" onClick={() => void copy(missionPacketId)}>
              {copyLabel(missionPacketId, "Copy packet ID")}
            </button>
          </div>

          <ol className={styles.receiptPacketList} aria-label="Completed work packet references">
            {workPacketIds.map((packetId, index) => (
              <li key={packetId}>
                <div>
                  <span>CompletedWorkPacket {index + 1}</span>
                  <code title={packetId}>{shortId(packetId)}</code>
                </div>
                <button type="button" onClick={() => void copy(packetId)}>
                  {copyLabel(packetId, "Copy packet ID")}
                </button>
              </li>
            ))}
          </ol>

          <div className={styles.receiptDigest}>
            <div>
              <span>Completion receipt digest</span>
              <code title={receiptDigest}>{receiptDigest}</code>
            </div>
            <button type="button" onClick={() => void copy(receiptDigest)}>
              {copyLabel(receiptDigest, "Copy digest")}
            </button>
          </div>

          <p className={styles.receiptBoundary}>
            Read-only · restart-safe · no settlement replay · no packet contents
          </p>

          {copyState?.status === "failed" ? (
            <p className={styles.receiptCopyError} role="status">
              Clipboard access was refused. The reference was not copied.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
