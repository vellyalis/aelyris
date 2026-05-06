# Performance Audit Validation - 2026-05-05

This note validates `docs/PERFORMANCE_AUDIT_REPORT.md` against the current codebase. The Gemini report was useful as a lead, but several claims needed tightening against implementation reality.

## Verdict

| Area | Verdict | Notes |
| --- | --- | --- |
| PTY IPC overhead | Confirmed, partially already mitigated | The current stream now batches PTY bytes as base64 payloads and keeps legacy number-array decoding on the frontend. Remaining risk is actual throughput measurement under live Tauri/WebView2 load. |
| Scrollback fetch | Confirmed bug | The frontend could request `scrollOffset` rows. Deep scrollback could therefore pull thousands of `CellSnapshot` rows. |
| PTY stream synchronous analysis | Confirmed risk, already partly mitigated | Auto-repair and port detection have been moved to a side worker. This pass added small event-name and port-scan fast paths. |
| Duplicate memory | Partial | `OutputBuffer` and alacritty scrollback overlap, but `OutputBuffer` is 1000 text lines, not a full 10000-line cell grid duplicate. |
| IME instability | Partly confirmed | No direct composition-loss bug found in this pass. Existing risk remains around live OS/TSF verification and candidate anchoring after focus/resize changes. |

## Fixes Applied

- `src/shared/hooks/useScrollback.ts`
  - Keeps scrollback row fetches bounded to the visible viewport.
  - Tracks `historyWindowFrom` so deep scrollback renders the correct rows without storing every row above the viewport.
  - Throttles `term_history_size` refreshes to avoid one IPC call per terminal diff snapshot.

- `src/features/terminal/TerminalCanvas.tsx`
  - Adds scrollback state to the paint effect dependencies so wheel/search navigation repaints immediately, not only after unrelated cursor/snapshot churn.

- `src-tauri/src/pty/buffer.rs`
  - Replaces repeated partial-string slicing with `std::mem::take` based splitting to avoid repeated reallocations during log floods.

- `src-tauri/src/ipc/commands.rs`
  - Reuses precomputed event names in the PTY stream path.
  - Skips port scanning unless a chunk contains `localhost:` or `127.0.0.1:`.

- `src/__tests__/useScrollback.test.ts`
  - Adds a deep-scroll regression asserting the frontend requests only the visible history window.
  - Adds a snapshot-churn regression asserting `term_history_size` is not spammed on rapid snapshot changes.

## Validation

- `pnpm.cmd test src/__tests__/useScrollback.test.ts src/__tests__/TerminalCanvas.test.tsx src/__tests__/NativeTerminalArea.test.tsx -- --reporter=dot`
  - Passed: 45 tests.
- `pnpm.cmd test src/__tests__/usePtyLag.test.tsx src/__tests__/NativeTerminalInitialOutputReplay.test.ts src/__tests__/useCanvasIME.test.ts src/__tests__/IMEInputBar.test.tsx src/__tests__/TerminalCanvasInput.test.tsx -- --reporter=dot`
  - Passed: 92 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml pty::buffer --lib`
  - Passed: 13 tests.
- `pnpm.cmd exec tsc --noEmit`
  - Passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - Passed.

## Remaining High-Value Checks

- Live Tauri/WebView2 flood test: stream a large build log and measure UI latency, dropped chunks, and CPU.
- Real Windows IME regression: Japanese long composition, deletion, conversion, resize, focus return, Claude/Gemini CLI prompt anchoring.
- CI perf baseline: add a repeatable threshold around `src-tauri/benches/term_engine.rs` or a focused no-window terminal stream harness.
- Event journal E2E: one harness should verify event-bus delivery and DB snapshot durability in the same run.
