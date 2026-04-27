import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  FileText,
  GitBranch,
  Minus,
  Plus,
  Undo2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../../shared/store/toastStore";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { GitStatusPip } from "../../shared/ui/GitStatusPip";
import { PanelHeader } from "../../shared/ui/PanelHeader";
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

type GroupId = "staged" | "changes" | "conflicts" | "untracked" | "renamed";

const GROUPS: { id: GroupId; label: string; color: string }[] = [
  { id: "conflicts", label: "Merge Conflicts", color: "var(--ctp-red)" },
  { id: "staged", label: "Staged Changes", color: "var(--ctp-green)" },
  { id: "changes", label: "Changes", color: "var(--ctp-blue)" },
  { id: "renamed", label: "Renamed", color: "var(--ctp-cyan)" },
  { id: "untracked", label: "Untracked", color: "var(--text-muted)" },
];

interface GitStatusInfo {
  branch: string;
  is_dirty: boolean;
  changed_files: ChangedFile[];
  upstream: string;
  ahead: number;
  behind: number;
}

export function SCMPanel({ projectPath, onOpenFile, onOpenDiff }: SCMPanelProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [branch, setBranch] = useState<string>("");
  const [upstream, setUpstream] = useState<string>("");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await invoke<GitStatusInfo>("git_status", { repoPath: projectPath });
      setFiles(info.changed_files);
      setBranch(info.branch);
      setUpstream(info.upstream);
      setAhead(info.ahead);
      setBehind(info.behind);
    } catch {
      /* not a git repo */
    }
  }, [projectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  // Refresh on fs:changed events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    // Without the cancelled flag, an unmount that races the dynamic
    // import + listen() resolution leaks the listener: the cleanup runs
    // before `unlisten` is assigned, and the .then callback then stores
    // a handle on an unmounted component that nothing ever calls. Same
    // shape as the WorkflowPanel listener leak landed in round 2.
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ root: string }>("fs:changed", (e) => {
          if (cancelled) return;
          if (e.payload.root === projectPath) refresh();
        }),
      )
      .then((u) => {
        if (cancelled) {
          u();
          return;
        }
        unlisten = u;
      })
      .catch(() => {
        // Backend unreachable (e.g. tests). No listener was registered.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [projectPath, refresh]);

  const classify = (f: ChangedFile): GroupId => {
    if (f.conflicted) return "conflicts";
    if (f.staged) return "staged";
    if (f.status === "untracked") return "untracked";
    if (f.status === "renamed") return "renamed";
    return "changes";
  };

  const grouped = GROUPS.map((g) => ({
    ...g,
    files: files.filter((f) => classify(f) === g.id),
  })).filter((g) => g.files.length > 0);

  // Each stage/unstage/discard/stage-all wrapper used to `await invoke()`
  // bare. A reject would fall out as an uncaught promise rejection in the
  // event handler — the click would silently no-op, no toast, and the
  // working copy state would still be stale because `refresh()` never
  // ran. Surface failures + still refresh so the UI re-syncs with disk.
  const handleStage = useCallback(
    async (paths: string[]) => {
      try {
        await invoke("git_stage", { repoPath: projectPath, paths });
      } catch (e) {
        toast.error("Stage failed", String(e));
      }
      refresh();
    },
    [projectPath, refresh],
  );

  const handleUnstage = useCallback(
    async (paths: string[]) => {
      try {
        await invoke("git_unstage", { repoPath: projectPath, paths });
      } catch (e) {
        toast.error("Unstage failed", String(e));
      }
      refresh();
    },
    [projectPath, refresh],
  );

  const handleDiscard = useCallback(
    async (paths: string[]) => {
      const ok = await showConfirm({
        title: paths.length === 1 ? `Discard changes in ${paths[0]}?` : `Discard changes in ${paths.length} files?`,
        description: "This cannot be undone.",
        confirmLabel: "Discard",
        tone: "danger",
      });
      if (!ok) return;
      try {
        await invoke("git_discard", { repoPath: projectPath, paths });
      } catch (e) {
        toast.error("Discard failed", String(e));
      }
      refresh();
    },
    [projectPath, refresh],
  );

  const handleStageAll = useCallback(async () => {
    try {
      await invoke("git_stage_all", { repoPath: projectPath });
    } catch (e) {
      toast.error("Stage all failed", String(e));
    }
    refresh();
  }, [projectPath, refresh]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    setIsCommitting(true);
    try {
      await invoke("git_commit", { repoPath: projectPath, message: commitMsg.trim() });
      setCommitMsg("");
      toast.success("Committed", commitMsg.trim().slice(0, 50));
      refresh();
    } catch (e) {
      toast.error("Commit failed", String(e));
    } finally {
      setLoading(false);
      setIsCommitting(false);
    }
  }, [commitMsg, projectPath, refresh]);

  const handleCommitAndPush = useCallback(async () => {
    if (!commitMsg.trim()) return;
    setLoading(true);
    setIsPushing(true);
    try {
      await invoke("git_commit", { repoPath: projectPath, message: commitMsg.trim() });
      await invoke("git_push", { repoPath: projectPath });
      setCommitMsg("");
      toast.success("Committed & pushed", commitMsg.trim().slice(0, 50));
      refresh();
    } catch (e) {
      toast.error("Commit & push failed", String(e));
    } finally {
      setLoading(false);
      setIsPushing(false);
    }
  }, [commitMsg, projectPath, refresh]);

  const stagedCount = files.filter((f) => f.staged).length;
  const fileName = (path: string) => path.split("/").pop() ?? path;

  const handleCommitMsgChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommitMsg(e.target.value);
    const el = e.currentTarget;
    // Autogrow: reset to the min row height first so the scrollHeight read
    // reflects the actual content, not the previous value (Chrome caches).
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div className={styles.panel}>
      <PanelHeader title="Source control" count={stagedCount} />
      {/* Branch + tracking summary */}
      {branch && (
        <div className={styles.branchBar}>
          <GitBranch size={10} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.branchName} title={upstream ? `Tracking ${upstream}` : "No upstream configured"}>
            {branch}
          </span>
          {upstream && (
            <span className={styles.upstream} title={`Upstream: ${upstream}`}>
              <ArrowRight size={10} strokeWidth={2} aria-hidden="true" />
              {upstream.replace(/^origin\//, "")}
            </span>
          )}
          {(ahead > 0 || behind > 0) && (
            <span className={styles.syncPair}>
              {ahead > 0 && (
                <span className={styles.ahead} title={`${ahead} commit${ahead === 1 ? "" : "s"} ahead of upstream`}>
                  <ArrowUp size={10} strokeWidth={2} aria-hidden="true" />
                  {ahead}
                </span>
              )}
              {behind > 0 && (
                <span className={styles.behind} title={`${behind} commit${behind === 1 ? "" : "s"} behind upstream`}>
                  <ArrowDown size={10} strokeWidth={2} aria-hidden="true" />
                  {behind}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Commit area */}
      <div className={styles.commitArea}>
        <textarea
          ref={commitInputRef}
          className={styles.commitInput}
          placeholder="Commit message (Ctrl+Enter to commit)"
          value={commitMsg}
          onChange={handleCommitMsgChange}
          rows={3}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "Enter") handleCommit();
          }}
        />
        <div className={styles.commitActions}>
          <button className={styles.stageAllBtn} onClick={handleStageAll} title="Stage All">
            <Plus size={10} /> Stage All
          </button>
          <button
            className={styles.commitBtn}
            onClick={handleCommit}
            disabled={!commitMsg.trim() || stagedCount === 0 || loading}
            aria-busy={isCommitting}
          >
            <Check size={10} /> Commit {stagedCount > 0 && `(${stagedCount})`}
          </button>
          <button
            className={styles.pushBtn}
            onClick={handleCommitAndPush}
            disabled={!commitMsg.trim() || stagedCount === 0 || loading}
            aria-busy={isPushing}
            title="Commit & Push"
          >
            <Upload size={10} />
          </button>
        </div>
      </div>

      {/* File groups */}
      <div className={styles.groups}>
        {grouped.map((g) => {
          const toggleGroup = () => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }));
          // ARIA spec forbids interactive controls inside a button (or
          // role="button"). The previous round's `role="button"` wrapper
          // around action <button>s relied on fragile propagation
          // suppression and could be flattened by some assistive
          // technologies. Codex r1 P2 — split the disclosure into a
          // real <button>, and put the action <button>s as siblings
          // inside the row container so neither nests the other.
          return (
            <div key={g.id} className={styles.group}>
              <div className={styles.groupRow}>
                <button
                  type="button"
                  className={styles.groupHeader}
                  aria-expanded={!collapsed[g.id]}
                  onClick={toggleGroup}
                >
                  <ChevronRight
                    size={10}
                    className={`${styles.chevron} ${!collapsed[g.id] ? styles.chevronOpen : ""}`}
                  />
                  <span className={styles.groupDot} style={{ background: g.color }} />
                  <span className={styles.groupLabel}>{g.label}</span>
                  <span className={styles.groupCount}>{g.files.length}</span>
                </button>
                {g.id === "changes" && (
                  <span className={styles.groupActions}>
                    <button
                      type="button"
                      onClick={() => handleStage(g.files.map((f) => f.path))}
                      aria-label="Stage all changes"
                      title="Stage all"
                    >
                      <Plus size={10} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDiscard(g.files.map((f) => f.path))}
                      aria-label="Discard all changes"
                      title="Discard all"
                    >
                      <Undo2 size={10} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {g.id === "staged" && (
                  <span className={styles.groupActions}>
                    <button
                      type="button"
                      onClick={() => handleUnstage(g.files.map((f) => f.path))}
                      aria-label="Unstage all files"
                      title="Unstage all"
                    >
                      <Minus size={10} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            {!collapsed[g.id] && (
              <div className={styles.fileList}>
                {g.files.map((f) => (
                  <div key={f.path} className={styles.fileRow}>
                    <GitStatusPip status={f.status} variant="letter" className={styles.fileStatus} />
                    <button
                      type="button"
                      className={styles.fileName}
                      onClick={() => onOpenDiff?.(f.path)}
                      aria-label={`Open diff for ${f.path}`}
                      title={f.path}
                    >
                      {fileName(f.path)}
                    </button>
                    <span className={styles.filePath}>{f.path.replace(fileName(f.path), "")}</span>
                    <span className={styles.fileActions}>
                      {g.id === "changes" || g.id === "untracked" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStage([f.path])}
                            aria-label={`Stage ${f.path}`}
                            title="Stage"
                          >
                            <Plus size={10} aria-hidden="true" />
                          </button>
                          {g.id === "changes" && (
                            <button
                              type="button"
                              onClick={() => handleDiscard([f.path])}
                              aria-label={`Discard ${f.path}`}
                              title="Discard"
                            >
                              <Undo2 size={10} aria-hidden="true" />
                            </button>
                          )}
                        </>
                      ) : g.id === "staged" ? (
                        <button
                          type="button"
                          onClick={() => handleUnstage([f.path])}
                          aria-label={`Unstage ${f.path}`}
                          title="Unstage"
                        >
                          <Minus size={10} aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(projectPath + "/" + f.path)}
                        aria-label={`Open ${f.path}`}
                        title="Open"
                      >
                        <FileText size={10} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            </div>
          );
        })}
        {files.length === 0 && (
          <EmptyState
            preset="files"
            title="Working tree clean"
            description={branch ? `Nothing to commit on ${branch}.` : "Nothing to commit."}
          />
        )}
      </div>
    </div>
  );
}
