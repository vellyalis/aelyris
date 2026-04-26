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

    // setContent must appear AFTER the stillCurrent gate, never before
    // markSaved (which is the unconditional, filePath-scoped call). We
    // match positions in the success arm rather than depending on the
    // exact indentation of the if-block — a future formatting pass
    // shouldn't silently invalidate the regression guard.
    const successArm = src.match(/\.then\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*\.catch/);
    expect(successArm).not.toBeNull();
    const body = successArm![1];
    expect(body).toMatch(/if\s*\(\s*stillCurrent\s*\)/);

    const stillCurrentIdx = body.indexOf("stillCurrent");
    const setContentIdx = body.indexOf("setContent(value)");
    const markSavedIdx = body.indexOf("markSaved(");
    expect(stillCurrentIdx).toBeGreaterThan(-1);
    expect(setContentIdx).toBeGreaterThan(-1);
    expect(markSavedIdx).toBeGreaterThan(-1);
    // Ordering: gate → setContent → markSaved (gate must precede the
    // mutation it guards; markSaved is filePath-scoped and runs after).
    expect(setContentIdx).toBeGreaterThan(stillCurrentIdx);
    expect(markSavedIdx).toBeGreaterThan(setContentIdx);
  });

  it("save pill setTimeout is held in a ref and cleared on unmount (codex r1 M2)", () => {
    const src = Object.entries(sources)[0][1];

    // Without a ref the 2 s setSaved(false) timer outlives the panel
    // when the user closes the file mid-save — produces React's
    // "state update on unmounted component" warning. The timeout id
    // must be retained in a ref and cleaned up in the unmount effect.
    expect(src).toMatch(/savedPillTimerRef/);
    // Cleanup effect must clear the timer when the component unmounts.
    expect(src).toMatch(/clearTimeout\(\s*savedPillTimerRef\.current\s*\)/);
  });
});
