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

    // Anchor on the success arm of the write_file invoke. The body must
    // call setContent(value) gated by the savedFilePath guard so it only
    // mutates panel state when the saved file is still on screen.
    expect(src).toMatch(/invoke\(\s*"write_file"[\s\S]*?setContent\(\s*value\s*\)/);
    expect(src).toMatch(/invoke\(\s*"write_file"[\s\S]*?setModified\(\s*false\s*\)/);
    expect(src).toMatch(/invoke\(\s*"write_file"[\s\S]*?markSaved\(/);
  });

  it("Ctrl+S handler snapshots filePath and gates state writes on filePathRef (codex L3)", () => {
    const src = Object.entries(sources)[0][1];

    // The savedFilePath snapshot decouples the in-flight save from the
    // user's later file switches, and filePathRef.current === savedFilePath
    // gates panel-state mutations against the live filePath.
    expect(src).toMatch(/const\s+savedFilePath\s*=\s*filePath/);
    expect(src).toMatch(/filePathRef\.current\s*===\s*savedFilePath/);

    // The previous unconditional setContent must be inside the gate.
    const successArm = src.match(/\.then\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*\.catch/);
    expect(successArm).not.toBeNull();
    const body = successArm![1];
    expect(body).toMatch(/if\s*\(\s*stillCurrent\s*\)/);
    // setContent must be inside the if-block, not above it.
    const ifBlockMatch = body.match(/if\s*\(\s*stillCurrent\s*\)\s*\{([\s\S]*?)\n\s{12}\}/);
    expect(ifBlockMatch).not.toBeNull();
    expect(ifBlockMatch![1]).toMatch(/setContent\(/);
  });
});
