import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSeq.current;
    if (!projectPath) {
      setFiles([]);
      setLoading(false);
      return;
    }
    if (cache.current?.path === projectPath) {
      setFiles(cache.current.files);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const entries = await invoke<FileListEntry[]>("list_all_files", { rootPath: projectPath, maxFiles: 10000 });
      if (requestId !== requestSeq.current) return;
      const paths = entries.map((e) => e.relative_path);
      cache.current = { path: projectPath, files: paths };
      setFiles(paths);
    } catch {
      if (requestId !== requestSeq.current) return;
      setFiles([]);
    } finally {
      if (requestId === requestSeq.current) {
        setLoading(false);
      }
    }
  }, [projectPath]);

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  // Invalidate cache on fs:changed
  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;

    (async () => {
      try {
        const unsubscribe = await listen<{ root: string }>("fs:changed", (e) => {
          if (e.payload.root === projectPath) {
            cache.current = null;
            void load();
          }
        });
        if (!active) {
          unsubscribe();
          return;
        }
        unlisten = unsubscribe;
      } catch {
        /* listen unavailable */
      }
    })();

    return () => {
      active = false;
      requestSeq.current += 1;
      unlisten?.();
    };
  }, [projectPath, load]);

  return { files, loading, refresh: load };
}
