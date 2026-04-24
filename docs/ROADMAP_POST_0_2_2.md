# Enhancement proposals — post v0.2.2

Drafted 2026-04-25 at the end of the "senior-engineer quality pass" session.
Every item is sized, prioritised, and reasoned about against the current
codebase; there are no speculative additions. The ordering reflects
**expected leverage per day of effort**, not personal preference — the
top of the list is what would most change how the product looks to a
senior reviewer or a daily-driver user.

Each proposal carries:

- **Why** — the gap it closes (user pain, regression surface, or pitch
  weakness)
- **Shape** — concrete files/modules that would change, roughly
- **Cost** — engineer-days with today's test coverage, honestly
- **Risk** — what could go wrong, and the cheapest hedge

## Legend

| Tier | Meaning |
|------|---------|
| 🔴   | Senior-engineer blocker — would reject at code review |
| 🟡   | Pro-grade polish — visible to experienced users, not blocking |
| 🟢   | Nice-to-have — only worth doing if the tiers above are clear |

---

## Tier 🔴 — ship before broader dogfood

### 1. PTY crash recovery + auto-respawn (2-3 days)

**Why.** Today a `ConPTY` child crash (`powershell.exe` SEGV, `bash`
dying from signal) leaves the native terminal frozen. The UI keeps the
canvas but shows nothing — no "session ended" banner, no one-key
restart. A senior user will hit this within a week of daily use and
lose trust.

**Shape.**
- `src-tauri/src/pty/manager.rs`: reader thread already emits
  `pty-exit-<id>` on EOF; extend to include exit code + a best-effort
  "crash vs clean" signal (Windows `NTSTATUS` vs `exit(0)`).
- Frontend (`NativeTerminalArea.tsx`): listen for that event, render a
  compact banner "Shell exited (code N). Press Enter to restart." plus
  an IPC call that recreates the PTY with the same shell + cwd.
- Preserve the `NativeTerminalRegistry` session id across respawn so
  prompt mark history is not discarded.

**Cost.** 2-3 days including tests for the "crash mid-output" race.

**Risk.** Preserving the session id while swapping the PTY instance
inside `NativeTerminalRegistry` requires a careful lock ordering. Cheap
hedge: write a Rust-side integration test that spawns a shell, kills
the child, and asserts the registry stays queryable + restartable.

### 2. Shell integration install UI (1 day)

**Why.** The OSC 133 scripts in `assets/shell-integration/` only fire
if the user *knows to source them*. Today there is no in-app pointer.
Users will attribute the missing exit dot / jump-to-prompt to "it just
doesn't work" rather than "I haven't installed the script."

**Shape.**
- Settings panel new section: **Shell integration**. Detect `$PROFILE`
  / `~/.bashrc` / `~/.zshrc` presence via an IPC probe; offer a **Copy
  one-liner to profile** button that writes the `source …` line.
- Welcome-screen onboarding checklist: one more step "Enable jump-to-
  prompt" that links to the same panel.

**Cost.** 1 day. Pure UI + a single `install_shell_integration` IPC
that copies the script alongside the user's profile and appends the
source line.

**Risk.** Writing to a user's profile is a semi-destructive action. Hedge:
show the line, copy to clipboard, and require a click to append — never
silent-edit.

### 3. Auto-updater wiring (2 days)

**Why.** Aether is local-only today (see `project_local_only.md`), so
users are stuck on whatever MSI they installed. The minute `v0.2.1` is
in production anywhere, a `v0.2.2` critical fix has no delivery path.

**Shape.**
- Tauri v2 ships an `updater` plugin. Add to `src-tauri/Cargo.toml`,
  configure an endpoint in `tauri.conf.json`, sign updates with a
  generated Ed25519 key.
- Ship a minimal in-app "Updates available" banner driven by the
  plugin's events.

**Cost.** 2 days including sign-key management + a release-tooling
script to emit `latest.json` next to the MSI/NSIS bundles.

**Risk.** The update URL needs to exist somewhere reachable. Since the
project is local-only, the endpoint could be a local file path during
development and a real URL once a public host is picked — the
plugin supports both.

---

## Tier 🟡 — pro-grade polish

### 4. Terminal hyperlink click = open URL (0.5 day)

**Why.** We already *detect* OSC 8 hyperlinks and regex URLs; the click
handler opens them via `tauri-plugin-opener`. But OSC 8 URIs that point
at `file://` paths inside the open project should open the **editor**,
not a system handler. Today that path opens the OS default (usually
Notepad on Windows).

**Shape.** Branch on the URL scheme in `TerminalCanvas.handleLinkClick`:
- `https?` / `ftp` / `mailto` → existing `tauri-plugin-opener` path
- `file://` pointing inside `cwd` → open in the built-in editor

**Cost.** 0.5 day including tests for the branching logic.

### 5. Sixel / Kitty image inline rendering (3-5 days)

**Why.** Modern terminals (Warp, iTerm2, kitty) render inline images.
Aether's native canvas has a `<canvas>` context already — the data
path is just "parse OSC 1337 / Kitty `_G`, decode, draw onto the grid
at cell coordinates." Most CLI tools that emit images gracefully
degrade to text, so this is a "shines when present, no-ops when
absent" feature.

