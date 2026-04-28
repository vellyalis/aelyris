/**
 * Pure layout helper for the Orchestra Conductor DAG.
 *
 * Sessions are placed in columns by role (Implementer / Tester / Reviewer /
 * Documenter / Unassigned) and sorted within each column by `startedAt`.
 * Edges are derived from `handoffFrom` — a child session points back to
 * its parent so you can read the graph left-to-right as "who spawned what".
 */

import type { AgentSession } from "../types/agent";
import { ORCHESTRA_ROLES, type OrchestraRoleId } from "./orchestrator";

export const COL_WIDTH = 260;
export const ROW_HEIGHT = 120;
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 96;

export interface ConductorNode {
  id: string;
  column: OrchestraRoleId | "unassigned";
  row: number;
  x: number;
  y: number;
  session: AgentSession;
}

export interface ConductorEdge {
  id: string;
  source: string;
  target: string;
}

export interface ConductorLayout {
  nodes: ConductorNode[];
  edges: ConductorEdge[];
  columns: Array<{
    id: OrchestraRoleId | "unassigned";
    label: string;
    x: number;
    count: number;
  }>;
}

const COLUMN_ORDER: Array<OrchestraRoleId | "unassigned"> = [
  ...ORCHESTRA_ROLES.map((r) => r.id),
  "unassigned",
];
const KNOWN_COLUMNS = new Set<string>(COLUMN_ORDER);

function columnLabel(id: OrchestraRoleId | "unassigned"): string {
  if (id === "unassigned") return "Ad-hoc";
  return ORCHESTRA_ROLES.find((r) => r.id === id)?.label ?? id;
}

function resolveColumn(role: AgentSession["role"]): OrchestraRoleId | "unassigned" {
  if (!role) return "unassigned";
  return KNOWN_COLUMNS.has(role) ? role : "unassigned";
}

export function layoutConductor(sessions: AgentSession[]): ConductorLayout {
  const byColumn = new Map<OrchestraRoleId | "unassigned", AgentSession[]>();
  for (const col of COLUMN_ORDER) byColumn.set(col, []);
  for (const s of sessions) {
    byColumn.get(resolveColumn(s.role))?.push(s);
  }
  // Sort within each column by startedAt (oldest at top).
  for (const col of COLUMN_ORDER) {
    byColumn.get(col)?.sort((a, b) => a.startedAt - b.startedAt);
  }

  const nodes: ConductorNode[] = [];
  const columns: ConductorLayout["columns"] = [];
  let colIndex = 0;
  for (const colId of COLUMN_ORDER) {
    const list = byColumn.get(colId) ?? [];
    if (list.length === 0) continue;
    columns.push({
      id: colId,
      label: columnLabel(colId),
      x: colIndex * COL_WIDTH,
      count: list.length,
    });
    list.forEach((s, row) => {
      nodes.push({
        id: s.id,
        column: colId,
        row,
        x: colIndex * COL_WIDTH,
        y: row * ROW_HEIGHT,
        session: s,
      });
    });
    colIndex += 1;
  }

  const ids = new Set(nodes.map((n) => n.id));
  const edges: ConductorEdge[] = [];
  for (const node of nodes) {
    const parent = node.session.handoffFrom;
    if (!parent || !ids.has(parent)) continue;
    edges.push({
      id: `${parent}->${node.id}`,
      source: parent,
      target: node.id,
    });
  }

  return { nodes, edges, columns };
}
