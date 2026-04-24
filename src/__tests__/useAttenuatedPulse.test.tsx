import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAttenuatedPulse } from "../shared/hooks/useAttenuatedPulse";

describe("useAttenuatedPulse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'off' when inactive", () => {
    const { result } = renderHook(() => useAttenuatedPulse(false));
    expect(result.current).toBe("off");
  });

  it("returns 'active' immediately when isActive flips to true", () => {
    const { result } = renderHook(() => useAttenuatedPulse(true));
    expect(result.current).toBe("active");
  });

  it("transitions from 'active' to 'ambient' after default 30s", () => {
    const { result } = renderHook(() => useAttenuatedPulse(true));
    expect(result.current).toBe("active");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe("ambient");
  });

  it("does not transition to ambient before the duration elapses", () => {
    const { result } = renderHook(() => useAttenuatedPulse(true));
    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(result.current).toBe("active");
  });

  it("honours a custom activeDurationMs", () => {
    const { result } = renderHook(() => useAttenuatedPulse(true, 5_000));
    expect(result.current).toBe("active");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe("ambient");
  });

  it("returns to 'off' as soon as isActive flips back to false", () => {
    const { result, rerender } = renderHook(({ active }) => useAttenuatedPulse(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe("ambient");
    rerender({ active: false });
    expect(result.current).toBe("off");
  });

  it("restarts the active phase when isActive flips back to true", () => {
    const { result, rerender } = renderHook(({ active }) => useAttenuatedPulse(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe("ambient");
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toBe("active");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe("ambient");
  });

  it("clears the pending timer on unmount so it does not fire stale setState", () => {
    const { unmount } = renderHook(() => useAttenuatedPulse(true));
    unmount();
    // If the timer were not cleared, vi.advanceTimersByTime would invoke a
    // setState on an unmounted component and React would warn. This test
    // passes quietly when the cleanup is correct.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
  });
});