**Shape.**
- `src-tauri/src/term/engine.rs`: pre-scan for the two protocols
  alongside the existing OSC 133 scan.
- Snapshot carries an `Option<ImageRef>` per cell; the renderer
  paints the image rectangle at the appropriate cell bounds.

**Cost.** 3-5 days. Most of the budget is format decoding (Sixel has
a real encoding) and the memory ceiling (images are bigger than
cells — need an on-disk scratch dir with eviction).

**Risk.** Scrollback × inline images × eviction is a real memory
trap. Hedge: cap per-session image bytes at 50 MiB with oldest-first
eviction, fail closed on Sixel decode errors.

### 6. E2E coverage for PTY-in-the-loop flows (2 days)

**Why.** The 13 Playwright specs we have all run against the Vite dev
server (no Tauri backend). They catch UI regressions but miss every
PTY-involved flow — agent spawn, shell write → echo, scrollback
population, IME bar round-trip.

**Shape.** The memory note `reference_tauri_cdp_e2e.md` already
documents the CDP-attached pattern. Extend it into a dedicated spec
suite that `pnpm tauri:dev` starts, then Playwright attaches via port
9222. Cover:

- Spawn terminal → write `echo hello\r` → see "hello" in the grid
  (uses `term_snapshot` to read back).
- Agent CLI detection: write `claude\r`, assert the AI-CLI banner
  appears.
- Scrollback: emit 50 lines, scroll up with `Ctrl+Shift+Up`, assert
  the composite cells reflect the jump.

**Cost.** 2 days; harder part is stable fixture setup (a throwaway
temp project dir per spec).

### 7. Observability: structured JSON log output + viewer (1.5 days)

**Why.** The backend now emits ~75 `log::` calls (up from 50 in the
pre-0.2.2 audit) but they all land in stderr with env_logger's default
format. Production debugging needs JSON so a log shipper can aggregate
by correlation id, but today we have neither the format nor the
correlation id plumbing.

**Shape.**
- Switch env_logger → `tracing` + `tracing-subscriber` with JSON
  formatter. Shim `log::*` through the `tracing-log` adapter so the
  existing call sites keep working.
- Add `#[instrument]` on the top-level IPC command handlers to get
  request ids for free.
- Surface recent log lines in an in-app panel (right-panel tab), so
  users have somewhere to look when Something Goes Wrong without
  opening a terminal to read stderr.

**Cost.** 1.5 days.

### 8. PTY backpressure signal to UI (1 day)

**Why.** When an agent floods the PTY with output (tests emitting
mountains of logs, `cargo build --verbose`), the UI coalesces diffs at
60fps but the broadcast channel can still `Lagged`. Today the only hint
is a dim `[dropped N chunks]` sentinel in the canvas. A numeric
"throttled" badge in `TerminalInfoBar` tied to the recent `Lagged`
count would telegraph what's happening.

**Shape.**
- `pty/manager.rs`: expose a `lag_events` counter per subscriber.
- `term:lag-<id>` event when the counter ticks up.
- `TerminalInfoBar`: throttled badge when events arrive within the
  last 5 s.

**Cost.** 1 day.

---

## Tier 🟢 — only after 🔴 / 🟡 are clear

### 9. Search-within-scrollback (1 day)

Ctrl+F already searches the live grid. Extend to the full retained
history (10 000 lines × average line length — easy to keep under a
50 MB string) with highlight spans in the composite render. Natural
follow-up to the scrollback work and small in scope.

### 10. Theme palette editor with live preview (2 days)

`themeToCSS` already takes a `ThemePalette` and emits CSS custom
properties. A small editor UI that lets users tweak accents with a live
preview (the existing window *is* the preview) would be cheap to build
and a frequent community ask for terminals. Worth doing only after the
three 🔴 items land — without them, polish features against the wrong
surface.

---

## Non-goals / things NOT to do

These are ideas that sound good but would trade a lot of code for
little real improvement at the current stage. Recording them here so
they stop getting re-raised.

- **Remote PTY via v2d TLS.** `project_local_only.md` is explicit;
  until the use case exists the TLS surface is pure attack surface.
- **Rewriting UI in native Rust / wgpu.** SUPERSEDED in
  `project_strategic_direction.md` (2026-04-17). The Tauri + React
  UI stack is the decided one.
- **Extension / plugin marketplace.** VS Code owns this space. Aether's
  edge is the integrated agent-workspace surface, not plugin breadth;
  opening an extension API first means letting every plugin author vote
  on product direction.
- **On-by-default telemetry.** Aether targets senior engineers who will
  see it and uninstall. If telemetry ever happens, it must be opt-in
  with the payload visible in Settings.

## How to use this doc

Pick one item from Tier 🔴 to start the next session. The three 🔴
items are independent — they can be sequenced in any order — but all
three should land before any 🟡 work to keep the "what would a senior
notice first?" bar moving in one direction.

Tier 🟡 items should not be touched until 🔴 is empty; Tier 🟢 should
not be touched until 🟡 is empty. The explicit tiering is meant to
resist the pull of "I'll just polish one more thing" while 🔴 blockers
are still open.
