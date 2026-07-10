import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneLifecycleState } from "../features/terminal/pane-tree/types";
import { TerminalInfoBar } from "../features/terminal/TerminalInfoBar";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

describe("TerminalInfoBar pane lifecycle", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it.each([
    "live",
    "starting",
    "layout-only",
  ] satisfies PaneLifecycleState[])("does not imply a problem for %s panes", (lifecycle) => {
    render(<TerminalInfoBar shell="pwsh" terminalId={null} lifecycle={lifecycle} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["exited", "exited"],
    ["crashed", "crashed"],
    ["detached", "detached"],
    ["reconnecting", "reconnecting…"],
  ] satisfies Array<[PaneLifecycleState, string]>)("labels %s panes", (lifecycle, label) => {
    render(<TerminalInfoBar shell="pwsh" terminalId={null} lifecycle={lifecycle} />);
    const badge = screen.getByRole("status");
    expect(badge.textContent).toBe(label);
    expect(badge.getAttribute("data-lifecycle")).toBe(lifecycle);
  });

  it("shows the reconnect attempt only as tooltip detail", () => {
    render(<TerminalInfoBar shell="pwsh" terminalId={null} lifecycle="reconnecting" lifecycleAttempt={3} />);
    expect(screen.getByRole("status").getAttribute("title")).toBe("Reconnect attempt 3");
  });
});
