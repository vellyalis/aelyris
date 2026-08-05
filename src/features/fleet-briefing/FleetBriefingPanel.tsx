import { invoke } from "@tauri-apps/api/core";
import { Activity, AlertTriangle, Check, DatabaseZap, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { EventBatch, SeqEvent } from "../../shared/types/eventBus";
import { deriveFleetBriefing, type FleetBriefingCategory } from "./fleetBriefingModel";
import styles from "./FleetBriefingPanel.module.css";

const PAGE_SIZE = 250;
const MAX_PAGES = 16;
const STORAGE_PREFIX = "aelyris:fleet-briefing:";

interface FleetBriefingCursor {
  readonly afterSeq: number;
  readonly viewedAt: number | null;
}

interface FleetBriefingPanelProps {
  readonly projectPath: string;
}

function cursorStorageKey(projectPath: string): string {
  const identity = projectPath.trim().toLowerCase() || "workspace";
  return `${STORAGE_PREFIX}${encodeURIComponent(identity)}`;
}

function isCursorOutOfRange(error: unknown): boolean {
  return String(error).includes('"code":"cursor_out_of_range"');
}

function loadCursor(projectPath: string): FleetBriefingCursor {
  if (typeof window === "undefined") return { afterSeq: 0, viewedAt: null };
  try {
    const raw = window.localStorage.getItem(cursorStorageKey(projectPath));
    if (!raw) return { afterSeq: 0, viewedAt: null };
    const parsed = JSON.parse(raw) as { afterSeq?: unknown; viewedAt?: unknown };
    return {
      afterSeq:
        typeof parsed.afterSeq === "number" && Number.isSafeInteger(parsed.afterSeq) && parsed.afterSeq >= 0
          ? parsed.afterSeq
          : 0,
      viewedAt:
        typeof parsed.viewedAt === "number" && Number.isFinite(parsed.viewedAt) && parsed.viewedAt > 0
          ? parsed.viewedAt
          : null,
    };
  } catch {
    return { afterSeq: 0, viewedAt: null };
  }
}

function saveCursor(projectPath: string, cursor: FleetBriefingCursor): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cursorStorageKey(projectPath), JSON.stringify(cursor));
  } catch {
    // Hardened WebViews may deny localStorage. The durable event owner remains intact;
    // this only means the UI cursor resets next launch.
  }
}

function formatViewedAt(viewedAt: number | null): string {
  if (viewedAt == null) return "First briefing from durable history";
  return `Last marked ${new Date(viewedAt).toLocaleString()}`;
}

const METRICS: ReadonlyArray<{
  category: FleetBriefingCategory;
  label: string;
  icon: typeof Sparkles;
}> = [
  { category: "progress", label: "Progress", icon: Check },
  { category: "attention", label: "Attention", icon: AlertTriangle },
  { category: "durable", label: "Durable", icon: DatabaseZap },
  { category: "fleet", label: "Fleet", icon: Activity },
];

export function FleetBriefingPanel({ projectPath }: FleetBriefingPanelProps) {
  const [cursor, setCursor] = useState<FleetBriefingCursor>(() => loadCursor(projectPath));
  const [events, setEvents] = useState<SeqEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setError("Durable briefing is available in the Aelyris desktop runtime.");
      return;
    }

    setLoading(true);
    setError(null);
    setTruncated(false);
    try {
      let afterSeq = cursor.afterSeq;
      const collected = new Map<number, SeqEvent>();
      let filledEveryPage = true;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch = await invoke<EventBatch>("event_since", { afterSeq, limit: PAGE_SIZE });
        for (const event of batch.events) collected.set(event.seq, event);
        if (batch.events.length < PAGE_SIZE) {
          filledEveryPage = false;
          break;
        }
        afterSeq = batch.events[batch.events.length - 1]?.seq ?? afterSeq;
      }

      let hasMore = false;
      if (filledEveryPage && collected.size > 0) {
        const probe = await invoke<EventBatch>("event_since", { afterSeq, limit: 1 });
        hasMore = probe.events.length > 0;
      }

      setEvents([...collected.values()].sort((left, right) => left.seq - right.seq));
      setTruncated(hasMore);
    } catch (err) {
      setEvents([]);
      if (cursor.afterSeq > 0 && isCursorOutOfRange(err)) {
        const resetCursor = { afterSeq: 0, viewedAt: null };
        saveCursor(projectPath, resetCursor);
        setCursor(resetCursor);
        reportInvokeFailure({ source: "fleet-briefing", operation: "event_since_cursor_reset", err, userVisible: false });
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Could not read durable fleet history: ${detail}`);
      reportInvokeFailure({ source: "fleet-briefing", operation: "event_since", err, userVisible: true });
    } finally {
      setLoading(false);
    }
  }, [cursor.afterSeq, projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const summary = useMemo(() => deriveFleetBriefing(events), [events]);
  const canMarkRead = summary.latestSeq > cursor.afterSeq;

  const markRead = useCallback(() => {
    if (!canMarkRead) return;
    const nextCursor = { afterSeq: summary.latestSeq, viewedAt: Date.now() };
    saveCursor(projectPath, nextCursor);
    setCursor(nextCursor);
    setEvents([]);
  }, [canMarkRead, projectPath, summary.latestSeq]);

  return (
    <section className={styles.panel} aria-label="Fleet briefing">
      <div className={styles.header}>
        <div className={styles.heading}>
          <Sparkles size={14} aria-hidden="true" />
          <div>
            <strong>{summary.headline}</strong>
            <span>{formatViewedAt(cursor.viewedAt)}</span>
          </div>
        </div>
        <button type="button" className={styles.iconButton} onClick={() => void refresh()} disabled={loading} aria-label="Refresh fleet briefing">
          <RefreshCw size={14} aria-hidden="true" className={loading ? styles.spinning : undefined} />
        </button>
      </div>

      <div className={styles.metrics} aria-label="Fleet briefing counts">
        {METRICS.map(({ category, label, icon: Icon }) => (
          <div key={category} className={styles.metric} data-category={category}>
            <Icon size={12} aria-hidden="true" />
            <strong>{summary.counts[category]}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : summary.items.length > 0 ? (
        <ol className={styles.list} aria-label="Latest durable fleet events">
          {summary.items.map((item) => (
            <li key={`${item.seq}:${item.eventId}`} className={styles.item} data-category={item.category}>
              <span className={styles.sequence}>#{item.seq}</span>
              <span className={styles.itemCopy}>
                <strong>{item.label}</strong>
                {item.detail && <span>{item.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>{loading ? "Reading durable fleet history..." : "You are caught up."}</p>
      )}

      {truncated && (
        <p className={styles.notice}>More durable events remain. This briefing shows the first {events.length} after your cursor.</p>
      )}

      <div className={styles.footer}>
        <span>{summary.unlocks} unlock{summary.unlocks === 1 ? "" : "s"} observed</span>
        <button type="button" className={styles.markButton} onClick={markRead} disabled={!canMarkRead || loading}>
          <Check size={12} aria-hidden="true" />
          {truncated ? "Mark loaded as read" : "Mark as read"}
        </button>
      </div>
    </section>
  );
}
