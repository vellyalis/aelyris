import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEffectiveProjectPath, useProjectTabLifecycle } from "../features/app/useProjectTabLifecycle";
import { paneTreeStorageKey } from "../features/terminal/pane-tree";
import type { Tab } from "../shared/hooks/useTabManager";
import { useAppStore } from "../shared/store/appStore";
import { showConfirm } from "../shared/ui/ConfirmDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("../shared/ui/ConfirmDialog", () => ({
  showConfirm: vi.fn(),
}));

const tabs: Tab[] = [
  { id: "tab-a", label: "Repo A", shell: "powershell", cwd: "C:/repo-a" },
  { id: "tab-b", label: "Repo B", shell: "powershell", cwd: "C:/repo-b" },
];

function seedActiveContext() {
  useAppStore.setState({
    activeFile: "C:/repo-a/src/main.ts",
    openFiles: ["C:/repo-a/src/main.ts", "C:/repo-a/src/other.ts"],
    unsavedFiles: new Set(["C:/repo-a/src/main.ts"]),
  });
  localStorage.setItem(paneTreeStorageKey("tab-a"), '{"snapshot":"active"}');
  localStorage.setItem(paneTreeStorageKey("tab-b"), '{"snapshot":"inactive"}');
}

function expectEditorContextPreserved() {
  expect(useAppStore.getState()).toMatchObject({
    activeFile: "C:/repo-a/src/main.ts",
    openFiles: ["C:/repo-a/src/main.ts", "C:/repo-a/src/other.ts"],
  });
  expect(useAppStore.getState().unsavedFiles).toEqual(new Set(["C:/repo-a/src/main.ts"]));
}

