import { describe, expect, it } from "vitest";

import {
  isPhaseActive,
  repairPhaseLabel,
  type RepairPhase,
} from "../shared/types/repair";

describe("repairPhaseLabel", () => {
  const cases: Array<[RepairPhase, string]> = [
    [{ kind: "creatingWorktree" }, "Creating worktree"],
    [{ kind: "runningAgent" }, "AI fixing"],
    [{ kind: "runningTests" }, "Running tests"],
    [{ kind: "succeeded" }, "Succeeded"],
    [{ kind: "failed", message: "tests red" }, "Failed: tests red"],
  ];

  for (const [phase, expected] of cases) {
    it(`labels ${phase.kind} correctly`, () => {
      expect(repairPhaseLabel(phase)).toBe(expected);
    });
  }
});

describe("isPhaseActive", () => {
  it("is true for in-flight phases", () => {
    expect(isPhaseActive({ kind: "creatingWorktree" })).toBe(true);
    expect(isPhaseActive({ kind: "runningAgent" })).toBe(true);
    expect(isPhaseActive({ kind: "runningTests" })).toBe(true);
  });

  it("is false for terminal phases", () => {
    expect(isPhaseActive({ kind: "succeeded" })).toBe(false);
    expect(isPhaseActive({ kind: "failed", message: "x" })).toBe(false);
  });
});
