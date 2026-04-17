import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useGpuRenderer } from "../shared/hooks/useGpuRenderer";

describe("useGpuRenderer", () => {
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

  it("reads a stored wgpu preference", () => {
    localStorage.setItem("aether:renderer", "wgpu");
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("wgpu");
  });

  it("reads a stored native preference", () => {
    localStorage.setItem("aether:renderer", "native");
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("native");
  });

  it("falls back to xterm for unknown stored values", () => {
    localStorage.setItem("aether:renderer", "bogus");
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("xterm");
  });

  it("reacts to storage events", () => {
    const { result } = renderHook(() => useGpuRenderer());
    expect(result.current).toBe("xterm");
    act(() => {
      localStorage.setItem("aether:renderer", "native");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(result.current).toBe("native");
    act(() => {
      localStorage.setItem("aether:renderer", "wgpu");
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(result.current).toBe("wgpu");
  });
});
