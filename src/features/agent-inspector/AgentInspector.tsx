import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { type AgentSession, type AgentStatus, type WorktreeInfo, STATUS_COLORS, STATUS_LABELS, getSessionColor } from "../../shared/types/agent";
import { MODEL_OPTIONS, getModelById } from "../../shared/types/model";
import { showPrompt } from "../../shared/ui/PromptDialog";
import { useAppStore } from "../../shared/store/appStore";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { ContextGauge } from "../../shared/ui/ContextGauge";
import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { ClipboardCopy, Plus, Pencil, Activity, Layers, GitBranch } from "lucide-react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ToolBadge } from "../../shared/ui/ToolBadge";
import { extractToolName } from "../../shared/types/toolBadge";
import styles from "./AgentInspector.module.css";

interface AgentInspectorProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onStartAgent?: (prompt: string, model?: string) => void;
  onStopAgent?: (id: string) => void;
  onCreateWorktree?: (sessionId: string, branchName: string) => Promise<WorktreeInfo | null>;
  onRemoveWorktree?: (sessionId: string) => void;
}

export function AgentInspector({ sessions, activeSessionId, onSelectSession, onStartAgent, onStopAgent, onCreateWorktree, onRemoveWorktree }: AgentInspectorProps) {
  const [tab, setTab] = useState<"sessions" | "activity" | "parallel">("sessions");
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [promptText, setPromptText] = useState("");
  const { selectedModel, setSelectedModel } = useAppStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Inline worktree creation state (per-session)
  const [worktreeInputId, setWorktreeInputId] = useState<string | null>(null);
  const [worktreeBranch, setWorktreeBranch] = useState("");

  const handleCreateWorktree = useCallback(async (sessionId: string) => {
    if (!worktreeBranch.trim() || !onCreateWorktree) return;
    await onCreateWorktree(sessionId, worktreeBranch.trim());
    setWorktreeInputId(null);
    setWorktreeBranch("");
  }, [worktreeBranch, onCreateWorktree]);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== "idle" && s.status !== "done"),
    [sessions],
  );

  // Sort: active sessions first, then idle, then done
  const STATUS_ORDER: Record<AgentStatus, number> = {
    generating: 0, coding: 1, thinking: 2, waiting: 3,
    error: 4, idle: 5, done: 6,
  };
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [sessions],
  );

  // Auto-switch to parallel tab when 2+ sessions become active
  const prevActiveCount = useRef(activeSessions.length);
  useEffect(() => {
    if (activeSessions.length >= 2 && prevActiveCount.current < 2 && tab === "sessions") {
      setTab("parallel");
    }
    if (activeSessions.length < 2 && prevActiveCount.current >= 2 && tab === "parallel") {
      setTab("sessions");
    }
    prevActiveCount.current = activeSessions.length;
  }, [activeSessions.length]);

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
        <button className={`${styles.tab} ${tab === "parallel" ? styles.tabActive : ""}`} onClick={() => setTab("parallel")} title="Parallel session view">
          <Layers size={11} style={{ marginRight: 3, verticalAlign: -1 }} />
          {activeSessions.length > 0 && <span className={styles.tabBadge}>{activeSessions.length}</span>}
        </button>
        <div className={styles.tabActions}>
          <button className={styles.iconBtn} title="Copy session info" onClick={() => { if (activeSession) handleCopySessionInfo(activeSession); }}><ClipboardCopy size={12} /></button>
          <button className={styles.iconBtn} title="Add session" onClick={() => setShowPromptInput(true)}><Plus size={12} /></button>
        </div>
      </div>

      {/* Prompt input + model selector */}
      {showPromptInput && (
        <div
          className={styles.promptInput}
          onBlur={(e) => {
            // Only close if focus leaves the entire promptInput container
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setShowPromptInput(false);
              setPromptText("");
            }
          }}
        >
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
            {sortedSessions.length === 0 && !showPromptInput && (
              <EmptyState preset="agents" title="No active agents" description="Press Ctrl+Shift+A to start an agent" />
            )}
            {sortedSessions.map((s) => {
              const sColor = getSessionColor(s.id);
              const lastLog = s.logs.length > 0 ? s.logs[s.logs.length - 1] : null;
              const pct = s.status === "done" ? 100 : s.status === "idle" ? 0 : s.tokensUsed > 0 ? Math.min(95, Math.round((s.tokensUsed / 10000) * 100)) : 2;
              return (
              <RadixContextMenu.Root key={s.id}>
                <RadixContextMenu.Trigger asChild>
                  <button
                    className={`${styles.card} ${s.watchdog ? styles.cardWatchdog : ""} ${s.id === activeSessionId ? styles.cardActive : ""}`}
                    onClick={() => onSelectSession(s.id)}
                    style={{
                      "--session-accent": sColor.accent,
                      "--session-dim": sColor.dim,
                      "--session-subtle": sColor.subtle,
                      "--session-glow": sColor.glow,
                    } as React.CSSProperties}
                  >
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
                          {pct > 0 && pct < 100 && <span className={styles.cardPct}>{pct}%</span>}
                          {s.filesChanged !== undefined && s.filesChanged > 0 && <span className={styles.cardFiles}>📎{s.filesChanged}</span>}
                          <span className={styles.cardAge}>{formatAge(s.startedAt)}</span>
                        </div>
                      </div>
                      <ContextGauge percent={pct} />
                    </div>
                    {/* Last log preview */}
                    {lastLog && (
                      <div className={styles.cardPreview}>
                        <span className={styles.cardPreviewText}>{lastLog.content}</span>
                      </div>
                    )}
                    <div className={styles.cardMeta}>
                      <span className={styles.cardModel}>{s.model}</span>
                      <span className={styles.cardCost}>&lt;${s.cost.toFixed(2)}</span>
                      {s.status !== "done" && s.status !== "idle" && (
                        <span className={styles.stopBtn} onClick={(e) => { e.stopPropagation(); onStopAgent?.(s.id); }}>■</span>
                      )}
                    </div>
                    <div className={styles.progressTrack}>
                      <div className={styles.progressBar} style={{
                        width: `${pct}%`,
                        background: sColor.accent,
                      }} />
                    </div>
                    {/* Worktree info or inline creation */}
                    {s.worktree ? (
                      <div className={styles.worktreeInfo}>
                        <GitBranch size={10} />
                        <span className={styles.worktreeBranch}>{s.worktree.branch}</span>
                        <span className={styles.worktreeStatus} data-status={s.worktree.status}>{s.worktree.status === "Clean" ? "✓" : s.worktree.status === "Modified" ? "●" : "⚠"}</span>
                      </div>
                    ) : worktreeInputId === s.id ? (
                      <div className={styles.worktreeCreate} onClick={(e) => e.stopPropagation()}>
                        <GitBranch size={10} />
                        <input
                          autoFocus
                          className={styles.worktreeInput}
                          placeholder="branch name"
                          value={worktreeBranch}
                          onChange={(e) => setWorktreeBranch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCreateWorktree(s.id);
                            if (e.key === "Escape") { setWorktreeInputId(null); setWorktreeBranch(""); }
                          }}
                        />
                        <button className={styles.worktreeBtn} onClick={() => handleCreateWorktree(s.id)}>Create</button>
                      </div>
                    ) : null}
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
                    {s.worktree ? (
                      <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onRemoveWorktree?.(s.id)}>
                        End Session &amp; Remove Worktree
                      </RadixContextMenu.Item>
                    ) : (
                      <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => { setWorktreeInputId(s.id); setWorktreeBranch(""); }}>
                        Create Worktree
                      </RadixContextMenu.Item>
                    )}
                    <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => onStartAgent?.(`Attach watchdog to ${s.name}`)}>Attach Watchdog</RadixContextMenu.Item>
                    <RadixContextMenu.Separator className={styles.ctxDivider} />
                    <RadixContextMenu.Item className={styles.ctxItem} disabled={s.status === "idle" || s.status === "done"} onSelect={() => onStopAgent?.(s.id)}>
                      End Session
                    </RadixContextMenu.Item>
                  </RadixContextMenu.Content>
                </RadixContextMenu.Portal>
              </RadixContextMenu.Root>
              );
            })}
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
      ) : tab === "activity" ? (
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
                const logColor = getSessionColor(log.sessionId);
                return (
                <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                  <span className={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className={styles.activityDot} style={{ background: logColor.accent }} />
                  <span className={styles.activityName}>{log.sessionName}</span>
                  {tool && <ToolBadge tool={tool} />}
                  <span className={styles.logContent}>{log.content}</span>
                </div>
                ); })}
            {sessions.flatMap((s) => s.logs).length === 0 && (
              <EmptyState icon={<Activity size={20} />} title="No activity yet" description="Agent logs will appear here" />
            )}
          </div>
        </div>
      ) : (
        /* Parallel tab — stacked mini-logs for all sessions */
        <div className={styles.parallelView}>
          {sessions.length === 0 ? (
            <EmptyState icon={<Layers size={20} />} title="No sessions" description="Start agents to see parallel view" />
          ) : (
            sessions.map((s) => {
              const sColor = getSessionColor(s.id);
              const pct = s.status === "done" ? 100 : s.status === "idle" ? 0 : s.tokensUsed > 0 ? Math.min(95, Math.round((s.tokensUsed / 10000) * 100)) : 2;
              return (
                <div
                  key={s.id}
                  className={`${styles.parallelPane} ${s.id === activeSessionId ? styles.parallelPaneActive : ""}`}
                  style={{ "--session-accent": sColor.accent, "--session-dim": sColor.dim, "--session-glow": sColor.glow } as React.CSSProperties}
                  onClick={() => onSelectSession(s.id)}
                >
                  <div className={styles.parallelHeader}>
                    <PixelAvatar seed={s.id} size={20} />
                    <span className={styles.parallelName}>{s.name}</span>
                    <StatusIcon status={s.status} size={8} />
                    <span className={styles.parallelStatus} style={{ color: STATUS_COLORS[s.status] }}>{STATUS_LABELS[s.status]}</span>
                    {pct > 0 && pct < 100 && <span className={styles.parallelPct}>{pct}%</span>}
                    {s.status !== "done" && s.status !== "idle" && (
                      <span className={styles.stopBtn} onClick={(e) => { e.stopPropagation(); onStopAgent?.(s.id); }}>■</span>
                    )}
                  </div>
                  <div className={styles.parallelProgress}>
                    <div className={styles.parallelProgressBar} style={{ width: `${pct}%`, background: sColor.accent }} />
                  </div>
                  <div className={styles.parallelLogs}>
                    {s.logs.slice(-5).map((log, i) => {
                      const tool = log.type === "tool_use" ? extractToolName(log.content) : null;
                      return (
                        <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                          <span className={styles.logTime}>
                            {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                          {tool && <ToolBadge tool={tool} />}
                          <span className={styles.logContent}>{log.content}</span>
                        </div>
                      );
                    })}
                    {s.logs.length === 0 && (
                      <span className={styles.parallelEmpty}>Waiting for activity...</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
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
