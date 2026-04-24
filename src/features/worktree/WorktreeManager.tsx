import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch, Plus, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { toast } from "../../shared/store/toastStore";
import styles from "./WorktreeManager.module.css";

interface WorktreeInfo {
  branch: string;
  path: string;
  is_main: boolean;
}

interface WorktreeManagerProps {
  projectPath: string;
  onSwitch: (worktreePath: string) => void;
}

export function WorktreeManager({ projectPath, onSwitch }: WorktreeManagerProps) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [activePath, setActivePath] = useState(projectPath);
  const [showCreate, setShowCreate] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [loading, setLoading] = useState(false);

  const loadWorktrees = useCallback(async () => {
    try {
      const result = await invoke<WorktreeInfo[]>("list_worktrees", { repoPath: projectPath });
      setWorktrees(result);
    } catch { /* ignore */ }
  }, [projectPath]);

  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!newBranch.trim()) return;
    setLoading(true);
    setCreateError(null);
    try {
      await invoke("create_worktree", { repoPath: projectPath, branchName: newBranch.trim() });
      toast.success("Worktree created", newBranch.trim());
      setNewBranch("");
      setShowCreate(false);
      await loadWorktrees();
    } catch (err) {
      setCreateError(String(err));
      toast.error("Worktree creation failed", String(err));
    } finally {
      setLoading(false);
    }
  }, [newBranch, projectPath, loadWorktrees]);

  const handleSwitch = useCallback((path: string) => {
    setActivePath(path);
    onSwitch(path);
  }, [onSwitch]);

  const handleRemove = useCallback(async (wt: WorktreeInfo) => {
    if (wt.is_main) return;
    const ok = await showConfirm({
      title: `Remove worktree?`,
      description: `This deletes the worktree directory at:\n${wt.path}\n\nThe branch "${wt.branch}" is not deleted from the repository.`,
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    try {
      // Rust command takes (repo_path, worktree_name, delete_branch).
      // `worktree_name` is the branch identifier; we leave the branch intact
      // because the confirm copy told the user the branch stays.
      await invoke("remove_worktree", {
        repoPath: projectPath,
        worktreeName: wt.branch,
        deleteBranch: false,
      });
      toast.success("Worktree removed", wt.branch);
      if (activePath === wt.path) {
        setActivePath(projectPath);
        onSwitch(projectPath);
      }
      await loadWorktrees();
    } catch (err) {
      toast.error("Remove worktree failed", String(err));
    }
  }, [projectPath, activePath, onSwitch, loadWorktrees]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Worktrees</span>
        <button
          type="button"
          className={styles.headerBtn}
          onClick={() => setShowCreate(!showCreate)}
          aria-expanded={showCreate}
          aria-label="New worktree"
          title="New Worktree"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.headerBtn}
          onClick={loadWorktrees}
          aria-label="Refresh worktrees"
          title="Refresh"
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      </div>

      {showCreate && (
        <div className={styles.createForm}>
          <input
            className={styles.createInput}
            placeholder="Branch name..."
            aria-label="New worktree branch name"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
            autoFocus
          />
          <button className={styles.headerBtn} onClick={handleCreate} disabled={loading || !newBranch.trim()}>
            {loading ? "..." : "Create"}
          </button>
          {createError && <div style={{ color: "var(--ctp-red)", fontSize: "var(--text-xs)", padding: "2px 4px" }}>{createError}</div>}
        </div>
      )}

      <div className={styles.list}>
        {worktrees.length === 0 && (
          <EmptyState preset="worktrees" title="No worktrees" description="Create a worktree to work on a branch in parallel" />
        )}
        {worktrees.map((wt) => (
          <button
            key={wt.path}
            type="button"
            className={`${styles.card} ${wt.path === activePath ? styles.cardActive : ""}`}
            onClick={() => handleSwitch(wt.path)}
            aria-pressed={wt.path === activePath}
            aria-label={`Switch to worktree ${wt.branch}${wt.is_main ? " (main)" : ""}`}
          >
            <GitBranch size={14} className={styles.cardIcon} aria-hidden="true" />
            <div className={styles.cardInfo}>
              <div className={styles.cardBranch}>
                {wt.branch}
                {wt.is_main && " (main)"}
              </div>
              <div className={styles.cardPath}>{wt.path}</div>
            </div>
            {!wt.is_main && (
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={(e) => { e.stopPropagation(); handleRemove(wt); }}
                  aria-label={`Remove worktree ${wt.branch}`}
                  title="Remove Worktree"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
