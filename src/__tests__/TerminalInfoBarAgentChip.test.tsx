import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalInfoBar } from "../features/terminal/TerminalInfoBar";

// usePromptMarks / usePtyLag reach for Tauri; mock so they no-op in jsdom.
const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => listenMock(...a) }));

describe("TerminalInfoBar — agent chip", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    invokeMock.mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows a pulsing running chip with the agent model", () => {
    const { container } = render(
      <TerminalInfoBar shell="pwsh" terminalId="t-1" activeAgent={{ model: "sonnet", status: "running" }} />,
    );
    expect(screen.getByText("sonnet")).toBeTruthy();
    const chip = container.querySelector('[data-status="running"]');
    expect(chip).not.toBeNull();
    // A live status dot is rendered alongside the model while running.
    expect(chip?.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("settles to a done chip when the agent finishes", () => {
    const { container } = render(
      <TerminalInfoBar shell="pwsh" terminalId="t-1" activeAgent={{ model: "opus", status: "done" }} />,
    );
    expect(container.querySelector('[data-status="done"]')).not.toBeNull();
  });

  it("renders no agent chip for a plain (non-agent) pane", () => {
    const { container } = render(<TerminalInfoBar shell="pwsh" terminalId="t-1" />);
    expect(container.querySelector("[data-status]")).toBeNull();
  });
});
