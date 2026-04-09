import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileIcon } from "./FileIcon";
import styles from "./FileTree.module.css";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  file_type: string;
  children_count: number;
}

interface FileTreeProps {
  rootPath: string;
  onFileSelect?: (path: string) => void;
}

export function FileTree({ rootPath, onFileSelect }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([rootPath]));
  const [contents, setContents] = useState<Map<string, FileEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  const toggleDir = useCallback(async (dirPath: string) => {
    const next = new Set(expanded);
    if (next.has(dirPath)) {
      next.delete(dirPath);
      setExpanded(next);
      return;
    }
    next.add(dirPath);
    setExpanded(next);

    if (!contents.has(dirPath)) {
      setLoading((prev) => new Set(prev).add(dirPath));
      try {
        const entries = await invoke<FileEntry[]>("list_directory", { path: dirPath });
        setContents((prev) => new Map(prev).set(dirPath, entries));
      } catch { /* ignore */ }
      setLoading((prev) => { const n = new Set(prev); n.delete(dirPath); return n; });
    }
  }, [expanded, contents]);

  // Load root on first render
  if (!contents.has(rootPath) && !loading.has(rootPath)) {
    toggleDir(rootPath);
  }

  const rootName = rootPath.split("/").filter(Boolean).pop() ?? "project";

  return (
    <div className={styles.tree}>
      <div className={styles.rootHeader}>
        <FileIcon type="folder" isOpen />
        <span className={styles.rootName}>{rootName}</span>
      </div>
      <div className={styles.list}>
        {renderEntries(contents.get(rootPath) ?? [], 0, expanded, contents, loading, toggleDir, onFileSelect)}
      </div>
    </div>
  );
}

function renderEntries(
  entries: { name: string; path: string; is_dir: boolean; file_type: string }[],
  depth: number,
  expanded: Set<string>,
  contents: Map<string, { name: string; path: string; is_dir: boolean; file_type: string }[]>,
  loading: Set<string>,
  toggleDir: (path: string) => void,
  onFileSelect?: (path: string) => void,
): React.ReactNode {
  return entries.map((entry) => {
    const isOpen = expanded.has(entry.path);
    const isLoading = loading.has(entry.path);

    return (
      <div key={entry.path}>
        <button
          className={styles.row}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => entry.is_dir ? toggleDir(entry.path) : onFileSelect?.(entry.path)}
        >
          {entry.is_dir && (
            <span className={`${styles.arrow} ${isOpen ? styles.arrowOpen : ""}`}>▸</span>
          )}
          {!entry.is_dir && <span className={styles.arrowSpacer} />}
          <FileIcon type={entry.file_type} isOpen={isOpen} />
          <span className={styles.fileName}>{entry.name}</span>
          {isLoading && <span className={styles.spinner}>…</span>}
        </button>
        {entry.is_dir && isOpen && contents.has(entry.path) && (
          renderEntries(contents.get(entry.path)!, depth + 1, expanded, contents, loading, toggleDir, onFileSelect)
        )}
      </div>
    );
  });
}
