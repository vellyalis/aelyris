import { useState, useCallback } from "react";
import { type AgentSession, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import { MODEL_OPTIONS, getModelById } from "../../shared/types/model";
import { showPrompt } from "../../shared/ui/PromptDialog";
import { useAppStore } from "../../shared/store/appStore";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { ContextGauge } from "../../shared/ui/ContextGauge";
import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { ClipboardCopy, Bell, Plus, Pencil } from "lucide-react";
import { ToolBadge } from "../../shared/ui/ToolBadge";
import { extractToolName } from "../../shared/types/toolBadge";
import styles from "./AgentInspector.module.css";

interface AgentInspectorProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onStartAgent?: (prompt: string, model?: string) => void;
  onStopAgent?: (id: string) => void;
}

export function AgentInspector({ sessions, activeSessionId, onSelectSession, onStartAgent, onStopAgent }: AgentInspectorProps) {
  const [tab, setTab] = useState<"sessions" | "activity">("sessions");
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [promptText, setPromptText] = useState("");
  const { selectedModel, setSelectedModel } = useAppStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleRenameSession = useCallback(async (session: AgentSession) => {
    const newName = await showPrompt("Rename Session", { defaultValue: session.name });
    if (newName && newName !== session.name) {
      // Session rename is in-memory only for now
      session.name = newName;
      onSelectSession(session.id); // trigger re-render
    }
  }, [onSelectSession]);

  const handleCopySessionInfo = useCallback((session: AgentSession) => {
    const info = `Session: ${session.name}\nModel: ${session.model}\nStatus: ${STATUS_LABELS[session.status]}\nCost: $${session.cost.toFixed(2)}\nTokens: ${session.tokensUsed}`;
    navigator.clipboard.writeText(info).catch(() => {});
  }, []);

  return (
    <div className={styles.inspector} role="region" aria-label="Agent sessions">
      {/* Tab toggle */}
      <div className={styles.tabBar}>
        <button className={`${styles.tab} ${tab === "sessions" ? styles.tabActive : ""}`} onClick={() => setTab("sessions")}>Sessions</button>
        <button className={`${styles.tab} ${tab === "activity" ? styles.tabActive : ""}`} onClick={() => setTab("activity")}>Activity</button>
        <div className={styles.tabActions}>
          <button className={styles.iconBtn} title="Copy session info"><ClipboardCopy size={12} /></button>
          <button className={styles.iconBtn} title="Notifications"><Bell size={12} /></button>
          <button className={styles.iconBtn} title="Add session" onClick={() => setShowPromptInput(true)}><Plus size={12} /></button>
        </div>
      </div>

      {/* Prompt input + model selector */}
      {showPromptInput && (
        <div className={styles.promptInput}>
          <div className={styles.modelRow}>
            <select
              className={styles.modelSelect}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <span className={styles.modelDot} style={{ background: getModelById(selectedModel)?.color ?? "var(--ctp-blue)" }} />
          </div>
          <input
            autoFocus
            placeholder={`Prompt for ${getModelById(selectedModel)?.label ?? "Agent"}...`}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && promptText.trim()) {
                const model = getModelById(selectedModel);
                onStartAgent?.(promptText.trim(), model?.modelArg);
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
              <RadixContextMenu.Root key={s.id}>
                <RadixContextMenu.Trigger asChild>
                  <button className={`${styles.card} ${s.watchdog ? styles.cardWatchdog : ""} ${s.id === activeSessionId ? styles.cardActive : ""}`} onClick={() => onSelectSession(s.id)}>
                    <div className={styles.cardTop}>
                      <PixelAvatar seed={s.id} size={36} />
                      <div className={styles.cardInfo}>
                        <div className={styles.cardNameRow}>
                          <span className={styles.cardName}>{s.name}</span>
                          {s.branch && <span className={styles.cardBranch}>⚡{s.branch}</span>}
                          <span className={styles.cardIcons}><Pencil size={9} /></span>
                        </div>
                        <div className={styles.cardStatusRow}>
                          <StatusIcon status={s.status} size={10} />
                          <span className={styles.cardStatusLabel} style={{ color: STATUS_COLORS[s.status] }}>{STATUS_LABELS[s.status]}</span>
                          {s.filesChanged !== undefined && s.filesChanged > 0 && <span className={styles.cardFiles}>📎{s.filesChanged}</span>}
                          <span className={styles.cardAge}>{formatAge(s.startedAt)}</span>
                        </div>
                      </div>
                      <ContextGauge percent={s.status === "done" ? 100 : s.status === "idle" ? 0 : s.tokensUsed > 0 ? Math.min(95, (s.tokensUsed / 10000) * 100) : 2} />
                    </div>
                    <div className={styles.cardMeta}>
                      <span className={styles.cardModel}>{s.model}</span>
                      <span className={styles.cardCost}>&lt;${s.cost.toFixed(2)}</span>
                      {s.status !== "done" && s.status !== "idle" && (
                        <span className={styles.stopBtn} onClick={(e) => { e.stopPropagation(); onStopAgent?.(s.id); }}>■</span>
                      )}
                    </div>
                    <div className={styles.progressTrack}>
                      <div className={styles.progressBar} style={{
                        width: s.status === "done" ? "100%" : s.status === "idle" ? "0%" : s.status === "generating" ? "50%" : "30%",
                        background: STATUS_COLORS[s.status],
                      }} />
                    </div>
                    {s.watchdog && (
                      <div className={styles.watchdogInfo}>🐕 {s.watchdog}</div>
                    )}
                  </button>
                </RadixContextMenu.Trigger>
                <RadixContextMenu.Portal>
                  <RadixContextMenu.Content className={styles.ctxMenu}>
                    <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onSelectSession(s.id)}>Switch to Session</RadixContextMenu.Item>
                    <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => handleRenameSession(s)}>Rename</RadixContextMenu.Item>
                    <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => handleCopySessionInfo(s)}>Copy Info</RadixContextMenu.Item>
                    <RadixContextMenu.Separator className={styles.ctxDivider} />
                    <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onStartAgent?.(`Create worktree for ${s.name}`, s.model)}>Create Worktree</RadixContextMenu.Item>
                    <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onStartAgent?.(`Attach watchdog to ${s.name}`)}>Attach Watchdog</RadixContextMenu.Item>
                    <RadixContextMenu.Separator className={styles.ctxDivider} />
                    <RadixContextMenu.Item className={styles.ctxItem} disabled={s.status === "idle" || s.status === "done"} onSelect={() => onStopAgent?.(s.id)}>
                      End Session
                    </RadixContextMenu.Item>
                  </RadixContextMenu.Content>
                </RadixContextMenu.Portal>
              </RadixContextMenu.Root>
            ))}
            <div className={styles.navHint}>Ctrl+0-9 Jump · Ctrl+[ Prev · Ctrl+] Next</div>
          </div>

          {/* Log viewer for selected session */}
          {activeSession && (
            <div className={styles.logSection}>
              <div className={styles.logHeader}>{activeSession.tokensUsed.toLocaleString()} tokens</div>
              <div className={styles.logList}>
                {activeSession.logs.map((log, i) => {
                  const tool = log.type === "tool_use" ? extractToolName(log.content) : null;
                  return (
                    <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                      <span className={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      {tool && <ToolBadge tool={tool} />}
                      <span className={styles.logContent}>{log.content}</span>
                    </div>
                  );
                })}
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
              .map((log, i) => {
                const tool = log.type === "tool_use" ? extractToolName(log.content) : null;
                return (
                <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                  <span className={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className={styles.activityName}>{log.sessionName}</span>
                  {tool && <ToolBadge tool={tool} />}
                  <span className={styles.logContent}>{log.content}</span>
                </div>
                ); })}
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
