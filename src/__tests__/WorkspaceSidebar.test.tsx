import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSidebar } from "../features/sidebar/WorkspaceSidebar";
import type { WorkspaceSidebarActions, WorkspaceSidebarViewModel } from "../features/sidebar/workspaceSidebarContract";

const DEFAULT_VIEW_MODEL: WorkspaceSidebarViewModel = {
  hidden: false,
  width: 288,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderSidebar(
  viewModel: WorkspaceSidebarViewModel = DEFAULT_VIEW_MODEL,
  actions: WorkspaceSidebarActions = { onWidthChange: vi.fn() },
) {
  return {
    actions,
    ...render(
      <WorkspaceSidebar
        viewModel={viewModel}
        actions={actions}
        content={{
          files: <div>file tree content</div>,
          tasks: <div>task board content</div>,
          sourceControl: <div>source control content</div>,
          search: <div>search content</div>,
        }}
      />,
    ),
  };
}

describe("WorkspaceSidebar", () => {
  it("projects shell geometry, sections, and named content from one typed view model", () => {
    renderSidebar();

    const sidebar = screen.getByRole("navigation", { name: "Project sidebar" });
    expect(sidebar.getAttribute("style")).toContain("width: 288px");
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByRole("button", { name: "Toggle Files" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Toggle Tasks" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Toggle Source Control" })).not.toBeNull();
    expect(screen.getByText("file tree content")).not.toBeNull();
    expect(screen.getByText("search content")).not.toBeNull();
  });

  it("projects the existing collapsed or zen visibility decision without rederiving it", () => {
    const { container } = renderSidebar({ ...DEFAULT_VIEW_MODEL, hidden: true });

    const sidebar = container.querySelector("nav");
    if (!(sidebar instanceof HTMLElement)) throw new Error("Expected hidden project sidebar");
    expect(sidebar.className).toContain("left-panel-collapsed");
    expect(sidebar.getAttribute("aria-hidden")).toBe("true");
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    expect(sidebar.getAttribute("style")).toBeNull();
  });

  it("routes keyboard resize intents through the width action without owning duplicate width state", () => {
    const actions: WorkspaceSidebarActions = { onWidthChange: vi.fn() };
    renderSidebar(DEFAULT_VIEW_MODEL, actions);
    const resizeHandle = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" });
    fireEvent.keyDown(resizeHandle, { key: "ArrowRight", shiftKey: true });

    expect(actions.onWidthChange).toHaveBeenNthCalledWith(1, 272);
    expect(actions.onWidthChange).toHaveBeenNthCalledWith(2, 352);
  });

  it("routes pointer resize intents and releases its drag owner", () => {
    const actions: WorkspaceSidebarActions = { onWidthChange: vi.fn() };
    renderSidebar(DEFAULT_VIEW_MODEL, actions);
    const resizeHandle = screen.getByRole("separator", { name: "Resize sidebar" });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(resizeHandle, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    fireEvent.pointerDown(resizeHandle, { clientX: 300, pointerId: 9 });
    expect(setPointerCapture).toHaveBeenCalledWith(9);
    expect(document.body.style.cursor).toBe("col-resize");

    fireEvent.pointerMove(resizeHandle, { clientX: 340, pointerId: 9 });
    expect(actions.onWidthChange).toHaveBeenCalledWith(328);

    fireEvent.pointerUp(resizeHandle, { clientX: 340, pointerId: 9 });
    expect(releasePointerCapture).toHaveBeenCalledWith(9);
    expect(document.body.style.cursor).toBe("");

    fireEvent.pointerMove(resizeHandle, { clientX: 360, pointerId: 9 });
    expect(actions.onWidthChange).toHaveBeenCalledTimes(1);
  });
});
