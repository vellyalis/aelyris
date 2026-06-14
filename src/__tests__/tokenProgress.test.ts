import { describe, expect, it } from "vitest";
import { computeTokenProgress } from "../shared/lib/tokenProgress";

describe("computeTokenProgress", () => {
  it("returns 100 for done and 0 for idle regardless of usage", () => {
    expect(computeTokenProgress("done", 5000, 10_000)).toBe(100);
    expect(computeTokenProgress("idle", 5000, 10_000)).toBe(0);
  });

  it("scales usage to a percent, capped at 99", () => {
    expect(computeTokenProgress("coding", 5000, 10_000)).toBe(50);
    expect(computeTokenProgress("coding", 9999, 10_000)).toBe(99);
    expect(computeTokenProgress("coding", 10_000, 10_000)).toBe(99);
  });

  it("floors a running session with no usage yet at 2", () => {
    expect(computeTokenProgress("coding", 0, 10_000)).toBe(2);
  });
});
