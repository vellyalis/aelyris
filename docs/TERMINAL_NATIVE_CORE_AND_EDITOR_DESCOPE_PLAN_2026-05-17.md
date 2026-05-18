# Terminal Native Core and Editor Descope Plan

Date: 2026-05-17

## Product Direction

Aether should stay a React + Tauri workspace shell for fast iteration, visual polish, settings, panels, and orchestration. The terminal core should move toward Rust-owned correctness: PTY lifecycle, pane/session model, scrollback, keymap, IME placement, persistence, recovery, and performance-sensitive rendering state.

The built-in Monaco editor is no longer a strategic center. Opening files in VSCode is enough for most workflows, and removing the editor surface reduces memory, bundle size, LSP process churn, and focus/IME contention.

## P0: Terminal Correctness

- Keep React/Tauri as the UI shell.
- Treat IME positioning as a release blocker for AI CLIs.
- Prefer Rust-owned terminal/session state over DOM heuristics where possible.
- Keep AI CLI input anchoring enabled in every terminal surface, including embedded agent terminals.
- Verify Codex CLI, Claude Code CLI, and Gemini CLI separately because their TUI cursor semantics differ.

## P1: Native Core Boundary

Rust should own:

- PTY spawn/resize/write/kill/restart.
- Pane split tree, move/swap/even layout, session identity, and recovery.
- Persistent scrollback and terminal snapshots.
- Prefix/keymap processing.
- AI CLI session classification and input-region hints where possible.
- IME candidate positioning API and diagnostics.

React should own:

- Visual layout, settings, command palette, right rail, file tree, and workflow UI.
- Rendering the current terminal grid until a full native renderer is justified.
- User-facing diagnostics and QA overlays, gated off by default.

## P1: Editor Descope

Phase 1:
- Add an editor open mode: `builtin` vs `vscode`.
- Default new installs to `vscode`.
- Route FileTree, Search, Quick Open, terminal file links, and SCM open actions to VSCode.

Phase 2:
- Split diff behavior: `monaco`, `external`, or `text`.
- Route file diffs to VSCode diff or a lightweight internal read-only text diff.
- Keep SCM metadata and review queue in Aether.

Phase 3:
- Stop starting LSP when builtin editor is disabled.
- Remove Monaco chunks, Monaco Vim, and editor-only LSP wiring after external open mode is stable.

## Acceptance Gates

- Codex CLI, Claude Code CLI, and Gemini CLI Japanese IME candidate windows stay at the visible input/preedit position.
- Pane split/close/reopen does not flash a console window or lose focus.
- New agent terminals inherit AI CLI IME anchoring.
- Opening a file from any Aether surface opens VSCode at the file/line.
- No editor/LSP bundle is loaded when editor mode is `vscode`.
- `pnpm test`, `pnpm exec tsc --noEmit`, and release build pass.
