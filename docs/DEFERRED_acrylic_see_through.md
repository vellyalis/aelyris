# RESOLVED: transparent and Acrylic see-through on Windows

Status: **resolved** (updated 2026-08-02). Aelyris now has two distinct
see-through modes on the Windows 11 Tauri/WebView2 stack:

- `transparent`: crisp per-pixel see-through with no native blur.
- `acrylic`: blurred see-through using `SetWindowCompositionAttribute` (SWCA)
  Acrylic over a `DWMSBT_NONE` window.
- `mica`: opaque Windows Mica, intentionally not see-through.

No new public effect or runtime dependency is used.

## Empirical mechanism result

OS-level capture, not a DOM/CDP inference, established the mechanism boundary:

| Native mechanism | Observed result |
| --- | --- |
| `DWMSBT_TRANSIENTWINDOW` | opaque dark gray; background hidden |
| Tauri `windowEffects.effects: ["acrylic"]` | opaque dark gray and a second accent owner |
| `DWMSBT_NONE` only | crisp desktop/windows see-through |
| `DWMSBT_NONE` + SWCA `AccentState=4` | blurred desktop/windows see-through |

The proven SWCA vector used `AccentFlags=0` and dark ABGR tint equivalent to
RGBA `(3, 10, 22, 120)`. It returned success and produced visible OS-captured
blur even with CDP enabled. Web content and the terminal renderer must still
leave enough alpha for the native blur to remain visible; a DOM/CDP observation
alone is not final glass proof because it cannot establish native composition.

## Runtime contract

`src-tauri/src/lib.rs` is the single Windows composition owner. Static Tauri
window effects stay empty in both configs.

1. Before every live switch, clear the prior SWCA `AccentPolicy`. This makes
   Acrylic → transparent/Mica switching reversible instead of leaving blur
   attached to the HWND.
2. `transparent` applies `DWMSBT_NONE` and no AccentPolicy.
3. `mica` applies `DWMSBT_MAINWINDOW` and no AccentPolicy.
4. `acrylic` applies `DWMSBT_NONE`, then SWCA
   `ACCENT_ENABLE_ACRYLICBLURBEHIND` (`AccentState=4`). It never uses the opaque
   `DWMSBT_TRANSIENTWINDOW` path.
5. If SWCA Acrylic is refused, DWM NONE has already been applied, so the window
   degrades to crisp transparent instead of opaque gray. The IPC returns an
   actionable error and logs the failed native operation.

The appearance opacity slider (0.2–1.0) maps linearly to tint alpha 48–128.
This keeps the dark tint visibly tied to the user's setting while bounding it
inside the empirically useful translucent interval. The normal 0.95 setting
maps to alpha 123, close to the proven alpha 120 vector. RGB remains `(3,10,22)`
so changing strength does not shift the product palette.

Startup and the live `set_window_effect` IPC call the same helper with the same
effect and appearance opacity. Changing Acrylic opacity in Settings re-applies
the native tint immediately; Save persists the already-applied values.

## Regression guards

- `backdrop_tests` in `src-tauri/src/lib.rs` prove:
  - transparent/unknown → DWM NONE + Accent disabled;
  - Mica → DWM MAINWINDOW + Accent disabled;
  - Acrylic → DWM NONE + Accent state 4;
  - opacity clamping/defaulting and exact ABGR tint encoding.
- `src/__tests__/window-transparency.test.ts` proves:
  - both Tauri configs remain per-pixel transparent and material-free;
  - live Settings calls carry opacity;
  - Acrylic avoids DWM transient-window and uses SWCA;
  - AccentPolicy is cleared before the DWM mode changes.

## Remaining visual caveats

- Panel and terminal surface alpha can still visually cover correct native
  Acrylic. Evaluate the native mechanism separately from CSS/canvas opacity.
- Windows composition behavior can vary by OS build, remote desktop, power
  policy, and inactive-window state. SWCA failure remains transparent and is
  not promoted to a Mica or opaque fallback.
- Final visual acceptance requires an OS-level screenshot with another window
  behind Aelyris; CDP state must be recorded but is not itself a blocker.
