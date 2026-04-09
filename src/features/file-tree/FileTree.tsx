import { useState, useCallback, useRef, useEffect } from "react";
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

interface ChangedFileInfo {
  path: string;
  status: string;
}

interface FileTreeProps {
  rootPath: string;
  onFileSelect?: (path: string) => void;
  changedFiles?: ChangedFileInfo[];
  onSearch?: (query: string) => void;
}

export function FileTree({ rootPath, onFileSelect, changedFiles = [] }: FileTreeProps) {
  const [currentRoot, setCurrentRoot] = useState(rootPath);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset currentRoot when rootPath changes (project switch)
  useEffect(() => { setCurrentRoot(rootPath); }, [rootPath]);
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

  // Load current root on first render or root change
  if (!contents.has(currentRoot) && !loading.has(currentRoot)) {
    toggleDir(currentRoot);
  }

  // rootName used in breadcrumb via currentRoot

  // File search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await invoke<FileEntry[]>("search_files", { rootPath, query, maxResults: 30 });
        setSearchResults(results);
      } catch { setSearchResults([]); }
    }, 200);
  }, [rootPath]);

  // Build set of changed file paths for highlighting
  const changedSet = new Set(changedFiles.map((f) => f.path.replace(/\\/g, "/")));
  const changedStatusMap = new Map(changedFiles.map((f) => [f.path.replace(/\\/g, "/"), f.status]));

  return (
    <div className={styles.tree}>
      {/* Search input */}
      <div className={styles.searchBox}>
        <input
          className={styles.searchInput}
          placeholder="Filter files..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {searchResults ? (
        <div className={styles.list}>
          {searchResults.map((entry) => (
            <button
              key={entry.path}
              className={styles.row}
              style={{ paddingLeft: 8 }}
              onClick={() => !entry.is_dir && onFileSelect?.(entry.path)}
            >
              <FileIcon type={entry.file_type} />
              <span className={styles.fileName}>{entry.name}</span>
              <span className={styles.searchPath}>{entry.path.replace(rootPath + "/", "")}</span>
            </button>
          ))}
          {searchResults.length === 0 && <div className={styles.noResults}>No matches</div>}
        </div>
      ) : (
        <>
          {/* Breadcrumb: show back button when drilled into subfolder */}
          {currentRoot !== rootPath && (
            <button
              className={styles.breadcrumb}
              onClick={() => {
                const parent = currentRoot.split("/").slice(0, -1).join("/");
                setCurrentRoot(parent || rootPath);
              }}
            >
              ← {currentRoot.split("/").filter(Boolean).pop()}
            </button>
          )}
          <div className={styles.rootHeader}>
            <FileIcon type="folder" isOpen />
            <span className={styles.rootName}>{currentRoot.split("/").filter(Boolean).pop() ?? "project"}</span>
          </div>
          <div className={styles.list}>
            {renderEntries(contents.get(currentRoot) ?? [], 0, expanded, contents, loading, toggleDir, onFileSelect, changedSet, changedStatusMap)}
          </div>
          {changedFiles.length > 0 && (
            <div className={styles.changesBar}>Show {changedFiles.length} changes</div>
          )}
        </>
      )}
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
  changedSet?: Set<string>,
  changedStatusMap?: Map<string, string>,
): React.ReactNode {
  return entries.map((entry) => {
    const isOpen = expanded.has(entry.path);
    const isLoading = loading.has(entry.path);
    const isChanged = changedSet?.has(entry.path) ?? false;
    const changeStatus = changedStatusMap?.get(entry.path);

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
          <span className={`${styles.fileName} ${isChanged ? styles.fileChanged : ""}`}
            data-status={changeStatus}
          >{entry.name}</span>
          {isChanged && <span className={styles.changeDot} data-status={changeStatus} />}
          {isLoading && <span className={styles.spinner}>…</span>}
        </button>
        {entry.is_dir && isOpen && contents.has(entry.path) && (
          renderEntries(contents.get(entry.path)!, depth + 1, expanded, contents, loading, toggleDir, onFileSelect, changedSet, changedStatusMap)
        )}
      </div>
    );
  });
}
