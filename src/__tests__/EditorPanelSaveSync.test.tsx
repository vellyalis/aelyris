import { describe, expect, it } from "vitest";

/**
 * Regression guard for EditorPanel Ctrl+S content sync bug.
 *
 * Bug (HIGH): the save handler called `markSaved` and `setModified(false)`
 * but never updated `content` state to the just-saved value. The window-
 * focus reload effect compares `diskContent !== content` — after save the
 * disk content is the new value while `content` state is still the
 * initial-load value. The mismatch triggers `editor.setValue(diskContent)`,
 * which fires onChange and re-marks the file dirty — even though the user
 * hadn't typed anything since saving.
 *
 * Monaco + lazy DiffViewer make a runtime test fragile (jsdom hangs), so
 * we guard the structural fix: the Ctrl+S `.then` callback must call
 * `setContent(value)`.
 */

const sources = import.meta.glob("../features/editor/EditorPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("EditorPanel Ctrl+S sync", () => {
  it("write_file success handler syncs content state to the saved value", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    // Locate the .then() arm that follows invoke("write_file", ...). The
    // arm body must update content via setContent(value) so the next focus
    // reload sees a matching disk/state pair.
    const writeFileBlock = src.match(
      /invoke\(\s*"write_file"[\s\S]*?\.then\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*\.catch/,
    );
    expect(writeFileBlock).not.toBeNull();
    const body = writeFileBlock![1];

    expect(body).toMatch(/setContent\(\s*value\s*\)/);
    expect(body).toMatch(/setModified\(\s*false\s*\)/);
    expect(body).toMatch(/markSaved\(/);
  });
});
