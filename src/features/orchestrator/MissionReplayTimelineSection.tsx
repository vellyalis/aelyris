import { invoke } from "@tauri-apps/api/core";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./OrchestratorPanel.module.css";

interface ReplayMissionIdentity {
  missionId: string;
  missionRevision: number;
  planId: string;
  planRevision: number;
  status: string;
}

interface ReplayCheckpoint {
  position: number;
  eventKind: string;
  taskStatusCounts: Record<string, number>;
  completedWorkCount: number;
  packetBackedMissionState: "completed" | "incomplete";
  checkpointHash: string;
}

interface ReplaySourceSummary {
  taskCount: number;
  executionCount: number;
  durableEventCount: number;
  durableEventScannedCount: number;
  durableEventHighWaterSeq: number;
  workPacketCount: number;
  missionCompletionPacketPresent: boolean;
}

interface ReplayGuarantees {
  readOnly: boolean;
  deterministic: boolean;
  restartSafe: boolean;
  sideEffectCount: number;
  secondJournalUsed: boolean;
  secondTaskGraphUsed: boolean;
  secondPacketStoreUsed: boolean;
  replayCacheUsed: boolean;
}

interface ReplayTimeline {
  mission: ReplayMissionIdentity;
  timelineHash: string;
  totalCheckpointCount: number;
  returnedCheckpointCount: number;
  returnedStartPosition: number | null;
  hasMore: boolean;
  checkpoints: ReplayCheckpoint[];
  finalTaskStatusCounts: Record<string, number>;
  finalCompletedWorkCount: number;
  finalPacketBackedMissionState: "completed" | "incomplete";
  source: ReplaySourceSummary;
  guarantees: ReplayGuarantees;
}

interface ReplayExposure {
  repositoryPathExposed: boolean;
  rawGoalOrContextExposed: boolean;
  taskIdentityOrPayloadExposed: boolean;
  executionIdentityExposed: boolean;
  eventIdentityOrPayloadExposed: boolean;
  globalEventSequenceExposed: boolean;
  oidValuesExposed: boolean;
  reviewOrEvidenceExposed: boolean;
  packetIdentityOrContentsExposed: boolean;
  checkpointPrivateMaterialExposed: boolean;
  recoveryOrRollbackAuthorityExposed: boolean;
}

interface ReplayTimelineResponse {
  schema: string;
  outcome: "ok" | "not_found";
  found: boolean;
  requestedLimit: number | null;
  effectiveLimit: number;
  timeline: ReplayTimeline | null;
  exposure: ReplayExposure;
  notFound?: {
    code: string;
    syntheticTimelineCreated: boolean;
  };
}

interface MissionReplayTimelineSectionProps {
  repoPath: string;
}

type CopyState = { value: string; status: "copied" | "failed" } | null;

const CHECKPOINT_PAGE_SIZE = 20;
const CHECKPOINT_MAX_LIMIT = 100;
const STATUS_ORDER = ["running", "review", "ready", "pending", "blocked", "failed", "done"];

function shortHash(value: string): string {
  return value.length > 16 ? value.slice(0, 16) : value;
}

function formatEventKind(value: string): string {
  return value.replace(/_/g, " ");
}

function formatStatusCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => {
      const leftIndex = STATUS_ORDER.indexOf(left);
      const rightIndex = STATUS_ORDER.indexOf(right);
      return (
        (leftIndex < 0 ? STATUS_ORDER.length : leftIndex) -
        (rightIndex < 0 ? STATUS_ORDER.length : rightIndex)
      );
    });
  return entries.length > 0 ? entries.map(([status, count]) => `${count} ${status}`).join(" · ") : "0 tasks";
}

