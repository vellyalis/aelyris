import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductModeRail } from "../features/app/ProductModeRail";
import type { ProductModeRailActions } from "../features/app/productModeRailContract";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function createActions(): ProductModeRailActions {
  return {
    onSelectMode: vi.fn(),
  };
}

describe("ProductModeRail", () => {
  it("projects the active product mode from one typed view model", () => {
    render(<ProductModeRail viewModel={{ activeMode: "workspace", hidden: false }} actions={createActions()} />);

    expect(screen.getByRole("navigation", { name: "Aelyris mode rail" }).getAttribute("data-active-mode")).toBe(
      "workspace",
    );
    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: /^Workspace\./ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Terminal\./ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("routes pointer and Alt shortcut intents through the action contract", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const actions = createActions();
    render(<ProductModeRail viewModel={{ activeMode: "terminal", hidden: false }} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: /^Git\./ }));
    fireEvent.keyDown(window, { key: "2", altKey: true });

    expect(actions.onSelectMode).toHaveBeenNthCalledWith(1, "git");
    expect(actions.onSelectMode).toHaveBeenNthCalledWith(2, "agents");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Agents\./ }));
  });

  it("keeps Alt shortcut routing active while the visual rail is hidden", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const actions = createActions();
    render(<ProductModeRail viewModel={{ activeMode: "terminal", hidden: true }} actions={actions} />);

    expect(screen.queryByRole("navigation", { name: "Aelyris mode rail" })).toBeNull();
    fireEvent.keyDown(window, { key: "4", altKey: true });

    expect(actions.onSelectMode).toHaveBeenCalledWith("review");
  });
});
