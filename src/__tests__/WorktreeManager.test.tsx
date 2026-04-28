import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../features/worktree/WorktreeManager.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("WorktreeManager interactive structure", () => {
  it("keeps the remove button as a sibling of the switch button", () => {
    const src = getSrc();
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(stripped).toMatch(/<div[\s\S]*className=\{`\$\{styles\.card\}/);
    expect(stripped).toMatch(/className=\{styles\.cardMain\}/);
    expect(stripped).toMatch(/className=\{styles\.deleteBtn\}/);
    expect(stripped).not.toMatch(/<button\s+key=\{wt\.path\}/);
  });
});
