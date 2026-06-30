import { describe, expect, it } from "vitest";

/**
 * Surface 5 guards: the Kanban launch routes through the shared branch-name
 * validator before any git side-effect, and review cards can mount the inline
 * diff panel for their assigned agent.
 */

const sources = import.meta.glob("../features/kanban/KanbanBoard.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const appSources = import.meta.glob("../App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  return Object.values(sources)[0] ?? "";
}

describe("KanbanBoard branch-name validation", () => {
  it("pre-validates the branch name through the shared validator", () => {
    const src = getSrc();
    expect(src).toMatch(/invoke\(\s*"validate_branch_name"/);
  });

  it("validates before creating the worktree (clean error, no side-effect first)", () => {
    const src = getSrc();
    const validateAt = src.indexOf('"validate_branch_name"');
    const createAt = src.indexOf('"create_worktree"');
    expect(validateAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(createAt);
  });
});

describe("KanbanBoard inline review", () => {
  it("imports and mounts the inline result panel", () => {
    const src = getSrc();
    expect(src).toMatch(/import \{ InlineResultPanel \}/);
    expect(src).toMatch(/<InlineResultPanel/);
  });

  it("accepts a sessions prop and resolves the assigned agent for the panel", () => {
    const src = getSrc();
    expect(src).toMatch(/sessions\?: AgentSession\[\]/);
    expect(src).toMatch(/sessions\?\.find\(\(session\) => session\.id === t\.assignedAgentId\)/);
  });

  it("App passes the fleet sessions down to the board", () => {
    const appSrc = Object.values(appSources)[0] ?? "";
    expect(appSrc).toMatch(/<KanbanBoard[\s\S]*?sessions=\{sessions\}/);
  });
});
