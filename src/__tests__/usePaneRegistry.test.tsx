import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePaneRegistry } from "../features/terminal/usePaneRegistry";

const ownerSources = import.meta.glob("../features/terminal/usePaneRegistry.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getOwnerSource(): string {
  const entries = Object.entries(ownerSources);
  expect(entries).toHaveLength(1);
  return entries[0][1].replace(/\r\n/g, "\n");
}

describe("usePaneRegistry", () => {
  it("owns registry deduplication, ended-process cleanup, and closed-tab pruning", () => {
    const owner = getOwnerSource();

    expect(owner).toContain("paneRegistryEqual");
    expect(owner).toContain("clearActivePtyId");
    expect(owner).toContain("const liveIds = new Set(tabs.map");
    expect(owner).toContain("previous[tabId] === ptyId");
  });

  it("removes active-PTY and registry state together when a tab is removed", async () => {
    const { result, rerender } = renderHook(({ activeTabId, tabs }) => usePaneRegistry(activeTabId, tabs), {
      initialProps: {
        activeTabId: "tab-a",
        tabs: [{ id: "tab-a" }, { id: "tab-b" }],
      },
    });

    act(() => {
      result.current.setTabActivePtyId("tab-a", "pty-a");
      result.current.setTabActivePtyId("tab-b", "pty-b");
      result.current.setTabPaneRegistry("tab-a", []);
      result.current.setTabPaneRegistry("tab-b", [
        { paneId: "pane-b", terminalId: "pty-b", shortId: 2, lifecycle: "live", index: 0, shell: "powershell" },
      ]);
    });

    rerender({ activeTabId: "tab-a", tabs: [{ id: "tab-a" }] });
    await waitFor(() => expect(result.current.tabPaneRegistries["tab-b"]).toBeUndefined());
    expect(result.current.activePtyId).toBe("pty-a");

    act(() => {
      result.current.setTabActivePtyId("tab-b", "pty-late");
      result.current.setTabPaneRegistry("tab-b", [
        {
          paneId: "pane-late",
          terminalId: "pty-late",
          shortId: 3,
          lifecycle: "live",
          index: 0,
          shell: "powershell",
        },
      ]);
    });
    expect(result.current.tabPaneRegistries["tab-b"]).toBeUndefined();

    rerender({ activeTabId: "tab-b", tabs: [{ id: "tab-a" }] });
    expect(result.current.activePtyId).toBeNull();
  });
});