function validateResponse(response: ReplayTimelineResponse): ReplayTimelineResponse {
  const exposure = response?.exposure;
  const timeline = response?.timeline;
  const exposureClosed =
    exposure &&
    Object.values(exposure).every((value) => value === false);
  if (
    !response ||
    !["ok", "not_found"].includes(response.outcome) ||
    typeof response.effectiveLimit !== "number" ||
    !exposureClosed
  ) {
    throw new Error("Mission replay timeline returned an invalid or unsafe projection.");
  }
  if (response.outcome === "not_found") {
    if (response.found !== false || timeline !== null || response.notFound?.syntheticTimelineCreated !== false) {
      throw new Error("Mission replay timeline returned an invalid not-found projection.");
    }
    return response;
  }
  if (
    response.found !== true ||
    !timeline ||
    !Array.isArray(timeline.checkpoints) ||
    timeline.returnedCheckpointCount !== timeline.checkpoints.length ||
    timeline.timelineHash.length !== 64 ||
    timeline.guarantees?.readOnly !== true ||
    timeline.guarantees?.deterministic !== true ||
    timeline.guarantees?.restartSafe !== true ||
    timeline.guarantees?.sideEffectCount !== 0 ||
    timeline.guarantees?.secondJournalUsed !== false ||
    timeline.guarantees?.secondTaskGraphUsed !== false ||
    timeline.guarantees?.secondPacketStoreUsed !== false ||
    timeline.guarantees?.replayCacheUsed !== false ||
    timeline.checkpoints.some(
      (checkpoint) =>
        checkpoint.checkpointHash.length !== 64 ||
        typeof checkpoint.position !== "number" ||
        typeof checkpoint.eventKind !== "string",
    )
  ) {
    throw new Error("Mission replay timeline returned incomplete convergence evidence.");
  }
  return response;
}

