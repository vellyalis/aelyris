import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Plus, Minus, Undo2, Check, Upload, FileText } from "lucide-react";
import styles from "./SCMPanel.module.css";

interface ChangedFile {
  path: string;
  status: string;
  staged: boolean;
  conflicted: boolean;
}

interface SCMPanelProps {
  projectPath: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}

type GroupId = "staged" | "changes" | "conflicts" | "untracked";

const GROUPS: { id: GroupId; label: string; color: string }[] = [
  { id: "conflicts", label: "Merge Conflicts", color: "var(--ctp-red)" },
  { id: "staged", label: "Staged Changes", color: "var(--ctp-green)" },
  { id: "changes", label: "Changes", color: "var(--ctp-blue)" },
  { id: "untracked", label: "Untracked", color: "var(--text-muted)" },
];

const STATUS_ICON: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  conflicted: "!",
};

export function SCMPanel({ projectPath, onOpenFile, onOpenDiff }: SCMPanelProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const info = await invoke<{ changed_files: ChangedFile[] }>("git_status", { repoPath: projectPath });
      setFiles(info.changed_files);
    } catch { /* not a git repo */ }
  }, [projectPath]);

  useEffect(() => { refresh(); }, [refresh]);
  // Refresh on fs:changed events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ root: string }>("fs:changed", (e) => {
        if (e.payload.root === projectPath) refresh();
      }).then((u) => { unlisten = u; });
    });
    return () => { unlisten?.(); };
  }, [projectPath, refresh]);

  const classify = (f: ChangedFile): GroupId => {
    if (f.conflicted) return "conflicts";
    if (f.staged) return "staged";
    if (f.status === "untracked") return "untracked";
    return "changes";
  };

  const grouped = GROUPS.map((g) => ({
    ...g,
    files: files.filter((f) => classify(f) === g.id),
  })).filter((g) => g.files.length > 0);

  const handleStage = useCallback(async (paths: string[]) => {
    await invoke("git_stage", { repoPath: projectPath, paths });
    refresh();
  }, [projectPath, refresh]);

  const handleUnstage = useCallback(async (paths: string[]) => {
    await invoke("git_unstage", { repoPath: projectPath, paths });
    refresh();
  }, [projectPath, refresh]);

  const handleDiscard = useCallback(async (paths: string[]) => {
    if (!window.confirm(`Discard changes in ${paths.length} file(s)?`)) return;
    await invoke("git_discard", { repoPath: projectPath, paths });
    refresh();
  }, [projectPath, refresh]);

  const handleStageAll = useCallback(async () => {
    await invoke("git_stage_all", { repoPath: projectPath });
    refresh();
  }, [projectPath, refresh]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    try {
      await invoke("git_commit", { repoPath: projectPath, message: commitMsg.trim() });
      setCommitMsg("");
      refresh();
    } catch (e) {
      /* commit error — user sees no new commit in UI */
    } finally { setLoading(false); }
  }, [commitMsg, projectPath, refresh]);

  const handleCommitAndPush = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    try {
      await invoke("git_commit", { repoPath: projectPath, message: commitMsg.trim() });
      await invoke("git_push", { repoPath: projectPath });
      setCommitMsg("");
      refresh();
    } catch (e) {
      /* commit & push error */
    } finally { setLoading(false); }
  }, [commitMsg, projectPath, refresh]);

  const stagedCount = files.filter((f) => f.staged).length;
  const fileName = (path: string) => path.split("/").pop() ?? path;

  return (
    <div className={styles.panel}>
      {/* Commit area */}
      <div className={styles.commitArea}>
        <textarea
          className={styles.commitInput}
          placeholder="Commit message..."
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={2}
          onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") handleCommit(); }}
        />
        <div className={styles.commitActions}>
          <button className={styles.stageAllBtn} onClick={handleStageAll} title="Stage All">
            <Plus size={10} /> Stage All
          </button>
          <button className={styles.commitBtn} onClick={handleCommit} disabled={!commitMsg.trim() || stagedCount === 0 || loading}>
            <Check size={10} /> Commit {stagedCount > 0 && `(${stagedCount})`}
          </button>
          <button className={styles.pushBtn} onClick={handleCommitAndPush} disabled={!commitMsg.trim() || stagedCount === 0 || loading} title="Commit & Push">
            <Upload size={10} />
          </button>
        </div>
      </div>

      {/* File groups */}
      <div className={styles.groups}>
        {grouped.map((g) => (
          <div key={g.id} className={styles.group}>
            <button className={styles.groupHeader} onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}>
              <ChevronRight size={11} className={`${styles.chevron} ${!collapsed[g.id] ? styles.chevronOpen : ""}`} />
              <span className={styles.groupDot} style={{ background: g.color }} />
              <span className={styles.groupLabel}>{g.label}</span>
              <span className={styles.groupCount}>{g.files.length}</span>
              {/* Group-level actions */}
              {g.id === "changes" && (
                <span className={styles.groupActions} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleStage(g.files.map((f) => f.path))} title="Stage all"><Plus size={10} /></button>
                  <button onClick={() => handleDiscard(g.files.map((f) => f.path))} title="Discard all"><Undo2 size={10} /></button>
                </span>
              )}
              {g.id === "staged" && (
                <span className={styles.groupActions} onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleUnstage(g.files.map((f) => f.path))} title="Unstage all"><Minus size={10} /></button>
                </span>
              )}
            </button>
            {!collapsed[g.id] && (
              <div className={styles.fileList}>
                {g.files.map((f) => (
                  <div key={f.path} className={styles.fileRow}>
                    <span className={styles.fileStatus} data-status={f.status}>{STATUS_ICON[f.status] ?? "?"}</span>
                    <span className={styles.fileName} onClick={() => onOpenDiff?.(f.path)} title={f.path}>{fileName(f.path)}</span>
                    <span className={styles.filePath}>{f.path.replace(fileName(f.path), "")}</span>
                    <span className={styles.fileActions}>
                      {g.id === "changes" || g.id === "untracked" ? (
                        <>
                          <button onClick={() => handleStage([f.path])} title="Stage"><Plus size={10} /></button>
                          {g.id === "changes" && <button onClick={() => handleDiscard([f.path])} title="Discard"><Undo2 size={10} /></button>}
                        </>
                      ) : g.id === "staged" ? (
                        <button onClick={() => handleUnstage([f.path])} title="Unstage"><Minus size={10} /></button>
                      ) : null}
                      <button onClick={() => onOpenFile?.(projectPath + "/" + f.path)} title="Open"><FileText size={10} /></button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {files.length === 0 && <div className={styles.empty}>No changes</div>}
      </div>
    </div>
  );
}
