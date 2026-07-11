import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionTrustMeta } from "../features/agent-inspector/SessionTrustMeta";
import type { AgentSession } from "../shared/types/agent";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-1",
    name: "Agent 1",
    model: "codex",
    prompt: "Do the work",
    status: "coding",
    startedAt: Date.now(),
    logs: [],
    tokensUsed: 0,
    cost: 0,
    ...overrides,
  };
}

describe("SessionTrustMeta", () => {
  it("renders no empty ownership or blocker chrome", () => {
    const { container } = render(<SessionTrustMeta session={session()} />);
    expect(container.childElementCount).toBe(0);
  });

  it("renders populated ownership fields and write-set count", () => {
    render(
      <SessionTrustMeta
        session={session({ owner: "sol", workspaceScope: "src/features", writeSet: ["a.ts", "b.ts"] })}
      />,
    );
    expect(screen.getByText("sol · src/features · 2 files write-set")).toBeTruthy();
  });

  it("renders the typed blocker and next actor only when present", () => {
    render(<SessionTrustMeta session={session({ blockedReason: "Approval required", nextActor: "human" })} />);
    expect(screen.getByText("Approval required → human")).toBeTruthy();
  });
});
