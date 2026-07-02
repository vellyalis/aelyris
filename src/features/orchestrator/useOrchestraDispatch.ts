import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import {
  launchOrchestraPrompts,
  type OrchestraRoutingDecision,
  routeOrchestraPrompts,
  type StartInteractiveSession,
} from "../../shared/lib/orchestraDispatch";
import { buildOrchestraPrompts, type OwnershipPromptSection } from "../../shared/lib/orchestrator";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import { toast } from "../../shared/store/toastStore";
import { showOrchestra } from "../../shared/ui/OrchestraDialog";
import type { RightRailWidgetId } from "../right-rail/rightRailModel";
import type { PaneAgentSpawnRequest } from "../terminal/pane-tree/PaneTreeContainer";

export type OrchestraRolePaneMap = Map<string, { terminalId: string; tabId: string }>;

type MountAgentPtyInPane = (
  agents: PaneAgentSpawnRequest["agents"][number] | PaneAgentSpawnRequest["agents"][number][],
  tabId?: string,
) => void;

interface UseOrchestraDispatchOptions {
  activeTabId: string;
  decisionInboxPendingCount: number;
  handleStartInteractiveSession: StartInteractiveSession;
  interactiveSessionCount: number;
  mountAgentPtyInPane: MountAgentPtyInPane;
  projectName: string;
  projectPath: string;
  rightRailAllChangedFiles: { path: string }[];
  rightRailPrimaryActionNextStep?: string;
  selectInteractiveSession: (sessionId: string) => void;
  sessionsCount: number;
  setRightRailFocusWidget: (widget: RightRailWidgetId | null) => void;
  setRightRailMode: (mode: "command") => void;
}

export function useOrchestraDispatch({
  activeTabId,
  decisionInboxPendingCount,
  handleStartInteractiveSession,
  interactiveSessionCount,
  mountAgentPtyInPane,
  projectName,
  projectPath,
  rightRailAllChangedFiles,
  rightRailPrimaryActionNextStep,
  selectInteractiveSession,
  sessionsCount,
  setRightRailFocusWidget,
  setRightRailMode,
}: UseOrchestraDispatchOptions) {
  // Role -> { mounted pty id, tab it was mounted in } for the most recent
  // orchestra dispatch, so a role lane card can focus its central pane in the
  // correct tab even after the operator switches tabs (WU-VP-1 DoD#6).
  const [orchestraRolePanes, setOrchestraRolePanes] = useState<OrchestraRolePaneMap>(() => new Map());

  const handleStartRightRailOrchestra = useCallback(async () => {
    if (!projectPath) {
      toast.error("No workspace", "Open a project before dispatching an agent team.");
      return;
    }
    const defaultTask =
      rightRailPrimaryActionNextStep ??
      (rightRailAllChangedFiles.length > 0
        ? `Finish and review ${rightRailAllChangedFiles.length} changed file${
            rightRailAllChangedFiles.length === 1 ? "" : "s"
          } in ${projectName}.`
        : `Plan and implement the next parallel development task for ${projectName}.`);
    const changedFiles = rightRailAllChangedFiles.map((file) => file.path);
    // Fetch the SAME backend-rendered ownership context the loop injects (SSOT) so the
    // hand-launched roles are warned off the symbols other agents own. Browser-dev (no
    // backend) simply skips the consult - the launch path itself requires Tauri. A real
    // Tauri/backend FAILURE is different: it must NOT be collapsed into "0 claims"
    // (= looks parallel-safe). Track it separately so the dialog warns safety is UNKNOWN.
    let ownershipContext: OwnershipPromptSection | undefined;
    let ownershipUnavailable = false;
    if (isTauriRuntime()) {
      try {
        ownershipContext = await tauriInvoke<OwnershipPromptSection>("symbol_ownership_prompt_section", {
          files: changedFiles,
          forAgent: null,
        });
      } catch (error) {
        ownershipContext = undefined;
        ownershipUnavailable = true;
        console.error("[Orchestra] symbol_ownership_prompt_section failed", error);
      }
    }
    const result = await showOrchestra({
      defaultTask,
      defaultRoles: ["implementer", "tester", "reviewer"],
      activeClaimCount: ownershipContext?.claimCount ?? 0,
      ownershipUnavailable,
    });
    if (!result || result.roles.length === 0) return;
    const prompts = buildOrchestraPrompts({
      task: result.task,
      roles: result.roles,
      projectPath,
      changedFiles,
      pendingDecisionCount: decisionInboxPendingCount,
      existingSessionCount: sessionsCount + interactiveSessionCount,
      ownershipContext,
    });
    const routedPrompts = await routeOrchestraPrompts(
      prompts,
      (prompt) => tauriInvoke<OrchestraRoutingDecision>("route_agent", { prompt }),
      isTauriRuntime(),
    );
    const launches = await launchOrchestraPrompts(routedPrompts, projectPath, handleStartInteractiveSession);
    if (launches.length === 0) {
      toast.error("Orchestra dispatch failed", "No agent session could be started.");
      return;
    }
    // Mount each launched role as a live central pane (WU-VP-1) in one tiling
    // pass, and remember role -> pane so its lane card can focus it (DoD#6).
    mountAgentPtyInPane(
      launches.map((launch) => ({
        terminalId: launch.terminalId,
        model: launch.model,
        backend: launch.backend === "sidecar" ? "sidecar" : "native",
        durability: launch.backend === "sidecar" ? "tmux-durable" : "degraded",
        spawnedAt: new Date().toISOString(),
        ...(launch.roleId ? { roleId: launch.roleId } : {}),
        ...(launch.branchName ? { branchName: launch.branchName } : {}),
      })),
      activeTabId,
    );
    setOrchestraRolePanes((prev) => {
      const next = new Map(prev);
      for (const launch of launches) next.set(launch.roleId, { terminalId: launch.terminalId, tabId: activeTabId });
      return next;
    });
    // spawn_interactive_agent selects each spawned session, and the main tab's
    // pane tree only renders while no interactive session is selected - so the
    // last-spawned agent tab would hide the panes we just mounted. Clear the
    // selection so the operator lands on the tiled role panes, not an agent tab.
    selectInteractiveSession("");
    setRightRailMode("command");
    setRightRailFocusWidget("sessions");
    toast.success(
      "Orchestra dispatched",
      `${launches.length} agent${launches.length === 1 ? "" : "s"} launched in role-scoped panes.`,
    );
  }, [
    activeTabId,
    decisionInboxPendingCount,
    handleStartInteractiveSession,
    interactiveSessionCount,
    mountAgentPtyInPane,
    projectName,
    projectPath,
    rightRailAllChangedFiles,
    rightRailAllChangedFiles.length,
    rightRailPrimaryActionNextStep,
    selectInteractiveSession,
    sessionsCount,
    setRightRailFocusWidget,
    setRightRailMode,
  ]);

  return {
    handleStartRightRailOrchestra,
    orchestraRolePanes,
  };
}
