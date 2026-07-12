import { describe, expect, it, vi } from "vitest";
import {
  launchOrchestraPrompts,
  type OrchestraRoutingDecision,
  routeOrchestraPrompts,
} from "../shared/lib/orchestraDispatch";
import type { OrchestraPrompt } from "../shared/lib/orchestrator";

function prompt(overrides: Partial<OrchestraPrompt> = {}): OrchestraPrompt {
  return {
    roleId: "implementer",
    model: "sonnet",
    prompt: "Implement the task",
    branchName: "agent/implementer/task-1",
    ...overrides,
  };
}

function decision(model: string): OrchestraRoutingDecision {
  return {
    recommended_model: model,
    reasoning: "test",
    estimated_cost: 0,
    fallback_model: "claude-sonnet",
    task_type: "CodeGen",
    complexity: "Moderate",
  };
}

describe("routeOrchestraPrompts", () => {
  it("normalizes routed Claude model names", async () => {
    const routed = await routeOrchestraPrompts([prompt()], async () => decision("claude-opus"), true);

    expect(routed[0].model).toBe("opus");
  });

  it("keeps role defaults when routing is disabled or unavailable", async () => {
    await expect(
      routeOrchestraPrompts([prompt({ model: "haiku" })], async () => decision("claude-opus"), false),
    ).resolves.toMatchObject([{ model: "haiku" }]);

    await expect(
      routeOrchestraPrompts(
        [prompt({ model: "sonnet" })],
        async () => {
          throw new Error("router unavailable");
        },
        true,
      ),
    ).resolves.toMatchObject([{ model: "sonnet" }]);
  });
});

describe("launchOrchestraPrompts", () => {
  it("returns a launch per spawned role carrying the pty id to mount as a pane", async () => {
    const start = vi.fn(async () => ({ session_id: "s1", pty_id: "term-1", backend: "native" }));
    const launches = await launchOrchestraPrompts([prompt()], "C:/repo", start);

    expect(launches).toEqual([
      {
        roleId: "implementer",
        model: "sonnet",
        branchName: "agent/implementer/task-1",
        terminalId: "term-1",
        backend: "native",
      },
    ]);
    expect(start).toHaveBeenCalledWith({
      cwd: "C:/repo",
      model: "sonnet",
      initialPrompt: "Implement the task",
      branchName: "agent/implementer/task-1",
    });
  });

  it("drops roles whose spawn produced no pty id", async () => {
    const start = vi.fn(async () => null);
    const launches = await launchOrchestraPrompts([prompt()], "C:/repo", start);
    expect(launches).toEqual([]);
  });
});

describe("App orchestra → central pane wiring", () => {
  const sources = import.meta.glob("../App.tsx", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >;
  const hookSources = import.meta.glob("../features/orchestrator/useOrchestraDispatch.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const paneSpawnSources = import.meta.glob("../features/terminal/usePaneAgentSpawns.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const src = Object.values(sources)[0] ?? "";
  const orchestraHookSrc = Object.values(hookSources)[0] ?? "";
  const paneSpawnHookSrc = Object.values(paneSpawnSources)[0] ?? "";

  it("mounts orchestra launches as central panes instead of discarding a count", () => {
    expect(orchestraHookSrc).toContain("const launches = await launchOrchestraPrompts(");
    expect(orchestraHookSrc).toMatch(/mountAgentPtyInPane\(\s*\n?\s*launches\.map/);
  });

  it("routes the autonomous loop path through the same unified mount (WU-VP-2)", () => {
    expect(src).toContain("usePaneAgentSpawns(activeTabId)");
    expect(paneSpawnHookSrc).toContain("mountAgentPtyInPane(agent)");
    expect(paneSpawnHookSrc).toContain('tauriListen<AgentSpawnedEvent>("agent-event"');
    // The old divergent inline spawn-merge must be gone from the listener.
    expect(paneSpawnHookSrc).not.toContain("agents: [...agents, agent],");
  });
});
