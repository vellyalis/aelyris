import { useState, useEffect } from "react";
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
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [repoPath]);

  return { branch, isDirty, changedFiles };
}
