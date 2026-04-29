import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InteractiveSessionCard } from "../features/agent-inspector/InteractiveSessionCard";
import type { InteractiveSession } from "../shared/types/interactiveAgent";

const baseSession = (overrides: Partial<InteractiveSession> = {}): InteractiveSession => ({
  id: "interactive-1",
  pty_id: "interactive-1",
  cli: "gemini",
  status: "coding",
  model: "gemini-2.5-pro",
  initial_prompt: "ship it",
  cwd: "C:/repo",
  cost: 0.03,
  tokens_used: 10_000,
  started_at: Math.floor(Date.now() / 1000) - 60,
  ...overrides,
});

describe("InteractiveSessionCard", () => {
  afterEach(() => cleanup());

  it("computes context usage from the model context window instead of a 10k token constant", () => {
    const { container } = render(<InteractiveSessionCard session={baseSession()} />);

    expect(container.textContent).toContain("1%");
    expect(container.textContent).not.toContain("95%");
  });

  it("does not pin model and cost metadata onto the interactive card face", () => {
    const { container } = render(<InteractiveSessionCard session={baseSession()} />);

    expect(container.textContent).not.toContain("gemini-2.5-pro");
    expect(container.textContent).not.toContain("$0.03");
  });
});
