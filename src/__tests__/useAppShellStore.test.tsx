import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppShellStore } from "../features/app/useAppShellStore";
import { useAppStore } from "../shared/store/appStore";

describe("useAppShellStore", () => {
  it("does not rerender the shell owner for an unrelated store mutation", () => {
    const originalSelectedModel = useAppStore.getState().selectedModel;
    const originalSidebarCollapsed = useAppStore.getState().sidebarCollapsed;
    let renderCount = 0;

    const { unmount } = renderHook(() => {
      renderCount += 1;
      return useAppShellStore();
    });
    const initialRenderCount = renderCount;

    try {
      act(() => {
        useAppStore.setState({ selectedModel: `${originalSelectedModel}-unrelated` });
      });
      expect(renderCount).toBe(initialRenderCount);

      act(() => {
        useAppStore.setState({ sidebarCollapsed: !originalSidebarCollapsed });
      });
      expect(renderCount).toBe(initialRenderCount + 1);
    } finally {
      act(() => {
        useAppStore.setState({
          selectedModel: originalSelectedModel,
          sidebarCollapsed: originalSidebarCollapsed,
        });
      });
      unmount();
    }
  });
});
