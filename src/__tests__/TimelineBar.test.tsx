import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type ActiveSnapshotOverlay, TimelineBar } from "../features/timeline/TimelineBar";
import type { SnapshotSummary } from "../shared/types/snapshot";
import type { GridSnapshot } from "../shared/types/terminal";

function snap(partial: Partial<SnapshotSummary> & { id: string }): SnapshotSummary {
  return {
    sessionId: "sess-1",
    capturedAt: 1_700_000_000,
    trigger: { kind: "userSubmitted" },
    cols: 80,
    rows: 24,
    ...partial,
  };
}

function grid(): GridSnapshot {
  return {
    cols: 2,
    rows: 1,
    cells: [
      [
        { ch: " ", fg: 0, bg: 0, attrs: 0 },
        { ch: " ", fg: 0, bg: 0, attrs: 0 },
      ],
    ],
    cursor: {
      row: 0,
      col: 0,
      shape: "block",
      blinking: false,
      visible: true,
    },
  };
}

describe("TimelineBar", () => {
  it("keeps the empty state quiet when there are no snapshots", () => {
    render(
      <TimelineBar
        terminalId="t1"
        snapshots={[]}
        activeOverlay={null}
        onSelectSnapshot={() => {}}
        onDismissOverlay={() => {}}
      />,
    );
    expect(screen.getByTestId("timeline-bar")).toBeTruthy();
    expect(screen.queryByText(/No snapshots yet/i)).toBeNull();
  });

  it("renders one tick per snapshot with trigger-based class", () => {
    const snapshots = [
      snap({ id: "a", trigger: { kind: "userSubmitted" } }),
      snap({ id: "b", trigger: { kind: "userMarked", label: "mark" } }),
    ];
    const { container } = render(
      <TimelineBar
        terminalId="t1"
        snapshots={snapshots}
        activeOverlay={null}
        onSelectSnapshot={() => {}}
        onDismissOverlay={() => {}}
      />,
    );
    const ticks = container.querySelectorAll("[data-snapshot-id]");
    expect(ticks.length).toBe(2);
    expect((ticks[0] as HTMLElement).dataset.snapshotId).toBe("a");
    expect((ticks[1] as HTMLElement).dataset.snapshotId).toBe("b");
    // The userMarked tick should get the userMarked class modifier.
    expect((ticks[1] as HTMLElement).className).toMatch(/userMarked/);
  });

  it("calls onSelectSnapshot when a tick is clicked", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    const snapshots = [snap({ id: "x" })];
    const { container } = render(
      <TimelineBar
        terminalId="t1"
        snapshots={snapshots}
        activeOverlay={null}
        onSelectSnapshot={onSelect}
        onDismissOverlay={onDismiss}
      />,
    );
    const tick = container.querySelector("[data-snapshot-id='x']");
    if (!tick) throw new Error("Snapshot tick missing");
    fireEvent.click(tick);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("x");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("clicking the active tick dismisses the overlay instead of re-selecting", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    const snapshots = [snap({ id: "x" })];
    const overlay: ActiveSnapshotOverlay = {
      layerId: "layer-1",
      snapshotId: "x",
      grid: grid(),
    };
    const { container } = render(
      <TimelineBar
        terminalId="t1"
        snapshots={snapshots}
        activeOverlay={overlay}
        onSelectSnapshot={onSelect}
        onDismissOverlay={onDismiss}
      />,
    );
    const tick = container.querySelector("[data-snapshot-id='x']");
    if (!tick) throw new Error("Snapshot tick missing");
    fireEvent.click(tick);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the active pill and its dismiss button when overlay is active", () => {
    const onDismiss = vi.fn();
    const overlay: ActiveSnapshotOverlay = {
      layerId: "layer-1",
      snapshotId: "x",
      grid: grid(),
    };
    render(
      <TimelineBar
        terminalId="t1"
        snapshots={[snap({ id: "x" })]}
        activeOverlay={overlay}
        onSelectSnapshot={() => {}}
        onDismissOverlay={onDismiss}
      />,
    );
    const btn = screen.getByLabelText(/Return to live/i);
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders the mark button only when onMarkSnapshot is provided and terminal is live", () => {
    const onMark = vi.fn();
    const { rerender } = render(
      <TimelineBar
        terminalId={null}
        snapshots={[]}
        activeOverlay={null}
        onSelectSnapshot={() => {}}
        onDismissOverlay={() => {}}
        onMarkSnapshot={onMark}
      />,
    );
    // terminalId null → no mark button.
    expect(screen.queryByLabelText(/Bookmark/i)).toBeNull();

    rerender(
      <TimelineBar
        terminalId="t1"
        snapshots={[]}
        activeOverlay={null}
        onSelectSnapshot={() => {}}
        onDismissOverlay={() => {}}
        onMarkSnapshot={onMark}
      />,
    );
    const btn = screen.getByLabelText(/Bookmark/i);
    fireEvent.click(btn);
    expect(onMark).toHaveBeenCalledTimes(1);
  });

  it("sets aria-selected on the active tick only", () => {
    const snapshots = [snap({ id: "a" }), snap({ id: "b" }), snap({ id: "c" })];
    const overlay: ActiveSnapshotOverlay = {
      layerId: "l",
      snapshotId: "b",
      grid: grid(),
    };
    const { container } = render(
      <TimelineBar
        terminalId="t1"
        snapshots={snapshots}
        activeOverlay={overlay}
        onSelectSnapshot={() => {}}
        onDismissOverlay={() => {}}
      />,
    );
    const ticks = Array.from(container.querySelectorAll<HTMLElement>("[data-snapshot-id]"));
    const selected = ticks.map((t) => t.getAttribute("aria-selected"));
    expect(selected).toEqual(["false", "true", "false"]);
  });
});
