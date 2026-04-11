import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileListEntry {
  relative_path: string;
  /** File size in bytes. Precision limited to 2^53 (JS number). Sufficient for all practical file sizes. */
  size: number;
}

/**
 * Hook that fetches and caches the project file list from Rust backend.
 * Invalidates on fs:changed events.
 */
export function useFileList(projectPath: string) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef<{ path: string; files: string[] } | null>(null);

  const load = useCallback(async () => {
    if (!projectPath) return;
    if (cache.current?.path === projectPath) {
      setFiles(cache.current.files);
      return;
    }
    setLoading(true);
    try {
      const entries = await invoke<FileListEntry[]>("list_all_files", { rootPath: projectPath, maxFiles: 10000 });
      const paths = entries.map((e) => e.relative_path);
      cache.current = { path: projectPath, files: paths };
      setFiles(paths);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Load on mount
  useEffect(() => { load(); }, [load]);

  // Invalidate cache on fs:changed
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ root: string }>("fs:changed", (e) => {
        if (e.payload.root === projectPath) {
          cache.current = null;
          load();
        }
      }).then((u) => { unlisten = u; });
    });
    return () => { unlisten?.(); };
  }, [projectPath, load]);

  return { files, loading, refresh: load };
}
