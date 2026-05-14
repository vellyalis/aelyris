import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalInfoBar } from "../features/terminal/TerminalInfoBar";
import type { PromptMark } from "../shared/hooks/usePromptMarks";

// TerminalInfoBar subscribes to OSC 133 prompt marks via usePromptMarks.
// In the jsdom test environment we mock Tauri core/event so the seed
// query resolves immediately with a fixed mark list and no real listener
// is ever attached.
const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function mark(sequence: number, kind: PromptMark["kind"], exitCode: number | null = null): PromptMark {
  return { kind, screenLine: 0, exitCode, sequence, historySize: 0 };
}

describe("TerminalInfoBar — exit status dot", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hides the dot when no CommandEnd mark is present", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    // The bar is synchronous; no dot should ever show up for this session.
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("renders a green dot for a successful last command (exit 0)", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "commandEnd", 0)]);
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    await waitFor(() => {
      const dot = container.querySelector("[role='status']") as HTMLElement | null;
      expect(dot).not.toBeNull();
      expect(dot?.style.background).toBe("var(--ctp-green)");
      expect(dot?.getAttribute("aria-label")).toContain("succeeded");
    });
  });

  it("renders a red dot with the exit code in the label for a failed command", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "commandEnd", 137)]);
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    await waitFor(() => {
      const dot = container.querySelector("[role='status']") as HTMLElement | null;
      expect(dot).not.toBeNull();
      expect(dot?.style.background).toBe("var(--ctp-red)");
      expect(dot?.getAttribute("aria-label")).toContain("137");
    });
  });

  it("renders a muted dot when the shell ended a command but did not report an exit code", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "commandEnd", null)]);
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    await waitFor(() => {
      const dot = container.querySelector("[role='status']") as HTMLElement | null;
      expect(dot).not.toBeNull();
      expect(dot?.style.background).toBe("var(--text-muted)");
    });
  });

  it("uses the most recent CommandEnd when several marks exist", async () => {
    invokeMock.mockResolvedValueOnce([
      mark(0, "commandEnd", 0),
      mark(1, "promptStart"),
      mark(2, "commandStart"),
      mark(3, "commandEnd", 2),
    ]);
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    await waitFor(() => {
      const dot = container.querySelector("[role='status']") as HTMLElement | null;
      expect(dot).not.toBeNull();
      // Latest is exit 2 — must be red, not green from the earlier 0.
      expect(dot?.style.background).toBe("var(--ctp-red)");
      expect(dot?.getAttribute("aria-label")).toContain("2");
    });
  });

  it("renders nothing related to exit status when terminalId is null (pre-spawn)", () => {
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId={null} />);
    expect(container.querySelector("[role='status']")).toBeNull();
    // And we didn't call the backend — hook respects the null id.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("renders pane identity and cycles its role from the compact badge", () => {
    const onCycle = vi.fn();
    render(
      <TerminalInfoBar
        shell="pwsh"
        terminalId={null}
        paneTitle="frontend"
        paneRole="build"
        onCyclePaneRole={onCycle}
      />,
    );

    const identity = screen.getByRole("button", { name: /Pane identity: Build · frontend/ });
    expect(identity.textContent).toContain("Build · frontend");
    fireEvent.click(identity);
    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it("sets a pane role from the explicit role menu", async () => {
    const onSetPaneRole = vi.fn();
    render(
      <TerminalInfoBar
        shell="pwsh"
        terminalId={null}
        paneTitle="frontend"
        paneRole="build"
        onSetPaneRole={onSetPaneRole}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Pane identity: Build · frontend/ });
    fireEvent.pointerDown(trigger);
    const items = await screen.findAllByRole("menuitem");
    const review = items.find((item) => item.textContent?.replace(/\s+/g, " ").includes("Review@review"));
    if (!review) throw new Error("Review role menu item was not rendered");
    fireEvent.click(review);

    expect(onSetPaneRole).toHaveBeenCalledWith("review");
  });

  it("renames the pane from the explicit rename button without cycling the role", () => {
    const onCycle = vi.fn();
    const onRename = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("  reviewer  ");
    render(
      <TerminalInfoBar
        shell="pwsh"
        terminalId={null}
        paneRole="review"
        onCyclePaneRole={onCycle}
        onRenamePane={onRename}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rename pane: Review/ }));
    expect(onCycle).not.toHaveBeenCalled();
    expect(onRename).toHaveBeenCalledWith("reviewer");
  });

  it("shows synchronized input as a pressed toolbar toggle", () => {
    const onToggleSync = vi.fn();
    render(<TerminalInfoBar shell="pwsh" terminalId={null} syncMode onToggleSync={onToggleSync} />);

    const toggle = screen.getByRole("button", { name: "Toggle synchronized input" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("title")).toBe("Disable Sync Input");
    fireEvent.click(toggle);
    expect(onToggleSync).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate global branch metadata inside each terminal pane bar", () => {
    render(<TerminalInfoBar shell="pwsh" terminalId={null} branch="feature/noise" cwd="C:/repo" />);

    expect(screen.queryByText("feature/noise")).toBeNull();
    expect(screen.getByText("~/C:/repo")).not.toBeNull();
  });
});
