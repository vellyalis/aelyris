# PTY-in-the-loop E2E (Tier 🟡 #6)

A small Playwright spec suite that drives a real Tauri dev build over CDP
and exercises the PTY surface that the default `frontend` project cannot
reach (it talks to the Vite dev server only and `__TAURI_INTERNALS__` is
`undefined` there).

## Spec file

`e2e/pty-flows.spec.ts` — three tests.

| # | name | what it asserts |
|---|------|-----------------|
| 1 | `echo round-trip lands the sentinel in the visible grid` | `spawn_terminal` → `write_terminal "echo …"` → `term_snapshot` reflects the sentinel within 5 s |
| 2 | `emitting more lines than rows grows the scrollback ring` | 80 lines pushed at a 30-row terminal lands at least one row in `term_history_size` and `term_history_rows(0, 1)` returns content |
| 3 | `structured log ring captures backend events emitted during the spec` | `logs_since(watermark)` returns at least one entry from `aether_terminal_lib` after the test has driven the backend |

Each test owns its own terminal id and closes it on the way out so a
single failure does not leak a live PTY into the rest of the suite.

## Running

The suite expects a live Tauri dev build with the CDP port open:

```sh
pnpm tauri:dev   # opens 9222 thanks to tauri.dev.conf.json
pnpm exec playwright test e2e/pty-flows.spec.ts
```

`pnpm test:e2e` (the existing default) also runs the suite alongside the
13 frontend specs. When 9222 is unreachable every test in the suite calls
`test.skip` with the reason in the report — no red bar and no manual
filter needed.

## CDP attach details

See `reference_tauri_cdp_e2e.md` (memory) and `scripts/verify-3c2.mjs`
for the same pattern at IPC level. Key points:

- `chromium.connectOverCDP("http://localhost:9222")` returns a `Browser`
  attached to the already-running webview. We do **not** launch our own.
- The Tauri page is the one whose URL contains `localhost:1420`. There
  may be one extra DevTools page in the same context.
- `__TAURI_INTERNALS__.invoke(cmd, args)` is the v2 IPC entrypoint —
  v1's `__TAURI__.invoke` is gone.
- `afterAll` calls `browser.close()`. With a CDP-attached browser this is
  a disconnect, not a tear-down of the user's window.

## Why this exists

The default `frontend` Playwright project covers UI surface but skips the
PTY entirely. Before this suite, every PTY-touching regression had to be
caught by Rust integration tests (which exercise the manager directly,
bypassing IPC) or by hand. The CDP-attached spec closes that loop:

- IPC-level coverage that mirrors what the UI actually invokes
- An `aether_terminal_lib::*` log entry serves as a non-flaky signal
  that the new tracing pipeline (Tier 🟡 #7) reaches the wire
- Future PTY work can lean on this harness — adding new flows is one
  test function, not a script

## Limits

- The suite expects PowerShell as the default shell. On Windows that's
  the shipped default. If a future CI image uses bash/zsh as the system
  shell, the `1..80 | ForEach-Object` line in the scrollback test needs
  adjusting.
- We deliberately do **not** test the AI CLI banner here (it lives in
  the frontend `useAICliDetection` hook and is covered by Vitest at
  `src/__tests__/useAICliDetection.test.tsx`). Driving it from the PTY
  side would require an actual `claude` binary in PATH which we cannot
  guarantee in CI.
