import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../features/pr-inspector/PRInspector.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("PRInspector stale IPC responses", () => {
  it("guards PR list and diff updates with request tokens", () => {
    const src = getSrc();

    expect(src).toMatch(/const prRequestSeq\s*=\s*useRef\(0\)/);
    expect(src).toMatch(/const diffRequestSeq\s*=\s*useRef\(0\)/);
    expect(src).toMatch(/const requestId\s*=\s*\+\+prRequestSeq\.current/);
    expect(src).toMatch(/if\s*\(requestId !== prRequestSeq\.current\)\s*return/);
    expect(src).toMatch(/const requestId\s*=\s*\+\+diffRequestSeq\.current/);
    expect(src).toMatch(/if\s*\(requestId !== diffRequestSeq\.current\)\s*return/);
    expect(src).toMatch(/diffRequestSeq\.current \+= 1/);
  });
});
