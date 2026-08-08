import { invoke } from "@tauri-apps/api/core";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MissionReceiptInspector } from "./MissionReceiptInspector";
import styles from "./OrchestratorPanel.module.css";

type MissionPlanStatus = "previewed" | "accepted" | "rejected" | "cancelled";
type MissionCompletionState =
  | "completed"
  | "incomplete"
  | "inconsistent"
  | "previewed"
  | "rejected"
  | "cancelled";

interface CurrentTaskSummary {
  available: boolean;
  exact: boolean;
  taskCount?: number;
  statusCounts?: Record<string, number>;
  reason?: string;
}

interface MissionHistoryCompletion {
  state: MissionCompletionState;
  packetBacked: boolean;
  workPacketCount: number;
  missionCompletionPacketPresent: boolean;
  receiptDigest: string | null;
}

interface MissionHistoryEntry {
  missionId: string;
  missionRevision: number;
  planId: string;
  planRevision: number;
  status: MissionPlanStatus;
  current: boolean;
  taskCount: number;
  currentTaskSummary: CurrentTaskSummary | null;
  completion: MissionHistoryCompletion;
}

interface MissionHistoryBoundary {
  source: string;
  readOnly: boolean;
  restartSafe: boolean;
  bounded: boolean;
  historyCacheUsed: boolean;
  historyIndexUsed: boolean;
  eventHistoryUsed: boolean;
  repositoryPathExposed: boolean;
  packetIdentityExposed: boolean;
  packetContentsExposed: boolean;
}

interface MissionHistoryResponse {
  outcome: "ok" | "empty";
  repositoryDigest: string;
  requestedLimit: number | null;
  effectiveLimit: number;
  returnedCount: number;
  hasMore: boolean;
  entries: MissionHistoryEntry[];
  boundary: MissionHistoryBoundary;
}

interface MissionHistorySectionProps {
  repoPath: string | null | undefined;
}

interface ReceiptSelection {
  missionId: string;
  planId: string;
  receiptDigest: string;
}

type CopyState = { value: string; status: "copied" | "failed" } | null;

const HISTORY_PAGE_SIZE = 20;
const HISTORY_MAX_LIMIT = 100;
const STATUS_ORDER = ["running", "review", "ready", "pending", "blocked", "failed", "done"];

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function completionLabel(state: MissionCompletionState): string {
  switch (state) {
    case "completed":
      return "Packet-backed";
    case "inconsistent":
      return "Needs reconciliation";
    case "previewed":
      return "Previewed";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    case "incomplete":
      return "Incomplete";
  }
}

function completionTone(state: MissionCompletionState): string {
  switch (state) {
    case "completed":
      return styles.historyBadgeComplete;
    case "inconsistent":
      return styles.historyBadgeAttention;
    case "rejected":
    case "cancelled":
      return styles.historyBadgeTerminal;
    default:
      return styles.historyBadgePending;
  }
}

function formatStatusSummary(summary: CurrentTaskSummary | null): string | null {
  if (!summary) return null;
  if (!summary.available || !summary.exact || !summary.statusCounts) {
    return "Current status unavailable";
  }
  const entries = Object.entries(summary.statusCounts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => {
      const leftIndex = STATUS_ORDER.indexOf(left);
      const rightIndex = STATUS_ORDER.indexOf(right);
      return (
        (leftIndex < 0 ? STATUS_ORDER.length : leftIndex) -
        (rightIndex < 0 ? STATUS_ORDER.length : rightIndex)
      );
    });
  if (entries.length === 0) {
    return `${summary.taskCount ?? 0} tasks`;
  }
  return entries.map(([status, count]) => `${count} ${status}`).join(" · ");
}

function validateHistoryResponse(response: MissionHistoryResponse): MissionHistoryResponse {
  if (
    !response ||
    !Array.isArray(response.entries) ||
    typeof response.returnedCount !== "number" ||
    typeof response.effectiveLimit !== "number" ||
    typeof response.hasMore !== "boolean" ||
    response.boundary?.readOnly !== true ||
    response.boundary?.restartSafe !== true ||
    response.boundary?.historyCacheUsed !== false ||
    response.boundary?.eventHistoryUsed !== false
  ) {
    throw new Error("Mission history returned an invalid or unsafe projection.");
  }
  return response;
}

