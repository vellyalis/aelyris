import { Eraser, ScrollText } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { type Invoke, useLogStream } from "../../shared/hooks/useLogStream";
import { type LogEntry, type LogLevel, levelAtLeast } from "../../shared/types/logs";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./LogsPanel.module.css";

const FILTER_LEVELS: readonly LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

interface LogsPanelProps {
  /** Inject a fake invoke for testing. Production omits this. */
  invoke?: Invoke;
  /** Force the polling cadence (ms). Tests override to keep runs short. */
  pollMs?: number;
  /** Initial collapsed state. Tests open the panel up-front. */
  defaultCollapsed?: boolean;
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--:--:--";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function levelClass(level: string): string {
  switch (level) {
    case "TRACE":
      return styles.levelTRACE;
    case "DEBUG":
      return styles.levelDEBUG;
    case "INFO":
      return styles.levelINFO;
    case "WARN":
      return styles.levelWARN;
    case "ERROR":
      return styles.levelERROR;
    default:
      return styles.levelINFO;
  }
}

export function LogsPanel({ invoke, pollMs, defaultCollapsed = true }: LogsPanelProps) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const [minLevel, setMinLevel] = useState<LogLevel>("INFO");
  const [hideSeq, setHideSeq] = useState<number>(0);

  const stream = useLogStream({
    invoke,
    pollMs,
    enabled: !collapsed,
  });

  const filtered = useMemo(() => {
    return stream.entries.filter((e) => e.seq > hideSeq && levelAtLeast(e.level, minLevel));
  }, [stream.entries, minLevel, hideSeq]);

  const onClear = useCallback(() => {
    // "Clear" is presentation-only — the Rust ring keeps emitting; we
    // just hide everything currently in view by floating the threshold
    // up. New entries with higher seq still arrive.
    if (stream.entries.length === 0) return;
    setHideSeq(stream.entries[stream.entries.length - 1]?.seq);
  }, [stream.entries]);

  return (
    <section className={styles.logs} data-collapsed={collapsed ? "true" : "false"} aria-label="Application logs">
      <PanelHeader
        title="Logs"
        leadingIcon={<ScrollText size={12} />}
        count={collapsed ? undefined : filtered.length}
        collapsible
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      {!collapsed && (
        <div className={styles.body}>
          <div className={styles.controls} role="toolbar" aria-label="Log filters">
            <fieldset className={styles.levelGroup} aria-label="Minimum level">
              {FILTER_LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={styles.levelBtn}
                  data-active={minLevel === l}
                  aria-pressed={minLevel === l}
                  onClick={() => setMinLevel(l)}
                >
                  {l}
                </button>
              ))}
            </fieldset>
            <span className={styles.spacer} />
            <span className={styles.meta} aria-live="polite">
              {filtered.length}/{stream.entries.length}
            </span>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClear}
              aria-label="Clear visible logs"
              title="Clear visible logs (does not affect Rust ring)"
            >
              <Eraser size={11} />
            </button>
          </div>
          {stream.error && (
            <div className={styles.error} role="alert">
              {stream.error}
            </div>
          )}
          <div
            className={styles.list}
            role="log"
            aria-live="off"
            aria-busy={!stream.ready}
            data-empty={filtered.length === 0 ? "true" : "false"}
          >
            {filtered.length === 0 ? (
              <div className={styles.empty}>
                {stream.ready ? "No log entries match this filter." : "Loading logs..."}
              </div>
            ) : (
              filtered.map((entry) => <LogRow key={entry.seq} entry={entry} />)
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className={styles.row} data-level={entry.level} data-testid={`log-row-${entry.seq}`}>
      <span className={styles.timestamp}>{formatTimestamp(entry.timestamp_ms)}</span>
      <span className={`${styles.level} ${levelClass(entry.level)}`}>{entry.level}</span>
      <span className={styles.message}>
        <span className={styles.target}>{entry.target}</span>
        {entry.message}
      </span>
    </div>
  );
}
