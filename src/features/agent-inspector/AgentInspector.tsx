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
      <div className={styles.header}>
        <span className={styles.title}>Agent Inspector</span>
        <span className={styles.count}>{sessions.length}</span>
      </div>

      {/* Session list */}
      <div className={styles.sessionList}>
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`${styles.sessionItem} ${session.id === activeSessionId ? styles.active : ""}`}
            onClick={() => onSelectSession(session.id)}
          >
            <div className={styles.sessionRow}>
              <span
                className={styles.statusDot}
                style={{ background: STATUS_COLORS[session.status] }}
              />
              <span className={styles.sessionName}>{session.name}</span>
            </div>
            <div className={styles.sessionMeta}>
              <span>{STATUS_LABELS[session.status]}</span>
              <span className={styles.cost}>
                ${session.cost.toFixed(2)}
              </span>
            </div>
          </button>
        ))}
        {sessions.length === 0 && (
          <div className={styles.empty}>
            No active agents.
            <br />
            <span className={styles.hint}>Use Ctrl+Shift+A to start a session</span>
          </div>
        )}
      </div>

      {/* Log viewer */}
      {activeSession && (
        <div className={styles.logSection}>
          <div className={styles.logHeader}>
            <span>{activeSession.model}</span>
            <span className={styles.tokens}>
              {activeSession.tokensUsed.toLocaleString()} tokens
            </span>
          </div>
          <div className={styles.logList}>
            {activeSession.logs.map((log, i) => (
              <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                <span className={styles.logTime}>
                  {new Date(log.timestamp).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className={styles.logContent}>{log.content}</span>
              </div>
            ))}
            {activeSession.logs.length === 0 && (
              <div className={styles.empty}>Waiting for output...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
