import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, FileText, RotateCcw, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../../shared/store/toastStore";
import type { AgentSession, FileChangeDetail } from "../../shared/types/agent";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./InlineResultPanel.module.css";

const DiffViewer = lazy(() => import("../diff-viewer/DiffViewer").then((m) => ({ default: m.DiffViewer })));

interface InlineResultPanelProps {
  session: AgentSession;
  projectPath: string;
  onClose: () => void;
  onStartAgent?: (prompt: string) => void;
}

interface FileDiffData {
  path: string;
  original: string;
  modified: string;
  loading: boolean;
  error: string | null;
}

// Compound cache key: `path` alone leaks state across action transitions
// (a path that appeared as `create` first leaves a stub `original: ""`
// entry in the cache, and if the same path later appears as `edit` or
// `delete` the stub is reused — its empty original is what Revert would
// then write back, re-opening the data-loss path codex-r1 closed.)
function diffCacheKey(file: { path: string; action: string }): string {
  return `${file.action}:${file.path}`;
}

// Match the Tauri / std::io family of "file not found" errors so the
// `delete` action's expected `read_file` rejection (working copy is
// gone) can be skipped without also swallowing genuine I/O failures
// like permission-denied. Errors arrive as plain strings via Tauri's
// `Result<_, String>` convention.
function isFileNotFoundReason(reason: unknown): boolean {
  const msg = String(reason).toLowerCase();
  return /(no such file|not found|cannot find|os error 2|enoent)/.test(msg);
}

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    rs: "rust",
    py: "python",
    go: "go",
    css: "css",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    toml: "toml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
  };
  return map[ext] ?? "plaintext";
}

