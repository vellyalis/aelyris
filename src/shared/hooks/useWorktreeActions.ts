import { useCallback } from "react";
import type { AgentSession, WorktreeInfo } from "../types/agent";

interface UseWorktreeActionsOptions {
  projectPath: string;
  sessions: AgentSession[];
  addTabWithCwd: (shell: "powershell" | "cmd" | "gitbash" | "wsl", cwd: string, worktreeBranch?: string) => void;
  stopAgent: (id: string) => void;
  onRefresh: () => void;
}

export function useWorktreeActions({
  projectPath,
  sessions,
  addTabWithCwd,
  stopAgent,
  onRefresh,
}: UseWorktreeActionsOptions) {
  const createWorktree = useCallback(
    async (_sessionId: string, branchName: string): Promise<WorktreeInfo | null> => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const wt = await invoke<{
          name: string;
          path: string;
          branch: string;
          is_main: boolean;
          head_sha: string;
          status: string;
        }>("create_worktree", {
          repoPath: projectPath,
          branchName,
        });
        addTabWithCwd("powershell", wt.path, branchName);
        onRefresh();
        return { ...wt, status: wt.status as "Clean" | "Modified" | "Conflicted" };
      } catch {
        return null;
      }
    },
    [projectPath, addTabWithCwd, onRefresh],
  );

  const removeWorktree = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session?.worktree) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("remove_worktree", {
          repoPath: projectPath,
          worktreeName: session.worktree.name,
          deleteBranch: true,
        });
        stopAgent(sessionId);
        onRefresh();
      } catch {
        /* ignore */
      }
    },
    [sessions, projectPath, stopAgent, onRefresh],
  );

  return { createWorktree, removeWorktree };
}
