import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

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
  const watcherStarted = useRef(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Poll git status
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const info = await invoke<GitStatusInfo>("git_status", { repoPath });
        if (!active) return;
        setBranch(info.branch);
        setIsDirty(info.is_dirty);
        setChangedFiles(info.changed_files);
      } catch { /* not a git repo or error */ }
    };
    const timeout = setTimeout(poll, 500);
    // With file watcher, reduce polling to 30s (watcher handles fast updates)
    const interval = setInterval(poll, 30000);
    return () => { active = false; clearTimeout(timeout); clearInterval(interval); };
  }, [repoPath, refreshKey]);

  // Start file watcher and listen for fs:changed events
  useEffect(() => {
    if (!repoPath || watcherStarted.current) return;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        // Start the backend file watcher
        await invoke("start_fs_watcher", { watchPath: repoPath });
        watcherStarted.current = true;

        // Listen for change events from the watcher
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ root: string; paths: string[] }>("fs:changed", (event) => {
          if (event.payload.root === repoPath) {
            refresh();
          }
        });
      } catch { /* watcher not available */ }
    };
    setup();

    return () => {
      unlisten?.();
      if (watcherStarted.current) {
        invoke("stop_fs_watcher", { watchPath: repoPath }).catch(() => {});
        watcherStarted.current = false;
      }
    };
  }, [repoPath, refresh]);

  return { branch, isDirty, changedFiles, refresh };
}
