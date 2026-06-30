import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the props the mirror hands to TerminalCanvas so we can prove the tile
// is read-only (no-op writer) without a real canvas/PTY.
const captured: { writeBytes?: (id: string, data: string) => void } = {};
vi.mock("../features/terminal/TerminalCanvas", () => ({
  TerminalCanvas: (props: { terminalId: string; writeBytes?: (id: string, data: string) => void }) => {
    captured.writeBytes = props.writeBytes;
    return <canvas data-testid="fgt" data-terminal-id={props.terminalId} />;
  },
}));

import { FleetGridTerminal } from "../features/agent-inspector/FleetGridTerminal";

let widthSpy: ReturnType<typeof vi.spyOn> | null = null;
let heightSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  captured.writeBytes = undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  heightSpy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
});

afterEach(() => {
  widthSpy?.mockRestore();
  heightSpy?.mockRestore();
  vi.unstubAllGlobals();
  cleanup();
});

describe("FleetGridTerminal (read-only PTY mirror)", () => {
  it("marks its container inert and non-interactive so it cannot steal focus or input", () => {
    render(<FleetGridTerminal ptyId="pty-1" />);
    const container = screen.getByTestId("fgt").parentElement;
    expect(container).not.toBeNull();
    expect(container?.hasAttribute("inert")).toBe(true);
    expect(container?.style.pointerEvents).toBe("none");
  });

  it("passes a no-op writeBytes so keystrokes can never reach the agent pty", () => {
    render(<FleetGridTerminal ptyId="pty-1" />);
    expect(typeof captured.writeBytes).toBe("function");
    // The no-op writer returns nothing and must not throw.
    expect(() => captured.writeBytes?.("pty-1", "rm -rf /\n")).not.toThrow();
    expect(captured.writeBytes?.("pty-1", "x")).toBeUndefined();
  });
});
