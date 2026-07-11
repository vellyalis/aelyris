import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../shared/hooks/useKeyboardShortcuts.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const registrySources = import.meta.glob("../shared/lib/shortcutRegistry.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

function getRegistrySrc(): string {
  const entries = Object.entries(registrySources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("useKeyboardShortcuts create-file flow", () => {
  it("opens a newly created file only after create_file succeeds", () => {
    const src = getSrc();
    const ctrlN = src.match(/if \(matchesShortcut\(e, SHORTCUTS\.newFile\)\)[\s\S]*?\} else if/);
    expect(ctrlN).not.toBeNull();
    const body = ctrlN?.[0] ?? "";

    expect(src).toContain("matchesShortcut(e, SHORTCUTS.newFile)");
    expect(getRegistrySrc()).toContain('id: "newFile"');
    expect(body).toMatch(/try\s*\{/);
    expect(body.indexOf('await invoke("create_file"')).toBeLessThan(body.indexOf("handleFileSelect(path)"));
    expect(body).toMatch(/catch \(error\)/);
    expect(body).toMatch(/toast\.error\("Create file failed"/);
  });
});
