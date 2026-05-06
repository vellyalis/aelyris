import { describe, expect, it } from "vitest";

/**
 * Regression guards for KanbanBoard.tsx silent bugs.
 *
 * Bug 1 (perf): the previous revision called `useAppStore()` with no
 * selector — that subscribes the component to the entire store, so any
 * unrelated state mutation (terminals, agents, ghost layers…) would
 * re-render the kanban tree.
 *
 * Bug 2 (a11y): the outer `<div role="button">` for each task wraps real
 * `<button>` children (Launch + Delete). The outer's onKeyDown catches
 * Enter / Space on bubble and calls preventDefault → which suppresses
 * the inner button's native Enter activation. Pressing Enter on Delete
 * fires handleActivate instead of deleteKanbanTask. The inner buttons
 * must stop propagation for Enter / Space so the outer wrapper does
 * not pre-empt them.
 */

const sources = import.meta.glob("../features/kanban/KanbanBoard.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("KanbanBoard store subscription", () => {
  it("subscribes to each store slice via a selector, not the full store", () => {
    const src = getSrc();

    // Strip line/block comments before negative-asserting on the
    // unselectored `useAppStore()` form — the explanatory comment
    // about the bug intentionally references the bad pattern.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // The unselectored form `useAppStore()` re-renders on every store
    // mutation app-wide and is the bug we're guarding against.
    expect(stripped).not.toMatch(/useAppStore\(\s*\)/);

    // Each kanban-related slice must come through its own selector.
    expect(stripped).toMatch(/useAppStore\(\s*\(s\)\s*=>\s*s\.kanbanTasks\s*\)/);
    expect(stripped).toMatch(/useAppStore\(\s*\(s\)\s*=>\s*s\.activeTaskId\s*\)/);
    expect(stripped).toMatch(/useAppStore\(\s*\(s\)\s*=>\s*s\.setActiveTaskId\s*\)/);
  });
});

describe("KanbanBoard nested button keyboard", () => {
  it("inner Launch / Delete buttons stop Enter / Space propagation", () => {
    const src = getSrc();

    // Find the two inline button blocks rendered inside the role=button
    // task wrapper. Each must include an onKeyDown that stops Enter /
    // Space at the button — otherwise the outer wrapper's onKeyDown
    // pre-empts the native button activation and routes the keystroke
    // to handleActivate.
    const buttonBlocks = src.match(
      /<button[\s\S]*?onKeyDown=\{\(e\)\s*=>\s*\{[\s\S]*?if\s*\(e\.key\s*===\s*"Enter"\s*\|\|\s*e\.key\s*===\s*"\s"\s*\)\s*\{\s*e\.stopPropagation\(\s*\)\s*;\s*\}[\s\S]*?\}\}/g,
    );
    expect(buttonBlocks).not.toBeNull();
    expect((buttonBlocks ?? []).length).toBeGreaterThanOrEqual(2);

    // Aria labels must distinguish the two actions for screen readers —
    // they previously had no aria-label at all on the delete button.
    expect(src).toMatch(/aria-label=\{`Launch agent for task: \$\{t\.title\}`\}/);
    expect(src).toMatch(/aria-label=\{`Delete task: \$\{t\.title\}`\}/);
  });
});

describe("KanbanBoard completed visibility", () => {
  it("does not collapse completed work by default", () => {
    const src = getSrc();

    expect(src).not.toMatch(/useState<Record<string,\s*boolean>>\(\{\s*done:\s*true\s*\}\)/);
    expect(src).toMatch(/useState<Record<string,\s*boolean>>\(\{\s*\}\)/);
  });
});
