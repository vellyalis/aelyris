import { describe, expect, it } from "vitest";
import {
  deriveAuditRecoveryHint,
  formatAuditMetadataSummary,
  getAuditCorrelationId,
} from "../shared/lib/auditRecovery";

describe("deriveAuditRecoveryHint", () => {
  it("classifies terminal write failures as pane restart candidates", () => {
    expect(
      deriveAuditRecoveryHint({
        category: "terminal",
        action: "send_keys_failed",
        severity: "warn",
        metadata: { error: "writer unavailable" },
      }),
    ).toMatchObject({
      kind: "restart-pane",
      recoverable: true,
      label: "Restart pane",
    });
  });

  it("classifies target routing failures before generic restart recovery", () => {
    expect(
      deriveAuditRecoveryHint({
        category: "terminal",
        action: "send_keys_by_role_failed",
        severity: "error",
        metadata: { error: "No pane with role reviewer" },
      }),
    ).toMatchObject({
      kind: "inspect-target",
      recoverable: true,
    });
  });

  it("keeps routine successful events non-recoverable", () => {
    expect(
      deriveAuditRecoveryHint({
        category: "terminal",
        action: "write",
        severity: "info",
        metadata: { redacted: true },
      }),
    ).toMatchObject({
      kind: "none",
      recoverable: false,
    });
  });
});

describe("formatAuditMetadataSummary", () => {
  it("keeps metadata summaries redacted and allowlisted", () => {
    expect(
      formatAuditMetadataSummary({
        content: "secret command",
        correlationId: "terminal:terminal:term-1",
        error: "writer unavailable",
        redacted: true,
      }),
    ).toBe("error:writer unavailable · trace:terminal:terminal:term-1 · redacted:yes");
  });
});

describe("getAuditCorrelationId", () => {
  it("returns a trimmed non-empty correlation id", () => {
    expect(getAuditCorrelationId({ correlationId: " terminal:terminal:term-1 " })).toBe("terminal:terminal:term-1");
    expect(getAuditCorrelationId({ correlationId: " " })).toBeNull();
    expect(getAuditCorrelationId({ correlationId: 12 })).toBeNull();
  });
});
