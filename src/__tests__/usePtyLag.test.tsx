import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type LagEventPayload, usePtyLag } from "../shared/hooks/usePtyLag";

// Long enough to absorb JSDOM/Node setTimeout jitter (~10-20ms is common)
// without making the suite slow — every test sleeps at most ~150ms.
const TEST_DECAY_MS = 120;

interface ProbeProps {
  terminalId: string | null;
  subscribe: (terminalId: string, onEvent: (p: LagEventPayload) => void) => Promise<() => void>;
  onState: (state: ReturnType<typeof usePtyLag>) => void;
}

function Probe({ terminalId, subscribe, onState }: ProbeProps) {
  const state = usePtyLag(terminalId, subscribe, TEST_DECAY_MS);
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("usePtyLag", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns the inactive state by default", async () => {
    const subscribe = vi.fn(async () => () => {});
    const states: ReturnType<typeof usePtyLag>[] = [];
    render(<Probe terminalId={"t-1"} subscribe={subscribe} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith("t-1", expect.any(Function)));
    expect(states.at(-1)).toEqual({ dropped: 0, active: false });
  });

  it("flips to active and accumulates dropped counts on lag events", async () => {
    let emit: ((p: LagEventPayload) => void) | null = null;
    const subscribe = vi.fn(async (_id: string, cb: (p: LagEventPayload) => void) => {
      emit = cb;
      return () => {};
    });
    const states: ReturnType<typeof usePtyLag>[] = [];
    render(<Probe terminalId={"t-1"} subscribe={subscribe} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(emit).not.toBeNull());

    await act(async () => {
      emit?.({ dropped: 100 });
    });
    await act(async () => {
      emit?.({ dropped: 50 });
    });
    expect(states.at(-1)).toEqual({ dropped: 150, active: true });
  });

  it("decays back to inactive after the decay window of silence", async () => {
    let emit: ((p: LagEventPayload) => void) | null = null;
    const subscribe = vi.fn(async (_id: string, cb: (p: LagEventPayload) => void) => {
      emit = cb;
      return () => {};
    });
    const states: ReturnType<typeof usePtyLag>[] = [];
    render(<Probe terminalId={"t-1"} subscribe={subscribe} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(emit).not.toBeNull());

    await act(async () => {
      emit?.({ dropped: 10 });
    });
    expect(states.at(-1)?.active).toBe(true);

    await act(async () => {
      await sleep(TEST_DECAY_MS + 30);
    });
    await waitFor(() => expect(states.at(-1)?.active).toBe(false));
    expect(states.at(-1)).toEqual({ dropped: 0, active: false });
  });

  it("decay timer resets on each subsequent event", async () => {
    vi.useFakeTimers();
    let emit: ((p: LagEventPayload) => void) | null = null;
    const subscribe = vi.fn(async (_id: string, cb: (p: LagEventPayload) => void) => {
      emit = cb;
      return () => {};
    });
    const states: ReturnType<typeof usePtyLag>[] = [];
    render(<Probe terminalId={"t-1"} subscribe={subscribe} onState={(s) => states.push(s)} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(emit).not.toBeNull();

    try {
      await act(async () => {
        emit?.({ dropped: 5 });
      });
      await act(async () => {
        vi.advanceTimersByTime(Math.floor(TEST_DECAY_MS * 0.6));
      });
      await act(async () => {
        emit?.({ dropped: 5 });
      });

      expect(states.at(-1)).toEqual({ dropped: 10, active: true });

      await act(async () => {
        vi.advanceTimersByTime(TEST_DECAY_MS - 1);
      });
      expect(states.at(-1)).toEqual({ dropped: 10, active: true });

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(states.at(-1)).toEqual({ dropped: 0, active: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores negative dropped values defensively", async () => {
    let emit: ((p: LagEventPayload) => void) | null = null;
    const subscribe = vi.fn(async (_id: string, cb: (p: LagEventPayload) => void) => {
      emit = cb;
      return () => {};
    });
    const states: ReturnType<typeof usePtyLag>[] = [];
    render(<Probe terminalId={"t-1"} subscribe={subscribe} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(emit).not.toBeNull());

    await act(async () => {
      emit?.({ dropped: -1 as unknown as number });
    });
    expect(states.at(-1)).toEqual({ dropped: 0, active: true });
  });

  it("does not subscribe when terminalId is null", async () => {
    const subscribe = vi.fn(async () => () => {});
    render(<Probe terminalId={null} subscribe={subscribe} onState={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(subscribe).not.toHaveBeenCalled();
  });
});
