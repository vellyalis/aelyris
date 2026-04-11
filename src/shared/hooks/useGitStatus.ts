import { useState, useEffect, useCallback } from "react";
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

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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
    // Delay initial poll to not block startup
    const timeout = setTimeout(poll, 500);
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearTimeout(timeout); clearInterval(interval); };
  }, [repoPath, refreshKey]);

  return { branch, isDirty, changedFiles, refresh };
}
