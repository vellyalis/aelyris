import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useGpuRenderer } from "../shared/hooks/useGpuRenderer";

// Phase 2 lockdown (2026-04-17): wgpu/native paths hang the webview on
// startup, so `useGpuRenderer` hard-pins to `xterm` and normalises any
// stale localStorage value. These tests reflect the lockdown behaviour —
// the earlier round-trip tests for wgpu/native are parked until those
// renderers are diagnosed and re-enabled.
describe("useGpuRenderer (Phase 2 lockdown)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to xterm when no preference is stored", () => {
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("xterm");
  });

  it("forces a stored wgpu preference back to xterm", () => {
    localStorage.setItem("aether:renderer", "wgpu");
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("xterm");
    expect(localStorage.getItem("aether:renderer")).toBe("xterm");
  });

  it("forces a stored native preference back to xterm", () => {
    localStorage.setItem("aether:renderer", "native");
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("xterm");
    expect(localStorage.getItem("aether:renderer")).toBe("xterm");
  });

  it("normalises unknown stored values to xterm", () => {
    localStorage.setItem("aether:renderer", "bogus");
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("xterm");
    expect(localStorage.getItem("aether:renderer")).toBe("xterm");
  });

  it("ignores storage events — always resolves to xterm", () => {
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("xterm");
    act(() => {
      localStorage.setItem("aether:renderer", "native");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(result.current).toBe("xterm");
    act(() => {
      localStorage.setItem("aether:renderer", "wgpu");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(result.current).toBe("xterm");
  });
});
