import { invoke } from "@tauri-apps/api/core";
import { Bot, ChevronRight, FileText, GitBranch, Play, Plus } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../../shared/store/appStore";
import { toast } from "../../shared/store/toastStore";
import { type AgentSession, STATUS_COLORS } from "../../shared/types/agent";
import { KANBAN_COLUMNS, type KanbanColumnId, PRIORITY_COLORS, type TaskPriority } from "../../shared/types/kanban";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import { InlineResultPanel } from "../agent-inspector/InlineResultPanel";
import styles from "./KanbanBoard.module.css";

interface CreatedWorktree {
  branch: string;
  path: string;
}

interface KanbanBoardProps {
  onStartAgent?: (prompt: string) => Promise<string | undefined>;
  onActivateTask?: (taskId: string) => void;
  onMoveWithSideEffects?: (taskId: string, toColumn: string) => void;
  projectPath?: string;
  agentStatuses?: Record<string, { status: string; cost: number }>;
  /** Full fleet sessions, so a review card can resolve its assigned agent for
   *  the inline diff panel (agentStatuses alone lacks changedFileDetails). */
  sessions?: AgentSession[];
}

export function KanbanBoard({
  onStartAgent,
  onActivateTask,
  onMoveWithSideEffects,
  projectPath,
  agentStatuses,
  sessions,
}: KanbanBoardProps) {
  // Subscribe to each store slice individually so a write to an unrelated
  // field (terminals, agents, ghost layers…) does not re-render the entire
  // kanban tree. The previous `useAppStore()` call grabbed the whole store
  // and forced a re-render on every state mutation app-wide.
  const kanbanTasks = useAppStore((s) => s.kanbanTasks);
  const addKanbanTask = useAppStore((s) => s.addKanbanTask);
  const moveKanbanTask = useAppStore((s) => s.moveKanbanTask);
  const deleteKanbanTask = useAppStore((s) => s.deleteKanbanTask);
  const updateKanbanTask = useAppStore((s) => s.updateKanbanTask);
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const setActiveTaskId = useAppStore((s) => s.setActiveTaskId);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [showForm, setShowForm] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Close form on outside click (mousedown for WebView2 reliability)
  useEffect(() => {
    if (!showForm) return;
    const handler = (e: MouseEvent) => {
      if (formRef.current?.contains(e.target as Node)) return;
      setShowForm(false);
      setNewTitle("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showForm]);

  const handleAdd = useCallback(() => {
    if (!newTitle.trim()) return;
    addKanbanTask(newTitle.trim(), newPriority);
    setNewTitle("");
    setShowForm(false);
  }, [newTitle, newPriority, addKanbanTask]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleActivate = useCallback(
    (taskId: string) => {
      setActiveTaskId(taskId);
      onActivateTask?.(taskId);
    },
    [setActiveTaskId, onActivateTask],
  );

  // Unified task→agent launch: create worktree → start agent → link → move to in_progress
  const handleLaunchTask = useCallback(
    async (task: { id: string; title: string }) => {
      if (!onStartAgent) return;
      const branchSlug = `task/${task.id.replace("task-", "")}`;
      let worktree: CreatedWorktree | null = null;

      // Create worktree if projectPath available
      if (projectPath) {
        // Pre-flight through the shared validator so a bad slug fails with a
        // clean message BEFORE any git side-effect (create_worktree validates
        // internally, but only after starting work).
        try {
          await invoke("validate_branch_name", { name: branchSlug });
        } catch (error) {
          toast.error("Invalid branch name", error instanceof Error ? error.message : String(error));
          return;
        }
        try {
          worktree = await invoke<CreatedWorktree>("create_worktree", {
            repoPath: projectPath,
            branchName: branchSlug,
          });
        } catch (error) {
          toast.error("Worktree creation failed", error instanceof Error ? error.message : String(error));
          return;
        }
      }

      // Start agent and link
      let sessionId: string | undefined;
      try {
        sessionId = await onStartAgent(task.title);
      } catch (error) {
        toast.error("Agent launch failed", error instanceof Error ? error.message : String(error));
        return;
      }
      if (!sessionId) {
        toast.error("Agent launch failed", "No session was created.");
        return;
      }
      updateKanbanTask(task.id, {
        ...(worktree ? { branch: worktree.branch, worktreePath: worktree.path } : {}),
        assignedAgentId: sessionId,
        column: "in_progress",
      });
    },
    [onStartAgent, projectPath, updateKanbanTask],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toColumn: KanbanColumnId) => {
      e.preventDefault();
      e.currentTarget.classList.remove(styles.dropHover);
      const taskId = e.dataTransfer.getData("taskId");
      if (taskId) {
        moveKanbanTask(taskId, toColumn);
        onMoveWithSideEffects?.(taskId, toColumn);
      }
    },
    [moveKanbanTask, onMoveWithSideEffects],
  );

  return (
    <div className={styles.container}>
      <PanelHeader
        title="Tasks"
        count={kanbanTasks.length}
        actions={
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setShowForm(!showForm)}
            title="New Task"
            aria-label="New task"
          >
            <Plus size={12} aria-hidden="true" />
          </button>
        }
      />

      {showForm && (
        <div ref={formRef} className={styles.form}>
          <input
            className={styles.formInput}
            placeholder="Task title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") {
                setShowForm(false);
                setNewTitle("");
              }
            }}
          />
          <div className={styles.formRow}>
            <select
              className={styles.formSelect}
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <button type="button" className={styles.formSubmit} onClick={handleAdd} disabled={!newTitle.trim()}>
              Add
            </button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {KANBAN_COLUMNS.map((col) => {
          const tasks = kanbanTasks.filter((t) => t.column === col.id);
          const isCollapsed = !!collapsed[col.id];
          return (
            /* biome-ignore lint/a11y/noStaticElementInteractions: Column drag/drop is paired with keyboard task activation inside the column. */
            <div
              key={col.id}
              className={styles.group}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add(styles.dropHover);
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove(styles.dropHover)}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <button type="button" className={styles.groupHeader} onClick={() => toggleCollapse(col.id)}>
                <ChevronRight size={12} className={`${styles.chevron} ${!isCollapsed ? styles.chevronOpen : ""}`} />
                <span className={styles.groupDot} style={{ background: col.color }} />
                <span className={styles.groupLabel}>{col.label}</span>
                <span className={styles.groupCount}>{tasks.length}</span>
              </button>
              {!isCollapsed && tasks.length === 0 && <div className={styles.groupEmpty}>Drop a task here</div>}
              {!isCollapsed && tasks.length > 0 && (
                <div className={styles.groupItems}>
                  {tasks.map((t) => {
                    const reviewSession =
                      t.column === "review" && t.assignedAgentId
                        ? sessions?.find((session) => session.id === t.assignedAgentId)
                        : undefined;
                    return (
                      <Fragment key={t.id}>
                        {/* biome-ignore lint/a11y/useSemanticElements: The draggable task card contains nested action buttons, so a button wrapper would be invalid. */}
                        <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Activate task: ${t.title}`}
                      aria-pressed={t.id === activeTaskId}
                      className={`${styles.item} ${t.id === activeTaskId ? styles.itemActive : ""}`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("taskId", t.id)}
                      onClick={() => handleActivate(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleActivate(t.id);
                        }
                      }}
                    >
                      <span
                        className={styles.priorityDot}
                        style={{ background: PRIORITY_COLORS[t.priority ?? "medium"] }}
                      />
                      <span className={styles.itemTitle}>{t.title}</span>
                      {t.branch && <GitBranch size={10} className={styles.itemBranchIcon} aria-hidden="true" />}
                      {t.assignedAgentId && agentStatuses?.[t.assignedAgentId] && (
                        <span
                          className={styles.itemAgentBadge}
                          style={{
                            color:
                              STATUS_COLORS[agentStatuses[t.assignedAgentId].status as keyof typeof STATUS_COLORS] ??
                              "var(--text-muted)",
                          }}
                          title={`Agent: ${agentStatuses[t.assignedAgentId].status}`}
                        >
                          <Bot size={10} />
                        </span>
                      )}
                      {(t.column === "todo" || t.column === "in_progress") && !t.assignedAgentId && onStartAgent && (
                        <button
                          type="button"
                          className={styles.itemAction}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLaunchTask(t);
                          }}
                          // Stop Enter / Space at the button so the outer
                          // role="button" wrapper's onKeyDown does not also
                          // fire — without this, hitting Enter on Launch
                          // calls preventDefault on the outer keydown,
                          // which suppresses the native button activation
                          // and ends up calling handleActivate instead of
                          // handleLaunchTask.
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                            }
                          }}
                          title="Launch Agent + Worktree"
                          aria-label={`Launch agent for task: ${t.title}`}
                        >
                          <Play size={10} aria-hidden="true" />
                        </button>
                      )}
                      {reviewSession && (
                        <button
                          type="button"
                          className={styles.itemAction}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReviewTaskId((cur) => (cur === t.id ? null : t.id));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                            }
                          }}
                          title={reviewTaskId === t.id ? "Hide agent changes" : "Review agent changes"}
                          aria-label={`Review changes for task: ${t.title}`}
                        >
                          <FileText size={10} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.itemDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteKanbanTask(t.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                          }
                        }}
                        title="Delete task"
                        aria-label={`Delete task: ${t.title}`}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                        {reviewTaskId === t.id && reviewSession && (
                          <InlineResultPanel
                            session={reviewSession}
                            projectPath={projectPath ?? ""}
                            onClose={() => setReviewTaskId(null)}
                            onStartAgent={
                              onStartAgent
                                ? (prompt) => {
                                    void onStartAgent(prompt);
                                  }
                                : undefined
                            }
                          />
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
