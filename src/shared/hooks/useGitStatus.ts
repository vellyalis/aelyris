import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import { isTauriRuntime } from "../lib/tauriRuntime";

interface ChangedFile {
  path: string;
  status: string;
  staged?: boolean;
  conflicted?: boolean;
  additions?: number;
  deletions?: number;
  binary?: boolean;
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
  const [_refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const reset = useCallback(() => {
    setBranch("main");
    setIsDirty(false);
    setChangedFiles([]);
  }, []);

  // Poll git status
  useEffect(() => {
    if (!repoPath || !isTauriRuntime()) {
      reset();
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const info = await invoke<GitStatusInfo>("git_status", { repoPath });
        if (!active) return;
        setBranch(info.branch);
        setIsDirty(info.is_dirty);
        setChangedFiles(info.changed_files);
      } catch {
        if (active) reset();
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
  }, [repoPath, reset]);

  // Start file watcher and listen for fs:changed events
  useEffect(() => {
    if (!repoPath || !isTauriRuntime()) return;
    let aborted = false;
    let watcherStarted = false;
    let unlisten: UnlistenFn | null = null;
    const reportWatcherFailure = (operation: string, err: unknown) => {
      reportInvokeFailure({
        source: "git-status.watcher",
        operation,
        err,
        severity: "warning",
        userVisible: true,
      });
    };
    const safeUnlisten = (unsub: UnlistenFn | null) => {
      if (!unsub) return;
      try {
        unsub();
      } catch (err) {
        reportWatcherFailure("unlisten_fs_changed", err);
      }
    };
    const stopWatcher = (operation = "stop_fs_watcher") => {
      void invoke("stop_fs_watcher", { watchPath: repoPath }).catch((err) => {
        reportWatcherFailure(operation, err);
      });
    };

    const setup = async () => {
      let unsub: UnlistenFn;
      try {
        unsub = await listen<{ root: string; paths: string[] }>("fs:changed", (event) => {
          const eventRoot = event.payload.root.replace(/\\/g, "/").toLowerCase();
          const currentRoot = repoPath.replace(/\\/g, "/").toLowerCase();
          if (eventRoot === currentRoot) refresh();
        });
      } catch (err) {
        reportWatcherFailure("listen_fs_changed", err);
        return;
      }

      if (aborted) {
        safeUnlisten(unsub);
        return;
      }
      unlisten = unsub;

      try {
        await invoke("start_fs_watcher", { watchPath: repoPath });
      } catch (err) {
        reportWatcherFailure("start_fs_watcher", err);
        return;
      }
      if (aborted) {
        stopWatcher("stop_fs_watcher_after_abort");
        return;
      }
      watcherStarted = true;
    };
    setup();

    return () => {
      aborted = true;
      safeUnlisten(unlisten);
      if (watcherStarted) {
        stopWatcher();
      }
    };
  }, [repoPath, refresh]);

  return { branch, isDirty, changedFiles, refresh };
}
