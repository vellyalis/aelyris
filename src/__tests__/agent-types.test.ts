import { describe, expect, it } from "vitest";
import type { AgentStatus } from "../shared/types/agent";
import { STATUS_COLORS, STATUS_LABELS } from "../shared/types/agent";

describe("Agent Types", () => {
  const ALL_STATUSES: AgentStatus[] = ["idle", "thinking", "coding", "waiting", "error", "done", "generating"];

  it("STATUS_COLORS covers all statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(typeof STATUS_COLORS[status]).toBe("string");
    }
  });

  it("STATUS_LABELS covers all statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_LABELS[status]).toBeDefined();
      expect(STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("idle is a Tailwind green hex (intentionally distinct from --ctp-green)", () => {
    expect(STATUS_COLORS.idle).toBe("#4ade80");
  });

  it("error resolves to --ctp-red so it tracks theme switches", () => {
    expect(STATUS_COLORS.error).toBe("var(--ctp-red)");
  });
});
