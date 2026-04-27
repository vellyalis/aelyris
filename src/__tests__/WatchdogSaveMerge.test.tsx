import { describe, expect, it } from "vitest";

/**
 * Regression guard for WatchdogDialog.tsx data-loss bugs.
 *
 * Bug 1 (CRITICAL — same shape as Settings.tsx Bug 1): handleSave used to
 * send the local `rules` state directly. If `get_watchdog_rules` failed
 * silently (the catch was `() => {}`), the rules state stayed at its
 * initial `{ enabled: false, auto_approve: [] }` default. Clicking Save
 * then wrote that empty default to disk, wiping every user-defined rule.
 *
 * Bug 2 (HIGH — same shape as Settings.tsx Bug 3): the Save invoke ended
 * in a bare `catch` swallow — failures were silently dropped and the
 * dialog closed (because setSaving(false) ran unconditionally and the
 * caller assumed success).
 *
 * Bug 3 (MEDIUM): the load `useEffect` had no cancelled flag, so a stale
 * resolution from a previous open could overwrite freshly loaded rules.
 *
 * Bug 4 (MEDIUM): setSaving(false) ran on a possibly-unmounted component
 * if the user closed the dialog mid-save.
 *
 * Runtime reproduction is fragile (Radix Dialog + Tauri invoke mocks +
 * jsdom), so we guard the structural fix in source instead — same
 * approach as SettingsSaveMerge.test.tsx.
 */

const sources = import.meta.glob("../features/watchdog/WatchdogDialog.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("WatchdogDialog.tsx Save merge", () => {
  it("Save merges through `loadedRules` instead of writing local state directly", () => {
    const src = getSrc();
    // The merged payload must spread loadedRules so any future field added
    // by Rust round-trips even if the UI doesn't edit it yet.
    expect(src).toMatch(/\.\.\.loadedRules/);
    expect(src).toMatch(/loadedRules/);

    // The bare `setRules` callback in `.then(setRules)` that ignored the
    // disk snapshot for round-trip purposes must be gone.
    expect(src).not.toMatch(/get_watchdog_rules[\s\S]{0,80}\.then\(\s*setRules\s*\)/);
  });

  it("handleSave guards on null loadedRules with a user-visible warning", () => {
    const src = getSrc();
    // Without the guard, a load failure leaves rules at its initial empty
    // default and Save would persist that empty default. The guard must
    // surface a toast (warning/error/info) instead of silently sending the
    // default to disk.
    expect(src).toMatch(/!loadedRules[\s\S]*?toast\.(warning|error|info)\(/);
  });

  it("load failure surfaces a toast instead of leaving Save as a silent no-op", () => {
    const src = getSrc();
    // The bug: get_watchdog_rules().catch(() => {}) plus default-empty
    // rules state. Net effect — load fails silently, user sees an empty
    // dialog, hits Save, disk gets overwritten with empty defaults.
    expect(src).toMatch(/get_watchdog_rules[\s\S]*?\.catch\(\s*\(\s*err\s*\)[\s\S]*?toast\.error\(/);
    expect(src).not.toMatch(/get_watchdog_rules[\s\S]{0,200}\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });

  it("Save failure surfaces a toast instead of closing silently", () => {
    const src = getSrc();
    // Anchor on the save_watchdog_rules invoke and verify its catch chain.
    expect(src).toMatch(/save_watchdog_rules[\s\S]*?catch\s*\(\s*err\s*\)[\s\S]*?toast\.error\(/);
    // The bare `catch { /* ignore */ }` swallow that hid failures must be gone.
    expect(src).not.toMatch(/save_watchdog_rules[\s\S]{0,200}catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/);
  });

  it("load useEffect uses a cancellation flag to drop stale resolutions", () => {
    const src = getSrc();
    // Find the useEffect that calls get_watchdog_rules.
    const effectRegex = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[([^\]]*)\]\s*\)/g;
    const matches = Array.from(src.matchAll(effectRegex));

    let found = false;
    for (const m of matches) {
      const body = m[1];
      if (!body.includes("get_watchdog_rules")) continue;
      found = true;

      // Must declare and toggle a cancellation flag, and the .then must
      // bail out when cancelled — otherwise a slow load resolved after
      // the dialog re-opened would overwrite a fresh successful load.
      expect(body).toMatch(/let\s+cancelled\s*=\s*false/);
      expect(body).toMatch(/if\s*\(cancelled\)\s*return/);
      expect(body).toMatch(/cancelled\s*=\s*true/);
    }

    expect(found).toBe(true);
  });

  it("setSaving guards on mountedRef to avoid state updates after unmount", () => {
    const src = getSrc();
    // Without mountedRef, closing the dialog mid-save (via Cancel or
    // Escape) leaves a pending setSaving(false) that fires on an
    // unmounted component — React warns and the next mount inherits
    // saving=true via stale closure if anything memoizes wrong.
    expect(src).toMatch(/mountedRef\s*=\s*useRef\(true\)/);
    expect(src).toMatch(/mountedRef\.current\s*=\s*false/);
    expect(src).toMatch(/!mountedRef\.current/);
  });

  it("loadedRules is cleared before each open so stale snapshots cannot bypass the save guard (codex r2 P2)", () => {
    const src = getSrc();
    // Bug: after the first successful open, loadedRules stays set even
    // when the dialog closes. On reopen, if Save fires before the new
    // get_watchdog_rules resolves (or after it rejects), the null guard
    // passes and the *previous* session's rules overwrite disk.
    //
    // Find the visible-gated useEffect and confirm it clears loadedRules
    // before starting the fetch.
    const effectRegex = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[([^\]]*)\]\s*\)/g;
    const matches = Array.from(src.matchAll(effectRegex));

    let found = false;
    for (const m of matches) {
      const body = m[1];
      if (!body.includes("get_watchdog_rules")) continue;
      found = true;
      // The setLoadedRules(null) reset must appear *before* the invoke
      // call inside the same effect body, otherwise the previous open's
      // value still gates the null check while the new fetch is racing.
      const resetIdx = body.indexOf("setLoadedRules(null)");
      const fetchIdx = body.indexOf("get_watchdog_rules");
      expect(resetIdx).toBeGreaterThanOrEqual(0);
      expect(fetchIdx).toBeGreaterThanOrEqual(0);
      expect(resetIdx).toBeLessThan(fetchIdx);
    }

    expect(found).toBe(true);
  });
});
