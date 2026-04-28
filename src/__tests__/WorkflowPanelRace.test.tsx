import { describe, expect, it } from "vitest";

/**
 * Regression guards for WorkflowPanel.tsx silent bugs.
 *
 * Bug 1 (HIGH): the listen() registration was inside a dynamic
 * `import("@tauri-apps/api/event").then(...)` chain. Both the import and
 * the listen() promise resolved asynchronously, so unmount cleanup could
 * fire before `unlisten = u` was assigned — leaking a Tauri event listener
 * for a component that no longer exists.
 *
 * Bug 2 (HIGH): handleExportYaml called `setBuilderOpen(false)` no matter
 * what — even when the disk write threw. The user lost the YAML they had
 * just typed, with only a toast to show for it.
 *
 * Both fixes are state-machine guards we can verify in source without
 * hitting the live Tauri runtime.
 */

const sources = import.meta.glob("../features/workflow/WorkflowPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("WorkflowPanel listener race", () => {
  it("listen() promise checks the active flag both before listen and after subscribe", () => {
    const src = getSrc();

    // Find the dynamic import block. The fix re-checks `active` in two
    // places: just inside the import .then() (before subscribing) and
    // just inside the listen .then() (before assigning the unlisten ref).
    expect(src).toContain("isTauriRuntime()");
    const importBlock = src.match(/import\(\s*"@tauri-apps\/api\/event"\s*\)([\s\S]*?)\.catch\(/);
    expect(importBlock).not.toBeNull();
    const body = importBlock?.[1] ?? "";

    // Two separate `if (!active)` guards — one before listen subscribes,
    // one inside the resolution that assigns unlisten.
    const guards = body.match(/if\s*\(\s*!active\s*\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);

    // The post-subscribe guard must call the resolved unlisten so a
    // listener that resolved after unmount doesn't leak.
    expect(body).toMatch(/if\s*\(\s*!active\s*\)\s*\{\s*u\(\s*\)/);
  });
});

describe("WorkflowPanel handleExportYaml", () => {
  it("save failure leaves the builder open so the user keeps their work", () => {
    const src = getSrc();
    const handlerMatch = src.match(
      /const handleExportYaml\s*=\s*useCallback\(\s*async\s*\(\s*yaml[^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[/,
    );
    expect(handlerMatch).not.toBeNull();
    const body = handlerMatch?.[1] ?? "";

    // After the try/catch around invoke("write_file"), the handler must
    // bail out before setBuilderOpen(false) when save failed.
    const earlyReturn = body.match(/if\s*\(\s*!saved\s*\)\s*return\s*;/);
    expect(earlyReturn).not.toBeNull();

    const earlyReturnIdx = body.indexOf("if (!saved) return");
    const builderCloseIdx = body.indexOf("setBuilderOpen(false)");
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(builderCloseIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeLessThan(builderCloseIdx);
  });
});

describe("WorkflowPanel gate action structure", () => {
  it("renders approve/reject as siblings of the phase expansion button", () => {
    const src = getSrc();
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(stripped).toMatch(/className=\{styles\.stepRow\}/);
    expect(stripped).toMatch(/<button[\s\S]*className=\{`\$\{styles\.step\}/);
    expect(stripped).toMatch(/className=\{styles\.gateActions\}/);
    expect(stripped).not.toMatch(/role="button"/);
    expect(stripped).not.toMatch(/e\.stopPropagation\(\)/);
  });
});
