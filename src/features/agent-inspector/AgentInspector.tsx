import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { type AgentSession, type AgentStatus, STATUS_COLORS, STATUS_LABELS, getSessionColor } from "../../shared/types/agent";
import type { InteractiveSession } from "../../shared/types/interactiveAgent";
import { MODEL_OPTIONS, getModelById, getMaxTokens } from "../../shared/types/model";
import { showPrompt } from "../../shared/ui/PromptDialog";
import { showHandoff } from "../../shared/ui/HandoffDialog";
import { buildHandoffPrompt } from "../../shared/lib/handoffPrompt";
import { getBudgetWarning, countOverBudget, type BudgetThresholds } from "../../shared/lib/budgetStatus";
import { collectActivity, filterActivity, LOG_TYPES, type LogType } from "../../shared/lib/activityFilter";
import { useAppStore } from "../../shared/store/appStore";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { ClipboardCopy, Plus, Activity, Layers, GitCompare, AlertTriangle, X, Search } from "lucide-react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { ToolBadge } from "../../shared/ui/ToolBadge";
import { extractToolName } from "../../shared/types/toolBadge";
import { parseToolUse } from "../../shared/lib/agentLogParser";
import {
  buildOrchestraPrompts,
  detectFileConflicts,
  type OrchestraRoleId,
} from "../../shared/lib/orchestrator";
import { showOrchestra } from "../../shared/ui/OrchestraDialog";
import { SessionAnalytics } from "../analytics/SessionAnalytics";
import { SessionCard } from "./SessionCard";
import { InteractiveSessionCard } from "./InteractiveSessionCard";
import { InlineResultPanel } from "./InlineResultPanel";
import styles from "./AgentInspector.module.css";

interface AgentInspectorProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onStartAgent?: (prompt: string, model?: string, meta?: { role?: OrchestraRoleId; handoffFrom?: string }) => void;
  onStopAgent?: (id: string) => void;
  onCreateWorktree?: (sessionId: string, branchName: string) => Promise<import("../../shared/types/agent").WorktreeInfo | null>;
  onRemoveWorktree?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
  interactiveSessions?: InteractiveSession[];
  onFocusInteractiveSession?: (sessionId: string) => void;
  onStopInteractiveSession?: (id: string) => void;
  onEndSessionAndRemoveWorktree?: (id: string) => void;
  onStartInteractiveSession?: (opts: { cwd: string; model?: string; initialPrompt?: string; branchName?: string }) => void;
}

