# mcp-server-tauri Evaluation

Evaluation for introducing `@hypothesi/tauri-mcp-server` as an AI-automatable
surface for Aether Terminal.

Status: **not installed**. Evaluation only, written 2026-04-24.

## What it is

- MCP server that lets Claude / Cursor / Windsurf drive a running Tauri app.
- Architecture: WebSocket on port 9223 between the MCP server and a
  `tauri-plugin-mcp-bridge` Rust plugin embedded in the target app.
- Capabilities exposed:
  - `webview_screenshot`
  - `webview_interact` (click, scroll, swipe, focus, long-press)
  - `webview_keyboard` (type text, send key events)
  - `webview_find_element`, `webview_select_element` (visual picker)
  - `webview_dom_snapshot`, `webview_execute_js`
  - `ipc_execute_command`, `ipc_monitor`
  - `read_logs`, multi-window.
- Install:
  - Claude Code side: `npx -y install-mcp @hypothesi/tauri-mcp-server --client claude-code`
  - Tauri side: add `tauri-plugin-mcp-bridge` to `src-tauri/Cargo.toml`,
    register in `lib.rs`, declare capability in `tauri.conf.json`. Exact
    lines are not documented in the project README — the README delegates
    to "ask your AI assistant" which means we have to read the plugin's own
    source to produce a correct patch.

## Fit vs Aether Terminal's current pain

| use case | mcp-server-tauri fits? |
|----------|------------------------|
| IME live verify (項目 1/2/3 of 2026-04-24 live check) | ❌ `webview_keyboard` sends DOM events, bypassing OS TSF/IMM32. Japanese composition cannot be replayed. |
| Focus / keybind tests (Ctrl+Shift+J, Esc, pane split shortcuts) | ⭕ Plain key events work. |
| 3C-2 / 3C-3 visual check (see `docs/visual-check-phase3.md`) | ⭕ `webview_screenshot` + `webview_dom_snapshot` remove the manual eyeball loop. High value. |
| IPC regression (commands don't silently drift) | ⭕ `ipc_monitor` + `ipc_execute_command` give us a dry-run harness. |
| Headless E2E in CI | △ Needs a display — Tauri has no pure headless mode on Windows. Works on a real runner, not in cloud CI. |
| 3D-1 API regression (`scripts/verify-3d1.mjs`) | ❌ Not needed — we already have a Node-side verifier that doesn't require the app window. |

## Conflict check

- Port 9223 vs 3D-1 API port 9333 → OK, no clash.
- Extra Cargo dependency → target/ cache grows. Feature-gate it to
  `cfg(debug_assertions)` so release bundle does not ship the plugin.

## Minimum viable introduction plan (when we do it)

1. Branch `feat/mcp-server-tauri`, target `refactor/tauri-react-migration`
   after v0.2.0 tag is done.
2. Read `hypothesi/mcp-server-tauri` Rust plugin source directly (not README)
   to nail down:
   - exact crate name + version on crates.io / git
   - `init()` / `Builder` call site
   - required `tauri.conf.json` capability scope
3. Add behind `#[cfg(debug_assertions)]` so `pnpm tauri build` (release) does
   not include the MCP bridge.
4. `.mcp.json` in repo root (project-scoped MCP registration). Document in
   `CLAUDE.md` so anyone running Claude Code in this repo picks it up.
5. Smoke test: ask Claude Code to take a screenshot and list windows. If
   that works, we have a working loop.
6. First real use: rerun `docs/visual-check-phase3.md` D-1 checklist via MCP
   screenshots, pinning baseline images under `docs/phase3/visual-baselines/`.

## Decision gate

Do we want this **before** dogfooding for a full 2 weeks? Probably no.
Dogfood pain (recorded in `project_dogfood_log.md`) will tell us whether
visual-regression / IPC-monitor pain is real. If by 2026-05-08 the log
shows "UI drift bit me" or "IPC silently changed shape," install mcp-server-tauri
then. Until then, this note is bookmarked.
