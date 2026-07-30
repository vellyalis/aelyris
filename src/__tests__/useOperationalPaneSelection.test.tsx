import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useOperationalPaneSelection } from "../features/terminal/useOperationalPaneSelection";
import type { TerminalPaneTarget } from "../shared/types/terminalPane";

const ownerSources = import.meta.glob("../features/terminal/useOperationalPaneSelection.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getOwnerSource(): string {
  const entries = Object.entries(ownerSources);
  expect(entries).toHaveLength(1);
  return entries[0][1].replace(/\r\n/g, "\n");
}

const pane: TerminalPaneTarget = {
  index: 0,
  paneId: "pane-a",
  shell: "powershell",
  tabId: "tab-a",
  tabLabel: "Repo A",
  tabShell: "powershell",
  terminalId: "pty-a",
};

describe("useOperationalPaneSelection", () => {
  it("owns pane reconciliation, project-bound selection, and audit/reliability trace routing", () => {
    const owner = getOwnerSource();

    expect(owner).toContain("reconcileOperationalPaneSelection(selected, panes)");
    expect(owner).toContain("clearEndedOperationalTerminal(selected, terminalId)");
    expect(owner).toContain("setSelectedAuditTraceFilter(correlationId)");
    expect(owner).toContain("setSelectedAuditEventId(incident.eventId)");
    expect(owner).toContain("currentOwnerKeyRef.current === ownerKey");
  });

  it("clears a selected pane after registry cleanup removes its owner", async () => {
    const { result, rerender } = renderHook(({ panes }) => useOperationalPaneSelection(panes), {
      initialProps: { panes: [pane] },
    });

    act(() => result.current.selectOperationalPane(pane));
    expect(result.current.selectedOperationalPaneTarget).toBe(pane);

    rerender({ panes: [] });
    await waitFor(() => expect(result.current.selectedOperationalPane).toBeNull());
    expect(result.current.selectedOperationalPaneTarget).toBeUndefined();
  });

  it("refreshes the selected terminal identity without changing pane ownership", async () => {
    const { result, rerender } = renderHook(({ panes }) => useOperationalPaneSelection(panes), {
      initialProps: { panes: [pane] },
    });
    act(() => result.current.selectOperationalPane(pane));

    const restarted = { ...pane, terminalId: "pty-restarted" };
    rerender({ panes: [restarted] });
    await waitFor(() =>
      expect(result.current.selectedOperationalPane).toEqual({
        paneId: "pane-a",
        tabId: "tab-a",
        terminalId: "pty-restarted",
      }),
    );
  });

  it("does not resurrect a removed pane from a late selection callback", async () => {
    const { result, rerender } = renderHook(({ panes }) => useOperationalPaneSelection(panes), {
      initialProps: { panes: [pane] },
    });
    act(() => result.current.selectOperationalPane(pane));
    rerender({ panes: [] });
    await waitFor(() => expect(result.current.selectedOperationalPane).toBeNull());

    act(() => result.current.selectOperationalPane(pane));
    expect(result.current.selectedOperationalPane).toBeNull();
  });

  it("clears pane and audit selections when the project owner changes", async () => {
    const { result, rerender } = renderHook(({ ownerKey }) => useOperationalPaneSelection([pane], ownerKey), {
      initialProps: { ownerKey: "project-a" },
    });
    act(() => {
      result.current.selectOperationalPane(pane);
      result.current.setSelectedAuditEventId(42);
      result.current.setSelectedAuditTraceFilter("trace-a");
    });

    rerender({ ownerKey: "project-b" });
    await waitFor(() => expect(result.current.selectedOperationalPane).toBeNull());
    expect(result.current.selectedAuditEventId).toBeNull();
    expect(result.current.selectedAuditTraceFilter).toBeNull();
  });

  it("rejects retained selection callbacks from a previous project owner", async () => {
    const { result, rerender } = renderHook(({ ownerKey }) => useOperationalPaneSelection([pane], ownerKey), {
      initialProps: { ownerKey: "project-a" },
    });
    const staleSelectPane = result.current.selectOperationalPane;
    const staleSelectAudit = result.current.setSelectedAuditEventId;
    const staleSelectTrace = result.current.setSelectedAuditTraceFilter;

    rerender({ ownerKey: "project-b" });
    await waitFor(() => expect(result.current.selectedOperationalPane).toBeNull());

    act(() => {
      staleSelectPane(pane);
      staleSelectAudit(42);
      staleSelectTrace("trace-a");
    });
    expect(result.current.selectedOperationalPane).toBeNull();
    expect(result.current.selectedAuditEventId).toBeNull();
    expect(result.current.selectedAuditTraceFilter).toBeNull();
  });
});
