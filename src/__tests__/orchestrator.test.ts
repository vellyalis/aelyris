import { describe, it, expect } from "vitest";
import { ORCHESTRA_ROLES, buildOrchestraPrompts } from "../shared/lib/orchestrator";

describe("ORCHESTRA_ROLES", () => {
  it("has 4 predefined roles", () => {
    expect(ORCHESTRA_ROLES).toHaveLength(4);
  });

  it("each role has required fields", () => {
    for (const role of ORCHESTRA_ROLES) {
      expect(role.id).toBeTruthy();
      expect(role.label).toBeTruthy();
      expect(role.model).toBeTruthy();
      expect(role.promptTemplate).toContain("{task}");
    }
  });

  it("has unique IDs", () => {
    const ids = ORCHESTRA_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildOrchestraPrompts", () => {
  it("builds prompts for selected roles", () => {
    const result = buildOrchestraPrompts({
      task: "Add user authentication",
      roles: ["implementer", "tester"],
      projectPath: "/project",
    });

    expect(result).toHaveLength(2);
    expect(result[0].roleId).toBe("implementer");
    expect(result[0].prompt).toContain("Add user authentication");
    expect(result[0].model).toBe("sonnet");
    expect(result[1].roleId).toBe("tester");
  });

  it("skips unknown role IDs", () => {
    const result = buildOrchestraPrompts({
      task: "test",
      roles: ["implementer", "nonexistent"],
      projectPath: "/project",
    });
    expect(result).toHaveLength(1);
  });

  it("returns empty for no roles", () => {
    const result = buildOrchestraPrompts({
      task: "test",
      roles: [],
      projectPath: "/project",
    });
    expect(result).toHaveLength(0);
  });

  it("reviewer uses opus model", () => {
    const result = buildOrchestraPrompts({
      task: "Review security",
      roles: ["reviewer"],
      projectPath: "/project",
    });
    expect(result[0].model).toBe("opus");
  });

  it("replaces {task} placeholder in prompt", () => {
    const result = buildOrchestraPrompts({
      task: "Refactor the database layer",
      roles: ["documenter"],
      projectPath: "/project",
    });
    expect(result[0].prompt).toContain("Refactor the database layer");
    expect(result[0].prompt).not.toContain("{task}");
  });
});