export function AgentInspector({ sessions, activeSessionId, onSelectSession, onStartAgent, onStopAgent, onCreateWorktree, onRemoveWorktree, onRenameSession, interactiveSessions = [], onFocusInteractiveSession, onStopInteractiveSession, onEndSessionAndRemoveWorktree, onStartInteractiveSession }: AgentInspectorProps) {
  const [tab, setTab] = useState<"sessions" | "activity" | "parallel" | "diffs">("sessions");
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [promptText, setPromptText] = useState("");
  const { selectedModel, setSelectedModel, rootProjectPath, perSessionCostCap, contextWarnPct } = useAppStore();
  const budgetThresholds = useMemo<BudgetThresholds>(
    () => ({ perSessionCostCap, contextWarnPct }),
    [perSessionCostCap, contextWarnPct],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Activity tab filter state
  const [activityQuery, setActivityQuery] = useState("");
  const [activityTypes, setActivityTypes] = useState<Set<LogType>>(() => new Set());
  const [activitySessions, setActivitySessions] = useState<Set<string>>(() => new Set());
  const toggleType = useCallback((t: LogType) => {
    setActivityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }, []);
  const toggleActivitySession = useCallback((id: string) => {
    setActivitySessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const resetActivityFilter = useCallback(() => {
    setActivityQuery("");
    setActivityTypes(new Set());
    setActivitySessions(new Set());
  }, []);

  const allActivity = useMemo(() => collectActivity(sessions), [sessions]);
  const filteredActivity = useMemo(
    () => filterActivity(allActivity, { query: activityQuery, types: activityTypes, sessionIds: activitySessions }),
    [allActivity, activityQuery, activityTypes, activitySessions],
  );
  const activityFilterActive = activityQuery.trim().length > 0 || activityTypes.size > 0 || activitySessions.size > 0;
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const [worktreeInputId, setWorktreeInputId] = useState<string | null>(null);
  const [analyticsSessionId, setAnalyticsSessionId] = useState<string | null>(null);
  const analyticsSession = analyticsSessionId ? sessions.find((s) => s.id === analyticsSessionId) : null;
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

  const STATUS_ORDER: Record<AgentStatus, number> = {
    generating: 0, coding: 1, thinking: 2, waiting: 3,
    error: 4, idle: 5, done: 6,
  };
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [sessions],
  );

  const totalCost = useMemo(
    () => sessions.reduce((sum, s) => sum + s.cost, 0),
    [sessions],
  );

  const overBudgetCount = useMemo(
    () => countOverBudget(sessions, budgetThresholds),
    [sessions, budgetThresholds],
  );

  // File-path → session-ids map for conflict badges. Only consider active
  // sessions so a long-done agent's old edits don't light up a live one.
  const conflictsByPath = useMemo(
    () => detectFileConflicts(activeSessions),
    [activeSessions],
  );
  const conflictPathsBySession = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const conflict of conflictsByPath) {
      for (const id of conflict.sessionIds) {
        const list = map.get(id) ?? [];
        list.push(conflict.path);
        map.set(id, list);
      }
    }
    return map;
  }, [conflictsByPath]);

  const handleStopOverBudget = useCallback(() => {
    if (!onStopAgent) return;
    for (const s of sessions) {
      if (getBudgetWarning(s, budgetThresholds) && s.status !== "done" && s.status !== "idle") {
        onStopAgent(s.id);
      }
    }
  }, [sessions, budgetThresholds, onStopAgent]);

  const handleStopSelected = useCallback(() => {
    if (!onStopAgent) return;
    for (const id of selectedIds) {
      const s = sessions.find((x) => x.id === id);
      if (s && s.status !== "done" && s.status !== "idle") onStopAgent(id);
    }
    clearSelection();
  }, [selectedIds, sessions, onStopAgent, clearSelection]);

  // Prune selection when sessions vanish
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const existing = new Set(sessions.map((s) => s.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (existing.has(id)) next.add(id); else changed = true;
    }
    if (changed) setSelectedIds(next);
  }, [sessions, selectedIds]);

  const prevActiveCount = useRef(activeSessions.length);
  useEffect(() => {
    if (activeSessions.length >= 2 && prevActiveCount.current < 2 && tab === "sessions") {
      setTab("parallel");
    }
    if (activeSessions.length < 2 && prevActiveCount.current >= 2 && tab === "parallel") {
      setTab("sessions");
    }
    prevActiveCount.current = activeSessions.length;
  }, [activeSessions.length, tab]);

  const handleRenameSession = useCallback(async (session: AgentSession) => {
    const newName = await showPrompt("Rename Session", { defaultValue: session.name });
    if (newName && newName !== session.name) {
      onRenameSession?.(session.id, newName);
    }
  }, [onRenameSession]);

  const handleHandoff = useCallback(async (session: AgentSession) => {
    if (!onStartAgent) return;
    const result = await showHandoff({
      sourceName: session.name,
      defaultPrompt: buildHandoffPrompt(session),
      defaultModelId: selectedModel,
    });
    if (!result) return;
    const target = getModelById(result.modelId);
    onStartAgent(result.prompt, target?.modelArg);
  }, [onStartAgent, selectedModel]);

  const handleCopySessionInfo = useCallback((session: AgentSession) => {
    const info = `Session: ${session.name}\nModel: ${session.model}\nStatus: ${STATUS_LABELS[session.status]}\nCost: $${session.cost.toFixed(2)}\nTokens: ${session.tokensUsed}`;
    navigator.clipboard.writeText(info).catch(() => {});
  }, []);

  const handleOrchestra = useCallback(async () => {
    if (!onStartAgent || !rootProjectPath) return;
    const result = await showOrchestra();
    if (!result || result.roles.length === 0) return;
    const prompts = buildOrchestraPrompts({
      task: result.task,
      roles: result.roles,
      projectPath: rootProjectPath,
    });
    for (const p of prompts) {
      onStartAgent(p.prompt, p.model, { role: p.roleId as OrchestraRoleId });
    }
  }, [onStartAgent, rootProjectPath]);

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
        <button className={`${styles.tab} ${tab === "diffs" ? styles.tabActive : ""}`} onClick={() => setTab("diffs")} title="View file changes">
          <GitCompare size={11} style={{ marginRight: 3, verticalAlign: -1 }} />
        </button>
        <div className={styles.tabActions}>
          {overBudgetCount > 0 && onStopAgent && (
            <button
              className={styles.overBudgetChip}
              title={`Stop ${overBudgetCount} over-budget session${overBudgetCount === 1 ? "" : "s"}`}
              onClick={handleStopOverBudget}
            >
              <AlertTriangle size={9} style={{ verticalAlign: -1, marginRight: 2 }} />
              {overBudgetCount} over budget
            </button>
          )}
          {totalCost > 0 && <span className={styles.totalCost} title="Total session cost">${totalCost.toFixed(2)}</span>}
          <button className={styles.iconBtn} title="Copy session info" onClick={() => { if (activeSession) handleCopySessionInfo(activeSession); }}><ClipboardCopy size={12} /></button>
          <button className={styles.iconBtn} title="Orchestra mode (3 agents)" onClick={handleOrchestra}>♫</button>
          <button className={styles.iconBtn} title="Add session" onClick={() => setShowPromptInput(true)}><Plus size={12} /></button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.bulkBar} role="toolbar" aria-label="Bulk session actions">
          <span className={styles.bulkCount}>{selectedIds.size} selected</span>
          {onStopAgent && (
            <button className={styles.bulkAction} data-variant="danger" onClick={handleStopSelected}>
              Stop selected
            </button>
          )}
          <button
            className={`${styles.bulkAction} ${styles.bulkClose}`}
            onClick={clearSelection}
            title="Clear selection"
            aria-label="Clear selection"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* Prompt input + model selector */}
      {showPromptInput && (
        <div
          className={styles.promptInput}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setShowPromptInput(false);
              setPromptText("");
            }
          }}
        >
          <div className={styles.modelRow}>
            <select className={styles.modelSelect} value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <span className={styles.modelDot} style={{ background: getModelById(selectedModel)?.color ?? "var(--ctp-blue)" }} />
          </div>
          <input
            autoFocus
            placeholder={`Prompt (Enter=agent, Ctrl+Enter=interactive)...`}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && promptText.trim()) {
                const model = getModelById(selectedModel);
                if (e.ctrlKey && onStartInteractiveSession && rootProjectPath) {
                  onStartInteractiveSession({ cwd: rootProjectPath, model: model?.modelArg, initialPrompt: promptText.trim() });
                } else {
                  onStartAgent?.(promptText.trim(), model?.modelArg);
                }
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
          <div className={styles.cards}>
            {sortedSessions.length === 0 && interactiveSessions.length === 0 && !showPromptInput && (
              <EmptyState preset="agents" title="No active agents" description="Press Ctrl+Shift+A to start an agent" />
            )}

            {interactiveSessions.map((is) => (
              <InteractiveSessionCard
                key={`i-${is.id}`}
                session={is}
                onFocus={onFocusInteractiveSession}
                onStop={onStopInteractiveSession}
                onEndAndRemoveWorktree={onEndSessionAndRemoveWorktree}
              />
            ))}

            {sortedSessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                isActive={s.id === activeSessionId}
                onSelect={onSelectSession}
                onStop={onStopAgent}
                onRename={handleRenameSession}
                onCopyInfo={handleCopySessionInfo}
                onViewAnalytics={setAnalyticsSessionId}
                onViewDiffs={(id) => { onSelectSession(id); setTab("diffs"); }}
                onCreateWorktree={(id) => { setWorktreeInputId(id); setWorktreeBranch(""); }}
                onRemoveWorktree={onRemoveWorktree}
                onStartAgent={onStartAgent}
                onHandoff={onStartAgent ? handleHandoff : undefined}
                budgetThresholds={budgetThresholds}
                isSelected={selectedIds.has(s.id)}
                onToggleSelect={toggleSelect}
                worktreeInputId={worktreeInputId}
                worktreeBranch={worktreeBranch}
                onWorktreeBranchChange={setWorktreeBranch}
                onWorktreeSubmit={handleCreateWorktree}
                onWorktreeCancel={() => { setWorktreeInputId(null); setWorktreeBranch(""); }}
                conflictingPaths={conflictPathsBySession.get(s.id)}
              />
            ))}
            <div className={styles.navHint}>Ctrl+0-9 Jump · Ctrl+[ Prev · Ctrl+] Next · Ctrl+Click to multi-select</div>
          </div>

          {/* Log viewer for selected session */}
          {activeSession && (
            <div className={styles.logSection}>
              <div className={styles.logHeader}>{activeSession.tokensUsed.toLocaleString()} tokens</div>
              <div className={styles.logList}>
                {activeSession.logs.map((log, i) => {
                  const tool = log.type === "tool_use" ? extractToolName(log.content) : null;
                  const parsed = log.type === "tool_use" ? parseToolUse(log.content) : null;
                  return (
                    <div key={i} className={`${styles.logEntry} ${styles[`log_${log.type}`]}`}>
                      <span className={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      {tool && <ToolBadge tool={tool} />}
                      {parsed?.isFileChange && parsed.filePath ? (
                        <span className={styles.logContent}>
                          <span style={{ color: "var(--ctp-green)", fontWeight: 500 }}>{parsed.tool}</span>
                          {" → "}
                          <span style={{ color: "var(--ctp-blue)" }}>{parsed.filePath.split("/").pop()}</span>
                          <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", marginLeft: 4 }}>
                            {parsed.filePath.split("/").slice(-3, -1).join("/")}
                          </span>
                        </span>
                      ) : (
                        <span className={styles.logContent}>{log.content}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : tab === "activity" ? (
        <div className={styles.logSection} style={{ flex: 1 }}>
          <div className={styles.activityFilters}>
            <div className={styles.activitySearchRow}>
              <Search size={11} className={styles.activitySearchIcon} />
              <input
                type="text"
                className={styles.activitySearch}
                placeholder="Filter activity..."
                value={activityQuery}
                onChange={(e) => setActivityQuery(e.target.value)}
              />
              {activityFilterActive && (
                <button
                  className={styles.activityResetBtn}
                  onClick={resetActivityFilter}
                  title="Clear filters"
                  aria-label="Clear filters"
                >
                  <X size={10} />
                </button>
              )}
            </div>
            <div className={styles.activityChips}>
              {LOG_TYPES.map((t) => (
                <button
                  key={t}
                  className={styles.activityChip}
                  data-active={activityTypes.has(t) || undefined}
                  onClick={() => toggleType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {sessions.length > 1 && (
              <div className={styles.activityChips}>
                {sessions.map((s) => {
                  const c = getSessionColor(s.id);
                  return (
                    <button
                      key={s.id}
                      className={styles.activityChip}
                      data-active={activitySessions.has(s.id) || undefined}
                      onClick={() => toggleActivitySession(s.id)}
                      style={{ "--session-accent": c.accent } as React.CSSProperties}
                    >
                      <span className={styles.activityDot} style={{ background: c.accent }} />
                      {s.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className={styles.logHeader}>
            {activityFilterActive ? `${filteredActivity.length} of ${allActivity.length}` : "All Activity"}
          </div>
          <div className={styles.logList}>
            {filteredActivity.slice(0, 200).map((log, i) => {
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
            {allActivity.length === 0 && (
              <EmptyState icon={<Activity size={20} />} title="No activity yet" description="Agent logs will appear here" />
            )}
            {allActivity.length > 0 && filteredActivity.length === 0 && (
              <EmptyState icon={<Search size={20} />} title="No matching activity" description="Try a different search or clear filters" />
            )}
          </div>
        </div>
      ) : (
        <div className={styles.parallelView}>
          {activeSessions.length >= 2 && (
            <div className={styles.parallelSummary}>
              <span>{activeSessions.length} agents running</span>
              <span className={styles.parallelCost}>${activeSessions.reduce((s, a) => s + a.cost, 0).toFixed(2)}</span>
              {conflictsByPath.length > 0 && (
                <span
                  className={styles.parallelConflicts}
                  title={conflictsByPath
                    .slice(0, 8)
                    .map((c) => `${c.path} — ${c.sessionIds.length} agents`)
                    .join("\n") + (conflictsByPath.length > 8 ? `\n+${conflictsByPath.length - 8} more` : "")}
                >
                  <AlertTriangle size={10} style={{ verticalAlign: -1, marginRight: 2 }} />
                  {conflictsByPath.length} file conflict{conflictsByPath.length === 1 ? "" : "s"}
                </span>
              )}
              <button className={styles.stopAllBtn} onClick={() => activeSessions.forEach((s) => onStopAgent?.(s.id))} title="Stop all agents">Stop All</button>
            </div>
          )}
          {sessions.length === 0 ? (
            <EmptyState icon={<Layers size={20} />} title="No sessions" description="Start agents to see parallel view" />
          ) : (
            sessions.map((s) => {
              const sColor = getSessionColor(s.id);
              const pct = s.status === "done" ? 100 : s.status === "idle" ? 0 : s.tokensUsed > 0 ? Math.min(99, Math.round((s.tokensUsed / getMaxTokens(s.model)) * 100)) : 2;
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

      {tab === "diffs" && (
        activeSession ? (
          <InlineResultPanel
            session={activeSession}
            projectPath={rootProjectPath ?? ""}
            onClose={() => setTab("sessions")}
            onStartAgent={onStartAgent}
          />
        ) : (
          <div className={styles.cards}>
            <EmptyState icon={<GitCompare size={20} />} title="No session selected" description="Select an agent session to view its file changes" />
          </div>
        )
      )}

      {analyticsSession && (
        <SessionAnalytics session={analyticsSession} onClose={() => setAnalyticsSessionId(null)} />
      )}
    </div>
  );
}
