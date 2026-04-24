import { describe, expect, it } from "vitest";
import type { KanbanColumnId } from "../shared/types/kanban";
import { KANBAN_COLUMNS, PRIORITY_COLORS } from "../shared/types/kanban";

describe("Kanban column definitions", () => {
  it("has 4 columns in correct order", () => {
    const ids = KANBAN_COLUMNS.map((c) => c.id);
    expect(ids).toEqual(["todo", "in_progress", "review", "done"]);
  });

  it("all columns have color defined", () => {
    for (const col of KANBAN_COLUMNS) {
      expect(col.color).toBeTruthy();
    }
  });
});

describe("Priority colors", () => {
  it("covers all 4 priorities", () => {
    expect(PRIORITY_COLORS.low).toBeTruthy();
    expect(PRIORITY_COLORS.medium).toBeTruthy();
    expect(PRIORITY_COLORS.high).toBeTruthy();
    expect(PRIORITY_COLORS.critical).toBeTruthy();
  });
});

describe("KanbanColumnId exhaustiveness", () => {
  it("review is a valid column", () => {
    const col: KanbanColumnId = "review";
    expect(KANBAN_COLUMNS.find((c) => c.id === col)).toBeDefined();
  });
});
