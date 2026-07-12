import { useCallback, useState } from "react";

import type {
  PaneAttachRequest,
  PaneCloseRequest,
  PaneFocusRequest,
  PaneLayoutCommand,
  PaneLayoutRequest,
  PaneRenameRequest,
  PaneRestartRequest,
  PaneRoleCycleRequest,
} from "./pane-tree/PaneTreeContainer";

type Routed<T> = T & { tabId: string };

interface UsePaneRequestControllerOptions {
  activeTabId: string;
  handleTabSwitch: (tabId: string) => Promise<boolean>;
  interactiveSessionId: string | null;
  selectInteractiveSession: (sessionId: string) => void;
}

export function usePaneRequestController({
  activeTabId,
  handleTabSwitch,
  interactiveSessionId,
  selectInteractiveSession,
}: UsePaneRequestControllerOptions) {
  const [paneFocusRequest, setPaneFocusRequest] = useState<Routed<PaneFocusRequest> | null>(null);
  const [paneCloseRequest, setPaneCloseRequest] = useState<Routed<PaneCloseRequest> | null>(null);
  const [paneRestartRequest, setPaneRestartRequest] = useState<Routed<PaneRestartRequest> | null>(null);
  const [paneAttachRequest, setPaneAttachRequest] = useState<Routed<PaneAttachRequest> | null>(null);
  const [paneRenameRequest, setPaneRenameRequest] = useState<Routed<PaneRenameRequest> | null>(null);
  const [paneRoleCycleRequest, setPaneRoleCycleRequest] = useState<Routed<PaneRoleCycleRequest> | null>(null);
  const [paneLayoutRequest, setPaneLayoutRequest] = useState<Routed<PaneLayoutRequest> | null>(null);

  const switchToTarget = useCallback(
    async (tabId: string) => (tabId === activeTabId ? true : handleTabSwitch(tabId)),
    [activeTabId, handleTabSwitch],
  );

  const handlePaneSwitch = useCallback(
    async (tabId: string, paneId: string) => {
      if (!(await switchToTarget(tabId))) return;
      if (interactiveSessionId) selectInteractiveSession("");
      setPaneFocusRequest((previous) => ({ tabId, paneId, sequence: (previous?.sequence ?? 0) + 1 }));
    },
    [interactiveSessionId, selectInteractiveSession, switchToTarget],
  );

  const applyPaneLayoutCommand = useCallback(
    (command: PaneLayoutCommand, tabId = activeTabId) => {
      setPaneLayoutRequest((previous) => ({ tabId, command, sequence: (previous?.sequence ?? 0) + 1 }));
    },
    [activeTabId],
  );

  const handlePaneClose = useCallback((tabId: string, paneId: string) => {
    setPaneCloseRequest((previous) => ({ tabId, paneId, sequence: (previous?.sequence ?? 0) + 1 }));
  }, []);

  const handlePaneRestart = useCallback(
    async (tabId: string, paneId: string) => {
      if (!(await switchToTarget(tabId))) throw new Error("Restart target tab is unavailable.");
      await new Promise<void>((resolve, reject) => {
        setPaneRestartRequest((previous) => ({
          tabId,
          paneId,
          sequence: (previous?.sequence ?? 0) + 1,
          onComplete: (error) => (error ? reject(new Error(error)) : resolve()),
        }));
      });
    },
    [switchToTarget],
  );

  const handlePaneAttach = useCallback(
    async (tabId: string, paneId: string, terminalId: string) => {
      if (!(await switchToTarget(tabId))) throw new Error("Attach target tab is unavailable.");
      await new Promise<void>((resolve, reject) => {
        setPaneAttachRequest((previous) => ({
          tabId,
          paneId,
          terminalId,
          sequence: (previous?.sequence ?? 0) + 1,
          onComplete: (error) => (error ? reject(new Error(error)) : resolve()),
        }));
      });
    },
    [switchToTarget],
  );

  const handlePaneRename = useCallback(
    async (tabId: string, paneId: string, title: string | null) => {
      if (!(await switchToTarget(tabId))) return;
      setPaneRenameRequest((previous) => ({
        tabId,
        paneId,
        title,
        sequence: (previous?.sequence ?? 0) + 1,
      }));
    },
    [switchToTarget],
  );

  const handlePaneRoleCycle = useCallback(
    async (tabId: string, paneId: string) => {
      if (!(await switchToTarget(tabId))) return;
      setPaneRoleCycleRequest((previous) => ({ tabId, paneId, sequence: (previous?.sequence ?? 0) + 1 }));
    },
    [switchToTarget],
  );

  return {
    applyPaneLayoutCommand,
    handlePaneAttach,
    handlePaneClose,
    handlePaneRename,
    handlePaneRestart,
    handlePaneRoleCycle,
    handlePaneSwitch,
    paneAttachRequest,
    paneCloseRequest,
    paneFocusRequest,
    paneLayoutRequest,
    paneRenameRequest,
    paneRestartRequest,
    paneRoleCycleRequest,
  };
}
