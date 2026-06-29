import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";
import { dedupePrepend, loadRecentCommands, MAX_RECENT, recordRecentCommand } from "../shared/lib/recentCommands";

function collectFallbackEvents() {
  const events: FallbackTelemetryDetail[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
  };
  window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
  return {
    events,
    cleanup: () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener),
  };
}

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
    localStorage.setItem("aelyris:recentCommands", "not-json");
    expect(loadRecentCommands()).toEqual([]);
  });

  it("filters non-string entries out", () => {
    localStorage.setItem("aelyris:recentCommands", JSON.stringify(["a", 5, null, "b"]));
    expect(loadRecentCommands()).toEqual(["a", "b"]);
  });

  it("records and reads back a command", () => {
    const next = recordRecentCommand("start-agent");
    expect(next).toEqual(["start-agent"]);
    expect(loadRecentCommands()).toEqual(["start-agent"]);
  });

  it("reports persistence failures instead of silently dropping recent commands", () => {
    const telemetry = collectFallbackEvents();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      const next = recordRecentCommand("start-agent");
      expect(next).toEqual(["start-agent"]);
      expect(telemetry.events).toContainEqual(
        expect.objectContaining({
          source: "recent-commands",
          operation: "persist_recent_commands",
          userVisible: true,
        }),
      );
    } finally {
      setItem.mockRestore();
      telemetry.cleanup();
    }
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
