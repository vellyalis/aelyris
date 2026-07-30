import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppDialogHost } from "../features/app/AppDialogHost";
import type { AppDialogHostActions } from "../features/app/appDialogHostContract";

vi.mock("../shared/ui/LazyDialog", () => ({
  LazyDialog: ({ children }: { children: ReactNode }) => <div data-testid="lazy-dialog">{children}</div>,
}));

vi.mock("../shared/ui/PromptDialog", () => ({
  PromptDialog: () => <div>prompt dialog surface</div>,
}));

vi.mock("../shared/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => <div>confirm dialog surface</div>,
}));

vi.mock("../shared/ui/HandoffDialog", () => ({
  HandoffDialog: () => <div>handoff dialog surface</div>,
}));

vi.mock("../shared/ui/OrchestraDialog", () => ({
  OrchestraDialog: () => <div>orchestra dialog surface</div>,
}));

vi.mock("../features/history/HistorySearchDialog", () => ({
  HistorySearchDialog: ({
    onAccept,
    defaultCwdPrefix,
  }: {
    onAccept: (hit: { score: number }) => void;
    defaultCwdPrefix?: string;
  }) => (
    <button type="button" data-cwd={defaultCwdPrefix} onClick={() => onAccept({ score: 0.91 })}>
      history dialog surface
    </button>
  ),
}));

vi.mock("../features/app/lazyPanels", () => ({
  FleetHud: () => <div>fleet overlay surface</div>,
  OnboardingOverlay: () => <div>onboarding overlay surface</div>,
}));

afterEach(cleanup);

function createActions(): AppDialogHostActions {
  return {
    onHistoryAccept: vi.fn(),
  };
}

describe("AppDialogHost", () => {
  it("projects only visible lazy dialogs through the shared host boundary", () => {
    render(
      <AppDialogHost
        viewModel={{ historyCwdPrefix: "C:\\workspace" }}
        actions={createActions()}
        lazyDialogs={[
          { id: "settings", visible: true, content: <div>settings content</div> },
          { id: "help", visible: false, content: <div>help content</div> },
        ]}
      />,
    );

    expect(screen.getAllByTestId("lazy-dialog")).toHaveLength(1);
    expect(screen.getByText("settings content")).not.toBeNull();
    expect(screen.queryByText("help content")).toBeNull();
  });

  it("preserves close and dialog intents carried by visible content slots", () => {
    const onClose = vi.fn();
    render(
      <AppDialogHost
        viewModel={{}}
        actions={createActions()}
        lazyDialogs={[
          {
            id: "command-palette",
            visible: true,
            content: (
              <button type="button" onClick={onClose}>
                close command palette
              </button>
            ),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "close command palette" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("owns persistent surfaces and routes history acceptance through the typed action contract", () => {
    const actions = createActions();
    render(<AppDialogHost viewModel={{ historyCwdPrefix: "C:\\repo" }} actions={actions} lazyDialogs={[]} />);

    expect(screen.getByText("prompt dialog surface")).not.toBeNull();
    expect(screen.getByText("confirm dialog surface")).not.toBeNull();
    expect(screen.getByText("handoff dialog surface")).not.toBeNull();
    expect(screen.getByText("orchestra dialog surface")).not.toBeNull();
    expect(screen.getByText("onboarding overlay surface")).not.toBeNull();
    expect(screen.getByText("fleet overlay surface")).not.toBeNull();

    const history = screen.getByRole("button", { name: "history dialog surface" });
    expect(history.getAttribute("data-cwd")).toBe("C:\\repo");
    fireEvent.click(history);
    expect(actions.onHistoryAccept).toHaveBeenCalledWith({ score: 0.91 });
  });
});
