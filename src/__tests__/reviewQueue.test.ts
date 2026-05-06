import { describe, expect, it } from "vitest";
import { buildReviewQueue } from "../shared/lib/reviewQueue";
import type { AgentSession } from "../shared/types/agent";

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1,
    logs: [],
    cost: 0,
    tokensUsed: 0,
    changedFileDetails: [],
    ...overrides,
  };
}

describe("buildReviewQueue", () => {
  it("prioritizes files touched by multiple agents as critical conflicts", () => {
    const queue = buildReviewQueue(
      [
        session("a", {
          name: "Implementer",
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 1 }],
        }),
        session("b", {
          name: "Reviewer",
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 2 }],
        }),
      ],
      [{ path: "src/App.tsx", status: "modified" }],
    );

    expect(queue.conflictCount).toBe(1);
    expect(queue.highRiskCount).toBe(1);
    expect(queue.items[0]).toMatchObject({
      path: "src/App.tsx",
      risk: "critical",
      conflict: true,
      reason: "Multi-agent overlap",
    });
    expect(queue.items[0]?.sessions.map((s) => s.name)).toEqual(["Implementer", "Reviewer"]);
  });

  it("marks platform and security files as high risk", () => {
    const queue = buildReviewQueue(
      [],
      [
        { path: "src-tauri/Cargo.toml", status: "modified" },
        { path: "vite.config.ts", status: "modified" },
        { path: ".env.local", status: "modified" },
        { path: "docs/readme.md", status: "modified" },
      ],
    );

    expect(queue.highRiskCount).toBe(3);
    expect(queue.items.map((item) => item.reason)).toContain("Dependency/config");
    expect(queue.items.map((item) => item.reason)).toContain("Platform/config");
    expect(queue.items.map((item) => item.reason)).toContain("Security-sensitive");
  });

  it("scores diffstat, coverage, validation, generated, binary, and merge readiness", () => {
    const queue = buildReviewQueue(
      [
        session("author", {
          owner: "codex",
          changedFileDetails: [{ path: "src/shared/lib/reviewQueue.ts", action: "edit", toolName: "Edit", timestamp: 4 }],
          logs: [{ timestamp: 5, type: "tool_result", content: "vitest reviewQueue.test.ts passed", metadata: { toolName: "vitest" } }],
        }),
      ],
      [
        { path: "src/shared/lib/reviewQueue.ts", status: "modified", additions: 140, deletions: 12 },
        { path: "src/__tests__/reviewQueue.test.ts", status: "modified", additions: 12, deletions: 0 },
        { path: "src-tauri/icons/icon.png", status: "modified", binary: true },
        { path: "src/generated/schema.generated.ts", status: "modified", generated: true, validation: "missing" },
      ],
    );

    const source = queue.items.find((item) => item.path === "src/shared/lib/reviewQueue.ts");
    expect(source).toMatchObject({
      coverage: "covered",
      validation: "passed",
      mergeReadiness: "ready",
      agentAuthors: ["codex"],
    });
    expect(source?.diffstat).toEqual({ additions: 140, deletions: 12, total: 152, binary: false });
    expect(source?.scoreBreakdown.diffstat).toBeGreaterThan(0);

    const binary = queue.items.find((item) => item.path === "src-tauri/icons/icon.png");
    expect(binary).toMatchObject({
      riskClass: "binary",
      coverage: "not_required",
      mergeReadiness: "needs_review",
    });

    const generated = queue.items.find((item) => item.path === "src/generated/schema.generated.ts");
    expect(generated).toMatchObject({
      generated: true,
      riskClass: "generated",
      mergeReadiness: "needs_validation",
    });
    expect(queue.needsValidationCount).toBe(1);
  });

  it("blocks merge readiness for explicit conflicts and failed validation", () => {
    const queue = buildReviewQueue(
      [
        session("reviewer", {
          changedFileDetails: [{ path: "src/security/auth.ts", action: "edit", toolName: "Edit", timestamp: 2 }],
          logs: [{ timestamp: 3, type: "tool_result", content: "cargo test failed", metadata: { toolName: "cargo" } }],
        }),
      ],
      [{ path: "src/security/auth.ts", status: "conflicted", conflicted: true, additions: 8, deletions: 2 }],
    );

    expect(queue.mergeReadiness).toBe("blocked");
    expect(queue.blockedCount).toBe(1);
    expect(queue.items[0]).toMatchObject({
      risk: "critical",
      validation: "failed",
      mergeReadiness: "blocked",
    });
  });
});
