import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepairJobsPanel } from "../features/repair/RepairJobsPanel";
import type { RepairJobInfo } from "../shared/types/repair";

const sampleJob: RepairJobInfo = {
  id: "repair-1",
  phase: { kind: "runningAgent" },
  branch: "fix/auto-abc",
  errorLine: "error: cannot find module",
  elapsedSecs: 42,
};

describe("RepairJobsPanel", () => {
  afterEach(() => cleanup());

  it("shows the disabled hint when auto-repair is off", () => {
    const { getByText } = render(
      <RepairJobsPanel
        jobs={[]}
        config={{ enabled: false, pattern: "error:" }}
        onToggleEnabled={() => {}}
        onClose={() => {}}
      />,
    );
    expect(getByText("Auto-repair is off.")).toBeTruthy();
  });

  it("shows the empty hint when enabled but no jobs", () => {
    const { getByText } = render(
      <RepairJobsPanel
        jobs={[]}
        config={{ enabled: true, pattern: "error:" }}
        onToggleEnabled={() => {}}
        onClose={() => {}}
      />,
    );
    expect(getByText(/Waiting for error output/)).toBeTruthy();
  });

  it("renders a job with branch, phase and error line", () => {
    const { getByText } = render(
      <RepairJobsPanel
        jobs={[sampleJob]}
        config={{ enabled: true, pattern: "error:" }}
        onToggleEnabled={() => {}}
        onClose={() => {}}
      />,
    );
    expect(getByText("fix/auto-abc")).toBeTruthy();
    expect(getByText("AI fixing")).toBeTruthy();
    expect(getByText("error: cannot find module")).toBeTruthy();
  });

  it("fires onToggleEnabled when the checkbox flips", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <RepairJobsPanel
        jobs={[]}
        config={{ enabled: false, pattern: "x" }}
        onToggleEnabled={onToggle}
        onClose={() => {}}
      />,
    );
    const cb = container.querySelector("input[type=checkbox]") as HTMLInputElement;
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("fires onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <RepairJobsPanel
        jobs={[]}
        config={{ enabled: false, pattern: "x" }}
        onToggleEnabled={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
