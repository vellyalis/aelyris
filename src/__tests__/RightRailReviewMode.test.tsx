import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RightRailReviewMode } from "../features/right-rail/RightRailReviewMode";
import type {
  RightRailReviewModeActions,
  RightRailReviewModeViewModel,
} from "../features/right-rail/rightRailReviewModeContract";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";

vi.mock("../features/review/ReviewQueuePanel", () => ({
  ReviewQueuePanel: ({
    activeSessionId,
    onSelectSession,
    onOpenDiff,
    onOpenCommandEvidence,
    onStartAgent,
  }: {
    activeSessionId: string | null;
    onSelectSession: (id: string) => void;
    onOpenDiff: (path: string) => void;
    onOpenCommandEvidence: (command: { id: string }) => void;
    onStartAgent: (prompt: string, model?: string, meta?: { role?: string }) => void;
  }) => (
    <section aria-label="review queue projection" data-active-session={activeSessionId ?? ""}>
      <button type="button" onClick={() => onSelectSession("reviewer-2")}>
        select review owner
      </button>
      <button type="button" onClick={() => onOpenDiff("src/review.ts")}>
        open review diff
      </button>
      <button type="button" onClick={() => onOpenCommandEvidence({ id: "command-1" })}>
        open command proof
      </button>
      <button type="button" onClick={() => onStartAgent("review prompt", "opus", { role: "reviewer" })}>
        start reviewer
      </button>
    </section>
  ),
}));

vi.mock("../features/scm/SCMPanel", () => ({
  SCMPanel: ({
    projectPath,
    onOpenFile,
    onOpenDiff,
  }: {
    projectPath: string;
    onOpenFile: (path: string) => void;
    onOpenDiff: (path: string) => void;
  }) => (
    <section aria-label="scm projection" data-project-path={projectPath}>
      <button type="button" onClick={() => onOpenFile("src/file.ts")}>
        open file
      </button>
      <button type="button" onClick={() => onOpenDiff("src/file.ts")}>
        open scm diff
      </button>
    </section>
  ),
}));

vi.mock("../features/context/ContextPanel", () => ({
  ContextPanel: ({
    activeSessionId,
    changedFilesCount,
    density,
    projectName,
    projectPath,
  }: {
    activeSessionId: string | null;
    changedFilesCount: number;
    density: string;
    projectName: string;
    projectPath: string;
  }) => (
    <section
      aria-label="context projection"
      data-active-session={activeSessionId ?? ""}
      data-changed-files={changedFilesCount}
      data-density={density}
      data-project-name={projectName}
      data-project-path={projectPath}
    />
  ),
}));

const VIEW_MODEL: RightRailReviewModeViewModel = {
  sessions: [],
  activeSessionId: "reviewer-1",
  changedFiles: [{ path: "src/review.ts", status: "modified" }],
  panes: [],
  auditEvents: [],
  project: {
    name: "Aelyris",
    path: "C:/repo",
    branch: "main",
  },
  workstationGraph: buildWorkstationGraph({ workspaceId: "C:/repo" }),
  contextFocused: true,
};

function createActions(): RightRailReviewModeActions {
  return {
    onSelectSession: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenCommandEvidence: vi.fn(),
    onStartAgent: vi.fn(),
    onOpenFile: vi.fn(),
  };
}

afterEach(cleanup);

describe("RightRailReviewMode", () => {
  it("projects the cohesive review surface from one view model without duplicating runtime state", () => {
    render(
      <RightRailReviewMode
        viewModel={VIEW_MODEL}
        actions={createActions()}
        reviewQueueDestination={<span>destination prompt</span>}
        agentInspector={<section aria-label="agent inspector slot" />}
      />,
    );

    expect(screen.getByText("destination prompt")).not.toBeNull();
    expect(screen.getByRole("region", { name: "agent inspector slot" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "review queue projection" }).dataset.activeSession).toBe("reviewer-1");
    expect(screen.getByRole("region", { name: "scm projection" }).dataset.projectPath).toBe("C:/repo");
    const context = screen.getByRole("region", { name: "context projection" });
    expect(context.dataset.density).toBe("compact");
    expect(context.dataset.changedFiles).toBe("1");
    expect(context.dataset.projectName).toBe("Aelyris");
  });

  it("routes review, SCM, and agent intents through the typed action contract", () => {
    const actions = createActions();
    render(
      <RightRailReviewMode
        viewModel={VIEW_MODEL}
        actions={actions}
        reviewQueueDestination={null}
        agentInspector={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "select review owner" }));
    fireEvent.click(screen.getByRole("button", { name: "open review diff" }));
    fireEvent.click(screen.getByRole("button", { name: "open command proof" }));
    fireEvent.click(screen.getByRole("button", { name: "start reviewer" }));
    fireEvent.click(screen.getByRole("button", { name: "open file" }));
    fireEvent.click(screen.getByRole("button", { name: "open scm diff" }));

    expect(actions.onSelectSession).toHaveBeenCalledWith("reviewer-2");
    expect(actions.onOpenDiff).toHaveBeenNthCalledWith(1, "src/review.ts");
    expect(actions.onOpenDiff).toHaveBeenNthCalledWith(2, "src/file.ts");
    expect(actions.onOpenCommandEvidence).toHaveBeenCalledWith({ id: "command-1" });
    expect(actions.onStartAgent).toHaveBeenCalledWith("review prompt", "opus", { role: "reviewer" });
    expect(actions.onOpenFile).toHaveBeenCalledWith("src/file.ts");
  });
});