export function MissionReplayTimelineSection({ repoPath }: MissionReplayTimelineSectionProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(CHECKPOINT_PAGE_SIZE);
  const [data, setData] = useState<ReplayTimelineResponse | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>(null);

  const load = useCallback(
    async (requestedLimit: number) => {
      setLoading(true);
      setError(null);
      try {
        const response = validateResponse(
          await invoke<ReplayTimelineResponse>("cockpit_mission_replay_timeline", {
            repoPath,
            limit: requestedLimit,
          }),
        );
        setData(response);
        setLimit(response.effectiveLimit);
        setLoadedPath(repoPath);
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
    setLimit(CHECKPOINT_PAGE_SIZE);
    setData(null);
    setLoadedPath(null);
    setError(null);
    setCopyState(null);
  }, [repoPath]);

  const stale = loadedPath !== repoPath;
  const timeline = data?.timeline ?? null;
  const checkpoints = useMemo(() => timeline?.checkpoints ?? [], [timeline]);

  const handleToggle = useCallback(
    (event: SyntheticEvent<HTMLDetailsElement>) => {
      const nextOpen = event.currentTarget.open;
      setOpen(nextOpen);
      if (nextOpen && (!data || stale) && !loading) {
        void load(CHECKPOINT_PAGE_SIZE);
      }
    },
    [data, load, loading, stale],
  );

  const loadOlder = useCallback(() => {
    void load(Math.min(limit + CHECKPOINT_PAGE_SIZE, CHECKPOINT_MAX_LIMIT));
  }, [limit, load]);

  const copyHash = useCallback(async (value: string) => {
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

  return (
    <details className={styles.replaySection} open={open} onToggle={handleToggle}>
      <summary className={styles.replaySummary}>
        <span className={styles.replayChevron} aria-hidden>
          ›
        </span>
        <span className={styles.replayTitle}>Replay timeline</span>
        <span className={styles.replaySummaryMeta}>
          {timeline
            ? `${timeline.returnedCheckpointCount}${timeline.hasMore ? "+" : ""} checkpoints`
            : "On demand"}
        </span>
      </summary>

      <div className={styles.replayBody}>
        <div className={styles.replayToolbar}>
          <p>Backend-reduced checkpoints only. No recovery or rollback authority.</p>
          <button type="button" onClick={() => void load(limit)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error ? (
          <div className={`${styles.replayState} ${styles.replayStateError}`} role="alert">
            <strong>Replay unavailable</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {!error && loading && !data ? (
          <div className={styles.replayState} role="status">
            Reducing durable Mission history…
          </div>
        ) : null}

        {!error && !loading && data?.outcome === "not_found" ? (
          <div className={styles.replayState}>No accepted Mission is available for replay.</div>
        ) : null}

        {!error && timeline ? (
          <>
            <div className={styles.replayHeader}>
              <div>
                <span>Timeline hash</span>
                <code title={timeline.timelineHash}>{shortHash(timeline.timelineHash)}</code>
              </div>
              <button type="button" onClick={() => void copyHash(timeline.timelineHash)}>
                {copyLabel(timeline.timelineHash, "Copy timeline hash")}
              </button>
            </div>

            <dl className={styles.replayFacts}>
              <div>
                <dt>Checkpoints</dt>
                <dd>
                  {timeline.returnedCheckpointCount} / {timeline.totalCheckpointCount}
                </dd>
              </div>
              <div>
                <dt>Final tasks</dt>
                <dd>{formatStatusCounts(timeline.finalTaskStatusCounts)}</dd>
              </div>
              <div>
                <dt>Completed work</dt>
                <dd>{timeline.finalCompletedWorkCount}</dd>
              </div>
              <div>
                <dt>Mission state</dt>
                <dd>{timeline.finalPacketBackedMissionState}</dd>
              </div>
            </dl>

            <ol className={styles.replayList} aria-label="Mission replay checkpoints">
              {checkpoints.map((checkpoint) => (
                <li className={styles.replayItem} key={`${checkpoint.position}:${checkpoint.checkpointHash}`}>
                  <div className={styles.replayItemHeading}>
                    <span className={styles.replayPosition}>#{checkpoint.position}</span>
                    <span className={styles.replayEvent}>{formatEventKind(checkpoint.eventKind)}</span>
                    <span
                      className={`${styles.replayStateBadge} ${
                        checkpoint.packetBackedMissionState === "completed"
                          ? styles.replayStateComplete
                          : styles.replayStateIncomplete
                      }`}
                    >
                      {checkpoint.packetBackedMissionState}
                    </span>
                  </div>
                  <div className={styles.replayItemFacts}>
                    <span>{formatStatusCounts(checkpoint.taskStatusCounts)}</span>
                    <span>{checkpoint.completedWorkCount} completed work</span>
                  </div>
                  <div className={styles.replayHashRow}>
                    <code title={checkpoint.checkpointHash}>{shortHash(checkpoint.checkpointHash)}</code>
                    <button type="button" onClick={() => void copyHash(checkpoint.checkpointHash)}>
                      {copyLabel(checkpoint.checkpointHash, "Copy checkpoint hash")}
                    </button>
                  </div>
                </li>
              ))}
            </ol>

            {timeline.hasMore ? (
              <div className={styles.replayBoundedNote}>
                <span>
                  Showing checkpoints {timeline.returnedStartPosition ?? 0}–{timeline.totalCheckpointCount - 1}; older
                  checkpoints remain unloaded.
                </span>
                <button type="button" onClick={loadOlder} disabled={loading || limit >= CHECKPOINT_MAX_LIMIT}>
                  {limit >= CHECKPOINT_MAX_LIMIT ? "Checkpoint limit reached" : "Load older checkpoints"}
                </button>
              </div>
            ) : null}

            <p className={styles.replayBoundary}>
              Read-only · deterministic · restart-safe · {timeline.guarantees.sideEffectCount} replay effects · no
              second journal
            </p>
          </>
        ) : null}

        {copyState?.status === "failed" ? (
          <p className={styles.replayCopyError} role="status">
            Clipboard access was refused. The hash was not copied.
          </p>
        ) : null}
      </div>
    </details>
  );
}
