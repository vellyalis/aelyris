import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FleetHudCard } from "../features/fleet-hud/FleetHudCard";
import type { FleetHudAgent } from "../features/fleet-hud/useFleetHud";

function agent(over: Partial<FleetHudAgent> = {}): FleetHudAgent {
  return {
    taskId: "t",
    title: "Build auth",
    model: "sonnet",
    status: "running",
    bucket: "running",
    startedAt: 0,
    ...over,
  };
}

describe("FleetHudCard", () => {
  afterEach(() => cleanup());

  it("renders title, model glyph, status, and mm:ss elapsed", () => {
    render(<FleetHudCard agent={agent({ startedAt: 1000 })} now={1000 + 252_000} />);
    expect(screen.getByText("Build auth")).toBeTruthy();
    expect(screen.getByText("sonnet")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("04:12")).toBeTruthy(); // 252s elapsed
  });

  it("tags the bucket for styling + stable CDP selectors", () => {
    const { container } = render(<FleetHudCard agent={agent({ bucket: "attention", status: "blocked" })} now={0} />);
    const card = container.querySelector('[data-testid="fleet-hud-card"]');
    expect(card?.getAttribute("data-bucket")).toBe("attention");
    expect(card?.getAttribute("data-agent-id")).toBe("t");
    expect(screen.getByText("blocked")).toBeTruthy();
  });
});
