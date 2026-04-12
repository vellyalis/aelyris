import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { AgentSession, FileChangeDetail } from "../../shared/types/agent";
import styles from "./InlineResultPanel.module.css";

const DiffViewer = lazy(() =>
  import("../diff-viewer/DiffViewer").then((m) => ({ default: m.DiffViewer }))
);

interface InlineResultPanelProps {
  session: AgentSession;
  projectPath: string;
  onClose: () => void;
}

interface FileDiffData {
  path: string;
  original: string;
  modified: string;
  loading: boolean;
  error: string | null;
}

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    rs: "rust", py: "python", go: "go", css: "css", html: "html",
    json: "json", yaml: "yaml", yml: "yaml", md: "markdown", toml: "toml",
    sql: "sql", sh: "shell", bash: "shell",
  };
  return map[ext] ?? "plaintext";
}

export function InlineResultPanel({ session, projectPath, onClose }: InlineResultPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [diffs, setDiffs] = useState<Map<string, FileDiffData>>(new Map());

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

  // Load diff for active file
  useEffect(() => {
    if (!activeFile || !projectPath) return;
    const path = activeFile.path;

    // Already loaded
    if (diffs.has(path) && !diffs.get(path)!.loading) return;

    setDiffs((prev) => {
      const next = new Map(prev);
      next.set(path, { path, original: "", modified: "", loading: true, error: null });
      return next;
    });

    let cancelled = false;

    (async () => {
      try {
        const [original, modified] = await Promise.all([
          invoke<string>("git_file_original", { repoPath: projectPath, filePath: path }).catch(() => ""),
          invoke<string>("read_file", { path }).catch(() => ""),
        ]);

        if (cancelled) return;
        setDiffs((prev) => {
          const next = new Map(prev);
          next.set(path, { path, original, modified, loading: false, error: null });
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        setDiffs((prev) => {
          const next = new Map(prev);
          next.set(path, { path, original: "", modified: "", loading: false, error: String(err) });
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [activeFile, projectPath, diffs]);

  if (uniqueFiles.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>No file changes</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close"><X size={12} /></button>
        </div>
        <div className={styles.empty}>This agent session has not modified any files yet.</div>
      </div>
    );
  }

  const currentDiff = activeFile ? diffs.get(activeFile.path) : null;
  const fileName = activeFile?.path.split(/[/\\]/).pop() ?? "";

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <FileText size={12} />
        <span className={styles.title}>
          {session.name} — {uniqueFiles.length} file{uniqueFiles.length !== 1 ? "s" : ""} changed
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close"><X size={12} /></button>
      </div>

      {/* File tabs */}
      <div className={styles.fileTabs}>
        {uniqueFiles.map((f, i) => {
          const name = f.path.split(/[/\\]/).pop() ?? f.path;
          return (
            <button
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
          className={styles.navBtn}
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
          disabled={activeIndex === 0}
          aria-label="Previous file"
        >
          <ChevronLeft size={12} />
        </button>
        <span className={styles.navLabel}>{activeIndex + 1} / {uniqueFiles.length}</span>
        <button
          className={styles.navBtn}
          onClick={() => setActiveIndex((i) => Math.min(uniqueFiles.length - 1, i + 1))}
          disabled={activeIndex === uniqueFiles.length - 1}
          aria-label="Next file"
        >
          <ChevronRight size={12} />
        </button>
        <span className={styles.filePath}>{activeFile?.path}</span>
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
