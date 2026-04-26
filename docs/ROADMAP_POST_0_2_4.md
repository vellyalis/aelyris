# Post-0.2.4 roadmap

Started 2026-04-30. Source: `project_dogfood_log.md` (痛みベースで起こす)
+ residual deferrals from `docs/sixel-kitty-spike.md`. Items are Tier-graded
the same way `docs/ROADMAP_POST_0_2_2.md` was.

| Tier | Meaning |
|------|---------|
| 🔴 | Senior-blocker — without this a feature is dark on the dogfood machine |
| 🟡 | Polish that real users will trip over within the first week |
| 🟢 | Nice-to-have / future-proofing |

## 🔴 1 — ConPTY `PSEUDOCONSOLE_PASSTHROUGH_MODE` wiring

**Why this is Tier 🔴**: as confirmed by the 2026-04-30 dogfood
(`project_dogfood_log.md`), the entire Tier 🟡 #5 inline-image pipeline
(scanner + decoder + snapshot + IPC + frontend paint) is *correct*, but
`portable-pty 0.8.1`'s `CreatePseudoConsole` call omits
`PSEUDOCONSOLE_PASSTHROUGH_MODE` (0x8) — the constant is even tagged
`#[allow(dead_code)]` in the crate. Win11 ConPTY in default mode
silently strips unknown APC sequences before they reach our engine.
Until passthrough is wired, **no inline image will ever render on the
dogfood machine**, regardless of how good the engine work was.

This blocks the user-visible value of #5 entirely. It is the only
item from the post-0.2.3 closure that fails dogfood. Hence Tier 🔴.

### Constraints

- `portable-pty 0.8.x` does not expose passthrough on its public API.
  We have to either patch the crate, fork it, or replace its Windows
  path with our own ConPTY init.
- `PSEUDOCONSOLE_PASSTHROUGH_MODE` requires Win11 22H2+. Older Windows
  must keep the existing default-mode behaviour (graceful degradation:
  inline images are not delivered, but everything else works).
- The flag changes ConPTY semantics — it stops normalising the output
  stream. We have to verify that our existing engine still handles
  every CSI / OSC / etc. sequence without ConPTY's normalisation help.

### Approach options (sorted by invasiveness)

1. **`[patch.crates-io]` to a local fork**: minimal diff (~10 lines in
   `psuedocon.rs` to add the flag conditionally). Fastest. Risk: we
   carry a fork until upstream merges.
2. **Replace the Windows path with hand-rolled ConPTY**: more code,
   but lets us drop the `portable-pty` Windows dep and keep only its
   Unix code via target_os gating. Worth considering if we end up
   wanting more ConPTY control later (e.g. attach-detach for hot
   reload).
3. **Switch PTY backend**: `pty-process`, custom, etc. Highest churn,
   probably overkill.

Default to option 1 unless the patch turns out to be more than a few
dozen lines.

### Acceptance criteria

- The OS-version detection runs at PTY-create time and only enables
  passthrough on Win11 22H2+.
- `e2e/image-flows.spec.ts` test 2 (currently `test.fixme`) is
  re-enabled, runs, and passes against the dogfood machine.
- `scripts/diag-image-escape.mjs` reports `images: [...]` non-empty
  and a non-null `term_image_data` hit.
- No regression in `e2e/pty-flows.spec.ts` or any of the existing
  Playwright suite — the change is invisible to text-only flows.
- A cargo test that exercises the OS-detection branch (probably gated
  on `#[cfg(target_os = "windows")]`) covers the Win10/Win11/old-Win11
  matrix.

## 🟡 2 — `chafa`-less visual confirmation

**Why this is Tier 🟡**: even after #1 lands, the only way to *visually*
confirm inline-image rendering on the dogfood machine is to ship a
fixture or use `[Console]::Out.Write` from PowerShell. No standard
image-emitting CLI is preinstalled. Either:
- Ship a small Rust-based test fixture (`scripts/emit-kitty-image.rs`?)
  that takes a PNG path and writes the Kitty escape to its stdout, or
- Document a winget recipe to install `chafa` (it ships in the
  `mintty/chafa` MSYS2 channel; coverage on plain Windows uncertain).

Either way, the dogfood log should have a one-line "smoke" recipe so
inline-image regressions are catchable in <30 s.

## 🟢 3 — Frontend canvas pixel-sample E2E spec

Today `e2e/image-flows.spec.ts` only validates the IPC + snapshot
contract. The frontend paint pass (`useTerminalImages` →
`paintImages`) is covered by Vitest in jsdom with bitmap factory
injection. A real-chromium spec that reads `<canvas>.getImageData()`
after a fixture image is staged would catch:
- Sub-pixel placement regressions
- Cell rectangle overrides (`cellW` / `cellH`) being mis-applied
- Theme changes that re-paint over the image

This requires `addInitScript` to stub `__TAURI_INTERNALS__.invoke` so
the spec can inject a controlled snapshot — non-trivial harness work.
Worth doing once #1 lands and we have a usable round-trip.

## 🟢 4 — iTerm2 OSC 1337 inline image protocol

`docs/sixel-kitty-spike.md` intentionally deferred OSC 1337 because
its payload overlaps the OSC 133 scanner. Kitty + Sixel are now
landed cleanly; adding OSC 1337 is a smaller incremental task. Most
useful for users coming from `wezterm imgcat`.

## 🟢 5 — Scrollback inline image rendering

Sprint 3 explicitly skipped scrollback rendering of images (live grid
only). Adding it requires an `ImageRef` with a history index and a
slightly different snapshot shape for scrolled-up frames. Defer until
real users complain; today's scrollback is text-only and that's fine
for the workflow.

## 🟢 6 — Inline-image memory budget telemetry

The 50 MiB cap fires silently via FIFO eviction. A status-bar badge
or a debug-only `images_bytes_used` IPC would help diagnose the
"my image disappeared" case in dogfood. Low priority until #1 + a
real workflow surfaces the need.

---

Items not on this list yet — `project_dogfood_log.md` will accumulate
痛み through ~2026-05-14 (two-week window from re-open) and feed
priorities here.
