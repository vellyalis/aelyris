import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetHudAgent } from "../features/fleet-hud/useFleetHud";

// Isolate the container: drive it via a mocked hook (the hook is unit-tested
// separately). useTaskGraph is stubbed so no Tauri wiring is needed.
const hud = vi.hoisted(() => ({
  value: {
    agents: [] as FleetHudAgent[],
    summary: { total: 0, running: 0, review: 0, attention: 0 },
    hasAgents: false,
  },
}));
vi.mock("../shared/hooks/useTaskGraph", () => ({ useTaskGraph: () => ({ tasks: [] }) }));
vi.mock("../features/fleet-hud/useFleetHud", () => ({ useFleetHud: () => hud.value }));

import { FleetHud } from "../features/fleet-hud/FleetHud";

function agent(over: Partial<FleetHudAgent>): FleetHudAgent {
  return { taskId: "x", title: "X", model: "sonnet", status: "running", bucket: "running", startedAt: 0, ...over };
}

describe("FleetHud", () => {
  afterEach(() => cleanup());

  it("renders nothing when the fleet is empty", () => {
    hud.value = { agents: [], summary: { total: 0, running: 0, review: 0, attention: 0 }, hasAgents: false };
    const { container } = render(<FleetHud />);
    expect(container.querySelector('[data-testid="fleet-hud"]')).toBeNull();
  });

  it("renders the swarm with header counts and one card per agent", () => {
    hud.value = {
      agents: [
        agent({ taskId: "a", title: "A", bucket: "running", status: "running" }),
        agent({ taskId: "b", title: "B", bucket: "attention", status: "blocked", model: "opus" }),
      ],
      summary: { total: 2, running: 1, review: 0, attention: 1 },
      hasAgents: true,
    };
    render(<FleetHud />);
    expect(screen.getByTestId("fleet-hud")).toBeTruthy();
    expect(screen.getAllByTestId("fleet-hud-card")).toHaveLength(2);
    expect(screen.getByText("2")).toBeTruthy(); // count badge
    expect(screen.getByText("1 running")).toBeTruthy();
    expect(screen.getByText("1 attn")).toBeTruthy();
  });
});
