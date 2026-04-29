import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogsPanel } from "../features/logs/LogsPanel";
import type { Invoke } from "../shared/hooks/useLogStream";
import type { LogEntry } from "../shared/types/logs";

// Real-timer cadence — see useLogStream.test.ts for rationale.
const TEST_POLL_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function entry(seq: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    seq,
    timestamp_ms: 1_700_000_000_000 + seq,
    level: "INFO",
    target: "aether::test",
    message: `m${seq}`,
    fields: {},
    ...overrides,
  };
}

describe("LogsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders collapsed by default and skips IPC calls", async () => {
    const invoke = vi.fn(async () => []) as unknown as Invoke;
    render(<LogsPanel invoke={invoke} pollMs={TEST_POLL_MS} />);
    await act(async () => {
      await sleep(TEST_POLL_MS * 3);
    });
    expect((invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("shows hydrated entries and the count meta", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "logs_recent") {
        return [
          entry(1, { level: "INFO", message: "hello" }),
          entry(2, { level: "WARN", message: "watch out" }),
        ];
      }
      return [];
    }) as unknown as Invoke;

    render(<LogsPanel invoke={invoke} pollMs={60_000} defaultCollapsed={false} />);

    await waitFor(() => expect(screen.getByText("hello")).toBeTruthy());
    expect(screen.getByText("watch out")).toBeTruthy();
    expect(screen.getByTestId("log-row-2").getAttribute("data-level")).toBe("WARN");
    expect(screen.getByText("2/2")).toBeTruthy();
  });

  it("filters by minimum level when a higher level button is selected", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "logs_recent") {
        return [
          entry(1, { level: "INFO", message: "informational" }),
          entry(2, { level: "WARN", message: "warning" }),
          entry(3, { level: "ERROR", message: "boom" }),
        ];
      }
      return [];
    }) as unknown as Invoke;

    render(<LogsPanel invoke={invoke} pollMs={60_000} defaultCollapsed={false} />);

    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());

    const errorBtn = screen.getByRole("button", { name: "ERROR" });
    fireEvent.click(errorBtn);
    expect(screen.queryByText("informational")).toBeNull();
    expect(screen.queryByText("warning")).toBeNull();
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("clear hides current entries until new ones arrive", async () => {
    const initial = [entry(1, { message: "old-1" }), entry(2, { message: "old-2" })];
    // The mock keeps fresh entries gated behind `allowFresh` until the
    // test opens the gate after the Clear click. Without the gate, a
    // saturated full-suite run can deliver `fresh` before the click,
    // which then sets `hideSeq` to fresh.seq and hides everything.
    let allowFresh = false;
    let deltaSent = false;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "logs_recent") return initial;
      if (cmd === "logs_since") {
        if (allowFresh && !deltaSent) {
          deltaSent = true;
          return [entry(3, { message: "fresh" })];
        }
        return [];
      }
      return [];
    }) as unknown as Invoke;

    render(<LogsPanel invoke={invoke} pollMs={TEST_POLL_MS} defaultCollapsed={false} />);
    await waitFor(() => expect(screen.getByText("old-1")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Clear visible logs"));
    expect(screen.queryByText("old-1")).toBeNull();
    expect(screen.queryByText("old-2")).toBeNull();
    expect(screen.getByRole("log").getAttribute("data-empty")).toBe("true");
    expect(screen.getByText(/No log entries match this filter/)).toBeTruthy();

    allowFresh = true;
    await waitFor(
      () => expect(screen.getByText("fresh")).toBeTruthy(),
      { timeout: 4_000, interval: 50 },
    );
    expect(screen.getByRole("log").getAttribute("data-empty")).toBe("false");
    expect(screen.queryByText("old-1")).toBeNull();
  });

  it("shows the IPC error and keeps the surface accessible", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "logs_recent") throw new Error("backend missing");
      return [];
    }) as unknown as Invoke;

    render(<LogsPanel invoke={invoke} pollMs={60_000} defaultCollapsed={false} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/backend missing/)).toBeTruthy();
  });

  it("toggles collapse via the panel header", async () => {
    const invoke = vi.fn(async () => []) as unknown as Invoke;
    render(<LogsPanel invoke={invoke} pollMs={60_000} />);

    const header = screen.getByRole("button", { name: /Logs/ });
    fireEvent.click(header);
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeTruthy());

    fireEvent.click(header);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});
