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
 * Root cause: on a wry per-pixel-transparent window (`transparent: true`),
 * applying ANY window material — a `windowEffects` vibrancy material here, or a
 * DWM system backdrop in lib.rs — fills the client area and OCCLUDES see-through
 * (the desktop/windows behind stop showing). See-through REQUIRES no material.
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

describe.each(["src-tauri/tauri.conf.json", "src-tauri/tauri.dev.conf.json"])(
  "window transparency config: %s",
  (relPath) => {
    const win = loadWindowConfig(relPath);

    it("keeps the window per-pixel transparent", () => {
      expect(win.transparent).toBe(true);
    });

    it("uses a fully transparent backgroundColor (alpha 0)", () => {
      expect(win.backgroundColor).toEqual([0, 0, 0, 0]);
    });

    it("applies NO window material (windowEffects.effects must be empty)", () => {
      // A non-empty effects array (e.g. ["acrylic"]) re-introduces the occluder
      // that broke see-through. Keep it empty; the backdrop is chosen at runtime
      // by window_effect via backdrop_for_effect (lib.rs), and see-through uses
      // DWMSBT_NONE (no material).
      expect(win.windowEffects?.effects ?? []).toEqual([]);
    });
  },
);

describe("Settings window-effect wiring (source contract)", () => {
  const settingsSrc = readFileSync(
    resolve(process.cwd(), "src/features/settings/Settings.tsx"),
    "utf8",
  );

  it("loads window_effect through sanitizeWindowEffect (never coerces transparent to mica)", () => {
    // Regression guard: the old `=== "acrylic" ? "acrylic" : "mica"` coercion
    // silently dropped a persisted "transparent" to "mica", reapplying the
    // opaque material and killing the default see-through.
    expect(settingsSrc).toContain("sanitizeWindowEffect(cfg.appearance.window_effect)");
    expect(settingsSrc).not.toMatch(/window_effect === "acrylic" \? "acrylic" : "mica"/);
  });

  it("applies the backdrop live when the dropdown changes (not only on next launch)", () => {
    expect(settingsSrc).toMatch(/onValueChange[\s\S]*?invoke\("set_window_effect"/);
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
