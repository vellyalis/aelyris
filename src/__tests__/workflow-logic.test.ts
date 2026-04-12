import { describe, it, expect } from "vitest";

/**
 * Tests for WorkflowPanel logic extracted from the component.
 * These test the filtering and state management patterns without React.
 */

interface PhaseResult {
  name: string;
  status: "pending" | "running" | "waiting_gate" | "passed" | "failed" | "skipped";
}

interface WorkflowStatus {
  id: string;
  workflow_name: string;
  task_title: string;
  current_phase: number;
  phases: PhaseResult[];
}

const TERMINAL_STATUSES = new Set(["passed", "failed", "skipped"]);

function isFinished(wf: WorkflowStatus): boolean {
  return wf.phases.every((p) => TERMINAL_STATUSES.has(p.status));
}

function filterRunning(workflows: WorkflowStatus[]): WorkflowStatus[] {
  return workflows.filter((wf) => !isFinished(wf));
}

describe("Workflow filtering", () => {
  it("keeps workflows with running phases", () => {
    const wfs: WorkflowStatus[] = [{
      id: "1", workflow_name: "bugfix", task_title: "Fix bug",
      current_phase: 0,
      phases: [
        { name: "reproduce", status: "running" },
        { name: "fix", status: "pending" },
      ],
    }];
    expect(filterRunning(wfs).length).toBe(1);
  });

  it("removes fully completed workflows", () => {
    const wfs: WorkflowStatus[] = [{
      id: "1", workflow_name: "bugfix", task_title: "Fix bug",
      current_phase: 2,
      phases: [
        { name: "reproduce", status: "passed" },
        { name: "fix", status: "passed" },
      ],
    }];
    expect(filterRunning(wfs).length).toBe(0);
  });

  it("removes workflows where all phases are failed/skipped", () => {
    const wfs: WorkflowStatus[] = [{
      id: "1", workflow_name: "bugfix", task_title: "Fix bug",
      current_phase: 0,
      phases: [
        { name: "reproduce", status: "failed" },
        { name: "fix", status: "skipped" },
      ],
    }];
    expect(filterRunning(wfs).length).toBe(0);
  });

  it("keeps workflows with waiting_gate phase", () => {
    const wfs: WorkflowStatus[] = [{
      id: "1", workflow_name: "feature", task_title: "Feature",
      current_phase: 1,
      phases: [
        { name: "implement", status: "passed" },
        { name: "review", status: "waiting_gate" },
      ],
    }];
    expect(filterRunning(wfs).length).toBe(1);
  });

  it("handles mixed list of running and finished", () => {
    const wfs: WorkflowStatus[] = [
      {
        id: "1", workflow_name: "a", task_title: "A",
        current_phase: 2,
        phases: [{ name: "p1", status: "passed" }],
      },
      {
        id: "2", workflow_name: "b", task_title: "B",
        current_phase: 0,
        phases: [{ name: "p1", status: "running" }],
      },
    ];
    const result = filterRunning(wfs);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("2");
  });

  it("handles empty phases (edge case)", () => {
    const wfs: WorkflowStatus[] = [{
      id: "1", workflow_name: "empty", task_title: "Empty",
      current_phase: 0,
      phases: [],
    }];
    // Empty phases = every() returns true = isFinished
    expect(filterRunning(wfs).length).toBe(0);
  });
});
