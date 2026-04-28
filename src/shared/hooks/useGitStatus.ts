import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { isTauriRuntime } from "../lib/tauriRuntime";

interface ChangedFile {
  path: string;
  status: string;
}

interface GitStatusInfo {
  branch: string;
  is_dirty: boolean;
  changed_files: ChangedFile[];
}

export function useGitStatus(repoPath: string) {
  const [branch, setBranch] = useState("main");
  const [isDirty, setIsDirty] = useState(false);
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Poll git status
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let active = true;
    const poll = async () => {
      try {
        const info = await invoke<GitStatusInfo>("git_status", { repoPath });
        if (!active) return;
        setBranch(info.branch);
        setIsDirty(info.is_dirty);
        setChangedFiles(info.changed_files);
      } catch {
        /* not a git repo or error */
      }
    };
    const timeout = setTimeout(poll, 500);
    // With file watcher, reduce polling to 30s (watcher handles fast updates)
    const interval = setInterval(poll, 30000);
    return () => {
      active = false;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [repoPath, refreshKey]);

  // Start file watcher and listen for fs:changed events
  useEffect(() => {
    if (!repoPath || !isTauriRuntime()) return;
    let aborted = false;
    let watcherStarted = false;
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      try {
        const unsub = await listen<{ root: string; paths: string[] }>("fs:changed", (event) => {
          if (event.payload.root === repoPath) refresh();
        });
        if (aborted) {
          unsub();
          return;
        }
        unlisten = unsub;

        await invoke("start_fs_watcher", { watchPath: repoPath });
        if (aborted) {
          invoke("stop_fs_watcher", { watchPath: repoPath }).catch(() => {});
          return;
        }
        watcherStarted = true;
      } catch {
        /* watcher not available */
      }
    };
    setup();

    return () => {
      aborted = true;
      unlisten?.();
      if (watcherStarted) {
        invoke("stop_fs_watcher", { watchPath: repoPath }).catch(() => {});
      }
    };
  }, [repoPath, refresh]);

  return { branch, isDirty, changedFiles, refresh };
}
