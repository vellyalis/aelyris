import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RightRailShell } from "../features/right-rail/RightRailShell";
import type { RightRailShellActions, RightRailShellViewModel } from "../features/right-rail/rightRailShellContract";

const DEFAULT_VIEW_MODEL: RightRailShellViewModel = {
  hidden: false,
  width: 320,
  activeMode: "command",
  modeBadges: {
    command: 2,
    review: 1,
    observe: 0,
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderShell(
  viewModel: RightRailShellViewModel = DEFAULT_VIEW_MODEL,
  actions: RightRailShellActions = {
    onWidthChange: vi.fn(),
    onModeChange: vi.fn(),
  },
) {
  return {
    actions,
    ...render(
      <RightRailShell viewModel={viewModel} actions={actions}>
        <div>rail content</div>
      </RightRailShell>,
    ),
  };
}

describe("RightRailShell", () => {
  it("projects shell geometry, active mode, badges, and content from one typed view model", () => {
    const { container } = renderShell();

    const inspector = screen.getByRole("complementary", { name: "Contextual inspector" });
    expect(inspector.getAttribute("style")).toContain("flex-basis: 320px");
    expect(inspector.getAttribute("style")).toContain("width: 320px");
    expect(inspector.hidden).toBe(false);
    expect(screen.getByText("rail content")).not.toBeNull();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /^Run:/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /^Run:/ }).textContent).toContain("2");
    expect(container.querySelector('[data-right-rail-mode="observe"]')?.hasAttribute("data-has-badge")).toBe(false);
  });

  it("routes mode click and keyboard navigation through the action contract", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const actions: RightRailShellActions = {
      onWidthChange: vi.fn(),
      onModeChange: vi.fn(),
    };
    renderShell(DEFAULT_VIEW_MODEL, actions);

    fireEvent.click(screen.getByRole("tab", { name: /^Review:/ }));
    expect(actions.onModeChange).toHaveBeenCalledWith("review");

    fireEvent.keyDown(screen.getByRole("tab", { name: /^Run:/ }), { key: "ArrowRight" });
    expect(actions.onModeChange).toHaveBeenLastCalledWith("review");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /^Review:/ }));
  });

  it("routes keyboard resizing through the width action without owning duplicate width state", () => {
    const actions: RightRailShellActions = {
      onWidthChange: vi.fn(),
      onModeChange: vi.fn(),
    };
    renderShell(DEFAULT_VIEW_MODEL, actions);
    const resizeHandle = screen.getByRole("separator", { name: "Resize agent inspector panel" });

    fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowRight", shiftKey: true });

    expect(actions.onWidthChange).toHaveBeenNthCalledWith(1, 336);
    expect(actions.onWidthChange).toHaveBeenNthCalledWith(2, 256);
  });

  it("routes pointer resizing with the inverted rail delta and releases its drag owner", () => {
    const actions: RightRailShellActions = {
      onWidthChange: vi.fn(),
      onModeChange: vi.fn(),
    };
    renderShell(DEFAULT_VIEW_MODEL, actions);
    const resizeHandle = screen.getByRole("separator", { name: "Resize agent inspector panel" });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(resizeHandle, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    fireEvent.pointerDown(resizeHandle, { clientX: 400, pointerId: 7 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.cursor).toBe("col-resize");

    fireEvent.pointerMove(resizeHandle, { clientX: 360, pointerId: 7 });
    expect(actions.onWidthChange).toHaveBeenCalledWith(360);

    fireEvent.pointerUp(resizeHandle, { clientX: 360, pointerId: 7 });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.cursor).toBe("");

    fireEvent.pointerMove(resizeHandle, { clientX: 320, pointerId: 7 });
    expect(actions.onWidthChange).toHaveBeenCalledTimes(1);
  });

  it("projects the existing zen or collapsed visibility decision without rederiving it", () => {
    const { container } = renderShell({ ...DEFAULT_VIEW_MODEL, hidden: true });

    const inspector = container.querySelector("aside");
    if (!(inspector instanceof HTMLElement)) throw new Error("Expected hidden right rail");
    expect(inspector.hidden).toBe(true);
    expect(inspector.getAttribute("aria-hidden")).toBe("true");
  });
});
