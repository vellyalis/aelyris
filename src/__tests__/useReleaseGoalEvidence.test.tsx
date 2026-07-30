import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useReleaseGoalEvidence } from "../features/app/useReleaseGoalEvidence";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const ownerSources = import.meta.glob("../features/app/useReleaseGoalEvidence.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => (invokeMock as unknown as InvokeFn)(cmd, args),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function finalAudit(tag: string): string {
  return JSON.stringify({
    goalComplete: false,
    evidenceComplete: false,
    requirements: [{ id: tag, label: tag, status: "proved", detail: "", evidence: [] }],
    missingRequirements: [],
    residualRiskRegister: {
      implementationFixableCount: 0,
      policyBlockedCount: 0,
      externalBlockedCount: 0,
      implementationFixable: [],
      policyBlocked: [],
      externalBlocked: [],
      canContinueWithoutTokenSpend: true,
      completionClaimAllowed: false,
    },
  });
}

function releaseQuality(tag: string): string {
  return JSON.stringify({
    generatedAt: "2026-07-30T00:00:00.000Z",
    releaseCandidateReady: false,
    scores: [{ id: tag, label: tag, points: 0, max: 1 }],
    blockers: [],
  });
}

function safeSummary(): string {
  return JSON.stringify({
    ok: false,
    tokenSpendingPromptExecuted: false,
    steps: [],
    failedSteps: [],
  });
}

function artifactFor(path: string, tag: string): string {
  if (path.endsWith("release-quality-score.json")) return releaseQuality(tag);
  if (path.endsWith("final-goal-audit.json")) return finalAudit(tag);
  if (path.endsWith("final-goal-safe-summary.json")) return safeSummary();
  throw new Error(`unexpected path ${path}`);
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function getOwnerSource(): string {
  const entries = Object.entries(ownerSources);
  expect(entries).toHaveLength(1);
  return entries[0][1].replace(/\r\n/g, "\n");
}

describe("useReleaseGoalEvidence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("owns release, final-audit, and safe-summary parsing and fail-closed polling contracts", () => {
    const owner = getOwnerSource();

    expect(owner).toContain("release-quality-score.json");
    expect(owner).toContain("final-goal-audit.json");
    expect(owner).toContain("final-goal-safe-summary.json");
    expect(owner).toContain("deriveReleaseQualityGoalInputs");
    expect(owner).toContain("parseReleaseQualityReport");
    expect(owner).toContain("deriveFinalGoalResidualRisk");
    expect(owner).toContain("parseFinalGoalAuditReport");
    expect(owner).toContain("deriveFinalGoalRequirementProofs");
    expect(owner).toContain("deriveFinalGoalSafeGate");
    expect(owner).toContain("parseFinalGoalSafeSummaryReport");
    expect(owner).toContain('invoke<string>("read_file", { path })');
    expect(owner).toContain('".codex-auto/quality/release-quality-score.json"');
    expect(owner).toContain('".codex-auto/quality/final-goal-audit.json"');
    expect(owner).toContain('".codex-auto/quality/final-goal-safe-summary.json"');
    expect(owner).toContain("deriveFinalGoalRequirementProofs(null)");
    expect(owner).toContain("const REFRESH_INTERVAL_MS = 60_000");
  });

  it("adopts all three files as one snapshot and fails closed on a partial generation", async () => {
    let partial = false;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args?: Record<string, unknown>) => {
        const path = String(args?.path);
        if (partial && path.endsWith("final-goal-safe-summary.json")) {
          return Promise.reject(new Error("safe summary unavailable"));
        }
        return Promise.resolve(artifactFor(path, "complete-generation"));
      },
    );

    const { result, unmount } = renderHook(() => useReleaseGoalEvidence("C:\\project"));
    await flushPromises();
    expect(result.current.finalGoalRequirementProofs).toEqual([expect.objectContaining({ id: "complete-generation" })]);
    expect(result.current.releaseQualityGoalInputs?.source).toBe("release-quality-score");
    expect(result.current.finalGoalResidualRisk?.source).toBe("final-goal-audit");
    expect(result.current.finalGoalSafeGate?.source).toBe("final-goal-safe-summary");

    partial = true;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await flushPromises();
    expect(result.current.releaseQualityGoalInputs?.source).toBe("unavailable");
    expect(result.current.finalGoalResidualRisk?.source).toBe("unavailable");
    expect(result.current.finalGoalRequirementProofs).toEqual([
      expect.objectContaining({ id: "final-goal-audit-unavailable" }),
    ]);
    expect(result.current.finalGoalSafeGate?.source).toBe("unavailable");
    unmount();
  });

  it("suppresses overlap and rejects the old project generation after a project change", async () => {
    const oldReads = Array.from({ length: 3 }, () => deferred<string>());
    const unmountReads = Array.from({ length: 3 }, () => deferred<string>());
    let oldReadIndex = 0;
    let unmountReadIndex = 0;
    let holdProjectB = false;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args?: Record<string, unknown>) => {
        const path = String(args?.path);
        if (path.startsWith("C:\\project-a")) {
          const pending = oldReads[oldReadIndex];
          oldReadIndex += 1;
          if (!pending) throw new Error("unexpected extra project-a read");
          return pending.promise;
        }
        if (holdProjectB) {
          const pending = unmountReads[unmountReadIndex];
          unmountReadIndex += 1;
          if (!pending) throw new Error("unexpected extra project-b read");
          return pending.promise;
        }
        return Promise.resolve(artifactFor(path, "project-b"));
      },
    );

    const { result, rerender, unmount } = renderHook(
      ({ projectPath }: { projectPath: string }) => useReleaseGoalEvidence(projectPath),
      { initialProps: { projectPath: "C:\\project-a" } },
    );
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(3);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(3);

    rerender({ projectPath: "C:\\project-b" });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(6);
    expect(result.current.finalGoalRequirementProofs).toEqual([expect.objectContaining({ id: "project-b" })]);

    await act(async () => {
      oldReads[0]?.resolve(releaseQuality("project-a"));
      oldReads[1]?.resolve(finalAudit("project-a"));
      oldReads[2]?.resolve(safeSummary());
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(result.current.finalGoalRequirementProofs).toEqual([expect.objectContaining({ id: "project-b" })]);

    holdProjectB = true;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(9);
    unmount();
    await act(async () => {
      unmountReads[0]?.resolve(releaseQuality("after-unmount"));
      unmountReads[1]?.resolve(finalAudit("after-unmount"));
      unmountReads[2]?.resolve(safeSummary());
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(result.current.finalGoalRequirementProofs).toEqual([expect.objectContaining({ id: "project-b" })]);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(9);
  });
});
