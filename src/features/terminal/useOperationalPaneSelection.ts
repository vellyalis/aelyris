import { useCallback, useEffect, useMemo, useState } from "react";

import {
  clearEndedOperationalTerminal,
  type OperationalPaneSelection,
  reconcileOperationalPaneSelection,
} from "../../shared/lib/operationalPaneSelection";
import type { AuditEventRecord } from "../../shared/types/audit";
import type { TerminalPaneTarget } from "../../shared/types/terminalPane";

export function useOperationalPaneSelection(panes: TerminalPaneTarget[]) {
  const [selectedAuditEventId, setSelectedAuditEventId] = useState<number | null>(null);
  const [selectedAuditTraceFilter, setSelectedAuditTraceFilter] = useState<string | null>(null);
  const [selectedOperationalPane, setSelectedOperationalPane] = useState<OperationalPaneSelection | null>(null);

  const selectedOperationalPaneTarget = useMemo(
    () =>
      selectedOperationalPane
        ? panes.find(
            (pane) => pane.tabId === selectedOperationalPane.tabId && pane.paneId === selectedOperationalPane.paneId,
          )
        : undefined,
    [panes, selectedOperationalPane],
  );

  const selectOperationalPane = useCallback((pane?: TerminalPaneTarget) => {
    setSelectedOperationalPane(
      pane ? { tabId: pane.tabId, paneId: pane.paneId, terminalId: pane.terminalId } : null,
    );
  }, []);

  const clearEndedOperationalPane = useCallback((terminalId: string) => {
    setSelectedOperationalPane((selected) => clearEndedOperationalTerminal(selected, terminalId));
  }, []);

  useEffect(() => {
    setSelectedOperationalPane((selected) => reconcileOperationalPaneSelection(selected, panes));
  }, [panes]);

  const handleSelectAuditEvent = useCallback(
    (entry: AuditEventRecord, pane?: TerminalPaneTarget) => {
      setSelectedAuditEventId(entry.id);
      selectOperationalPane(pane);
    },
    [selectOperationalPane],
  );

  const handleSelectReliabilityIncident = useCallback(
    (incident: { eventId: number; pane?: TerminalPaneTarget }) => {
      setSelectedAuditEventId(incident.eventId);
      selectOperationalPane(incident.pane);
    },
    [selectOperationalPane],
  );

  const handleTraceReliabilityIncident = useCallback(
    (correlationId: string, incident: { eventId: number; pane?: TerminalPaneTarget }) => {
      setSelectedAuditTraceFilter(correlationId);
      setSelectedAuditEventId(incident.eventId);
      selectOperationalPane(incident.pane);
    },
    [selectOperationalPane],
  );

  return {
    clearEndedOperationalPane,
    handleSelectAuditEvent,
    handleSelectReliabilityIncident,
    handleTraceReliabilityIncident,
    selectOperationalPane,
    setSelectedAuditEventId,
    setSelectedAuditTraceFilter,
    selectedAuditEventId,
    selectedAuditTraceFilter,
    selectedOperationalPane,
    selectedOperationalPaneTarget,
  };
}
