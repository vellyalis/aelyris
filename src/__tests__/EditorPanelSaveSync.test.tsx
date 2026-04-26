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

    // Extract the body of `if (stillCurrent) { ... }` via brace matching
    // instead of indentation-coupled regex. A positional check on the bare
    // identifier alone would still pass if `setContent(value)` were moved
    // outside the if-block (the `const stillCurrent = …` declaration
    // appears earlier and would satisfy a naive ordering check).
    const successArm = src.match(/\.then\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*\.catch/);
    expect(successArm).not.toBeNull();
    const body = successArm![1];

    const ifMatch = body.match(/if\s*\(\s*stillCurrent\s*\)\s*\{/);
    expect(ifMatch).not.toBeNull();
    const ifOpenIdx = body.indexOf(ifMatch![0]);
    const braceStart = ifOpenIdx + ifMatch![0].length - 1;
    let depth = 1;
    let i = braceStart + 1;
    while (i < body.length && depth > 0) {
      if (body[i] === "{") depth += 1;
      else if (body[i] === "}") depth -= 1;
      i += 1;
    }
    expect(depth).toBe(0);
    const ifBlockBody = body.slice(braceStart + 1, i - 1);

    expect(ifBlockBody).toMatch(/setContent\(\s*value\s*\)/);
    expect(ifBlockBody).toMatch(/setModified\(\s*false\s*\)/);
    expect(ifBlockBody).toMatch(/setSaved\(\s*true\s*\)/);
  });

  it("save handlers gate state mutations on mountedRef as well as filePathRef (codex r2 M)", () => {
    const src = Object.entries(sources)[0][1];

    // mountedRef must exist and be flipped to false in the unmount cleanup.
    expect(src).toMatch(/mountedRef\s*=\s*useRef\(\s*true\s*\)/);
    expect(src).toMatch(/mountedRef\.current\s*=\s*false/);

    // Both .then and .catch must consult mountedRef. Otherwise an
    // unmount mid-save lets state setters fire on a torn-down panel.
    const successArm = src.match(/\.then\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*\.catch/);
    expect(successArm).not.toBeNull();
    expect(successArm![1]).toMatch(/mountedRef\.current/);

    const catchArm = src.match(/\.catch\(\s*\(\s*err\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/);
    expect(catchArm).not.toBeNull();
    expect(catchArm![1]).toMatch(/mountedRef\.current/);
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
