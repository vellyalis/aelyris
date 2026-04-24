import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as RadixContextMenu from "@radix-ui/react-context-menu";
import { showPrompt } from "../../shared/ui/PromptDialog";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { GitStatusPip } from "../../shared/ui/GitStatusPip";
import { FileIcon } from "./FileIcon";
import { toast } from "../../shared/store/toastStore";
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

interface FlatEntry {
  name: string;
  path: string;
  is_dir: boolean;
  file_type: string;
  depth: number;
  isOpen: boolean;
  parent: string | null;
}

function flattenVisible(
  root: string,
  entries: Map<string, FileEntry[]>,
  expanded: Set<string>,
): FlatEntry[] {
  const out: FlatEntry[] = [];
  const walk = (dir: string, depth: number) => {
    const items = entries.get(dir);
    if (!items) return;
    for (const item of items) {
      const isOpen = expanded.has(item.path);
      out.push({
        name: item.name,
        path: item.path,
        is_dir: item.is_dir,
        file_type: item.file_type,
        depth,
        isOpen,
        parent: dir,
      });
      if (item.is_dir && isOpen) {
        walk(item.path, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

// Fixed row height in the tree (mirrors .row { height: 22px } in
// FileTree.module.css). Virtualization uses this to compute the absolute
// row offsets without having to measure each node.
const ROW_HEIGHT = 22;
// Number of rows rendered above/below the viewport to keep scroll-edge
// motion smooth. 12 rows × 22px = ~264px of overdraw on either side.
const OVERSCAN = 12;
// Below this many visible rows virtualization adds more overhead than it
// saves; we just render the list in full.
const VIRTUALIZE_THRESHOLD = 200;

export function FileTree({ rootPath, onFileSelect, onOpenDiff, changedFiles = [] }: FileTreeProps) {
  const [currentRoot, setCurrentRoot] = useState(rootPath);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([rootPath]));
  const [contents, setContents] = useState<Map<string, FileEntry[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

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
    } catch (e) { toast.error("Failed to create file", String(e)); }
  }, [reloadDir]);

  const handleNewFolder = useCallback(async (dir: string) => {
    const name = await showPrompt("New Folder", { placeholder: "folder name..." });
    if (!name) return;
    try {
      await invoke("create_directory", { path: `${dir}/${name}` });
      reloadDir(dir);
    } catch (e) { toast.error("Failed to create folder", String(e)); }
  }, [reloadDir]);

  const handleRename = useCallback(async (path: string) => {
    const oldName = path.split("/").pop() ?? "";
    const newName = await showPrompt("Rename", { placeholder: "new name...", defaultValue: oldName });
    if (!newName || newName === oldName) return;
    const parentDir = path.split("/").slice(0, -1).join("/");
    try {
      await invoke("rename_path", { oldPath: path, newPath: `${parentDir}/${newName}` });
      reloadDir(parentDir);
    } catch (e) { toast.error("Rename failed", String(e)); }
  }, [reloadDir]);

  const handleDelete = useCallback(async (path: string) => {
    const name = path.split("/").pop() ?? "";
    const ok = await showConfirm({
      title: `Delete "${name}"?`,
      description: "This moves the entry to the OS trash where possible.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    const parentDir = path.split("/").slice(0, -1).join("/");
    try {
      await invoke("delete_path", { path });
      reloadDir(parentDir);
    } catch (e) { toast.error("Delete failed", String(e)); }
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

  // Flat ordered list of visible rows — drives both the keyboard cursor and
  // roving tabindex. Recomputed only when the tree shape changes.
  const flatEntries = useMemo(
    () => flattenVisible(currentRoot, contents, expanded),
    [currentRoot, contents, expanded],
  );

  // Seed focus onto the first visible row once data arrives so Tab into the
  // tree lands somewhere sensible. Preserved across tree edits unless the
  // focused path disappears.
  useEffect(() => {
    if (flatEntries.length === 0) return;
    if (focusedPath && flatEntries.some((e) => e.path === focusedPath)) return;
    setFocusedPath(flatEntries[0].path);
  }, [flatEntries, focusedPath]);

  // Track scroll position + viewport height on the list container so the
  // windowed slice below can be kept current. Also observed via ResizeObserver
  // to handle split-pane drags that change the available height.
  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const update = () => {
      setScrollTop(el.scrollTop);
      setViewportHeight(el.clientHeight);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const shouldVirtualize = flatEntries.length > VIRTUALIZE_THRESHOLD;

  // Visible window — when not virtualizing, every row is in-window.
  const visibleRange = useMemo(() => {
    if (!shouldVirtualize) return { start: 0, end: flatEntries.length };
    if (viewportHeight === 0) {
      // First paint — assume 400px viewport so the initial render isn't empty.
      return { start: 0, end: Math.min(flatEntries.length, Math.ceil(400 / ROW_HEIGHT) + OVERSCAN) };
    }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      flatEntries.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
    );
    return { start, end };
  }, [shouldVirtualize, scrollTop, viewportHeight, flatEntries.length]);

  // Focus a row by path — scrolls it into view first when virtualizing so the
  // button exists in the DOM before we try to call .focus() on it.
  const focusEntry = useCallback(
    (path: string) => {
      setFocusedPath(path);
      const el = listScrollRef.current;
      if (!el || !shouldVirtualize) {
        rowRefs.current.get(path)?.focus();
        return;
      }
      const idx = flatEntries.findIndex((e) => e.path === path);
      if (idx < 0) return;
      const rowTop = idx * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      if (rowTop < viewTop) {
        el.scrollTop = rowTop;
      } else if (rowBottom > viewBottom) {
        el.scrollTop = rowBottom - el.clientHeight;
      }
      // Scroll updates scrollTop state → virtualization window renders the
      // target row. Defer focus until after the render commit.
      requestAnimationFrame(() => {
        rowRefs.current.get(path)?.focus();
      });
    },
    [flatEntries, shouldVirtualize],
  );

  const moveFocus = useCallback(
    (delta: number) => {
      if (flatEntries.length === 0) return;
      const idx = focusedPath
        ? flatEntries.findIndex((e) => e.path === focusedPath)
        : -1;
      const nextIdx = Math.max(0, Math.min(flatEntries.length - 1, (idx < 0 ? 0 : idx) + delta));
      const next = flatEntries[nextIdx];
      if (next) focusEntry(next.path);
    },
    [flatEntries, focusedPath, focusEntry],
  );

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (flatEntries.length === 0) return;
      const idx = focusedPath
        ? flatEntries.findIndex((e) => e.path === focusedPath)
        : -1;
      const current = idx >= 0 ? flatEntries[idx] : null;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(1);
          return;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(-1);
          return;
        case "Home":
          e.preventDefault();
          if (flatEntries[0]) focusEntry(flatEntries[0].path);
          return;
        case "End":
          e.preventDefault();
          {
            const last = flatEntries[flatEntries.length - 1];
            if (last) focusEntry(last.path);
          }
          return;
        case "ArrowRight":
          if (!current) return;
          e.preventDefault();
          if (current.is_dir && !current.isOpen) {
            toggleDir(current.path);
          } else if (current.is_dir && current.isOpen) {
            // Into the first child.
            const next = flatEntries[idx + 1];
            if (next && next.depth > current.depth) focusEntry(next.path);
          }
          return;
        case "ArrowLeft":
          if (!current) return;
          e.preventDefault();
          if (current.is_dir && current.isOpen) {
            toggleDir(current.path);
          } else if (current.parent && current.parent !== currentRoot) {
            focusEntry(current.parent);
          }
          return;
        case "Enter":
        case " ":
          if (!current) return;
          e.preventDefault();
          if (current.is_dir) {
            toggleDir(current.path);
          } else {
            onFileSelect?.(current.path);
          }
          return;
      }
    },
    [flatEntries, focusedPath, toggleDir, onFileSelect, currentRoot, moveFocus, focusEntry],
  );

  const registerRow = useCallback(
    (path: string) => (el: HTMLButtonElement | null) => {
      if (el) {
        rowRefs.current.set(path, el);
      } else {
        rowRefs.current.delete(path);
      }
    },
    [],
  );

  return (
    <div
      className={styles.tree}
      role="tree"
      aria-label="File explorer"
      onKeyDown={handleTreeKeyDown}
    >
      <div className={styles.searchBox}>
        <input
          className={styles.searchInput}
          placeholder="Filter files..."
          aria-label="Filter files"
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
          <div className={styles.list} ref={listScrollRef}>
            {flatEntries.length === 0 && !loading.has(currentRoot) ? (
              <EmptyState preset="files" title="Folder is empty" description="No files or subfolders here." />
            ) : shouldVirtualize ? (
              <div
                className={styles.virtualSpacer}
                style={{ height: flatEntries.length * ROW_HEIGHT }}
                role="presentation"
              >
                {flatEntries.slice(visibleRange.start, visibleRange.end).map((entry, i) => {
                  const absoluteIdx = visibleRange.start + i;
                  return (
                    <div
                      key={entry.path}
                      className={styles.virtualRow}
                      style={{ top: absoluteIdx * ROW_HEIGHT, height: ROW_HEIGHT }}
                    >
                      <TreeRow
                        entry={entry}
                        isFocused={focusedPath === entry.path}
                        isLoadingChildren={loading.has(entry.path)}
                        isChanged={changedSet.has(entry.path)}
                        changeStatus={changedStatusMap.get(entry.path)}
                        onFocus={() => setFocusedPath(entry.path)}
                        onActivate={() => entry.is_dir ? toggleDir(entry.path) : onFileSelect?.(entry.path)}
                        rowRef={registerRow(entry.path)}
                        actions={actions}
                        posInSet={absoluteIdx + 1}
                        setSize={flatEntries.length}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              flatEntries.map((entry, i) => (
                <TreeRow
                  key={entry.path}
                  entry={entry}
                  isFocused={focusedPath === entry.path}
                  isLoadingChildren={loading.has(entry.path)}
                  isChanged={changedSet.has(entry.path)}
                  changeStatus={changedStatusMap.get(entry.path)}
                  onFocus={() => setFocusedPath(entry.path)}
                  onActivate={() => entry.is_dir ? toggleDir(entry.path) : onFileSelect?.(entry.path)}
                  rowRef={registerRow(entry.path)}
                  actions={actions}
                  posInSet={i + 1}
                  setSize={flatEntries.length}
                />
              ))
            )}
          </div>
          {changedFiles.length > 0 && (
            <button
              type="button"
              className={styles.changesBar}
              aria-label={`${changedFiles.length} files with changes`}
            >
              Show {changedFiles.length} change{changedFiles.length === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface TreeRowProps {
  entry: FlatEntry;
  isFocused: boolean;
  isLoadingChildren: boolean;
  isChanged: boolean;
  changeStatus: string | undefined;
  onFocus: () => void;
  onActivate: () => void;
  rowRef: (el: HTMLButtonElement | null) => void;
  actions: TreeActions;
  /** 1-based position within the visible flat list — required so screen
   *  readers announce "3 of 412" correctly even when the row is rendered
   *  out of a virtualized window. */
  posInSet?: number;
  setSize?: number;
}

function TreeRow({
  entry,
  isFocused,
  isLoadingChildren,
  isChanged,
  changeStatus,
  onFocus,
  onActivate,
  rowRef,
  actions,
  posInSet,
  setSize,
}: TreeRowProps) {
  const dir = entry.is_dir ? entry.path : entry.path.split("/").slice(0, -1).join("/");

  return (
    <div>
      <RadixContextMenu.Root>
        <RadixContextMenu.Trigger asChild>
          <button
            ref={rowRef}
            className={`${styles.row} ${isFocused ? styles.rowFocused : ""}`}
            style={{ paddingLeft: 8 + entry.depth * 16 }}
            role="treeitem"
            aria-level={entry.depth + 1}
            aria-expanded={entry.is_dir ? entry.isOpen : undefined}
            aria-selected={isFocused}
            aria-setsize={setSize}
            aria-posinset={posInSet}
            tabIndex={isFocused ? 0 : -1}
            onClick={onActivate}
            onFocus={onFocus}
          >
            {entry.is_dir && (
              <span className={`${styles.arrow} ${entry.isOpen ? styles.arrowOpen : ""}`} aria-hidden="true">▸</span>
            )}
            {!entry.is_dir && <span className={styles.arrowSpacer} aria-hidden="true" />}
            <FileIcon type={entry.file_type} isOpen={entry.isOpen} />
            <span className={`${styles.fileName} ${isChanged ? styles.fileChanged : ""}`}
              data-status={changeStatus}
            >{entry.name}</span>
            {isChanged && changeStatus && (
              <GitStatusPip status={changeStatus} variant="dot" className={styles.changeDot} />
            )}
            {isLoadingChildren && <span className={styles.spinner} aria-hidden="true">…</span>}
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
    </div>
  );
}
