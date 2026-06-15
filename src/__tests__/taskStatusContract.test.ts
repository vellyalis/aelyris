// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isTaskStatus, isTerminalTaskStatus, TASK_STATUSES } from "../shared/types/taskStatus";

declare const process: { cwd(): string };

function rustTaskStatusNames(): string[] {
  const source = readFileSync(join(process.cwd(), "src-tauri/src/task/status.rs"), "utf8");
  const match = source.match(/TASK_STATUS_NAMES:\s*\[&str;\s*\d+\]\s*=\s*\[([\s\S]*?)\];/);
  if (!match) {
    throw new Error("TASK_STATUS_NAMES not found in Rust task status contract");
  }
  const matches = Array.from(match[1].matchAll(/"([^"]+)"/g)) as RegExpMatchArray[];
  return matches.map((item) => item[1] ?? "");
}

describe("TaskStatus contract", () => {
  it("keeps TS task status names in lockstep with Rust", () => {
    expect(TASK_STATUSES).toEqual(rustTaskStatusNames());
  });

  it("narrows known statuses and rejects unknown", () => {
    expect(isTaskStatus("review")).toBe(true);
    expect(isTaskStatus("merged")).toBe(false);
  });

  it("treats only done/failed as terminal", () => {
    expect(isTerminalTaskStatus("done")).toBe(true);
    expect(isTerminalTaskStatus("failed")).toBe(true);
    expect(isTerminalTaskStatus("review")).toBe(false);
    expect(isTerminalTaskStatus("blocked")).toBe(false);
  });
});
