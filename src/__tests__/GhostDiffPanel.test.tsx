import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GhostDiffPanel } from "../features/ghost-diff/GhostDiffPanel";
import type { LayerSummary } from "../shared/types/ghostdiff";

const sampleLayer: LayerSummary = {
  id: "repair-1",
  source: {
    kind: "worktree",
    path: "/tmp/repo-fix-auto",
    branch: "fix/auto-abc",
    repoPath: "/tmp/repo",
  },
  tint: { roleColor: "#fab387", roleLabel: "repair" },
  isComplete: false,
  createdAt: 1000,
  fileCount: 2,
  hunkCount: 5,
  filePaths: ["src/foo.ts", "src/bar.ts"],
};

describe("GhostDiffPanel", () => {
  afterEach(() => cleanup());

  it("shows the empty hint when no layers are active", () => {
    const { getByText } = render(
      <GhostDiffPanel layers={[]} onDismiss={() => {}} onClose={() => {}} />,
    );
    expect(getByText(/Agents in worktrees will appear here/)).toBeTruthy();
  });

  it("renders a layer with role, branch, and counts", () => {
    const { getByText } = render(
      <GhostDiffPanel
        layers={[sampleLayer]}
        onDismiss={() => {}}
        onClose={() => {}}
      />,
    );
    expect(getByText("repair")).toBeTruthy();
    expect(getByText("fix/auto-abc")).toBeTruthy();
    expect(getByText(/2 files · 5 hunks/)).toBeTruthy();
  });

  it("shows file paths when the row is expanded", () => {
    const { getByLabelText, getByText, queryByText } = render(
      <GhostDiffPanel
        layers={[sampleLayer]}
        onDismiss={() => {}}
        onClose={() => {}}
      />,
    );
    // Before expand
    expect(queryByText("src/foo.ts")).toBeNull();
    fireEvent.click(getByLabelText("Expand files"));
    expect(getByText("src/foo.ts")).toBeTruthy();
    expect(getByText("src/bar.ts")).toBeTruthy();
  });

  it("fires onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    const { getByLabelText } = render(
      <GhostDiffPanel
        layers={[sampleLayer]}
        onDismiss={onDismiss}
        onClose={() => {}}
      />,
    );
    fireEvent.click(getByLabelText("Dismiss layer"));
    expect(onDismiss).toHaveBeenCalledWith("repair-1");
  });

  it("fires onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <GhostDiffPanel layers={[]} onDismiss={() => {}} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the completed check icon when a layer is complete", () => {
    const { container } = render(
      <GhostDiffPanel
        layers={[{ ...sampleLayer, isComplete: true }]}
        onDismiss={() => {}}
        onClose={() => {}}
      />,
    );
    // Lucide renders check icon as svg with class "lucide-check".
    const check = container.querySelector("svg.lucide-check");
    expect(check).toBeTruthy();
  });
});
