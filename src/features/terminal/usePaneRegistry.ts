import { useCallback, useEffect, useState } from "react";

import type { PaneSwitcherEntry } from "./pane-tree";

function paneRegistryEqual(a: PaneSwitcherEntry[], b: PaneSwitcherEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return (
      !!right &&
      left.paneId === right.paneId &&
      left.terminalId === right.terminalId &&
      left.shortId === right.shortId &&
      left.lifecycle === right.lifecycle &&
      left.index === right.index &&
      left.shell === right.shell &&
      left.cwd === right.cwd &&
      left.title === right.title &&
      left.role === right.role &&
      left.label === right.label &&
      left.route === right.route
    );
  });
}

export function usePaneRegistry(activeTabId: string, tabs: Array<{ id: string }>) {
  const [tabActivePtyIds, setTabActivePtyIds] = useState<Record<string, string | null>>({});
  const [tabPaneRegistries, setTabPaneRegistries] = useState<Record<string, PaneSwitcherEntry[]>>({});

  const setTabActivePtyId = useCallback((tabId: string, ptyId: string | null) => {
    setTabActivePtyIds((previous) =>
      previous[tabId] === ptyId ? previous : { ...previous, [tabId]: ptyId },
    );
  }, []);

  const setTabPaneRegistry = useCallback((tabId: string, panes: PaneSwitcherEntry[]) => {
    setTabPaneRegistries((previous) =>
      paneRegistryEqual(previous[tabId] ?? [], panes) ? previous : { ...previous, [tabId]: panes },
    );
  }, []);

  const clearActivePtyId = useCallback((terminalId: string) => {
    setTabActivePtyIds((previous) => {
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(previous).map(([tabId, ptyId]) => {
          if (ptyId !== terminalId) return [tabId, ptyId];
          changed = true;
          return [tabId, null];
        }),
      );
      return changed ? next : previous;
    });
  }, []);

  useEffect(() => {
    const liveIds = new Set(tabs.map((tab) => tab.id));
    setTabActivePtyIds((previous) => {
      const next = Object.fromEntries(Object.entries(previous).filter(([id]) => liveIds.has(id)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
    setTabPaneRegistries((previous) => {
      const next = Object.fromEntries(Object.entries(previous).filter(([id]) => liveIds.has(id)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [tabs]);

  return {
    activePtyId: tabActivePtyIds[activeTabId] ?? null,
    clearActivePtyId,
    setTabActivePtyId,
    setTabPaneRegistry,
    tabPaneRegistries,
  };
}