export function InlineResultPanel({ session, projectPath, onClose, onStartAgent }: InlineResultPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [diffs, setDiffs] = useState<Map<string, FileDiffData>>(new Map());
  const reportedFileCount = session.filesChanged ?? 0;
  // Manual reload trigger. Bumped after a successful Revert so the load
  // effect re-fires for the same activeFile (the effect can't list `diffs`
  // in its deps without re-introducing the IPC double-fetch loop).
  const [reloadTick, setReloadTick] = useState(0);

  // Deduplicate changed files (keep latest action per path)
  const uniqueFiles = useMemo(() => {
    const details = session.changedFileDetails ?? [];
    const map = new Map<string, FileChangeDetail>();
    for (const d of details) {
      map.set(d.path, d);
    }
    return [...map.values()];
  }, [session.changedFileDetails]);

  const activeFile = uniqueFiles[activeIndex];
  const visibleFileTabs = useMemo(() => {
    if (uniqueFiles.length <= 3) {
      return uniqueFiles.map((file, index) => ({ file, index }));
    }
    const start = Math.min(Math.max(activeIndex - 1, 0), uniqueFiles.length - 3);
    return uniqueFiles.slice(start, start + 3).map((file, offset) => ({ file, index: start + offset }));
  }, [activeIndex, uniqueFiles]);

  // Mirror `diffs` into a ref so the load-diff effect can read freshness
  // without listing `diffs` as a dep — that would re-fire on every
  // setDiffs(loading=true) and double-invoke the IPC pair.
  const diffsRef = useRef(diffs);
  diffsRef.current = diffs;

  // Load diff for active file
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick deliberately reloads the same active file after revert.
  useEffect(() => {
    if (!activeFile || !projectPath) return;
    const path = activeFile.path;
    const action = activeFile.action;
    const key = diffCacheKey(activeFile);

    // Already loaded — skip without retriggering on dep changes.
    const existing = diffsRef.current.get(key);
    if (existing && !existing.loading) return;

    setDiffs((prev) => {
      const next = new Map(prev);
      next.set(key, { path, original: "", modified: "", loading: true, error: null });
      return next;
    });

    let cancelled = false;

    (async () => {
      // Use allSettled so we can record per-invoke failures explicitly.
      // The previous `.catch(() => "")` swallowed both rejections to ""
      // and stamped `error: null` on the cache, which let Revert sneak
      // past `cached.error` and silently truncate the file with the
      // empty placeholder original. (codex-detected data-loss.)
      const [originalResult, modifiedResult] = await Promise.allSettled([
        invoke<string>("git_file_original", { repoPath: projectPath, filePath: path }),
        invoke<string>("read_file", { path }),
      ]);
      if (cancelled) return;

      const original = originalResult.status === "fulfilled" ? originalResult.value : "";
      const modified = modifiedResult.status === "fulfilled" ? modifiedResult.value : "";
      // Per-action expected rejections must NOT mark `error` — otherwise
      // the Revert guard blocks legitimate restore flows. The expected
      // rejection is also gated on the reason looking like a "file not
      // found" so that genuine I/O errors (permission denied, disk
      // failure, malformed path) still bubble up to the user as a
      // load error and still trip the Revert guard.
      const errors: string[] = [];
      if (
        originalResult.status === "rejected" &&
        !(action === "create" && isFileNotFoundReason(originalResult.reason))
      ) {
        errors.push(`failed to load git original: ${String(originalResult.reason)}`);
      }
      if (
        modifiedResult.status === "rejected" &&
        !(action === "delete" && isFileNotFoundReason(modifiedResult.reason))
      ) {
        errors.push(`failed to read working copy: ${String(modifiedResult.reason)}`);
      }
      const error = errors.length > 0 ? errors.join("; ") : null;

      setDiffs((prev) => {
        const next = new Map(prev);
        next.set(key, { path, original, modified, loading: false, error });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeFile, projectPath, reloadTick]);

  if (uniqueFiles.length === 0) {
    const hasEstimatedChanges = reportedFileCount > 0;
    return (
      <div className={styles.panel}>
        <PanelHeader
          dense
          leadingIcon={<FileText size={12} />}
          title={session.name}
          subtitle={
            hasEstimatedChanges
              ? `${reportedFileCount} file${reportedFileCount === 1 ? "" : "s"} reported`
              : "No file changes"
          }
          actions={
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <X size={12} />
            </button>
          }
        />
        <div className={styles.empty}>
          {hasEstimatedChanges
            ? "This session reported changed files, but file-level diff details were not captured yet."
            : "This agent session has not modified any files yet."}
        </div>
      </div>
    );
  }

  const currentDiff = activeFile ? diffs.get(diffCacheKey(activeFile)) : null;
  const fileName = activeFile?.path.split(/[/\\]/).pop() ?? "";

  return (
    <div className={styles.panel}>
      <PanelHeader
        dense
        leadingIcon={<FileText size={12} />}
        title={session.name}
        subtitle={`${uniqueFiles.length} file${uniqueFiles.length !== 1 ? "s" : ""} changed`}
        actions={
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={12} />
          </button>
        }
      />

      {/* File tabs */}
      <div className={styles.fileTabs}>
        {visibleFileTabs.map(({ file: f, index: i }) => {
          const name = f.path.split(/[/\\]/).pop() ?? f.path;
          return (
            <button
              type="button"
              key={f.path}
              className={`${styles.fileTab} ${i === activeIndex ? styles.fileTabActive : ""}`}
              onClick={() => setActiveIndex(i)}
              title={f.path}
            >
              <span className={styles.fileAction} data-action={f.action}>
                {f.action === "create" ? "A" : f.action === "delete" ? "D" : "M"}
              </span>
              {name}
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      <div className={styles.nav}>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
          disabled={activeIndex === 0}
          aria-label="Previous file"
        >
          <ChevronLeft size={12} />
        </button>
        <span className={styles.navLabel}>
          {activeIndex + 1} / {uniqueFiles.length}
        </span>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => setActiveIndex((i) => Math.min(uniqueFiles.length - 1, i + 1))}
          disabled={activeIndex === uniqueFiles.length - 1}
          aria-label="Next file"
        >
          <ChevronRight size={12} />
        </button>
        <span className={styles.filePath}>{activeFile?.path}</span>
        <div className={styles.navActions}>
          <button
            type="button"
            className={styles.revertBtn}
            onClick={async () => {
              if (!activeFile || !projectPath) return;
              if (activeFile.action === "create") {
                // Reverting a newly-created file would mean deleting it on disk;
                // we don't expose a destructive action without explicit confirm.
                toast.error("Cannot revert new file", "The file did not exist before this session.");
                return;
              }
              const cached = diffs.get(diffCacheKey(activeFile));
              // Block while still loading — the placeholder entry has
              // `original: ""` and writing that would silently truncate
              // the file (codex-detected data-loss).
              if (!cached || cached.loading) {
                toast.error("Revert unavailable", "Diff is still loading.");
                return;
              }
              if (cached.error) {
                toast.error("Revert unavailable", "Original content could not be loaded.");
                return;
              }
              try {
                await invoke("write_file", { path: activeFile.path, content: cached.original });
                toast.success("Reverted", activeFile.path.split(/[/\\]/).pop() ?? "");
                // Drop the cache entry and bump the reload tick so the load
                // effect re-fires for the same activeFile.
                setDiffs((prev) => {
                  const next = new Map(prev);
                  next.delete(diffCacheKey(activeFile));
                  return next;
                });
                setReloadTick((t) => t + 1);
              } catch (err) {
                toast.error("Revert failed", String(err));
              }
            }}
            title="Revert to original"
            aria-label="Revert file"
          >
            <RotateCcw size={10} />
            <span className={styles.actionLabel}>Revert</span>
          </button>
          <button
            type="button"
            className={styles.acceptBtn}
            onClick={() => {
              if (activeIndex < uniqueFiles.length - 1) {
                setActiveIndex((i) => i + 1);
              } else {
                onClose();
              }
            }}
            title={activeIndex < uniqueFiles.length - 1 ? "Next file" : "Done reviewing"}
            aria-label={activeIndex < uniqueFiles.length - 1 ? "Next file" : "Done reviewing"}
          >
            <ChevronRight size={10} aria-hidden="true" />
            <span className={styles.actionLabel}>{activeIndex < uniqueFiles.length - 1 ? "Next" : "Done"}</span>
          </button>
          {onStartAgent && (
            <button
              type="button"
              className={styles.aiFixBtn}
              onClick={() => {
                const fileName = activeFile?.path.split(/[/\\]/).pop() ?? "";
                onStartAgent(
                  `Review and improve the changes in ${fileName}. Check for bugs, style issues, and missing edge cases.`,
                );
              }}
              title="Ask AI to review this file"
              aria-label="Ask AI to review"
            >
              AI
            </button>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div className={styles.diffArea}>
        {currentDiff?.loading && <div className={styles.loading}>Loading diff...</div>}
        {currentDiff?.error && <div className={styles.error}>{currentDiff.error}</div>}
        {currentDiff && !currentDiff.loading && !currentDiff.error && (
          <Suspense fallback={<div className={styles.loading}>Loading editor...</div>}>
            <DiffViewer
              original={currentDiff.original}
              modified={currentDiff.modified}
              language={detectLanguage(activeFile?.path ?? "")}
              fileName={fileName}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
