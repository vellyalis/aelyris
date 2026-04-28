import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../features/file-tree/FileTree.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("FileTree open editor reconciliation", () => {
  it("renames/deletes open editor paths only after the filesystem operation succeeds", () => {
    const src = getSrc();

    expect(src).toMatch(/const replaceOpenPath\s*=\s*useAppStore/);
    expect(src).toMatch(/const removeOpenPath\s*=\s*useAppStore/);
    expect(src).toMatch(/confirmOpenMutation/);

    const renameHandler = src.match(/const handleRename\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(renameHandler).not.toBeNull();
    const renameBody = renameHandler?.[0] ?? "";
    expect(renameBody.indexOf('await invoke("rename_path"')).toBeLessThan(renameBody.indexOf("replaceOpenPath(path, newPath)"));

    const deleteHandler = src.match(/const handleDelete\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(deleteHandler).not.toBeNull();
    const deleteBody = deleteHandler?.[0] ?? "";
    expect(deleteBody.indexOf('await invoke("delete_path"')).toBeLessThan(deleteBody.indexOf("removeOpenPath(path)"));
  });
});
