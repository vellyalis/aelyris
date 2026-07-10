import { describe, expect, it } from "vitest";
import { lifecycleFromPtyStreamState } from "../features/terminal/pane-tree/types";

describe("PTY stream state lifecycle merge", () => {
  it.each([
    ["reconnecting", "reconnecting"],
    ["recovered", "live"],
    ["gone", "exited"],
  ] as const)("maps %s to %s", (state, lifecycle) => {
    expect(lifecycleFromPtyStreamState(state)).toBe(lifecycle);
  });
});
