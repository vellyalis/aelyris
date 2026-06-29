# Deferred: Acrylic "see through to other windows" not working

Status: **deferred** (user-approved postpone). Root cause is fully diagnosed; this
is a ready-to-implement work item. Safe to hand to Codex or a future session.

## Symptom
The window only shows the desktop **wallpaper tint** (Windows Mica), never real
desktop translucency that reveals **other windows/apps behind**. Switching the
in-app Settings → Window Effect to **Acrylic** appears to do nothing.

## Root cause (two stacked blockers — both must be fixed)

### (b) PRIMARY — Window Effect change is never applied live
- `src-tauri/src/lib.rs:475` reads `config::load_config().appearance.window_effect`
  and applies the DWM backdrop (`DWMWA_SYSTEMBACKDROP_TYPE`: acrylic →
  `DWMSBT_TRANSIENTWINDOW`, mica → `DWMSBT_MAINWINDOW`) **exactly once**, inside the
  `setup` closure (the only `DwmSetWindowAttribute(... SYSTEMBACKDROP_TYPE ...)` call
  site is `lib.rs:499-533`).
- There is **no** `set_window_effect` Tauri command. `src-tauri/src/ipc/config_commands.rs`
  has zero references to `window_effect`/`Dwm`/`DWMSBT`.
- `src/features/settings/Settings.tsx:556-574` only `invoke("save_app_config", ...)`
  + `setStoreWindowEffect(...)` (JS store + persistence). It never re-applies the DWM
  backdrop. → changing Window Effect in Settings does nothing until the next app launch,
  and the persisted value is often still `"mica"`.

### (a) SECONDARY — a set in-app wallpaper image paints an opaque layer over the backdrop
- `src/shared/hooks/useTheme.ts:93-98`: when the active mood has a wallpaper `imagePath`,
  it sets `--aelyris-wallpaper-image` AND an **opaque** `--aelyris-wallpaper-backstop`
  (`#fbf2f7` light / `#05070e` dark).
- `global.css:867-885` `.app-container::before` (`position:fixed; inset:0`) paints that
  backstop + image at `--aelyris-wallpaper-opacity` (per-mood config, e.g. 0.64).
- Result: a ~65%-opaque full-window layer covers the DWM backdrop. A set in-app wallpaper
  is mutually exclusive with desktop see-through. (NOT a hard blocker: `html,body,#root`
  are `background: transparent`; WebView2 client area is transparent — `lib.rs:580/590` +
  `tauri.conf backgroundColor [0,0,0,0]`. Only the wallpaper backstop blocks.)

## Fix recipe
1. **(b) Apply live, no restart:**
   - Extract the DWMSBT block (`lib.rs:494-533`) into `fn apply_window_backdrop(hwnd, window_effect: &str)`.
   - Add `#[tauri::command] set_window_effect(effect: String)` in `config_commands.rs`
     that resolves the `"main"` window HWND and calls that fn; register it in the invoke handler.
   - In `Settings.tsx` after `save_app_config` succeeds (~`:557`),
     `invoke("set_window_effect", { effect: windowEffect })`.
   - Ensure the value actually persists as `"acrylic"`.
2. **(a) For see-through, the active mood must have no opaque wallpaper:** set its wallpaper
   `opacity = 0` or clear `imagePath` (so `useTheme.ts:101` sets backstop `transparent`).
   Alternatively, a "translucent wallpaper over acrylic" mode would set the backstop
   transparent even with an image — a separate design decision (user wants image + desktop
   both visible vs. desktop-only).

## Verification
- After the fix: switch Window Effect → Acrylic (applies live) AND clear the active mood's
  wallpaper → `DWMSBT_TRANSIENTWINDOW` + transparent WebView2 + no opaque CSS layer = other
  windows visible behind. Note: Win11 suppresses Acrylic on **inactive** windows by OS design.
- CDP/`AELYRIS_ENABLE_WEBVIEW2_CDP=1` forces WebView2 into a compositing path that SUPPRESSES
  the backdrop (`main.rs:23`) — verify transparency only WITHOUT that env var, by eye / OS
  PrintWindow, never via CDP.
