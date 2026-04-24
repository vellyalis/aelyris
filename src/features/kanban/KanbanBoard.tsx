import { Bot, ChevronRight, GitBranch, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../../shared/store/appStore";
import { STATUS_COLORS } from "../../shared/types/agent";
import { KANBAN_COLUMNS, type KanbanColumnId, PRIORITY_COLORS, type TaskPriority } from "../../shared/types/kanban";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./KanbanBoard.module.css";

interface KanbanBoardProps {
  onStartAgent?: (prompt: string) => Promise<string | undefined>;
  onActivateTask?: (taskId: string) => void;
  onMoveWithSideEffects?: (taskId: string, toColumn: string) => void;
  projectPath?: string;
  agentStatuses?: Record<string, { status: string; cost: number }>;
}

export function KanbanBoard({
  onStartAgent,
  onActivateTask,
  onMoveWithSideEffects,
  projectPath,
  agentStatuses,
}: KanbanBoardProps) {
  const {
    kanbanTasks,
    addKanbanTask,
    moveKanbanTask,
    deleteKanbanTask,
    updateKanbanTask,
    activeTaskId,
    setActiveTaskId,
  } = useAppStore();
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [showForm, setShowForm] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true });
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

      // Create worktree if projectPath available
      if (projectPath) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("create_worktree", { repoPath: projectPath, branchName: branchSlug });
          updateKanbanTask(task.id, { branch: branchSlug, worktreePath: `${projectPath}-${branchSlug}` });
        } catch {
          /* worktree already exists or no git, continue anyway */
        }
      }

      // Start agent and link
      const sessionId = await onStartAgent(task.title);
      if (sessionId) {
        updateKanbanTask(task.id, { assignedAgentId: sessionId, column: "in_progress" });
      }
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
            autoFocus
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
            <button className={styles.formSubmit} onClick={handleAdd} disabled={!newTitle.trim()}>
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
              <button className={styles.groupHeader} onClick={() => toggleCollapse(col.id)}>
                <ChevronRight size={12} className={`${styles.chevron} ${!isCollapsed ? styles.chevronOpen : ""}`} />
                <span className={styles.groupDot} style={{ background: col.color }} />
                <span className={styles.groupLabel}>{col.label}</span>
                <span className={styles.groupCount}>{tasks.length}</span>
              </button>
              {!isCollapsed && tasks.length === 0 && <div className={styles.groupEmpty}>Drop a task here</div>}
              {!isCollapsed && tasks.length > 0 && (
                <div className={styles.groupItems}>
                  {tasks.map((t) => (
                    <div
                      key={t.id}
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
                          className={styles.itemAction}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLaunchTask(t);
                          }}
                          title="Launch Agent + Worktree"
                        >
                          <Play size={10} />
                        </button>
                      )}
                      <button
                        className={styles.itemDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteKanbanTask(t.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
