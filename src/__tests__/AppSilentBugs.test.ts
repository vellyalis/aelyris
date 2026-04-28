import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("App unsaved editor guards", () => {
  it("does not clear editor state on project/tab changes without an unsaved confirmation", () => {
    const src = getSrc();

    expect(src).toMatch(/const confirmDiscardUnsavedFiles\s*=\s*useCallback/);
    expect(src).toMatch(/useAppStore\.getState\(\)\.unsavedFiles\.size/);
    expect(src).toMatch(/await confirmDiscardUnsavedFiles\("Switch tabs and discard them"\)/);
    expect(src).toMatch(/await confirmDiscardUnsavedFiles\("Open another project and discard them"\)/);
    expect(src).toMatch(/await confirmDiscardUnsavedFiles\("Close this project and discard them"\)/);

    const tabSwitch = src.match(/const handleTabSwitch\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(tabSwitch).not.toBeNull();
    const body = tabSwitch?.[0] ?? "";
    expect(body.indexOf("await confirmDiscardUnsavedFiles")).toBeLessThan(body.indexOf("clearFiles()"));
    expect(body).toMatch(/if\s*\(!\(await confirmDiscardUnsavedFiles/);
  });
});
