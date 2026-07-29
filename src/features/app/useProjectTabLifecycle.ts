import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import type { Tab } from "../../shared/hooks/useTabManager";
import { useAppStore } from "../../shared/store/appStore";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { deletePaneTreeSnapshot, deletePaneTreeSnapshotFromBackend, paneTreeStorageKey } from "../terminal/pane-tree";

interface UseProjectTabLifecycleOptions {
  activeTabId: string;
  addTabWithCwd: (shell: "powershell", cwd: string) => void;
  clearFiles: () => void;
  closeTab: (tabId: string) => void;
  onActiveContextChanged: () => void;
  setActiveTabId: (tabId: string) => void;
  setRootProjectPath: (path: string | null) => void;
  tabs: Tab[];
}

export function resolveEffectiveProjectPath(rootProjectPath: string | null, activeTabCwd?: string): string {
  return rootProjectPath ? (activeTabCwd ?? rootProjectPath) : "";
}

export function useProjectTabLifecycle({
  activeTabId,
  addTabWithCwd,
  clearFiles,
  closeTab,
  onActiveContextChanged,
  setActiveTabId,
  setRootProjectPath,
  tabs,
}: UseProjectTabLifecycleOptions) {
  const confirmDiscardUnsavedFiles = useCallback(async (action: string) => {
    const count = useAppStore.getState().unsavedFiles.size;
    if (count === 0) return true;
    return showConfirm({
      title: "Unsaved changes",
      description: `${count} file(s) have unsaved changes. ${action}?`,
      confirmLabel: "Discard",
      tone: "danger",
    });
  }, []);

  const handleOpenProject = useCallback(
    async (path: string) => {
      if (!(await confirmDiscardUnsavedFiles("Open another project and discard them"))) return;
      const normalized = path.replace(/\\/g, "/");
      addTabWithCwd("powershell", normalized);
      setRootProjectPath(normalized);
      clearFiles();
      onActiveContextChanged();
      void tauriInvoke("populate_knowledge_graph", { rootPath: normalized }).catch(() => {});
    },
    [addTabWithCwd, clearFiles, confirmDiscardUnsavedFiles, onActiveContextChanged, setRootProjectPath],
  );

  const handleCloseFolder = useCallback(async () => {
    if (!(await confirmDiscardUnsavedFiles("Close this project and discard them"))) return;
    setRootProjectPath(null);
    clearFiles();
    onActiveContextChanged();
  }, [clearFiles, confirmDiscardUnsavedFiles, onActiveContextChanged, setRootProjectPath]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
      if (selected) await handleOpenProject(typeof selected === "string" ? selected : selected[0]);
    } catch {
      /* cancelled or not in Tauri */
    }
  }, [handleOpenProject]);

  const handleTabSwitch = useCallback(
    async (tabId: string) => {
      if (tabId === activeTabId) return true;
      if (!tabs.some((tab) => tab.id === tabId)) return false;
      if (!(await confirmDiscardUnsavedFiles("Switch tabs and discard them"))) return false;
      setActiveTabId(tabId);
      clearFiles();
      onActiveContextChanged();
      return true;
    },
    [activeTabId, clearFiles, confirmDiscardUnsavedFiles, onActiveContextChanged, setActiveTabId, tabs],
  );

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      if (tabs.length <= 1 || !tabs.some((tab) => tab.id === tabId)) return false;
      const closesActiveTab = tabId === activeTabId;
      if (closesActiveTab && !(await confirmDiscardUnsavedFiles("Close this tab and discard them"))) {
        return false;
      }

      closeTab(tabId);
      const storageKey = paneTreeStorageKey(tabId);
      deletePaneTreeSnapshot(storageKey);
      void deletePaneTreeSnapshotFromBackend(storageKey);
      if (closesActiveTab) {
        clearFiles();
        onActiveContextChanged();
      }
      return true;
    },
    [activeTabId, clearFiles, closeTab, confirmDiscardUnsavedFiles, onActiveContextChanged, tabs],
  );

  return { handleCloseFolder, handleCloseTab, handleOpenFolder, handleOpenProject, handleTabSwitch };
}
