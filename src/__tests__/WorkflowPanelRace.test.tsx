import { describe, expect, it } from "vitest";

/**
 * Regression guards for WorkflowPanel.tsx silent bugs.
 *
 * Bug 1 (HIGH): the listen() registration resolves asynchronously, so
 * unmount cleanup can fire before `unlisten = u` is assigned — leaking a
 * Tauri event listener for a component that no longer exists.
 *
 * Bug 2 (HIGH): handleExportYaml called `setBuilderOpen(false)` no matter
 * what — even when the disk write threw. The user lost the YAML they had
 * just typed, with only a toast to show for it.
 *
 * Both fixes are state-machine guards we can verify in source without
 * hitting the live Tauri runtime.
 */

const sources = import.meta.glob("../features/workflow/WorkflowPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("WorkflowPanel listener race", () => {
  it("listen() promise checks the active flag both before listen and after subscribe", () => {
    const src = getSrc();

    // Find the async listen subscription block. The fix re-checks `active`
    // in two places: before subscribing and before assigning the unlisten ref.
    expect(src).toContain("isTauriRuntime()");
    expect(src).toContain('import { listen as tauriListen } from "@tauri-apps/api/event"');
    const listenBlock = src.match(/Promise\.resolve\(\{\s*listen:\s*tauriListen\s*\}\)([\s\S]*?)\.catch\(/);
    expect(listenBlock).not.toBeNull();
    const body = listenBlock?.[1] ?? "";

    // Two separate `if (!active)` guards — one before listen subscribes,
    // one inside the resolution that assigns unlisten.
    const guards = body.match(/if\s*\(\s*!active\s*\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);

    // The post-subscribe guard must call the resolved unlisten so a
    // listener that resolved after unmount doesn't leak.
    expect(body).toMatch(/if\s*\(\s*!active\s*\)\s*\{\s*u\(\s*\)/);
  });
});

describe("WorkflowPanel handleExportYaml", () => {
  it("save failure leaves the builder open so the user keeps their work", () => {
    const src = getSrc();
    const handlerMatch = src.match(
      /const handleExportYaml\s*=\s*useCallback\(\s*async\s*\(\s*yaml[^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[/,
    );
    expect(handlerMatch).not.toBeNull();
    const body = handlerMatch?.[1] ?? "";

    // After the try/catch around invoke("write_file"), the handler must
    // bail out before setBuilderOpen(false) when save failed.
    const earlyReturn = body.match(/if\s*\(\s*!saved\s*\)\s*return\s*;/);
    expect(earlyReturn).not.toBeNull();

    const earlyReturnIdx = body.indexOf("if (!saved) return");
    const builderCloseIdx = body.indexOf("setBuilderOpen(false)");
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(builderCloseIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeLessThan(builderCloseIdx);
  });
});

describe("WorkflowPanel gate action structure", () => {
  it("renders approve/reject as siblings of the phase expansion button", () => {
    const src = getSrc();
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(stripped).toMatch(/className=\{styles\.stepRow\}/);
    expect(stripped).toMatch(/<button[\s\S]*className=\{`\$\{styles\.step\}/);
    expect(stripped).toMatch(/className=\{styles\.gateActions\}/);
    expect(stripped).not.toMatch(/role="button"/);
    expect(stripped).not.toMatch(/e\.stopPropagation\(\)/);
  });
});

describe("WorkflowPanel empty state", () => {
  it("keeps the header rendered instead of leaving an empty bento wrapper", () => {
    const src = getSrc();

    expect(src).not.toContain("workflows.length === 0 && running.length === 0) return null");
    expect(src).toContain('aria-label="Workflow panel"');
    expect(src).toContain("Visual Builder");
  });

  it("uses the shared panel header and opens automatically for live workflow state", () => {
    const src = getSrc();

    expect(src).toContain('import { PanelHeader } from "../../shared/ui/PanelHeader"');
    expect(src).toContain("<PanelHeader");
    expect(src).toContain('subtitle="multi-step runs"');
    expect(src).toContain("collapsible");
    expect(src).toContain("collapsed={!expanded}");
    expect(src).toContain("if (running.length > 0) setExpanded(true)");
    expect(src).toContain("styles.runningName");
    expect(src).toContain("Build a workflow or import recipes to run repeatable guarded work.");
  });
});

describe("WorkflowPanel agent completion bridge", () => {
  it("syncs completed agent sessions back into workflow phases", () => {
    const src = getSrc();

    expect(src).toContain("sessions?: AgentSession[]");
    expect(src).toContain("completedPhaseRef");
    expect(src).toContain('invoke<WorkflowPhaseDoneResult>("workflow_phase_done"');
    expect(src).toContain('invoke<WorkflowStatus[]>("list_running_workflows", { projectPath })');
    expect(src).toContain("result.waiting_gate");
    expect(src).toContain("await advancePhaseRef.current?.(workflow.id)");
  });

  it("routes workflow phases to named terminal panes when target_pane is present", () => {
    const src = getSrc();

    expect(src).toContain("target_pane: string | null");
    expect(src).toContain('invoke<SendKeysBatchResult>("send_keys_by_target"');
    expect(src).toContain('import { normalizeCommandInput } from "../../shared/lib/terminalInput"');
    expect(src).toContain('import { showConfirm } from "../../shared/ui/ConfirmDialog"');
    expect(src).toContain("confirmWorkflowPaneTarget(targetPane)");
    expect(src).toContain('invoke<PaneInfo[]>("list_panes_info")');
    expect(src).toContain("countPaneTargetMatches");
    expect(src).toContain("Workflow pane target changed");
    expect(src).toContain("Send workflow phase to multiple panes");
    expect(src).toContain("data: normalizeCommandInput(phase.prompt)");
    expect(src).not.toContain("appendEnterIfNeeded");
    expect(src).toContain("agentSessionId: paneSessionId(targetPane)");
    expect(src).toContain("Mark pane phase done");
  });

  it("passes workflow agent_role metadata into Orchestra tracking for headless agents", () => {
    const src = getSrc();

    expect(src).toContain("agent_role: string | null");
    expect(src).toContain("toOrchestraRoleId(phase.agent_role)");
    expect(src).toContain('import type { StartAgentMeta } from "../../shared/hooks/useAgentFleet"');
    expect(src).toContain("meta?: StartAgentMeta");
  });

  it("surfaces workflow resume metadata, phase evidence, and decision-aware gates", () => {
    const src = getSrc();

    expect(src).toContain("resume_point?:");
    expect(src).toContain("decision_request?:");
    expect(src).toContain("gate_decision?:");
    expect(src).toContain("duration_ms?: number | null");
    expect(src).toContain("artifacts?: unknown[]");
    expect(src).toContain('invoke<boolean>("workflow_approve_gate_decision"');
    expect(src).toContain('invoke("workflow_reject_gate_decision"');
    expect(src).toContain('comment.trim().toLowerCase().startsWith("conditional:")');
    expect(src).toContain("styles.gateDecisionPanel");
    expect(src).toContain("Gate decision");
    expect(src).toMatch(/p\.decision_request\?\.reason\s*\?\?\s*p\.blocked_reason/);
    expect(src).toContain("styles.gateApproveAction");
    expect(src).toContain("styles.gateRejectAction");
    expect(src).toContain("onDestinationOutcome?:");
    expect(src).toContain('label: "Workflow gate approved"');
    expect(src).toContain('label: "Workflow gate rejected"');
    expect(src).toContain('label: "Workflow gate approval failed"');
    expect(src).toContain('routeWidget: "workflow"');
    expect(src).toContain('routeLabel: "Workflow"');
    expect(src).toContain("routeDetail: workflowId");
    expect(src).toContain("p.artifacts?.length");
    expect(src).toContain("wf.resume_point.phase_name");
  });
});
