import { type AgentSession, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import styles from "./AgentInspector.module.css";

interface AgentInspectorProps {
  visible: boolean;
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function AgentInspector({
  visible,
  sessions,
  activeSessionId,
  onSelectSession,
}: AgentInspectorProps) {
  if (!visible) return null;

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className={styles.inspector}>
      <div className={styles.header}>Sessions</div>

      {/* Session cards */}
      <div className={styles.cards}>
        {sessions.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>No active agents</div>
            <div className={styles.emptyHint}>Ctrl+Shift+A to start</div>
          </div>
        )}
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`${styles.card} ${session.id === activeSessionId ? styles.cardActive : ""}`}
            onClick={() => onSelectSession(session.id)}
          >
            <div className={styles.cardTop}>
              <span
                className={styles.statusDot}
                style={{ background: STATUS_COLORS[session.status] }}
              />
              <span className={styles.cardName}>{session.name}</span>
            </div>
            <div className={styles.cardStatus}>{STATUS_LABELS[session.status]}</div>
            <div className={styles.cardMeta}>
              <span className={styles.model}>{session.model}</span>
              <span className={styles.cost}>${session.cost.toFixed(2)}</span>
            </div>
            {/* Progress bar */}
            <div className={styles.progressTrack}>
              <div
                className={styles.progressBar}
                style={{
                  width: session.status === "done" ? "100%" : session.status === "idle" ? "0%" : "60%",
                  background: STATUS_COLORS[session.status],
                }}
              />
            </div>
          </button>
        ))}
      </div>

      {/* Log viewer */}
      {activeSession && (
        <div className={styles.logSection}>
          <div className={styles.logHeader}>
            <span>{activeSession.tokensUsed.toLocaleString()} tokens</span>
          </div>
          <div className={styles.logList}>
            {activeSession.logs.map((log, i) => (
              <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                <span className={styles.logTime}>
                  {new Date(log.timestamp).toLocaleTimeString("en-US", {
                    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
                  })}
                </span>
                <span className={styles.logContent}>{log.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
