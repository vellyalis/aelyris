import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptMark } from "../shared/hooks/usePromptMarks";

import { TerminalInfoBar } from "../features/terminal/TerminalInfoBar";

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
      expect(dot!.style.background).toBe("var(--ctp-green)");
      expect(dot!.getAttribute("aria-label")).toContain("succeeded");
    });
  });

  it("renders a red dot with the exit code in the label for a failed command", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "commandEnd", 137)]);
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    await waitFor(() => {
      const dot = container.querySelector("[role='status']") as HTMLElement | null;
      expect(dot).not.toBeNull();
      expect(dot!.style.background).toBe("var(--ctp-red)");
      expect(dot!.getAttribute("aria-label")).toContain("137");
    });
  });

  it("renders a muted dot when the shell ended a command but did not report an exit code", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "commandEnd", null)]);
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    await waitFor(() => {
      const dot = container.querySelector("[role='status']") as HTMLElement | null;
      expect(dot).not.toBeNull();
      expect(dot!.style.background).toBe("var(--text-muted)");
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
      expect(dot!.style.background).toBe("var(--ctp-red)");
      expect(dot!.getAttribute("aria-label")).toContain("2");
    });
  });

  it("renders nothing related to exit status when terminalId is null (pre-spawn)", () => {
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId={null} />);
    expect(container.querySelector("[role='status']")).toBeNull();
    // And we didn't call the backend — hook respects the null id.
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
