import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabManager } from "../shared/hooks/useTabManager";

// Clear localStorage before each test
beforeEach(() => {
  localStorage.clear();
});

describe("useTabManager", () => {
  it("initializes with one tab", () => {
    const { result } = renderHook(() => useTabManager("powershell"));
    expect(result.current.tabs.length).toBe(1);
    expect(result.current.tabs[0].shell).toBe("powershell");
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  it("generates unique tab IDs (UUID-based)", () => {
    const { result } = renderHook(() => useTabManager());
    const id1 = result.current.tabs[0].id;
    expect(id1).toMatch(/^tab-[a-f0-9]{8}$/);
  });

  it("adds a new tab and switches to it", () => {
    const { result } = renderHook(() => useTabManager());
    const firstId = result.current.tabs[0].id;

    act(() => { result.current.addTab("cmd"); });

    expect(result.current.tabs.length).toBe(2);
    expect(result.current.tabs[1].shell).toBe("cmd");
    expect(result.current.activeTabId).toBe(result.current.tabs[1].id);
    expect(result.current.activeTabId).not.toBe(firstId);
  });

  it("closes a tab and switches to adjacent", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => { result.current.addTab("cmd"); });
    act(() => { result.current.addTab("gitbash"); });

    const middleId = result.current.tabs[1].id;
    const firstId = result.current.tabs[0].id;

    // Switch to middle tab, then close it
    act(() => { result.current.setActiveTabId(middleId); });
    act(() => { result.current.closeTab(middleId); });

    expect(result.current.tabs.length).toBe(2);
    expect(result.current.activeTabId).toBe(firstId);
  });

  it("does not close the last tab", () => {
    const { result } = renderHook(() => useTabManager());
    const onlyId = result.current.tabs[0].id;

    act(() => { result.current.closeTab(onlyId); });

    expect(result.current.tabs.length).toBe(1);
    expect(result.current.tabs[0].id).toBe(onlyId);
  });

  it("persists tabs to localStorage", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => { result.current.addTab("cmd"); });

    const saved = localStorage.getItem("aether:tabs");
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.length).toBe(2);
  });

  it("restores tabs from localStorage", () => {
    // First: create tabs and persist
    const { result: r1, unmount } = renderHook(() => useTabManager());
    act(() => { r1.current.addTab("cmd"); });
    act(() => { r1.current.addTab("gitbash"); });
    unmount();

    // Second: new hook should restore
    const { result: r2 } = renderHook(() => useTabManager());
    expect(r2.current.tabs.length).toBe(3);
    expect(r2.current.tabs.map((t) => t.shell)).toEqual(["powershell", "cmd", "gitbash"]);
  });

  it("adds tab with cwd", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => { result.current.addTabWithCwd("powershell", "/home/user/project"); });

    const newTab = result.current.tabs[1];
    expect(newTab.cwd).toBe("/home/user/project");
    expect(newTab.label).toBe("project");
  });

  it("reorders tabs via drag & drop", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => { result.current.addTab("cmd"); });
    act(() => { result.current.addTab("gitbash"); });

    const [a, b, c] = result.current.tabs;
    // Move C before A
    act(() => { result.current.reorderTab(c.id, a.id); });

    expect(result.current.tabs.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it("reorder with same source and target is a no-op", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => { result.current.addTab("cmd"); });
    const before = result.current.tabs.map((t) => t.id);
    act(() => { result.current.reorderTab(before[0], before[0]); });
    expect(result.current.tabs.map((t) => t.id)).toEqual(before);
  });
});
