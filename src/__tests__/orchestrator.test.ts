import { describe, expect, it } from "vitest";
import {
  buildOrchestraBranchName,
  buildOrchestraPrompts,
  buildOrchestraRunPlan,
  normalizeOrchestraRoutedModel,
  ORCHESTRA_ROLES,
} from "../shared/lib/orchestrator";

describe("ORCHESTRA_ROLES", () => {
  it("has 4 predefined roles", () => {
    expect(ORCHESTRA_ROLES).toHaveLength(4);
  });

  it("each role has required fields", () => {
    for (const role of ORCHESTRA_ROLES) {
      expect(role.id).toBeTruthy();
      expect(role.label).toBeTruthy();
      expect(role.model).toBeTruthy();
      expect(role.lane).toBeTruthy();
      expect(role.mission).toContain(" ");
      expect(role.handoff).toContain(" ");
      expect(role.evidence).toContain(" ");
      expect(role.conflictPolicy).toContain(" ");
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
    expect(result[0].prompt).toContain("Aelyris Orchestra Contract:");
    expect(result[0].prompt).toContain("Worktree branch:");
    expect(result[0].branchName).toMatch(/^agent\/implementer\/add-user-authentication-\d+$/);
    expect(result[0].prompt).toContain("Conflict policy:");
    expect(result[0].prompt).toContain("Expected artifacts:");
    expect(result[0].model).toBe("sonnet");
    expect(result[1].roleId).toBe("tester");
  });

  it("builds branch names that match the Rust worktree validator contract", () => {
    expect(
      buildOrchestraBranchName({
        task: "日本語 + Add auth: phase #1",
        roleId: "tester",
        index: 1,
        existingSessionCount: 2,
      }),
    ).toBe("agent/tester/add-auth-phase-1-4");
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

  it("prepends the backend-rendered ownership context to every role prompt (SSOT, verbatim)", () => {
    const section =
      "[Active symbol ownership — do NOT edit these ranges; another agent owns them]\n" +
      "- @tester owns login in src/auth.rs (lines 10-20, lsp)\n";
    const result = buildOrchestraPrompts({
      task: "Edit auth",
      roles: ["implementer", "tester"],
      projectPath: "/project",
      ownershipContext: { section, claimCount: 1 },
    });
    expect(result).toHaveLength(2);
    for (const p of result) {
      // The backend text is embedded VERBATIM (never re-formatted in TS) ahead of the role.
      expect(p.prompt.startsWith("[Active symbol ownership")).toBe(true);
      expect(p.prompt).toContain("@tester owns login in src/auth.rs (lines 10-20, lsp)");
    }
  });

  it("omits the ownership section when there are no active claims", () => {
    const result = buildOrchestraPrompts({
      task: "Edit auth",
      roles: ["implementer"],
      projectPath: "/project",
      ownershipContext: { section: "", claimCount: 0 },
    });
    expect(result[0].prompt.startsWith("[Active symbol ownership")).toBe(false);
    expect(result[0].prompt).not.toContain("Active symbol ownership");
  });
});

describe("normalizeOrchestraRoutedModel", () => {
  it("normalizes Claude router model names for interactive CLI dispatch", () => {
    expect(normalizeOrchestraRoutedModel("claude-sonnet", "haiku")).toBe("sonnet");
    expect(normalizeOrchestraRoutedModel("claude-opus", "sonnet")).toBe("opus");
    expect(normalizeOrchestraRoutedModel("gemini-2.5-pro", "sonnet")).toBe("gemini-2.5-pro");
    expect(normalizeOrchestraRoutedModel("   ", "sonnet")).toBe("sonnet");
  });
});

describe("buildOrchestraRunPlan", () => {
  it("creates a parallel lane plan with handoff and evidence contracts", () => {
    const plan = buildOrchestraRunPlan({
      task: "Add command center queue",
      roles: ["implementer", "tester", "reviewer"],
      projectPath: "C:/repo",
      changedFiles: ["src/App.tsx"],
    });

    expect(plan.mode).toBe("parallel-lanes");
    expect(plan.laneCount).toBe(3);
    expect(plan.dispatchOrder).toEqual(["implementer", "tester", "reviewer"]);
    expect(plan.conflictPolicy).toContain("Review existing edits first");
    expect(plan.worktreePolicy).toContain("one pane or worktree per role");
    expect(plan.handoffContract).toContain("Commands run and result");
    expect(plan.expectedArtifacts).toContain("per-lane handoff summary");
    expect(plan.contextPack).toMatchObject({
      changedFileCount: 1,
      pendingDecisionCount: 0,
    });
  });

  it("deduplicates unknown and repeated roles", () => {
    const plan = buildOrchestraRunPlan({
      task: "Review",
      roles: ["reviewer", "reviewer", "missing"],
      projectPath: "C:/repo",
    });

    expect(plan.selectedRoles).toHaveLength(1);
    expect(plan.selectedRoles[0].roleId).toBe("reviewer");
    expect(plan.mode).toBe("review-first");
  });

  it("warns before dispatching into active decision gates", () => {
    const plan = buildOrchestraRunPlan({
      task: "",
      roles: [],
      projectPath: "C:/repo",
      pendingDecisionCount: 2,
      existingSessionCount: 7,
    });

    expect(plan.mode).toBe("review-first");
    expect(plan.warnings).toEqual([
      "Select at least one known orchestra role before dispatch.",
      "Add a concrete objective before launching agents.",
      "Resolve pending decision gates before starting new write-heavy lanes.",
      "Many sessions are already active; prefer review or handoff before spawning more agents.",
    ]);
  });
});