export function MissionHistorySection({ repoPath }: MissionHistorySectionProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [data, setData] = useState<MissionHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>(null);
  const [receiptSelection, setReceiptSelection] = useState<ReceiptSelection | null>(null);

  const load = useCallback(
    async (requestedLimit: number) => {
      if (!repoPath) return;
      setLoading(true);
      setError(null);
      try {
        const response = validateHistoryResponse(
          await invoke<MissionHistoryResponse>("cockpit_mission_history", {
            repoPath,
            limit: requestedLimit,
          }),
        );
        setData(response);
        setLimit(response.effectiveLimit);
        setLoadedPath(repoPath);
        setReceiptSelection((current) =>
          current &&
          response.entries.some(
            (entry) =>
              entry.current &&
              entry.missionId === current.missionId &&
              entry.planId === current.planId &&
              entry.completion.receiptDigest === current.receiptDigest,
          )
            ? current
            : null,
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setLoading(false);
      }
    },
    [repoPath],
  );

  useEffect(() => {
    setOpen(false);
    setLoading(false);
    setLimit(HISTORY_PAGE_SIZE);
    setLoadedPath(null);
    setData(null);
    setError(null);
    setCopyState(null);
    setReceiptSelection(null);
  }, [repoPath]);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const stale = loadedPath !== repoPath;

  const handleToggle = useCallback(
    (event: SyntheticEvent<HTMLDetailsElement>) => {
      const nextOpen = event.currentTarget.open;
      setOpen(nextOpen);
      if (nextOpen && (!data || stale) && !loading) {
        void load(HISTORY_PAGE_SIZE);
      }
    },
    [data, load, loading, stale],
  );

  const loadOlder = useCallback(() => {
    const nextLimit = Math.min(limit + HISTORY_PAGE_SIZE, HISTORY_MAX_LIMIT);
    void load(nextLimit);
  }, [limit, load]);

  const copyDigest = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState({ value, status: "copied" });
    } catch {
      setCopyState({ value, status: "failed" });
    }
  }, []);

  const copyLabel = useCallback(
    (value: string) => {
      if (copyState?.value !== value) return "Copy digest";
      return copyState.status === "copied" ? "Copied" : "Copy failed";
    },
    [copyState],
  );

  if (!repoPath) return null;

  return (
    <details className={styles.historySection} open={open} onToggle={handleToggle}>
      <summary className={styles.historySummary}>
        <span className={styles.historyChevron} aria-hidden>
          ›
        </span>
        <span className={styles.historyTitle}>Mission history</span>
        <span className={styles.historySummaryMeta}>
          {data ? `${data.returnedCount}${data.hasMore ? "+" : ""} shown` : "On demand"}
        </span>
      </summary>

      <div className={styles.historyBody}>
        <div className={styles.historyToolbar}>
          <p>Durable Mission identity and packet-backed outcomes from the existing backend owner.</p>
          <button type="button" onClick={() => void load(limit)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? (
          <div className={`${styles.historyState} ${styles.historyStateError}`} role="alert">
            <strong>History unavailable</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {!error && loading && !data ? (
          <div className={styles.historyState} role="status">
            Reading durable Mission history…
          </div>
        ) : null}

        {!error && !loading && data?.outcome === "empty" ? (
          <div className={styles.historyState}>No durable Mission attempts for this repository.</div>
        ) : null}

        {!error && entries.length > 0 ? (
          <ol className={styles.historyList} aria-label="Mission attempts">
            {entries.map((entry) => {
              const digest = entry.completion.receiptDigest;
              const currentStatus = entry.current ? formatStatusSummary(entry.currentTaskSummary) : null;
              return (
                <li
                  className={`${styles.historyItem} ${
                    entry.completion.state === "inconsistent" ? styles.historyItemInconsistent : ""
                  }`}
                  key={`${entry.planId}:${entry.planRevision}`}
                >
                  <div className={styles.historyItemHeading}>
                    <div className={styles.historyIdentityGroup}>
                      <span className={styles.historyIdentity} title={entry.missionId}>
                        Mission {shortId(entry.missionId)}
                      </span>
                      <span className={styles.historyRevision}>Plan r{entry.planRevision}</span>
                    </div>
                    <div className={styles.historyBadges}>
                      {entry.current ? <span className={styles.historyBadgeCurrent}>Current</span> : null}
                      <span className={`${styles.historyBadge} ${completionTone(entry.completion.state)}`}>
                        {completionLabel(entry.completion.state)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.historyFacts}>
                    <span>{entry.status}</span>
                    <span>
                      {entry.taskCount} {entry.taskCount === 1 ? "task" : "tasks"}
                    </span>
                    {currentStatus ? <span>{currentStatus}</span> : null}
                    {entry.completion.packetBacked ? (
                      <span>
                        {entry.completion.workPacketCount} work{" "}
                        {entry.completion.workPacketCount === 1 ? "packet" : "packets"}
                      </span>
                    ) : null}
                  </div>

                  {entry.completion.state === "inconsistent" ? (
                    <p className={styles.historyNotice} role="status">
                      Packet lineage is inconsistent. Completion is not trusted.
                    </p>
                  ) : null}

                  {digest && entry.completion.packetBacked ? (
                    <div className={styles.historyDigestRow}>
                      <code title={digest}>{digest.slice(0, 16)}</code>
                      <button
                        type="button"
                        onClick={() => void copyDigest(digest)}
                        aria-label={`Copy completion digest for Mission ${shortId(entry.missionId)}`}
                      >
                        {copyLabel(digest)}
                      </button>
                      {entry.current ? (
                        <button
                          type="button"
                          className={styles.historyInspect}
                          onClick={() =>
                            setReceiptSelection({
                              missionId: entry.missionId,
                              planId: entry.planId,
                              receiptDigest: digest,
                            })
                          }
                        >
                          Inspect receipt
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}

        {data?.hasMore ? (
          <div className={styles.historyBoundedNote}>
            <span>Showing the newest {data.returnedCount}; older entries remain unloaded.</span>
            <button type="button" onClick={loadOlder} disabled={loading || limit >= HISTORY_MAX_LIMIT}>
              {limit >= HISTORY_MAX_LIMIT ? "History limit reached" : "Load older"}
            </button>
          </div>
        ) : null}

        {copyState?.status === "failed" ? (
          <p className={styles.historyCopyError} role="status">
            Clipboard access was refused. The digest was not copied.
          </p>
        ) : null}

        {receiptSelection ? (
          <MissionReceiptInspector
            repoPath={repoPath}
            expectedMissionId={receiptSelection.missionId}
            expectedPlanId={receiptSelection.planId}
            expectedReceiptDigest={receiptSelection.receiptDigest}
            onClose={() => setReceiptSelection(null)}
          />
        ) : null}
      </div>
    </details>
  );
}
