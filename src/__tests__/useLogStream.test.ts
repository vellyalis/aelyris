import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLIENT_RING_LIMIT, useLogStream, type Invoke } from "../shared/hooks/useLogStream";
import type { LogEntry } from "../shared/types/logs";

// Real-timer cadence: small enough that tests stay fast, large enough
// that JSDOM/Node timer jitter (~10-20ms) does not race the assertions.
const TEST_POLL_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeEntry(seq: number, partial: Partial<LogEntry> = {}): LogEntry {
  return {
    seq,
    timestamp_ms: 1_700_000_000_000 + seq,
    level: "INFO",
    target: "test::module",
    message: `m${seq}`,
    fields: {},
    ...partial,
  };
}

describe("useLogStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates with logs_recent and reflects ready=true", async () => {
    const invoke = vi.fn(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === "logs_recent") return [makeEntry(1), makeEntry(2)];
      return [];
    }) as unknown as Invoke;

    const { result } = renderHook(() =>
      useLogStream({ invoke, pollMs: 60_000, initialLimit: 50 }),
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });

  it("appends only new entries from logs_since on each tick", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    // The mock honours the cursor: a tick after the cursor passes 4
    // sees an empty delta, so multiple ticks don't double-append the
    // same fixture entries.
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      if (cmd === "logs_recent") return [makeEntry(1), makeEntry(2)];
      if (cmd === "logs_since") {
        const after = Number((args as Record<string, number> | undefined)?.afterSeq ?? 0);
        if (after < 4) return [makeEntry(3), makeEntry(4)];
        return [];
      }
      return [];
    }) as unknown as Invoke;

    const { result } = renderHook(() =>
      useLogStream({ invoke, pollMs: TEST_POLL_MS }),
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    // The polling tick may already have appended {3, 4} by the time
    // we observe `ready=true`, so we only assert the eventual stable
    // state rather than the intermediate (1, 2) snapshot.
    await waitFor(() => expect(result.current.entries.length).toBe(4));
    expect(result.current.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);

    const sinceCall = calls.find((c) => c.cmd === "logs_since");
    expect(sinceCall?.args).toMatchObject({ afterSeq: 2 });
  });

  it("trims the local buffer to CLIENT_RING_LIMIT", async () => {
    let initialSent = false;
    let deltaSent = false;
    const initialBatch = (): LogEntry[] => {
      const out: LogEntry[] = [];
      for (let i = 1; i <= CLIENT_RING_LIMIT; i += 1) out.push(makeEntry(i));
      return out;
    };
    const deltaBatch = (): LogEntry[] => {
      const out: LogEntry[] = [];
      for (let i = 1; i <= 50; i += 1) out.push(makeEntry(CLIENT_RING_LIMIT + i));
      return out;
    };

    // Each batch is delivered exactly once so subsequent waitFor ticks
    // observe a stable buffer instead of unbounded growth.
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "logs_recent") {
        if (initialSent) return [];
        initialSent = true;
        return initialBatch();
      }
      if (cmd === "logs_since") {
        if (deltaSent) return [];
        deltaSent = true;
        return deltaBatch();
      }
      return [];
    }) as unknown as Invoke;

    const { result } = renderHook(() =>
      useLogStream({ invoke, pollMs: TEST_POLL_MS, initialLimit: CLIENT_RING_LIMIT }),
    );

    await waitFor(() => expect(result.current.entries.length).toBe(CLIENT_RING_LIMIT));
    await waitFor(() => {
      const last = result.current.entries[result.current.entries.length - 1];
      expect(last?.seq).toBe(CLIENT_RING_LIMIT + 50);
    });
    expect(result.current.entries.length).toBe(CLIENT_RING_LIMIT);
    // Oldest 50 dropped, newest 50 kept.
    expect(result.current.entries[0]!.seq).toBe(51);
  });

  it("surfaces invoke errors without losing existing entries", async () => {
    let stage: "ok" | "fail" = "ok";
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "logs_recent") return [makeEntry(1)];
      if (cmd === "logs_since") {
        if (stage === "fail") throw new Error("ipc down");
        return [];
      }
      return [];
    }) as unknown as Invoke;

    const { result } = renderHook(() =>
      useLogStream({ invoke, pollMs: TEST_POLL_MS }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entries.length).toBe(1);

    stage = "fail";
    await act(async () => {
      await sleep(TEST_POLL_MS + 30);
    });
    await waitFor(() => expect(result.current.error).toBe("ipc down"));
    // Entries preserved despite the polling failure.
    expect(result.current.entries.length).toBe(1);
  });

  it("stays idle and resets state when enabled is false", async () => {
    const invoke = vi.fn(async () => []) as unknown as Invoke;
    const { result, rerender } = renderHook(
      ({ enabled }) => useLogStream({ invoke, pollMs: TEST_POLL_MS, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    rerender({ enabled: false });
    await waitFor(() => {
      expect(result.current.entries.length).toBe(0);
      expect(result.current.ready).toBe(false);
    });
    // No further calls should land while disabled.
    const callsBefore = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      await sleep(TEST_POLL_MS * 3);
    });
    expect((invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBefore,
    );
  });
});
