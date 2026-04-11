import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { showPrompt } from "../../shared/ui/PromptDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
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
  onOpenDiff?: (path: string) => void;
  changedFiles?: ChangedFileInfo[];
  onSearch?: (query: string) => void;
}

interface TreeActions {
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  changedSet: Set<string>;
}

export function FileTree({ rootPath, onFileSelect, onOpenDiff, changedFiles = [] }: FileTreeProps) {
  const [currentRoot, setCurrentRoot] = useState(rootPath);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([rootPath]));
  const [contents, setContents] = useState<Map<string, FileEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());

  useEffect(() => { setCurrentRoot(rootPath); }, [rootPath]);

  const reloadDir = useCallback(async (dir: string) => {
    try {
      const entries = await invoke<FileEntry[]>("list_directory", { path: dir });
      setContents((prev) => new Map(prev).set(dir, entries));
    } catch { /* ignore */ }
  }, []);

  const handleNewFile = useCallback(async (dir: string) => {
    const name = await showPrompt("New File", { placeholder: "file name..." });
    if (!name) return;
    try {
      await invoke("create_file", { path: `${dir}/${name}` });
      reloadDir(dir);
    } catch { /* ignore */ }
  }, [reloadDir]);

  const handleNewFolder = useCallback(async (dir: string) => {
    const name = await showPrompt("New Folder", { placeholder: "folder name..." });
    if (!name) return;
    try {
      await invoke("create_directory", { path: `${dir}/${name}` });
      reloadDir(dir);
    } catch { /* ignore */ }
  }, [reloadDir]);

  const handleRename = useCallback(async (path: string) => {
    const oldName = path.split("/").pop() ?? "";
    const newName = await showPrompt("Rename", { placeholder: "new name...", defaultValue: oldName });
    if (!newName || newName === oldName) return;
    const parentDir = path.split("/").slice(0, -1).join("/");
    try {
      await invoke("rename_path", { oldPath: path, newPath: `${parentDir}/${newName}` });
      reloadDir(parentDir);
    } catch { /* ignore */ }
  }, [reloadDir]);

  const handleDelete = useCallback(async (path: string) => {
    const name = path.split("/").pop() ?? "";
    if (!confirm(`Delete "${name}"?`)) return;
    const parentDir = path.split("/").slice(0, -1).join("/");
    try {
      await invoke("delete_path", { path });
      reloadDir(parentDir);
    } catch { /* ignore */ }
  }, [reloadDir]);

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

  // Load root directory on mount or when root changes
  useEffect(() => {
    let cancelled = false;
    async function loadRoot() {
      setLoading((prev) => new Set(prev).add(currentRoot));
      setExpanded((prev) => new Set(prev).add(currentRoot));
      try {
        const entries = await invoke<FileEntry[]>("list_directory", { path: currentRoot });
        if (!cancelled) {
          setContents((prev) => new Map(prev).set(currentRoot, entries));
        }
      } catch { /* ignore */ }
      if (!cancelled) {
        setLoading((prev) => { const n = new Set(prev); n.delete(currentRoot); return n; });
      }
    }
    loadRoot();
    return () => { cancelled = true; };
  }, [currentRoot]);

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

  const changedSet = new Set(changedFiles.map((f) => f.path.replace(/\\/g, "/")));
  const changedStatusMap = new Map(changedFiles.map((f) => [f.path.replace(/\\/g, "/"), f.status]));

  const actions: TreeActions = {
    onNewFile: handleNewFile,
    onNewFolder: handleNewFolder,
    onRename: handleRename,
    onDelete: handleDelete,
    onOpenDiff,
    changedSet,
  };

  return (
    <div className={styles.tree} role="tree" aria-label="File explorer">
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
          {searchResults.length === 0 && <EmptyState preset="files" title="No matches" description="Try a different search term" />}
        </div>
      ) : (
        <>
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
            {renderEntries(contents.get(currentRoot) ?? [], 0, expanded, contents, loading, toggleDir, onFileSelect, changedSet, changedStatusMap, actions)}
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
  onFileSelect: ((path: string) => void) | undefined,
  changedSet: Set<string>,
  changedStatusMap: Map<string, string>,
  actions: TreeActions,
): React.ReactNode {
  return entries.map((entry) => {
    const isOpen = expanded.has(entry.path);
    const isLoading = loading.has(entry.path);
    const isChanged = changedSet.has(entry.path);
    const changeStatus = changedStatusMap.get(entry.path);
    const dir = entry.is_dir ? entry.path : entry.path.split("/").slice(0, -1).join("/");

    return (
      <div key={entry.path}>
        <RadixContextMenu.Root>
          <RadixContextMenu.Trigger asChild>
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
          </RadixContextMenu.Trigger>
          <RadixContextMenu.Portal>
            <RadixContextMenu.Content className={styles.ctxMenu}>
              <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => actions.onNewFile(dir)}>
                New File
              </RadixContextMenu.Item>
              <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => actions.onNewFolder(dir)}>
                New Folder
              </RadixContextMenu.Item>
              {!entry.is_dir && actions.changedSet.has(entry.path) && actions.onOpenDiff && (
                <>
                  <RadixContextMenu.Separator className={styles.ctxDivider} />
                  <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => actions.onOpenDiff!(entry.path)}>
                    Open Diff
                  </RadixContextMenu.Item>
                </>
              )}
              <RadixContextMenu.Separator className={styles.ctxDivider} />
              <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => actions.onRename(entry.path)}>
                Rename
              </RadixContextMenu.Item>
              <RadixContextMenu.Item className={styles.ctxItem} onSelect={() => actions.onDelete(entry.path)}>
                Delete
              </RadixContextMenu.Item>
            </RadixContextMenu.Content>
          </RadixContextMenu.Portal>
        </RadixContextMenu.Root>
        {entry.is_dir && isOpen && contents.has(entry.path) && (
          renderEntries(contents.get(entry.path)!, depth + 1, expanded, contents, loading, toggleDir, onFileSelect, changedSet, changedStatusMap, actions)
        )}
      </div>
    );
  });
}
