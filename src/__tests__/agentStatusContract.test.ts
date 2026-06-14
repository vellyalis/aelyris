// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_RUN_STATUSES, normalizeAgentRunStatus } from "../shared/types/agentStatus";

declare const process: { cwd(): string };

function rustStatusNames(): string[] {
  const source = readFileSync(join(process.cwd(), "src-tauri/src/agent/status.rs"), "utf8");
  const match = source.match(/AGENT_RUN_STATUS_NAMES:\s*\[&str;\s*\d+\]\s*=\s*\[([\s\S]*?)\];/);
  if (!match) {
    throw new Error("AGENT_RUN_STATUS_NAMES not found in Rust status contract");
  }
  const matches = Array.from(match[1].matchAll(/"([^"]+)"/g)) as RegExpMatchArray[];
  return matches.map((item) => item[1] ?? "");
}

describe("AgentRunStatus contract", () => {
  it("keeps TS status names in lockstep with Rust", () => {
    expect(AGENT_RUN_STATUSES).toEqual(rustStatusNames());
  });

  it("normalizes legacy frontend statuses during migration", () => {
    expect(normalizeAgentRunStatus("waiting")).toBe("waiting_approval");
    expect(normalizeAgentRunStatus("generating")).toBe("coding");
    expect(normalizeAgentRunStatus("thinking")).toBe("thinking");
    expect(normalizeAgentRunStatus("unknown")).toBeNull();
  });
});
