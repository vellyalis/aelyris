import { describe, expect, it } from "vitest";

const inspectorSources = import.meta.glob("../features/agent-inspector/AgentInspector.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const actionSources = import.meta.glob("../shared/hooks/useWorktreeActions.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("agent worktree failure handling", () => {
  it("keeps the create-worktree inline form open when creation returns null", () => {
    const src = Object.values(inspectorSources)[0];

    expect(src).toMatch(/const\s+worktree\s*=\s*await\s+onCreateWorktree/);
    expect(src).toMatch(/if\s*\(\s*!worktree\s*\)\s*return/);
    const createBlock = src.match(
      /const handleCreateWorktree = useCallback\(\s*async[\s\S]*?\[worktreeBranch, onCreateWorktree\]/,
    );
    expect(createBlock).not.toBeNull();
    const block = createBlock?.[0] ?? "";
    expect(block).toMatch(/setWorktreeInputId\(\s*null\s*\)/);
    expect(block.indexOf("if (!worktree) return")).toBeLessThan(block.indexOf("setWorktreeInputId(null)"));
  });

  it("surfaces create/remove worktree failures instead of swallowing them", () => {
    const src = Object.values(actionSources)[0];

    expect(src).toMatch(/toast\.error\(\s*"Worktree creation failed"/);
    expect(src).toMatch(/toast\.error\(\s*"Remove worktree failed"/);
    expect(src).not.toMatch(/catch\s*\{\s*return null;\s*\}/);
    expect(src).not.toMatch(/catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/);
  });
});
