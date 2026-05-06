import { useEffect, useState } from "react";

import { isTauriRuntime } from "../lib/tauriRuntime";
import type { PaneEntry } from "../types/pane";
import type { Invoke } from "./useLogStream";

interface UseLivePanesOptions {
  enabled?: boolean;
  invoke?: Invoke;
  pollMs?: number;
}

interface LivePanesState {
  panes: PaneEntry[];
  activeTerminalIds: string[];
  error: string | null;
  ready: boolean;
  backendAvailable: boolean;
}

const defaultInvoke: Invoke = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as Promise<never>;
};

export function useLivePanes({
  enabled = true,
  invoke = defaultInvoke,
  pollMs = 2_000,
}: UseLivePanesOptions = {}): LivePanesState {
  const [state, setState] = useState<LivePanesState>({
    panes: [],
    activeTerminalIds: [],
    error: null,
    ready: false,
    backendAvailable: false,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ panes: [], activeTerminalIds: [], error: null, ready: true, backendAvailable: false });
      return;
    }
    if (invoke === defaultInvoke && !isTauriRuntime()) {
      setState({ panes: [], activeTerminalIds: [], error: null, ready: true, backendAvailable: false });
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const [payload, activePayload] = await Promise.all([
          invoke<unknown>("list_panes_info"),
          invoke<unknown>("list_terminals").catch(() => []),
        ]);
        if (!cancelled) {
          const activeTerminalIds = parseTerminalIds(activePayload);
          const panes = mergeBackendTerminalTruth(parsePanePayload(payload), activeTerminalIds);
          setState({
            panes: normalizePanes(panes),
            activeTerminalIds,
            error: null,
            ready: true,
            backendAvailable: true,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error), ready: true }));
        }
      }
      if (!cancelled) timer = window.setTimeout(load, pollMs);
    };

    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, invoke, pollMs]);

  return state;
}

function parsePanePayload(payload: unknown): PaneEntry[] {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid live panes payload");
  }
  const panes: PaneEntry[] = [];
  for (const item of payload) {
    if (!isPaneRecord(item)) continue;
    const terminalId = normalizeField(item.terminal_id);
    if (!terminalId) continue;
    panes.push({
      terminal_id: terminalId,
      name: normalizeField(item.name),
      role: normalizeField(item.role),
      shell_type: normalizeField(item.shell_type) || "shell",
      cwd: normalizeField(item.cwd),
    });
  }
  return panes;
}

function parseTerminalIds(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return [...new Set(payload.map(normalizeField).filter(Boolean))].sort();
}

function isPaneRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePanes(panes: PaneEntry[]): PaneEntry[] {
  return [...panes].sort((a, b) => {
    const aKey = `${a.role || "~"}:${a.name || "~"}:${a.shell_type}:${a.terminal_id}`;
    const bKey = `${b.role || "~"}:${b.name || "~"}:${b.shell_type}:${b.terminal_id}`;
    return aKey.localeCompare(bKey);
  });
}

function mergeBackendTerminalTruth(panes: PaneEntry[], activeTerminalIds: string[]): PaneEntry[] {
  if (activeTerminalIds.length === 0) return panes;
  const byTerminalId = new Map(panes.map((pane) => [pane.terminal_id, pane]));
  for (const terminalId of activeTerminalIds) {
    if (byTerminalId.has(terminalId)) continue;
    byTerminalId.set(terminalId, {
      terminal_id: terminalId,
      name: "",
      role: "",
      shell_type: "shell",
      cwd: "",
    });
  }
  return [...byTerminalId.values()];
}