function createOptions() {
  let activeTabId = "tab-a";
  let interactiveSessionId = "interactive-a";
  let rootProjectPath: string | null = "C:/repo-a";
  const addTabWithCwd = vi.fn((_shell: "powershell", cwd: string) => {
    activeTabId = `opened:${cwd}`;
  });
  const clearFiles = vi.fn(() => useAppStore.getState().clearFiles());
  const closeTab = vi.fn((tabId: string) => {
    if (tabId === activeTabId) activeTabId = "tab-b";
  });
  const onActiveContextChanged = vi.fn(() => {
    interactiveSessionId = "";
  });
  const setActiveTabId = vi.fn((tabId: string) => {
    activeTabId = tabId;
  });
  const setRootProjectPath = vi.fn((path: string | null) => {
    rootProjectPath = path;
  });

  return {
    options: {
      activeTabId,
      addTabWithCwd,
      clearFiles,
      closeTab,
      onActiveContextChanged,
      setActiveTabId,
      setRootProjectPath,
      tabs,
    },
    state: {
      activeTabId: () => activeTabId,
      interactiveSessionId: () => interactiveSessionId,
      rootProjectPath: () => rootProjectPath,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(tauriInvoke).mockResolvedValue(undefined);
  useAppStore.setState({
    activeFile: null,
    openFiles: [],
    unsavedFiles: new Set(),
  });
});

describe("useProjectTabLifecycle", () => {
  it("opens a project only after confirmation and clears active context after the tab transition", async () => {
    seedActiveContext();
    const { options, state } = createOptions();
    const { result } = renderHook(() => useProjectTabLifecycle(options));
    vi.mocked(showConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await act(async () => {
      await result.current.handleOpenProject("C:\\repo-c");
    });

    expect(options.addTabWithCwd).not.toHaveBeenCalled();
    expect(options.setRootProjectPath).not.toHaveBeenCalled();
    expect(options.clearFiles).not.toHaveBeenCalled();
    expect(options.onActiveContextChanged).not.toHaveBeenCalled();
    expect(state.activeTabId()).toBe("tab-a");
    expect(state.interactiveSessionId()).toBe("interactive-a");
    expectEditorContextPreserved();
    expect(localStorage.getItem(paneTreeStorageKey("tab-a"))).toBe('{"snapshot":"active"}');

    await act(async () => {
      await result.current.handleOpenProject("C:\\repo-c");
    });

    expect(options.addTabWithCwd).toHaveBeenCalledWith("powershell", "C:/repo-c");
    expect(options.setRootProjectPath).toHaveBeenCalledWith("C:/repo-c");
    expect(options.addTabWithCwd.mock.invocationCallOrder[0]).toBeLessThan(
      options.setRootProjectPath.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(options.setRootProjectPath.mock.invocationCallOrder[0]).toBeLessThan(
      options.clearFiles.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(options.clearFiles.mock.invocationCallOrder[0]).toBeLessThan(
      options.onActiveContextChanged.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(useAppStore.getState()).toMatchObject({ activeFile: null, openFiles: [] });
    expect(state.activeTabId()).toBe("opened:C:/repo-c");
    expect(state.interactiveSessionId()).toBe("");
    expect(tauriInvoke).toHaveBeenCalledWith("populate_knowledge_graph", { rootPath: "C:/repo-c" });
  });

  it("switches tabs only after confirmation and preserves every active-context owner on cancel", async () => {
    seedActiveContext();
    const { options, state } = createOptions();
    const { result } = renderHook(() => useProjectTabLifecycle(options));
    vi.mocked(showConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    let switched = true;
    await act(async () => {
      switched = await result.current.handleTabSwitch("tab-b");
    });

    expect(switched).toBe(false);
    expect(options.setActiveTabId).not.toHaveBeenCalled();
    expect(options.clearFiles).not.toHaveBeenCalled();
    expect(options.onActiveContextChanged).not.toHaveBeenCalled();
    expect(state.activeTabId()).toBe("tab-a");
    expect(state.interactiveSessionId()).toBe("interactive-a");
    expectEditorContextPreserved();
    expect(localStorage.getItem(paneTreeStorageKey("tab-a"))).toBe('{"snapshot":"active"}');

    await act(async () => {
      switched = await result.current.handleTabSwitch("tab-b");
    });

    expect(switched).toBe(true);
    expect(options.setActiveTabId).toHaveBeenCalledWith("tab-b");
    expect(options.setActiveTabId.mock.invocationCallOrder[0]).toBeLessThan(
      options.clearFiles.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(state.activeTabId()).toBe("tab-b");
    expect(state.interactiveSessionId()).toBe("");
    expect(useAppStore.getState()).toMatchObject({ activeFile: null, openFiles: [] });
  });

  it("closes the folder only after confirmation and detaches the effective project path", async () => {
    seedActiveContext();
    const { options, state } = createOptions();
    const { result } = renderHook(() => useProjectTabLifecycle(options));
    vi.mocked(showConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await act(async () => {
      await result.current.handleCloseFolder();
    });

    expect(options.setRootProjectPath).not.toHaveBeenCalled();
    expect(options.clearFiles).not.toHaveBeenCalled();
    expect(options.onActiveContextChanged).not.toHaveBeenCalled();
    expect(state.rootProjectPath()).toBe("C:/repo-a");
    expect(resolveEffectiveProjectPath(state.rootProjectPath(), tabs[0].cwd)).toBe("C:/repo-a");
    expectEditorContextPreserved();

    await act(async () => {
      await result.current.handleCloseFolder();
    });

    expect(options.setRootProjectPath).toHaveBeenCalledWith(null);
    expect(options.setRootProjectPath.mock.invocationCallOrder[0]).toBeLessThan(
      options.clearFiles.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(resolveEffectiveProjectPath(state.rootProjectPath(), tabs[0].cwd)).toBe("");
    expect(state.interactiveSessionId()).toBe("");
    expect(useAppStore.getState()).toMatchObject({ activeFile: null, openFiles: [] });
    expect(localStorage.getItem(paneTreeStorageKey("tab-a"))).toBe('{"snapshot":"active"}');
  });

  it("closes an inactive tab without discarding active editor or interactive context", async () => {
    seedActiveContext();
    const { options, state } = createOptions();
    const { result } = renderHook(() => useProjectTabLifecycle(options));

    let closed = false;
    await act(async () => {
      closed = await result.current.handleCloseTab("tab-b");
    });

    expect(closed).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
    expect(options.closeTab).toHaveBeenCalledWith("tab-b");
    expect(options.clearFiles).not.toHaveBeenCalled();
    expect(options.onActiveContextChanged).not.toHaveBeenCalled();
    expect(state.activeTabId()).toBe("tab-a");
    expect(state.interactiveSessionId()).toBe("interactive-a");
    expectEditorContextPreserved();
    expect(localStorage.getItem(paneTreeStorageKey("tab-a"))).toBe('{"snapshot":"active"}');
    expect(localStorage.getItem(paneTreeStorageKey("tab-b"))).toBeNull();
  });

  it("closes the active tab only after confirmation and commits cleanup after the tab transition", async () => {
    seedActiveContext();
    const { options, state } = createOptions();
    const { result } = renderHook(() => useProjectTabLifecycle(options));
    vi.mocked(showConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    let closed = true;
    await act(async () => {
      closed = await result.current.handleCloseTab("tab-a");
    });

    expect(closed).toBe(false);
    expect(options.closeTab).not.toHaveBeenCalled();
    expect(options.clearFiles).not.toHaveBeenCalled();
    expect(options.onActiveContextChanged).not.toHaveBeenCalled();
    expect(state.activeTabId()).toBe("tab-a");
    expect(state.interactiveSessionId()).toBe("interactive-a");
    expectEditorContextPreserved();
    expect(localStorage.getItem(paneTreeStorageKey("tab-a"))).toBe('{"snapshot":"active"}');

    await act(async () => {
      closed = await result.current.handleCloseTab("tab-a");
    });

    expect(closed).toBe(true);
    expect(options.closeTab).toHaveBeenCalledWith("tab-a");
    expect(options.closeTab.mock.invocationCallOrder[0]).toBeLessThan(
      options.clearFiles.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(options.clearFiles.mock.invocationCallOrder[0]).toBeLessThan(
      options.onActiveContextChanged.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(state.activeTabId()).toBe("tab-b");
    expect(state.interactiveSessionId()).toBe("");
    expect(useAppStore.getState()).toMatchObject({ activeFile: null, openFiles: [] });
    expect(localStorage.getItem(paneTreeStorageKey("tab-a"))).toBeNull();
    expect(localStorage.getItem(paneTreeStorageKey("tab-b"))).toBe('{"snapshot":"inactive"}');
  });
});
