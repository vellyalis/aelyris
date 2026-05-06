export interface OperationalPaneSelection {
  tabId: string;
  paneId: string;
  terminalId: string | null;
}

export interface OperationalPaneCandidate {
  tabId: string;
  paneId: string;
  terminalId: string | null;
}

export interface OperationalPaneChoiceCandidate extends OperationalPaneCandidate {
  tabLabel?: string;
  index?: number;
  shell?: string;
  title?: string;
  role?: string;
  label?: string;
}

export type OperationalPaneChoiceResult<TPane extends OperationalPaneChoiceCandidate> =
  | { kind: "match"; pane: TPane }
  | { kind: "empty" }
  | { kind: "not-found"; query: string }
  | { kind: "ambiguous"; query: string; matches: TPane[] };

export function reconcileOperationalPaneSelection<TPane extends OperationalPaneCandidate>(
  selected: OperationalPaneSelection | null,
  panes: readonly TPane[],
): OperationalPaneSelection | null {
  if (!selected) return null;
  const current = panes.find((pane) => pane.tabId === selected.tabId && pane.paneId === selected.paneId);
  if (!current) return null;
  if (current.terminalId === selected.terminalId) return selected;
  return {
    tabId: current.tabId,
    paneId: current.paneId,
    terminalId: current.terminalId,
  };
}

export function clearEndedOperationalTerminal(
  selected: OperationalPaneSelection | null,
  endedTerminalId: string,
): OperationalPaneSelection | null {
  if (!selected || selected.terminalId !== endedTerminalId) return selected;
  return {
    ...selected,
    terminalId: null,
  };
}

export function resolveOperationalPaneChoice<TPane extends OperationalPaneChoiceCandidate>(
  panes: readonly TPane[],
  choice: string | null | undefined,
): OperationalPaneChoiceResult<TPane> {
  const query = choice?.trim();
  if (!query) return { kind: "empty" };

  const numeric = Number.parseInt(query, 10);
  if (Number.isFinite(numeric) && String(numeric) === query) {
    const pane = panes[numeric - 1];
    return pane ? { kind: "match", pane } : { kind: "not-found", query };
  }

  const normalized = query.toLowerCase();
  const tabPaneTarget = parseTmuxPaneTarget(normalized);
  if (tabPaneTarget) {
    return uniqueMatch(
      query,
      panes.filter(
        (pane) =>
          normalize(pane.tabLabel) === tabPaneTarget.tab &&
          typeof pane.index === "number" &&
          pane.index + 1 === tabPaneTarget.paneNumber,
      ),
    );
  }

  const exact = uniqueMatch(
    query,
    panes.filter((pane) =>
      [
        pane.paneId,
        pane.terminalId,
        pane.title,
        pane.label,
        formatOperationalPaneChoice(pane),
        pane.role ? `@${pane.role}` : undefined,
      ].some((candidate) => normalize(candidate) === normalized),
    ),
  );
  if (exact.kind !== "not-found") return exact;

  return uniqueMatch(
    query,
    panes.filter((pane) =>
      [pane.title, pane.label, pane.role, formatOperationalPaneChoice(pane)].some((candidate) =>
        normalize(candidate).includes(normalized.replace(/^@/, "")),
      ),
    ),
  );
}

export function formatOperationalPaneChoice(pane: OperationalPaneChoiceCandidate): string {
  const indexLabel = typeof pane.index === "number" ? pane.index + 1 : 1;
  const paneLabel = pane.title || pane.label || (pane.role ? `@${pane.role}` : `${pane.shell ?? "pane"} ${indexLabel}`);
  const readiness = pane.terminalId ? pane.terminalId.slice(0, 8) : "spawning";
  return `${pane.tabLabel ?? pane.tabId}/${paneLabel} (${readiness})`;
}

function uniqueMatch<TPane extends OperationalPaneChoiceCandidate>(
  query: string,
  matches: TPane[],
): OperationalPaneChoiceResult<TPane> {
  if (matches.length === 1) return { kind: "match", pane: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", query, matches };
  return { kind: "not-found", query };
}

function parseTmuxPaneTarget(query: string): { tab: string; paneNumber: number } | null {
  const match = /^(.+)\.(\d+)(?:\s|$)/.exec(query);
  if (!match) return null;
  const paneNumber = Number.parseInt(match[2], 10);
  return Number.isFinite(paneNumber) && paneNumber > 0 ? { tab: match[1], paneNumber } : null;
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
