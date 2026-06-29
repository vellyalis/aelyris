# Release Confidence And Feature Gap Audit 2026-05-09

## Confidence Gate Changes

- Fixed the live Tauri/WebView2 smoke risk coverage ID for the retired Mission Control surface so the production closure script and live verifier agree on the same risk key.
- Added `pnpm verify:supply-chain` to write `.codex-auto/release-doctor/supply-chain-audit.json` and fail on known npm or Rust vulnerabilities.
- Added `pnpm verify:release:production` as the public-release gate. It runs the release gate with IME evidence, closes production risks from smoke artifacts, runs the supply-chain audit, and finishes with strict release doctor checks.
- Release Doctor now reports accepted/manual risk controls instead of hiding them behind `openRiskCount=0`.

## Remaining Non-Automatable Evidence

- Real OS sleep/resume remains an accepted low-risk hardware-soak control. Automation validates injected resume and DB-lock recovery, but it should not force-suspend the user's machine.
- Clean VM install/uninstall remains a human or lab-machine gate because it intentionally mutates installed software state.
- Fresh live Tauri/WebView2 smoke requires a running Tauri/CDP environment. The production gate can require this with `--fresh-live`.

## Feature Gap Findings

### External Baseline

- tmux's durable value is session persistence, detach/reattach, windows, panes, and prefix-key driven control.
- cmux emphasizes native split panes, vertical tabs, notification rings, an embedded browser, socket automation, GPU acceleration, and configurable shortcuts.
- Warp emphasizes multi-agent management, session-tied agent conversations, attachable context, task lists, profiles/permissions, code review, rich input, command history, blocks, session restoration, and remote steering.

### Aelyris Strengths

- Project-first workspace with file tree, source control, workflow, toolkit, right rail health/change/run views, agent inspector, and release/quality gates.
- Existing pane split/close/resize/rebalance/maximize/move/rename/role targeting and scrollback/command history foundations.
- Strong AI/workflow surface compared with classic terminal multiplexers.

### Highest-Value Missing Features

1. Persistent live session manager: named sessions/windows, detach/reattach UX, session browser, and live PTY survival across app restarts.
2. Keybinding editor and tmux prefix mode: editable shortcuts, conflict detection, import/export, tmux/vim/emacs presets.
3. Command blocks/run history UI: command, cwd, branch, exit code, duration, output, rerun, copy, pin, and search as first-class objects.
4. First-run setup wizard: shell integration, AI CLI detection, Git/gh/WSL/Node/Rust diagnostics, default shell, privacy/redaction, and sample workflow.
5. Agent/workflow command center: a clear single screen for active agents, decisions, failures, artifacts, diffs, and next actions.
