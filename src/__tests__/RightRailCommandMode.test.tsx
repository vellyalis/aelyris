import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RightRailCommandMode } from "../features/right-rail/RightRailCommandMode";
import type {
  RightRailCommandModeActions,
  RightRailCommandModeViewModel,
} from "../features/right-rail/rightRailCommandModeContract";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";

vi.mock("../features/right-rail/rightRailWidgetFrame", () => ({
  RightRailWidgetFrame: ({
    children,
    title,
    subtitle,
  }: {
    children: React.ReactNode;
    title: string;
    subtitle: string;
  }) => (
    <section aria-label={title} data-subtitle={subtitle}>
      {children}
    </section>
  ),
}));

vi.mock("../features/toolkit/ToolkitPanel", () => ({
  ToolkitPanel: ({
    projectName,
    activeTargetLabel,
    activeTargetReady,
    onRunCommand,
  }: {
    projectName: string;
    activeTargetLabel: string;
    activeTargetReady: boolean;
    onRunCommand: (command: string) => void;
  }) => (
    <section
      aria-label="toolkit projection"
      data-project-name={projectName}
      data-target-label={activeTargetLabel}
      data-target-ready={String(activeTargetReady)}
    >
      <button type="button" onClick={() => onRunCommand("pnpm test")}>
        run toolkit command
      </button>
    </section>
  ),
}));

vi.mock("../features/decision-inbox", () => ({
  DecisionInboxPanel: ({
    activeSessionId,
    focusRequestKey,
    onSelectSession,
    onOpenWorkflow,
    onOpenAudit,
    onDecide,
  }: {
    activeSessionId: string | null;
    focusRequestKey: number;
    onSelectSession: (id: string) => void;
    onOpenWorkflow: (id: string) => void;
    onOpenAudit: (id: number) => void;
    onDecide: (item: { id: string }, decision: "approve") => void;
  }) => (
    <section
      aria-label="decision projection"
      data-active-session={activeSessionId ?? ""}
      data-focus-request={focusRequestKey}
    >
      <button type="button" onClick={() => onSelectSession("agent-2")}>
        select decision owner
      </button>
      <button type="button" onClick={() => onOpenWorkflow("workflow-1")}>
        open workflow
      </button>
      <button type="button" onClick={() => onOpenAudit(42)}>
        open audit
      </button>
      <button type="button" onClick={() => onDecide({ id: "decision-1" }, "approve")}>
        approve decision
      </button>
    </section>
  ),
}));

vi.mock("../features/orchestrator/OrchestratorPanel", () => ({
  OrchestratorPanel: () => <section aria-label="orchestrator projection" />,
}));

vi.mock("../features/workflow/WorkflowPanel", () => ({
  WorkflowPanel: ({
    projectPath,
    onStartAgent,
    onDestinationOutcome,
  }: {
    projectPath: string;
    onStartAgent: (prompt: string, model: string) => void;
    onDestinationOutcome: (outcome: { label: string; detail: string; tone: "success" }) => void;
  }) => (
    <section aria-label="workflow projection" data-project-path={projectPath}>
      <button type="button" onClick={() => onStartAgent("workflow prompt", "gpt-5.6-sol")}>
        start workflow agent
      </button>
      <button
        type="button"
        onClick={() => onDestinationOutcome({ label: "Workflow ready", detail: "phase 1", tone: "success" })}
      >
        report workflow outcome
      </button>
    </section>
  ),
}));

vi.mock("../features/context/ContextPanel", () => ({
  ContextPanel: ({
    changedFilesCount,
    projectName,
    projectPath,
  }: {
    changedFilesCount: number;
    projectName: string;
    projectPath: string;
  }) => (
    <section
      aria-label="context projection"
      data-changed-files={changedFilesCount}
      data-project-name={projectName}
      data-project-path={projectPath}
    />
  ),
}));

