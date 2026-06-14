import { describe, expect, it } from "vitest";

import type { TerminalPaneTarget } from "../shared/types/terminalPane";
import { buildReliabilityReport } from "../shared/lib/reliabilityReport";
import type { AuditEventRecord } from "../shared/types/audit";

function pane(overrides: Partial<TerminalPaneTarget> = {}): TerminalPaneTarget {
  return {
    paneId: "pane-a",
    terminalId: "pty-a",
    index: 0,
    shell: "powershell",
    cwd: "C:/Users/owner/Aether_Terminal",
    title: "PowerShell",
    role: "build",
    tabId: "tab-a",
    tabLabel: "Aether",
    tabShell: "powershell",
    tabCwd: "C:/Users/owner/Aether_Terminal",
    ...overrides,
  };
}

function auditEvent(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id: 1,
    timestamp: "2026-05-01T12:00:00.000Z",
    category: "terminal",
    action: "send_keys_failed",
    severity: "warn",
    entityType: "terminal",
    entityId: "pty-a",
    summary: "Failed to send keys",
    metadata: { bytes: 128 },
    ...overrides,
  };
}

describe("buildReliabilityReport", () => {
  it("uses shared recovery hints for terminal incidents", () => {
    const report = buildReliabilityReport({
      sessions: [],
      panes: [pane()],
      changedFilesCount: 0,
      auditEvents: [auditEvent()],
    });

    expect(report.incidents[0]).toMatchObject({
      action: "send_keys_failed",
      recovery: expect.objectContaining({
        kind: "restart-pane",
        label: "Restart pane",
      }),
      correlationId: null,
      pane: expect.objectContaining({ paneId: "pane-a" }),
    });
  });

  it("carries audit correlation ids into incidents", () => {
    const report = buildReliabilityReport({
      sessions: [],
      panes: [pane()],
      changedFilesCount: 0,
      auditEvents: [auditEvent({ metadata: { correlationId: "terminal:terminal:pty-a" } })],
    });

    expect(report.incidents[0]?.correlationId).toBe("terminal:terminal:pty-a");
  });

  it("routes role and target failures to inspection instead of restart", () => {
    const report = buildReliabilityReport({
      sessions: [],
      panes: [pane({ role: "review" })],
      changedFilesCount: 0,
      auditEvents: [
        auditEvent({
          action: "send_to_role_no_pane",
          entityId: "review",
          severity: "error",
        }),
      ],
    });

    expect(report.incidents[0]?.recovery).toMatchObject({
      kind: "inspect-target",
      label: "Inspect target",
    });
  });

  it("downgrades the input path guardrail when terminal input fails", () => {
    const report = buildReliabilityReport({
      sessions: [],
      panes: [pane()],
      changedFilesCount: 0,
      auditEvents: [auditEvent({ action: "ime_composition_failed", severity: "error" })],
    });

    expect(report.guardrails.find((guardrail) => guardrail.id === "input")).toMatchObject({
      detail: "1 input fault",
      state: "risk",
    });
    expect(report.tone).not.toBe("good");
  });

  it("keeps unrelated terminal warnings out of the input path guardrail", () => {
    const report = buildReliabilityReport({
      sessions: [],
      panes: [pane()],
      changedFilesCount: 0,
      auditEvents: [auditEvent({ action: "command_recorded", severity: "warn" })],
    });

    expect(report.guardrails.find((guardrail) => guardrail.id === "input")).toMatchObject({
      detail: "IME composition guarded",
      state: "ok",
    });
  });

  it("keeps non-recoverable audit records informational", () => {
    const report = buildReliabilityReport({
      sessions: [],
      panes: [pane()],
      changedFilesCount: 0,
      auditEvents: [
        auditEvent({
          action: "command_recorded",
          severity: "warn",
          entityId: undefined,
        }),
      ],
    });

    expect(report.incidents[0]?.recovery).toMatchObject({
      kind: "none",
      recoverable: false,
    });
  });

  it("does not count cleanup-only or detached panes as controllable", () => {
    const report = buildReliabilityReport({
      sessions: [],
      panes: [
        pane({ paneId: "pane-live", terminalId: "pty-live", lifecycle: "live" }),
        pane({ paneId: "pane-orphan", terminalId: "pty-orphan", lifecycle: "orphaned" }),
        pane({ paneId: "pane-detached", terminalId: "pty-detached", lifecycle: "detached" }),
        pane({ paneId: "pane-exited", terminalId: "pty-exited", lifecycle: "exited" }),
      ],
      changedFilesCount: 0,
      auditEvents: [],
    });

    expect(report.guardrails.find((guardrail) => guardrail.id === "process")).toMatchObject({
      detail: "1 controllable pane",
      state: "ok",
    });
  });
});
