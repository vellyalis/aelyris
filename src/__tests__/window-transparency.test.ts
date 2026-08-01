// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_WINDOW_EFFECT, sanitizeWindowEffect } from "../shared/store/appStore";

declare const process: { cwd(): string };

/**
 * Regression guard for the 2026-04 "acrylic occludes transparency" bug.
 *
 * On a wry per-pixel-transparent window (`transparent: true`), Tauri's static
 * `windowEffects` material and DWM system backdrops can fill the client area and
 * occlude see-through. Keep this config material-free: lib.rs is the sole live
 * owner and applies either DWM NONE, opaque Mica, or the verified SWCA Acrylic.
 *
 * These assertions fail the build if a material is reintroduced into the Tauri
 * window config, so the regression cannot land silently again. The Rust side is
 * guarded by `backdrop_tests` in src-tauri/src/lib.rs (transparent -> DWMSBT_NONE).
 */
function loadWindowConfig(relPath: string) {
  const raw = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const conf = JSON.parse(raw);
  const win = conf.app.windows[0];
  return win;
}

describe.each([
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.dev.conf.json",
])("window transparency config: %s", (relPath) => {
  const win = loadWindowConfig(relPath);

  it("keeps the window per-pixel transparent", () => {
    expect(win.transparent).toBe(true);
  });

  it("uses a fully transparent backgroundColor (alpha 0)", () => {
    expect(win.backgroundColor).toEqual([0, 0, 0, 0]);
  });

  it("applies NO window material (windowEffects.effects must be empty)", () => {
    // A non-empty effects array creates a second accent owner that can race
    // live switching. Runtime window_effect owns DWM/SWCA composition.
    expect(win.windowEffects?.effects ?? []).toEqual([]);
  });
});

describe("Settings window-effect wiring (source contract)", () => {
  const settingsSrc = readFileSync(resolve(process.cwd(), "src/features/settings/Settings.tsx"), "utf8");

  it("loads window_effect through sanitizeWindowEffect (never coerces transparent to mica)", () => {
    // Regression guard: the old `=== "acrylic" ? "acrylic" : "mica"` coercion
    // silently dropped a persisted "transparent" to "mica", reapplying the
    // opaque material and killing the default see-through.
    expect(settingsSrc).toContain("sanitizeWindowEffect(cfg.appearance.window_effect)");
    expect(settingsSrc).not.toMatch(/window_effect === "acrylic" \? "acrylic" : "mica"/);
  });

  it("applies the backdrop and current opacity live when the dropdown changes", () => {
    expect(settingsSrc).toMatch(
      /onValueChange[\s\S]*?invoke\("set_window_effect", \{ effect, opacity: windowOpacity \}\)/,
    );
  });

  it("re-applies Acrylic while the opacity slider moves", () => {
    expect(settingsSrc).toContain('windowEffect === "acrylic"');
    expect(settingsSrc).toContain('invoke("set_window_effect", { effect: windowEffect, opacity: next })');
  });
});

describe("Windows window-chrome source contract", () => {
  const libSrc = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
  const commandSrc = readFileSync(resolve(process.cwd(), "src-tauri/src/ipc/config_commands.rs"), "utf8");

  it("keeps Acrylic off the opaque DWM transient-window backdrop", () => {
    const acrylicArm = libSrc.match(/"acrylic"\s*=>\s*\(([\s\S]*?)\),\s*\/\//)?.[1] ?? "";
    expect(acrylicArm).toContain("1,");
    expect(acrylicArm).not.toContain("3,");
    expect(libSrc).toContain("ACCENT_ENABLE_ACRYLIC_BLUR_BEHIND");
    expect(libSrc).toContain('GetProcAddress(user32, s!("SetWindowCompositionAttribute"))');
    expect(libSrc).not.toContain('link_name = "SetWindowCompositionAttribute"');
  });

  it("clears AccentPolicy before changing the DWM backdrop", () => {
    const applyBody = libSrc.slice(
      libSrc.indexOf("pub(crate) fn apply_window_backdrop"),
      libSrc.indexOf("#[cfg(test)]\nmod backdrop_tests"),
    );
    expect(applyBody.indexOf("apply_accent_policy(hwnd, ACCENT_DISABLED, 0)")).toBeGreaterThan(-1);
    expect(applyBody.indexOf("apply_accent_policy(hwnd, ACCENT_DISABLED, 0)")).toBeLessThan(
      applyBody.indexOf("DwmSetWindowAttribute("),
    );
  });

  it("applies startup composition after the WebView2 background is transparent", () => {
    const setup = libSrc.slice(libSrc.indexOf("SetDefaultBackgroundColor(COREWEBVIEW2_COLOR"));
    expect(setup.indexOf("SetDefaultBackgroundColor(COREWEBVIEW2_COLOR")).toBeGreaterThan(-1);
    expect(setup.indexOf("apply_window_backdrop(")).toBeGreaterThan(
      setup.indexOf("SetDefaultBackgroundColor(COREWEBVIEW2_COLOR"),
    );
  });

  it("binds the live IPC to the supplied opacity", () => {
    expect(commandSrc).toMatch(/set_window_effect\([\s\S]*?opacity: f32/);
    expect(commandSrc).toContain("apply_window_backdrop(hwnd, &effect, opacity)");
  });
});

describe("window effect default", () => {
  it("defaults to see-through (transparent), not an opaque material", () => {
    expect(DEFAULT_WINDOW_EFFECT).toBe("transparent");
  });

  it("sanitizes unknown values to the see-through default", () => {
    expect(sanitizeWindowEffect("garbage")).toBe("transparent");
    expect(sanitizeWindowEffect(null)).toBe("transparent");
    expect(sanitizeWindowEffect("mica")).toBe("mica");
    expect(sanitizeWindowEffect("acrylic")).toBe("acrylic");
    expect(sanitizeWindowEffect("transparent")).toBe("transparent");
  });
});
