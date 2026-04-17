import { describe, it, expect, beforeEach } from "vitest";
import { loadRecentCommands, recordRecentCommand, dedupePrepend, MAX_RECENT } from "../shared/lib/recentCommands";

describe("dedupePrepend", () => {
  it("moves an existing id to the front", () => {
    expect(dedupePrepend(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("prepends a new id", () => {
    expect(dedupePrepend(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("returns a single-element array when source is empty", () => {
    expect(dedupePrepend([], "a")).toEqual(["a"]);
  });
});

describe("recentCommands localStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty when nothing stored", () => {
    expect(loadRecentCommands()).toEqual([]);
  });

  it("returns empty when stored value is malformed", () => {
    localStorage.setItem("aether:recentCommands", "not-json");
    expect(loadRecentCommands()).toEqual([]);
  });

  it("filters non-string entries out", () => {
    localStorage.setItem("aether:recentCommands", JSON.stringify(["a", 5, null, "b"]));
    expect(loadRecentCommands()).toEqual(["a", "b"]);
  });

  it("records and reads back a command", () => {
    const next = recordRecentCommand("start-agent");
    expect(next).toEqual(["start-agent"]);
    expect(loadRecentCommands()).toEqual(["start-agent"]);
  });

  it("keeps most-recent-first ordering", () => {
    recordRecentCommand("a");
    recordRecentCommand("b");
    const next = recordRecentCommand("c");
    expect(next).toEqual(["c", "b", "a"]);
  });

  it("deduplicates when re-running the same command", () => {
    recordRecentCommand("a");
    recordRecentCommand("b");
    const next = recordRecentCommand("a");
    expect(next).toEqual(["a", "b"]);
  });

  it("caps the list at MAX_RECENT entries", () => {
    for (let i = 0; i < MAX_RECENT + 4; i++) {
      recordRecentCommand(`cmd-${i}`);
    }
    const stored = loadRecentCommands();
    expect(stored).toHaveLength(MAX_RECENT);
    expect(stored[0]).toBe(`cmd-${MAX_RECENT + 3}`);
  });
});
