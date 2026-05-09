import { describe, expect, it } from "vitest";

/**
 * Regression guard for Settings.tsx data-loss bugs.
 *
 * Bug 1 (CRITICAL): handleSave used to send a hand-built config object with
 * hardcoded defaults for `ui_font_family`, `window_effect`, `opacity`, and
 * `scrollback`, plus no `window` field. When deserialized by Rust the
 * `#[serde(default)]` filled the missing `[window]` block with defaults —
 * silently overwriting `last_directory`, `maximized`, `sidebar_visible`,
 * and `tab_count` every time the user clicked Save.
 *
 * Bug 2 (HIGH): the load `useEffect` only fired on first mount because its
 * deps list was `[setGhostDiffLiveMode]`. A user who edited config.toml
 * between dialog opens would have their changes overwritten by stale state.
 *
 * Bug 3 (MEDIUM): the Save invoke ended in `.catch(() => {})` — failures
 * were silently swallowed and the dialog still closed, with no feedback.
 *
 * Runtime reproduction is fragile (Radix Dialog + Tauri invoke mocks +
 * jsdom), so we guard the structural fix in source instead.
 */

const sources = import.meta.glob("../features/settings/Settings.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("Settings.tsx Save merge", () => {
  it("Save merges through `loadedConfig` instead of rebuilding from defaults", () => {
    const src = getSrc();
    // The merged payload must spread loadedConfig so window state +
    // ui_font_family + window_effect + opacity + scrollback survive.
    expect(src).toMatch(/\.\.\.loadedConfig/);
    expect(src).toMatch(/\.\.\.loadedConfig\.appearance/);
    expect(src).toMatch(/\.\.\.loadedConfig\.terminal/);

    // Hardcoded defaults that previously clobbered user settings must be
    // gone from the save path.
    const handleSaveMatch = src.match(/const handleSave\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/);
    expect(handleSaveMatch).not.toBeNull();
    const body = handleSaveMatch?.[1];
    expect(body).not.toMatch(/ui_font_family:\s*"IBM Plex Sans"/);
    expect(body).not.toMatch(/window_effect:\s*"mica"/);
    expect(body).not.toMatch(/opacity:\s*0\.95/);
    expect(body).not.toMatch(/scrollback:\s*10000/);
  });

  it("load useEffect re-runs when the dialog becomes visible", () => {
    const src = getSrc();
    // Find the useEffect that calls load_app_config.
    const effectRegex = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[([^\]]*)\]\s*\)/g;
    const matches = Array.from(src.matchAll(effectRegex));

    let found = false;
    for (const m of matches) {
      const body = m[1];
      const deps = m[2];
      if (!body.includes("load_app_config")) continue;
      found = true;

      // visible must gate + appear in deps so re-opening the dialog re-loads.
      expect(body).toMatch(/if\s*\(!visible\)\s*return/);
      const depList = deps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(depList).toContain("visible");
    }

    expect(found).toBe(true);
  });

  it("load useEffect does not re-run from editable field changes", () => {
    const src = getSrc();
    const effectRegex = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[([^\]]*)\]\s*\)/g;
    const matches = Array.from(src.matchAll(effectRegex));

    let found = false;
    for (const m of matches) {
      const body = m[1];
      const deps = m[2];
      if (!body.includes("load_app_config")) continue;
      found = true;

      const depList = deps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      expect(depList).toContain("visible");
      expect(depList).not.toContain("storeTheme");
      expect(depList).not.toContain("storeMood");
      expect(depList).not.toContain("defaultShell");
      expect(depList).not.toContain("ghostDiffLiveMode");
    }

    expect(found).toBe(true);
  });

  it("late load_app_config responses do not overwrite user edits", () => {
    const src = getSrc();

    expect(src).toMatch(/const userEditedRef\s*=\s*useRef\(false\)/);
    expect(src).toMatch(/userEditedRef\.current\s*=\s*false/);
    expect(src).toMatch(/setLoadedConfig\(cfg\);\s*if\s*\(userEditedRef\.current\)\s*return;/);
    expect(src).toMatch(/const markEdited\s*=\s*\(\)\s*=>\s*\{[\s\S]*?userEditedRef\.current\s*=\s*true/);
  });

  it("Save failure surfaces a toast instead of closing silently", () => {
    const src = getSrc();

    // Anchor on the save_app_config invoke and verify its `.catch`/`.then`
    // chain. Matching against the full handleSave body is fragile because
    // nested braces inside the merged-config literal trip up `.*?` regex.
    expect(src).toMatch(/invoke\(\s*"save_app_config"[\s\S]*?\.catch\s*\(\s*\(\s*err\s*\)/);
    expect(src).toMatch(/invoke\(\s*"save_app_config"[\s\S]*?toast\.error\(/);
    // Success path must close via .then so a failed save leaves the
    // dialog open for the user to retry.
    expect(src).toMatch(/invoke\(\s*"save_app_config"[\s\S]*?\.then\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?onClose\(\s*\)/);
    expect(src).toMatch(/invoke\(\s*"save_app_config"[\s\S]*?\.then\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?setThemeId\(theme\)/);
    // The bare `.catch(() => {})` swallow that hid failures must be gone.
    expect(src).not.toMatch(/save_app_config[\s\S]{0,200}\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });

  it("load failure surfaces a toast instead of leaving Save as a silent no-op (codex r0 M1)", () => {
    const src = getSrc();

    // The bug: load_app_config().catch(() => {}) plus a !loadedConfig guard
    // in handleSave that just calls onClose(). Net effect — load fails
    // silently, user fills in choices, clicks Save, dialog closes with no
    // disk write and no feedback. Both surfaces must alert the user.
    expect(src).toMatch(/load_app_config[\s\S]*?\.catch\(\s*\(\s*err\s*\)[\s\S]*?toast\.error\(/);
    expect(src).toMatch(/!loadedConfig[\s\S]*?toast\.(warning|error|info)\(/);
    expect(src).not.toMatch(/load_app_config[\s\S]{0,200}\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });
});
