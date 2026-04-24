import { useCallback, useMemo } from "react";

import { type SnapshotSummary, triggerLabel } from "../../shared/types/snapshot";
import type { GridSnapshot } from "../../shared/types/terminal";
import styles from "./TimelineBar.module.css";

export interface ActiveSnapshotOverlay {
  layerId: string;
  snapshotId: string;
  grid: GridSnapshot;
}

export interface TimelineBarProps {
  /** PTY session id whose snapshots are being displayed. Null hides the
   *  Mark button (but the bar itself still renders the empty hint). */
  terminalId: string | null;
  /**
   * Snapshots to render, oldest-to-newest. Lifted from the parent so a
   * single `useSnapshots(terminalId)` subscription lives at the terminal
   * area level instead of being instantiated twice per terminal.
   */
  snapshots: SnapshotSummary[];
  /** Active overlay — when non-null, the bar highlights the matching tick. */
  activeOverlay: ActiveSnapshotOverlay | null;
  /**
   * Invoked when the user picks a snapshot. Parent is responsible for
   * fetching the full grid, starting the overlay via IPC, and wiring it
   * into the terminal renderer's `snapshotOverride`.
   */
  onSelectSnapshot: (summary: SnapshotSummary) => void;
  /** Invoked when the user wants to dismiss the currently-active overlay. */
  onDismissOverlay: () => void;
  /** Explicit bookmark button — label is omitted at MVP. */
  onMarkSnapshot?: () => void;
}

/**
 * Phase 3C-3c — time-travel timeline bar.
 *
 * Renders one tick per captured snapshot, oldest-to-newest. Clicking a tick
 * asks the parent to start a read-only overlay of that grid. Empty sessions
 * render a subtle "No snapshots yet" hint instead of an empty row so the
 * user knows the feature is wired.
 */
export function TimelineBar({
  terminalId,
  snapshots,
  activeOverlay,
  onSelectSnapshot,
  onDismissOverlay,
  onMarkSnapshot,
}: TimelineBarProps) {
  const handleClick = useCallback(
    (summary: SnapshotSummary) => {
      if (activeOverlay?.snapshotId === summary.id) {
        onDismissOverlay();
        return;
      }
      onSelectSnapshot(summary);
    },
    [activeOverlay, onSelectSnapshot, onDismissOverlay],
  );

  const activeSummary = useMemo(() => {
    if (!activeOverlay) return null;
    return snapshots.find((s) => s.id === activeOverlay.snapshotId) ?? null;
  }, [snapshots, activeOverlay]);

  return (
    <div className={styles.root} data-testid="timeline-bar" aria-label="Timeline">
      <span className={styles.label}>TIMELINE</span>
      {snapshots.length === 0 ? (
        <span className={styles.empty}>No snapshots yet — press Enter to capture</span>
      ) : (
        <div className={styles.ticks} role="listbox" aria-label="Snapshots">
          {snapshots.map((snap) => {
            const isActive = activeOverlay?.snapshotId === snap.id;
            const kind = snap.trigger.kind;
            const classes = [styles.tick, kind === "userMarked" ? styles.userMarked : "", isActive ? styles.active : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={snap.id}
                type="button"
                className={classes}
                role="option"
                aria-selected={isActive}
                aria-label={`Snapshot ${snap.id.slice(0, 8)} — ${triggerLabel(snap.trigger)} — ${snap.cols}x${snap.rows}`}
                title={`${triggerLabel(snap.trigger)} · ${snap.cols}×${snap.rows} · ${new Date(snap.capturedAt * 1000).toLocaleTimeString()}`}
                onClick={() => handleClick(snap)}
                data-snapshot-id={snap.id}
                data-active={isActive ? "true" : "false"}
              />
            );
          })}
        </div>
      )}
      {onMarkSnapshot && terminalId && (
        <button
          type="button"
          className={styles.markBtn}
          onClick={onMarkSnapshot}
          aria-label="Bookmark current terminal state"
        >
          ✛ Mark
        </button>
      )}
      {activeOverlay && (
        <div className={styles.activePill} role="status" aria-live="polite">
          <span>Viewing {activeSummary ? triggerLabel(activeSummary.trigger) : "past state"}</span>
          <button
            type="button"
            className={styles.dismissBtn}
            onClick={onDismissOverlay}
            aria-label="Return to live terminal (Esc)"
            title="Return to live (Esc)"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
