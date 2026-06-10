import { describe, expect, it } from "vitest";
import {
  commandHistoryRecordsToCommandBlocks,
  inferCommandValidationKind,
  type NativeCommandBlockRecord,
  nativeCommandBlockRecordsToCommandBlocks,
} from "../shared/lib/commandHistoryGraph";
import type { CommandHistoryRecord } from "../shared/types/history";

function record(overrides: Partial<CommandHistoryRecord>): CommandHistoryRecord {
  return {
    id: 1,
    terminal_id: "pty-a",
    command: "pnpm test",
    cwd: "C:/repo",
    exit_code: 0,
    executed_at: "2026-05-19 10:00:00",
    ...overrides,
  };
}

function nativeRecord(overrides: Partial<NativeCommandBlockRecord>): NativeCommandBlockRecord {
  return {
    id: "history-42",
    terminalId: "pty-a",
    commandHistoryId: 42,
    command: "pnpm test",
    cwd: "C:/repo",
    status: "passed",
    exitCode: 0,
    commandSequence: 1,
    outputSequence: 2,
    endSequence: 3,
    commandHistorySize: 10,
    outputHistorySize: 11,
    endHistorySize: 12,
    commandScreenLine: 4,
    outputScreenLine: 5,
    endScreenLine: 6,
    ...overrides,
  };
}

describe("commandHistoryGraph", () => {
  it("converts validation history into command blocks linked to changed files", () => {
    const blocks = commandHistoryRecordsToCommandBlocks(
      [
        record({
          id: 42,
          command: "pnpm test -- src/App.tsx",
          exit_code: 0,
        }),
      ],
      [
        { path: "src/App.tsx", status: "modified" },
        { path: "src/shared/lib/workstationGraph.ts", status: "modified" },
      ],
      "C:/repo",
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        id: "history-42",
        command: "pnpm test -- src/App.tsx",
        cwd: "C:/repo",
        exitCode: 0,
        status: "passed",
        terminalId: "pty-a",
        filePaths: ["src/App.tsx", "src/shared/lib/workstationGraph.ts"],
        validationKind: "test",
      }),
    ]);
  });

  it("links file-specific non-validation commands only when the path is mentioned", () => {
    const blocks = commandHistoryRecordsToCommandBlocks(
      [
        record({
          id: 7,
          command: "git diff -- src/App.tsx",
          exit_code: null,
        }),
      ],
      [
        { path: "src/App.tsx", status: "modified" },
        { path: "src/Other.tsx", status: "modified" },
      ],
      "C:/repo",
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        id: "history-7",
        status: "unknown",
        filePaths: ["src/App.tsx"],
        validationKind: "unknown",
      }),
    ]);
  });

  it("drops unrelated workspace history instead of poisoning the review queue", () => {
    const blocks = commandHistoryRecordsToCommandBlocks(
      [
        record({ id: 1, cwd: "C:/elsewhere", command: "pnpm test" }),
        record({ id: 2, cwd: "C:/repo", command: "git status" }),
      ],
      [{ path: "src/App.tsx", status: "modified" }],
      "C:/repo",
    );

    expect(blocks).toEqual([]);
  });

  it("classifies common validation commands", () => {
    expect(inferCommandValidationKind("pnpm exec biome check src/App.tsx")).toBe("lint");
    expect(inferCommandValidationKind("pnpm exec tsc --noEmit")).toBe("typecheck");
    expect(inferCommandValidationKind("pnpm build")).toBe("build");
    expect(inferCommandValidationKind("git status")).toBe("unknown");
  });

  it("preserves native command block scrollback anchors for graph metadata", () => {
    const blocks = nativeCommandBlockRecordsToCommandBlocks(
      [nativeRecord({ command: "pnpm exec tsc --noEmit", status: "failed", exitCode: 2 })],
      [{ path: "src/App.tsx", status: "modified" }],
      "C:/repo",
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        id: "history-42",
        terminalId: "pty-a",
        status: "failed",
        exitCode: 2,
        validationKind: "typecheck",
        filePaths: ["src/App.tsx"],
        commandSequence: 1,
        outputSequence: 2,
        endSequence: 3,
        commandHistorySize: 10,
        outputHistorySize: 11,
        endHistorySize: 12,
      }),
    ]);
  });
});
