import { describe, expect, it } from "vitest";

import {
  buildOrchestraPrompts,
  buildOrchestraRunPlan,
  detectFileConflicts,
  getRole,
  ORCHESTRA_ROLES,
} from "../shared/lib/orchestrator";

describe("ORCHESTRA_ROLES", () => {
  it("exposes 4 distinct ids with icon + color", () => {
    const ids = ORCHESTRA_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
    for (const role of ORCHESTRA_ROLES) {
      expect(role.icon.length).toBeGreaterThan(0);
      expect(role.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(role.lane).toMatch(/^(build|verify|review|docs)$/);
      expect(role.mission.length).toBeGreaterThan(20);
      expect(role.handoff.length).toBeGreaterThan(20);
      expect(role.promptTemplate).toContain("{task}");
    }
  });
});

describe("getRole", () => {
  it("returns the role for a known id", () => {
    const r = getRole("tester");
    expect(r?.label).toBe("Tester");
  });

  it("returns undefined for unknown / nullish", () => {
    expect(getRole(undefined)).toBeUndefined();
    expect(getRole(null)).toBeUndefined();
  });
});

describe("buildOrchestraPrompts", () => {
  it("substitutes the task and keeps the role model", () => {
    const out = buildOrchestraPrompts({
      task: "add login",
      roles: ["implementer", "reviewer"],
      projectPath: "/p",
    });
    expect(out).toHaveLength(2);
    expect(out[0].roleId).toBe("implementer");
    expect(out[0].model).toBe("sonnet");
    expect(out[0].prompt).toContain("add login");
    expect(out[0].prompt).toContain("Aether Orchestra Contract:");
    expect(out[0].prompt).toContain("Handoff:");
    expect(out[1].roleId).toBe("reviewer");
    expect(out[1].model).toBe("opus");
  });

  it("filters unknown role ids silently", () => {
    const out = buildOrchestraPrompts({
      task: "t",
      roles: ["implementer", "bogus" as never],
      projectPath: "/p",
    });
    expect(out).toHaveLength(1);
    expect(out[0].roleId).toBe("implementer");
  });
});

describe("buildOrchestraRunPlan", () => {
  it("turns selected roles into lane-aware dispatch metadata", () => {
    const plan = buildOrchestraRunPlan({
      task: "ship agent team mode",
      roles: ["implementer", "tester", "reviewer", "documenter"],
      projectPath: "C:/repo",
      changedFiles: ["src/shared/lib/orchestrator.ts", "src/App.tsx"],
    });

    expect(plan.mode).toBe("parallel-lanes");
    expect(plan.laneCount).toBe(4);
    expect(plan.selectedRoles.map((role) => role.lane)).toEqual(["build", "verify", "review", "docs"]);
    expect(plan.contextPack.include).toContain("src/App.tsx");
    expect(plan.contextPack.exclude).toContain("src-tauri/target");
    expect(plan.expectedArtifacts).toContain("conflict notes before shared-file edits");
  });
});

describe("detectFileConflicts", () => {
  const base = (id: string, paths: string[]) => ({
    id,
    changedFileDetails: paths.map((path) => ({ path })),
  });

  it("flags paths touched by more than one session", () => {
    const conflicts = detectFileConflicts([
      base("a", ["src/api.ts", "src/util.ts"]),
      base("b", ["src/api.ts"]),
      base("c", ["README.md"]),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].path).toBe("src/api.ts");
    expect(conflicts[0].sessionIds).toEqual(["a", "b"]);
  });

  it("returns empty when no overlap", () => {
    const conflicts = detectFileConflicts([base("a", ["x"]), base("b", ["y"])]);
    expect(conflicts).toEqual([]);
  });

  it("ignores sessions without changedFileDetails", () => {
    const conflicts = detectFileConflicts([{ id: "a" }, { id: "b", changedFileDetails: [{ path: "shared" }] }]);
    expect(conflicts).toEqual([]);
  });

  it("deduplicates sessions editing the same path twice", () => {
    const conflicts = detectFileConflicts([base("a", ["same", "same"]), base("b", ["same"])]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sessionIds).toEqual(["a", "b"]);
  });

  it("orders conflicts alphabetically by path", () => {
    const conflicts = detectFileConflicts([base("a", ["z", "a"]), base("b", ["z", "a"])]);
    expect(conflicts.map((c) => c.path)).toEqual(["a", "z"]);
  });
});