const VIEW_MODEL: RightRailCommandModeViewModel = {
  sessions: [],
  activeSessionId: "agent-1",
  auditEvents: [],
  workflows: [],
  project: { name: "Aelyris", path: "C:/repo", branch: "main" },
  context: {
    changedFiles: [{ path: "src/command.ts", status: "modified" }],
    panes: [],
    workstationGraph: buildWorkstationGraph({ workspaceId: "C:/repo" }),
  },
  focusedWidget: "toolkit",
  toolkit: { activeTargetLabel: "terminal · shell", activeTargetReady: true },
  decisionInbox: { visible: true, pendingCount: 2, focusRequestKey: 7 },
  agents: { summary: "1 active", detail: "1 ready" },
  workflowConfirmation: { title: "Workflow reached", detail: "phase 1" },
};

function createActions(): RightRailCommandModeActions {
  return {
    onRunCommand: vi.fn(),
    onSelectSession: vi.fn(),
    onOpenWorkflow: vi.fn(),
    onOpenAudit: vi.fn(),
    onDecide: vi.fn(),
    onStartAgent: vi.fn().mockResolvedValue("agent-3"),
    onDestinationOutcome: vi.fn(),
  };
}

afterEach(cleanup);

describe("RightRailCommandMode", () => {
  it("projects the command surface from one typed view model without duplicating runtime owners", () => {
    render(
      <RightRailCommandMode
        viewModel={VIEW_MODEL}
        actions={createActions()}
        toolkitDestination={<span>toolkit destination</span>}
        decisionInboxDestination={<span>decision destination</span>}
        agentInspector={<section aria-label="agent inspector slot" />}
      />,
    );

    expect(screen.getByText("toolkit destination")).not.toBeNull();
    expect(screen.getByText("decision destination")).not.toBeNull();
    expect(screen.getByRole("region", { name: "agent inspector slot" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "toolkit projection" }).dataset.targetReady).toBe("true");
    expect(screen.getByRole("region", { name: "decision projection" }).dataset.focusRequest).toBe("7");
    expect(screen.getByRole("region", { name: "Decision Inbox" }).dataset.subtitle).toBe("2 waiting");
    expect(screen.getByRole("region", { name: "Agents" }).dataset.subtitle).toBe("1 active · 1 ready");
    expect(screen.getByRole("region", { name: "context projection" }).dataset.changedFiles).toBe("1");
  });

  it("routes toolkit, decision, and workflow intents through the action contract", () => {
    const actions = createActions();
    render(
      <RightRailCommandMode
        viewModel={VIEW_MODEL}
        actions={actions}
        toolkitDestination={null}
        decisionInboxDestination={null}
        agentInspector={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "run toolkit command" }));
    fireEvent.click(screen.getByRole("button", { name: "select decision owner" }));
    fireEvent.click(screen.getByRole("button", { name: "open workflow" }));
    fireEvent.click(screen.getByRole("button", { name: "open audit" }));
    fireEvent.click(screen.getByRole("button", { name: "approve decision" }));
    fireEvent.click(screen.getByRole("button", { name: "start workflow agent" }));
    fireEvent.click(screen.getByRole("button", { name: "report workflow outcome" }));

    expect(actions.onRunCommand).toHaveBeenCalledWith("pnpm test");
    expect(actions.onSelectSession).toHaveBeenCalledWith("agent-2");
    expect(actions.onOpenWorkflow).toHaveBeenCalledWith("workflow-1");
    expect(actions.onOpenAudit).toHaveBeenCalledWith(42);
    expect(actions.onDecide).toHaveBeenCalledWith({ id: "decision-1" }, "approve");
    expect(actions.onStartAgent).toHaveBeenCalledWith("workflow prompt", "gpt-5.6-sol");
    expect(actions.onDestinationOutcome).toHaveBeenCalledWith({
      label: "Workflow ready",
      detail: "phase 1",
      tone: "success",
    });
  });
});
