import { describe, expect, it } from "vitest";
import {
  commandFromWatchdogTool,
  createApprovalReplayRecord,
  parseWatchdogDecision,
  replayApprovalRecord,
  watchdogDecisionToLog,
} from "../shared/lib/watchdogDecision";

describe("watchdogDecision", () => {
  it("parses backend decision payloads", () => {
    expect(parseWatchdogDecision('{"decision":"approved","tool":"Read","rule":"Read"}')).toEqual({
      decision: "approved",
      tool: "Read",
      rule: "Read",
    });
  });

  it("rejects malformed or incomplete payloads", () => {
    expect(parseWatchdogDecision("{nope")).toBeNull();
    expect(parseWatchdogDecision('{"decision":"approved","tool":""}')).toBeNull();
    expect(parseWatchdogDecision('{"decision":"unknown","tool":"Bash"}')).toBeNull();
  });

  it("rejects non-serializable payloads without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(parseWatchdogDecision(1n)).toBeNull();
    expect(parseWatchdogDecision(circular)).toBeNull();
  });

  it("formats manual approval as structured system activity", () => {
    const log = watchdogDecisionToLog({ decision: "manual", tool: "Bash" }, 123);

    expect(log).toMatchObject({
      timestamp: 123,
      type: "system",
      content: "Needs manual approval: Bash",
      metadata: {
        event: "watchdog_decision",
        toolName: "Bash",
        decision: "manual",
        approvalReplayKey: expect.stringMatching(/^fnv1a32:/),
      },
    });
  });

  it("formats denied decisions as error activity", () => {
    const log = watchdogDecisionToLog({ decision: "denied", tool: "Bash", rule: "Bash(rm*)" }, 123);

    expect(log.type).toBe("error");
    expect(log.content).toBe("Auto-denied: Bash via Bash(rm*)");
  });

  it("extracts shell commands from watchdog tool labels", () => {
    expect(commandFromWatchdogTool("Bash(git status --short)")).toBe("git status --short");
    expect(commandFromWatchdogTool("Read")).toBe("Read");
  });

  it("creates redacted replayable approval records", () => {
    const record = createApprovalReplayRecord(
      { decision: "approved", tool: "Bash(curl https://api.test --token=secret-value)", rule: "Bash(curl*)" },
      456,
    );

    expect(record.id).toMatch(/^approval-456-/);
    expect(record.commandPreview).toContain("[REDACTED]");
    expect(record.commandPreview).not.toContain("secret-value");
    expect(record.riskClasses).toContain("network");
    expect(record.requiresApproval).toBe(true);
  });

  it("replays approvals only when command, decision, and risk match", () => {
    const event = { decision: "denied" as const, tool: "Bash(rm -rf /tmp/build)", rule: "Bash(rm*)" };
    const record = createApprovalReplayRecord(event, 789);

    expect(replayApprovalRecord(record, event)).toMatchObject({
      matched: true,
      decision: "denied",
    });
    expect(replayApprovalRecord(record, { ...event, tool: "Bash(git status)" })).toMatchObject({
      matched: false,
      reason: "command hash mismatch",
    });
  });
});
