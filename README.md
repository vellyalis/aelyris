# Aether Terminal

Windows-native AI workspace terminal. Inspired by [Scape](https://www.scape.work).

## Features

- **Terminal**: xterm.js + WebGL + ConPTY (PowerShell/CMD/Git Bash/WSL)
- **Editor**: Monaco Editor with diff, Vim mode, multi-tab, auto-indent
- **File Tree**: lazy-load, search, git change markers, right-click CRUD
- **AI Agent**: Claude Code headless integration, session cards, watchdog
- **Toolkit**: customizable quick actions, per-project persistence
- **Search**: full-text grep across files (Ctrl+Shift+F)
- **PR Inspector**: GitHub PR list + diff preview via `gh` CLI
- **Web Inspector**: localhost iframe browser
- **Settings**: config.toml persistence, theme/font/shell configuration

## Tech Stack

- **Framework**: Tauri v2 (Rust backend + WebView2)
- **Frontend**: Vite + React 19 + TypeScript
- **Terminal**: xterm.js + @xterm/addon-webgl
- **Editor**: Monaco Editor + monaco-vim
- **Git**: git2-rs (libgit2)
- **Animation**: Motion (Framer Motion successor)
- **Styling**: CSS Modules

## Prerequisites

- [Rust](https://rustup.rs/) (1.94+)
- [Node.js](https://nodejs.org/) (24+)
- [pnpm](https://pnpm.io/) (10+)
- Windows 11 (Windows 10 with limited features)

## Development

```bash
cd Aether_Terminal
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+P | Command Palette |
| Ctrl+Shift+T | New Terminal |
| Ctrl+Shift+W | Close Terminal Tab |
| Ctrl+N | New File |
| Ctrl+W | Close Editor |
| Ctrl+S | Save |
| Ctrl+F | Find in File |
| Ctrl+H | Replace |
| Ctrl+G | Go to Line |
| Ctrl+Shift+F | Search in Files |
| Ctrl+Shift+O | Open Folder |
| Ctrl+Shift+A | Start Agent |
| Ctrl+Shift+H | Split Horizontal |
| Ctrl+Shift+V | Split Vertical |
| Ctrl+0-9 | Jump to Session |
| Ctrl+[ / ] | Prev/Next Session |
| Ctrl+, | Settings |

## Architecture

```
src-tauri/src/        # Rust backend (31 IPC commands)
  pty/                # PTY management (ConPTY)
  git/                # git2-rs operations
  agent/              # Claude Code headless
  watchdog/           # auto-response rules
  config/             # config.toml persistence

src/                  # React frontend
  features/
    header/           # ProjectHeaderBar
    menubar/          # File/Edit/View/Terminal/Help
    file-tree/        # FileTree + FileIcon
    editor/           # Monaco EditorPanel
    terminal/         # xterm.js TerminalArea + InfoBar
    agent-inspector/  # Sessions + Activity
    toolkit/          # Quick actions
    helm/             # Task list
    search/           # Full-text search
    pr-inspector/     # GitHub PR viewer
    web-inspector/    # localhost browser
    welcome/          # Welcome screen
    command-palette/  # Ctrl+Shift+P
    settings/         # Settings dialog
    watchdog/         # Watchdog dialog
    about/            # About dialog
    workspace-tabs/   # Bottom tabs
  shared/
    ui/               # SplitPane, PixelAvatar, ContextGauge, StatusIcon, ErrorBoundary
    hooks/            # useTabManager, useAgentManager, useGitStatus
    types/            # agent.ts
```

## License

MIT
