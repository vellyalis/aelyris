import { describe, expect, it } from "vitest";
import { summarizeAgentLane } from "../shared/lib/agentLaneSummary";

describe("summarizeAgentLane", () => {
  it("surfaces attention ahead of live so blocked sessions never hide as live", () => {
    // 3 live includes the 2 that need attention; the headline must lead with attention.
    expect(summarizeAgentLane({ attentionCount: 2, liveCount: 3, totalCount: 5 })).toBe("2 need attention");
  });

  it("uses singular grammar for a single attention session", () => {
    expect(summarizeAgentLane({ attentionCount: 1, liveCount: 1, totalCount: 4 })).toBe("1 needs attention");
  });

  it("falls back to live when nothing needs attention", () => {
    expect(summarizeAgentLane({ attentionCount: 0, liveCount: 2, totalCount: 4 })).toBe("2 live");
  });

  it("reports parked when sessions exist but none are live", () => {
    expect(summarizeAgentLane({ attentionCount: 0, liveCount: 0, totalCount: 3 })).toBe("3 parked");
  });

  it("reports an empty lane when there are no sessions", () => {
    expect(summarizeAgentLane({ attentionCount: 0, liveCount: 0, totalCount: 0 })).toBe("No agents");
  });
});
