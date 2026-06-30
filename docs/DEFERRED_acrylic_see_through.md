# RESOLVED: window see-through to the desktop / windows behind

Status: **resolved** (2026-06-30). Real translucency — the desktop and the
windows stacked behind Aelyris show through the app — now works. The in-app
wallpaper renders as a translucent layer on top of that see-through.

> This file previously held a **wrong** diagnosis (it blamed only the in-app
> wallpaper backstop and claimed `DWMSBT_TRANSIENTWINDOW` Acrylic delivered
> "real desktop translucency"). That was disproved by OS screen capture. The
> correct root cause and the guards against regressing it are below.

## True root cause (verified by OS screen capture, not assumption)

On a wry per-pixel-transparent window (`transparent: true`, `backgroundColor
[0,0,0,0]`), applying **any window material** fills the client area and
**OCCLUDES** the per-pixel transparency — the desktop/windows behind stop
showing. Two materials were doing this, stacked:

1. **DWM system backdrop** — `lib.rs` applied `DWMWA_SYSTEMBACKDROP_TYPE`
   (Acrylic `DWMSBT_TRANSIENTWINDOW` / Mica `DWMSBT_MAINWINDOW`). This was
   *added* in 2026-04 (`ab420e8`) believing Acrylic = see-through. It is the
   opposite: the material paints over the transparent client area → opaque gray.
2. **window-vibrancy accent** — `tauri.conf` `windowEffects.effects: ["acrylic"]`
   applied `ACCENT_ENABLE_ACRYLICBLURBEHIND`, a second occluder.

Evidence (OS PrintWindow/screen capture, **without** CDP — CDP suppresses the
backdrop, so never verify transparency with `AELYRIS_ENABLE_WEBVIEW2_CDP=1`):

| Window material | Result |
| --- | --- |
| DWMSBT Acrylic (focused) | opaque dark gray, nothing behind |
| windowEffects accent acrylic | opaque dark gray |
| **No material** (DWMSBT_NONE + `windowEffects.effects: []`) | **desktop + windows behind show through** ✓ |

A CDP DOM probe separately proved the web content was already fully transparent
(`html/body/#root/.app-container` all `rgba(0,0,0,0)`, no viewport-covering
opaque layer) — so the occluder was the native material, not CSS.

Corollary: frosted "Acrylic glass" and per-pixel see-through are **mutually
exclusive** on this stack. We chose see-through.

## The fix (shipped)

1. `window_effect = "transparent"` is the default. `backdrop_for_effect`
   (`src-tauri/src/lib.rs`) maps `transparent` → `DWMSBT_NONE` (no material =
   see-through); `mica`/`acrylic` remain opt-in **opaque** materials.
2. `windowEffects.effects: []` in both `tauri.conf.json` and
   `tauri.dev.conf.json` (no vibrancy accent occluder).
3. The in-app wallpaper backstop is transparent in see-through mode
   (`useTheme.ts`, `seeThrough` arg), so the wallpaper image is a translucent
   layer over the live desktop, tuned by the wallpaper opacity slider.

## Guards against regressing this (so the same mistake can't land silently)

- `backdrop_tests` in `src-tauri/src/lib.rs` — `transparent`/unknown →
  `DWMSBT_NONE`, `mica`/`acrylic` → their material values.
- `src/__tests__/window-transparency.test.ts` — both Tauri configs must keep
  `windowEffects.effects: []`, `transparent: true`, `backgroundColor [0,0,0,0]`,
  and the default effect must be `transparent`.
- Comments at each site (`backdrop_for_effect`, the `windowEffects` config
  `_comment`) state that a material occludes see-through.

## Notes / OS caveats

- See-through is **crisp** (no blur), because the blur came from the material we
  removed. Panels keep their own semi-opaque glass backgrounds for legibility.
- Win11 still suppresses materials on inactive windows, but that no longer
  matters here since see-through uses no material.
