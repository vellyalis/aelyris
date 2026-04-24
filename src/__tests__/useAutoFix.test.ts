import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoFix } from "../shared/hooks/useAutoFix";
import type { DetectedError } from "../shared/lib/errorDetector";

const mockError: DetectedError = {
  type: "build_error",
  message: "Type mismatch in main.ts",
  suggestedPrompt: "Fix TypeScript error: Type mismatch in main.ts",
};

describe("useAutoFix", () => {
  let mockStartAgent: (prompt: string) => Promise<string | undefined>;

  beforeEach(() => {
    mockStartAgent = vi.fn(async (_prompt: string) => "session-123" as string | undefined);
  });

  it("triggerFix calls onStartAgent with structured prompt", async () => {
    const { result } = renderHook(() =>
      useAutoFix({
        onStartAgent: mockStartAgent,
        projectPath: "/project",
      }),
    );

    await act(async () => {
      await result.current.triggerFix(mockError);
    });

    expect(mockStartAgent).toHaveBeenCalledTimes(1);
    const prompt = (mockStartAgent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prompt).toContain("Type mismatch");
    expect(prompt).toContain("/project");
    expect(prompt).toContain("build_error");
  });

  it("respects 30s cooldown between triggers", async () => {
    const { result } = renderHook(() =>
      useAutoFix({
        onStartAgent: mockStartAgent,
        projectPath: "/project",
      }),
    );

    await act(async () => {
      await result.current.triggerFix(mockError);
    });
    expect(vi.mocked(mockStartAgent)).toHaveBeenCalledTimes(1);

    // Second call within cooldown — should be ignored
    await act(async () => {
      await result.current.triggerFix(mockError);
    });
    expect(vi.mocked(mockStartAgent)).toHaveBeenCalledTimes(1);
  });

  it("handleError auto-triggers when enabled", async () => {
    const { result } = renderHook(() =>
      useAutoFix({
        onStartAgent: mockStartAgent,
        projectPath: "/project",
        enabled: true,
      }),
    );

    await act(async () => {
      result.current.handleError(mockError);
    });

    // Wait for async
    await vi.waitFor(() => {
      expect(vi.mocked(mockStartAgent)).toHaveBeenCalledTimes(1);
    });
  });

  it("handleError does NOT auto-trigger when disabled", async () => {
    const { result } = renderHook(() =>
      useAutoFix({
        onStartAgent: mockStartAgent,
        projectPath: "/project",
        enabled: false,
      }),
    );

    act(() => {
      result.current.handleError(mockError);
    });

    expect(vi.mocked(mockStartAgent)).not.toHaveBeenCalled();
  });
});
