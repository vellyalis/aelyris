import { describe, expect, it } from "vitest";
import { buildAuditTraceSummary } from "../shared/lib/auditTrace";
import type { AuditEventRecord } from "../shared/types/audit";

function event(id: number, overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id,
    timestamp: `2026-05-01T12:0${id}:00.000Z`,
    category: "terminal",
    action: "write",
    severity: "info",
    entityType: "terminal",
    entityId: "term-1",
    summary: "Audit event",
    metadata: { correlationId: "terminal:terminal:term-1" },
    ...overrides,
  };
}

describe("buildAuditTraceSummary", () => {
  it("marks a trace as needing verification when risk has no stabilizing follow-up", () => {
    const summary = buildAuditTraceSummary(
      [event(2, { action: "send_keys_failed", severity: "warn" }), event(1, { action: "write", severity: "info" })],
      "terminal:terminal:term-1",
    );

    expect(summary.status).toBe("active-risk");
    expect(summary.label).toBe("Active risk");
    expect(summary.eventCount).toBe(2);
    expect(summary.riskCount).toBe(1);
    expect(summary.recoverableCount).toBe(1);
  });

  it("marks a trace as verified when a stabilizing action follows the latest risk", () => {
    const summary = buildAuditTraceSummary(
      [
        event(3, { action: "force_restart", severity: "info" }),
        event(2, { action: "send_keys_failed", severity: "warn" }),
        event(1, { action: "write", severity: "info" }),
      ],
      "terminal:terminal:term-1",
    );

    expect(summary.status).toBe("verified");
    expect(summary.label).toBe("Verified");
    expect(summary.latestTimestamp).toBe("2026-05-01T12:03:00.000Z");
  });

  it("ignores unrelated traces", () => {
    const summary = buildAuditTraceSummary(
      [
        event(2, {
          action: "force_restart",
          severity: "info",
          metadata: { correlationId: "terminal:terminal:term-2" },
        }),
        event(1, { action: "write", severity: "info" }),
      ],
      "terminal:terminal:term-1",
    );

    expect(summary.status).toBe("clean");
    expect(summary.eventCount).toBe(1);
  });
});
