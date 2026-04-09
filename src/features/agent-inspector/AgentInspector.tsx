import { useState } from "react";
import { type AgentSession, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import styles from "./AgentInspector.module.css";

interface AgentInspectorProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onStartAgent?: (prompt: string) => void;
  onStopAgent?: (id: string) => void;
}

export function AgentInspector({ sessions, activeSessionId, onSelectSession, onStartAgent, onStopAgent }: AgentInspectorProps) {
  const [tab, setTab] = useState<"sessions" | "activity">("sessions");
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [promptText, setPromptText] = useState("");
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className={styles.inspector}>
      {/* Tab toggle */}
      <div className={styles.tabBar}>
        <button className={`${styles.tab} ${tab === "sessions" ? styles.tabActive : ""}`} onClick={() => setTab("sessions")}>Sessions</button>
        <button className={`${styles.tab} ${tab === "activity" ? styles.tabActive : ""}`} onClick={() => setTab("activity")}>Activity</button>
        <div className={styles.tabActions}>
          <button className={styles.iconBtn} title="Add session" onClick={() => setShowPromptInput(true)}>+</button>
        </div>
      </div>

      {/* Prompt input */}
      {showPromptInput && (
        <div className={styles.promptInput}>
          <input
            autoFocus
            placeholder="Enter prompt for Claude..."
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && promptText.trim()) {
                onStartAgent?.(promptText.trim());
                setPromptText("");
                setShowPromptInput(false);
              }
              if (e.key === "Escape") { setShowPromptInput(false); setPromptText(""); }
            }}
            className={styles.promptField}
          />
        </div>
      )}

      {tab === "sessions" ? (
        <>
          {/* Session cards */}
          <div className={styles.cards}>
            {sessions.length === 0 && !showPromptInput && (
              <div className={styles.empty}>
                <div>No active agents</div>
                <div className={styles.hint}>Ctrl+Shift+A to start</div>
              </div>
            )}
            {sessions.map((s) => (
              <button key={s.id} className={`${styles.card} ${s.watchdog ? styles.cardWatchdog : ""} ${s.id === activeSessionId ? styles.cardActive : ""}`} onClick={() => onSelectSession(s.id)}>
                <div className={styles.cardTop}>
                  <span className={styles.statusDot} style={{ background: STATUS_COLORS[s.status] }} />
                  <span className={styles.cardName}>{s.name}</span>
                  {s.branch && <span className={styles.cardBranch}>⚡{s.branch}</span>}
                  <span className={styles.cardPct}>{s.status === "done" ? "100" : "—"}%</span>
                </div>
                <div className={styles.progressTrack}>
                  <div className={styles.progressBar} style={{ width: s.status === "done" ? "100%" : s.status === "idle" ? "0%" : s.status === "generating" ? "50%" : "30%" }} />
                </div>
                <div className={styles.cardMeta}>
                  <span><span className={styles.statusDotSmall} style={{ background: STATUS_COLORS[s.status] }} /> {STATUS_LABELS[s.status]}</span>
                  {s.filesChanged !== undefined && s.filesChanged > 0 && <span className={styles.cardFiles}>📎{s.filesChanged}</span>}
                  <span className={styles.cardAge}>{formatAge(s.startedAt)}</span>
                  <span className={styles.cardModel}>{s.model}</span>
                  <span className={styles.cardCost}>${s.cost.toFixed(2)}</span>
                  {s.status !== "done" && s.status !== "idle" && (
                    <span className={styles.stopBtn} onClick={(e) => { e.stopPropagation(); onStopAgent?.(s.id); }}>■</span>
                  )}
                </div>
                {s.watchdog && (
                  <div className={styles.watchdogInfo}>🐕 {s.watchdog}</div>
                )}
              </button>
            ))}
            <div className={styles.navHint}>Ctrl+0-9 Jump · Ctrl+[ Prev · Ctrl+] Next</div>
          </div>

          {/* Log viewer for selected session */}
          {activeSession && (
            <div className={styles.logSection}>
              <div className={styles.logHeader}>{activeSession.tokensUsed.toLocaleString()} tokens</div>
              <div className={styles.logList}>
                {activeSession.logs.map((log, i) => (
                  <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                    <span className={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className={styles.logContent}>{log.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* Activity tab — unified feed from all sessions */
        <div className={styles.logSection} style={{ flex: 1 }}>
          <div className={styles.logHeader}>All Activity</div>
          <div className={styles.logList}>
            {sessions
              .flatMap((s) => s.logs.map((log) => ({ ...log, sessionName: s.name, sessionId: s.id })))
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, 100)
              .map((log, i) => (
                <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                  <span className={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className={styles.activityName}>{log.sessionName}</span>
                  <span className={styles.logContent}>{log.content}</span>
                </div>
              ))}
            {sessions.flatMap((s) => s.logs).length === 0 && (
              <div className={styles.empty}>No activity yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatAge(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
