import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearEndedOperationalTerminal,
  type OperationalPaneSelection,
  reconcileOperationalPaneSelection,
} from "../../shared/lib/operationalPaneSelection";
import type { AuditEventRecord } from "../../shared/types/audit";
import type { TerminalPaneTarget } from "../../shared/types/terminalPane";

export function useOperationalPaneSelection(panes: TerminalPaneTarget[], ownerKey?: string) {
  const [selectedAuditEventId, setSelectedAuditEventIdState] = useState<number | null>(null);
  const [selectedAuditTraceFilter, setSelectedAuditTraceFilterState] = useState<string | null>(null);
  const [selectedOperationalPane, setSelectedOperationalPane] = useState<OperationalPaneSelection | null>(null);
  const currentOwnerKeyRef = useRef(ownerKey);
  const previousOwnerKeyRef = useRef(ownerKey);
  const panesRef = useRef(panes);
  currentOwnerKeyRef.current = ownerKey;
  panesRef.current = panes;

  const selectedOperationalPaneTarget = useMemo(
    () =>
      selectedOperationalPane
        ? panes.find(
            (pane) => pane.tabId === selectedOperationalPane.tabId && pane.paneId === selectedOperationalPane.paneId,
          )
        : undefined,
    [panes, selectedOperationalPane],
  );

  const selectOperationalPane = useCallback(
    (pane?: TerminalPaneTarget) => {
      if (currentOwnerKeyRef.current !== ownerKey) return;
      const livePane = pane
        ? panesRef.current.find((candidate) => candidate.tabId === pane.tabId && candidate.paneId === pane.paneId)
        : undefined;
      setSelectedOperationalPane(
        livePane ? { tabId: livePane.tabId, paneId: livePane.paneId, terminalId: livePane.terminalId } : null,
      );
    },
    [ownerKey],
  );

  const setSelectedAuditEventId = useCallback(
    (eventId: number | null) => {
      if (currentOwnerKeyRef.current === ownerKey) setSelectedAuditEventIdState(eventId);
    },
    [ownerKey],
  );

  const setSelectedAuditTraceFilter = useCallback(
    (traceId: string | null) => {
      if (currentOwnerKeyRef.current === ownerKey) setSelectedAuditTraceFilterState(traceId);
    },
    [ownerKey],
  );

  const clearEndedOperationalPane = useCallback((terminalId: string) => {
    setSelectedOperationalPane((selected) => clearEndedOperationalTerminal(selected, terminalId));
  }, []);

  useEffect(() => {
    setSelectedOperationalPane((selected) => reconcileOperationalPaneSelection(selected, panes));
  }, [panes]);

  useEffect(() => {
    if (previousOwnerKeyRef.current === ownerKey) return;
    previousOwnerKeyRef.current = ownerKey;
    setSelectedAuditEventIdState(null);
    setSelectedAuditTraceFilterState(null);
    setSelectedOperationalPane(null);
  }, [ownerKey]);

  const clearOperationalPaneSelection = useCallback(() => {
    setSelectedAuditEventIdState(null);
    setSelectedAuditTraceFilterState(null);
    setSelectedOperationalPane(null);
  }, []);

  const handleSelectAuditEvent = useCallback(
    (entry: AuditEventRecord, pane?: TerminalPaneTarget) => {
      if (currentOwnerKeyRef.current !== ownerKey) return;
      setSelectedAuditEventId(entry.id);
      selectOperationalPane(pane);
    },
    [ownerKey, selectOperationalPane, setSelectedAuditEventId],
  );

  const handleSelectReliabilityIncident = useCallback(
    (incident: { eventId: number; pane?: TerminalPaneTarget }) => {
      if (currentOwnerKeyRef.current !== ownerKey) return;
      setSelectedAuditEventId(incident.eventId);
      selectOperationalPane(incident.pane);
    },
    [ownerKey, selectOperationalPane, setSelectedAuditEventId],
  );

  const handleTraceReliabilityIncident = useCallback(
    (correlationId: string, incident: { eventId: number; pane?: TerminalPaneTarget }) => {
      if (currentOwnerKeyRef.current !== ownerKey) return;
      setSelectedAuditTraceFilter(correlationId);
      setSelectedAuditEventId(incident.eventId);
      selectOperationalPane(incident.pane);
    },
    [ownerKey, selectOperationalPane, setSelectedAuditEventId, setSelectedAuditTraceFilter],
  );

  return {
    clearEndedOperationalPane,
    clearOperationalPaneSelection,
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
