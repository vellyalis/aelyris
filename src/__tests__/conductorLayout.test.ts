import { describe, expect, it } from "vitest";

import { layoutConductor, COL_WIDTH, ROW_HEIGHT } from "../shared/lib/conductorLayout";
import type { AgentSession } from "../shared/types/agent";
import type { OrchestraRoleId } from "../shared/lib/orchestrator";

function session(
  id: string,
  role: OrchestraRoleId | undefined,
  startedAt: number,
  handoffFrom?: string,
): AgentSession {
  return {
    id,
    name: id,
    status: "coding",
    model: "sonnet",
    prompt: "p",
    startedAt,
    logs: [],
    cost: 0,
    tokensUsed: 0,
    role,
    handoffFrom,
  };
}

describe("layoutConductor", () => {
  it("groups sessions by role into left-to-right columns", () => {
    const layout = layoutConductor([
      session("a", "implementer", 1),
      session("b", "reviewer", 2),
      session("c", "tester", 3),
    ]);
    // Columns visible in order: implementer, tester, reviewer.
    expect(layout.columns.map((c) => c.id)).toEqual([
      "implementer",
      "tester",
      "reviewer",
    ]);
    expect(layout.columns[0].x).toBe(0);
    expect(layout.columns[1].x).toBe(COL_WIDTH);
    expect(layout.columns[2].x).toBe(2 * COL_WIDTH);
  });

  it("sorts within each column by startedAt (oldest first)", () => {
    const layout = layoutConductor([
      session("new", "implementer", 300),
      session("old", "implementer", 100),
      session("mid", "implementer", 200),
    ]);
    const impl = layout.nodes.filter((n) => n.column === "implementer");
    expect(impl.map((n) => n.id)).toEqual(["old", "mid", "new"]);
    expect(impl[0].y).toBe(0);
    expect(impl[1].y).toBe(ROW_HEIGHT);
    expect(impl[2].y).toBe(2 * ROW_HEIGHT);
  });

  it("puts role-less sessions into the ad-hoc column", () => {
    const layout = layoutConductor([
      session("a", undefined, 1),
      session("b", "implementer", 2),
    ]);
    expect(layout.columns.map((c) => c.id)).toEqual([
      "implementer",
      "unassigned",
    ]);
    const ad = layout.nodes.find((n) => n.id === "a");
    expect(ad?.column).toBe("unassigned");
  });

  it("skips empty columns — only used columns get laid out", () => {
    const layout = layoutConductor([
      session("a", "reviewer", 1),
    ]);
    expect(layout.columns).toHaveLength(1);
    expect(layout.columns[0].id).toBe("reviewer");
    expect(layout.columns[0].x).toBe(0);
  });

  it("creates an edge for every handoffFrom pointing to an existing node", () => {
    const layout = layoutConductor([
      session("parent", "implementer", 1),
      session("child", "reviewer", 2, "parent"),
    ]);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].source).toBe("parent");
    expect(layout.edges[0].target).toBe("child");
    expect(layout.edges[0].id).toBe("parent->child");
  });

  it("ignores handoffFrom when the parent is not in the set", () => {
    const layout = layoutConductor([
      session("orphan", "reviewer", 1, "ghost"),
    ]);
    expect(layout.edges).toHaveLength(0);
  });
});
