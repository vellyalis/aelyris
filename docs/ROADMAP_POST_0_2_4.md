# Post-0.2.4 roadmap

Started 2026-04-30. Source: `project_dogfood_log.md` (痛みベースで起こす)
+ residual deferrals from `docs/sixel-kitty-spike.md`. Items are Tier-graded
the same way `docs/ROADMAP_POST_0_2_2.md` was.

| Tier | Meaning |
|------|---------|
| 🔴 | Senior-blocker — without this a feature is dark on the dogfood machine |
| 🟡 | Polish that real users will trip over within the first week |
| 🟢 | Nice-to-have / future-proofing |

## 🔴 1 — Windows APC delivery to engine (replaces "passthrough wiring")

**Status**: ✅ All sprints landed. Sprint 1 (engine assembler,
`a627cb7`) + Sprint 2 (emitter wrappers + fixtures + diag harness,
`112bd23`) + Sprint 3 wave 1 (E2E unfixme + new chunked-osc-flows
spec + offline Rust integration test + user-guide + troubleshooting,
`e0845ed`) + Sprint 3 wave 2 (`term_image_metrics` IPC + TS type,
`bf8076a`) + Sprint 3 wave 3 (status-bar inline-image budget badge +
`image_evicted` structured log event, `6a4a480`) on 2026-05-01 →
2026-05-02. The wizard-grade definition's five axes (real Win11
ConPTY round-trip, hostile-input-safe, concurrent transfers don't
corrupt, observable, documented) are all green offline.

The remaining gates are user-side validation: a Win11 dogfood pass
of `node scripts/diag-chunked-osc.mjs` (4/4 expected) and a preview-
server visual confirmation of the status-bar badge under load. Once
both are green, v0.2.4 can ship. Streaming partial paint (Sprint 3
deliverable #5) remains deferred — the trigger is "dogfood says
paint is visibly slow", which has not happened yet.

The original framing ("just pass `PSEUDOCONSOLE_PASSTHROUGH_MODE` to
`CreatePseudoConsole`") turned out to be a dead end — see
"Investigation log" below. Spike 2 confirmed a chunked OSC side-
channel as a viable vehicle, Sprint 1 implements its engine half,
Sprint 2 ships the emitter half, Sprint 3 wave 1 locks in
correctness end-to-end without requiring a Tauri session, wave 2 +
3 surface the cap state through an IPC + status-bar widget so a
user can see eviction pressure before it happens.

**Why this is Tier 🔴**: the entire Tier 🟡 #5 inline-image pipeline
(scanner + decoder + snapshot + IPC + frontend paint) is *correct*,
but ConPTY on Win11 25H2 silently strips APC sequences (`\x1b_…\x1b\\`)
**even with PASSTHROUGH_MODE enabled**. Until APC bytes reach the
engine somehow, **no inline image renders on Windows**, regardless of
how good the engine work was. Tier 🟡 #5 user-value is 0 on Windows.

### Investigation log (2026-04-30)

1. Vendored `portable-pty 0.8.1` to `src-tauri/vendor/portable-pty/`,
   patched `psuedocon.rs` to OR in `PSEUDOCONSOLE_PASSTHROUGH_MODE`
   (gated by registry build ≥ 22621). Wired via `[patch.crates-io]`.
2. Confirmed via `eprintln` that:
   - `passthrough_supported = true` (build 26200 / 25H2).
   - `CreatePseudoConsole` was called with the flag set.
   - The new binary was loaded (5 spawn events all logged the flag).
3. Re-ran `scripts/diag-image-escape.mjs` with both PowerShell
   (`[Console]::Out.Write`) and Git Bash (`printf '\e_G…'`) emitters.
   Both showed `images: [absent]` and zero entries in
   `term_image_data(id, 1..200)`.
4. Added a temporary `eprintln` in `term::engine::TermEngine::advance`
   that logs every buffer containing `ESC _` (APC), `ESC P` (DCS), or
   `ESC [` (CSI). Result over the same diag run:
   - `CSI` buffers: many (every prompt redraw, every SGR, etc.).
   - `APC` / `DCS` buffers: **zero**.
5. Conclusion: **`PSEUDOCONSOLE_PASSTHROUGH_MODE` does not deliver APC
   to the host on Win11 25H2 build 26200.** The flag's actual
   behaviour is narrower than its docs imply, or affects only an input
   path we don't exercise. Whatever it does, it is not a raw byte
   tunnel, and OUR shipped engine cannot see APC bytes via ConPTY.
6. Reverted vendored crate + `[patch.crates-io]` (zero observable
   benefit, carrying upstream divergence for nothing). The
   `scripts/diag-image-escape.mjs` and `scripts/diag-image-bash.mjs`
   pair stays as the canonical reproducer.

### Spike 2 — OSC side-channel viability (2026-04-30)

Probed how large an OSC payload ConPTY will forward to the host.
`scripts/diag-osc-size.mjs` emits `\e]1338;<size>;<AAAA…>\a` from
Git Bash via `printf` and counts arrivals in the engine `eprintln`.

Result on Win11 25H2 build 26200:

| Payload size (raw) | Total OSC bytes | Arrived at engine |
|--------------------|-----------------|-------------------|
| 64                 | 75              | ✅                |
| 256                | 268             | ✅                |
| 384                | 396             | ✅                |
| 480                | 492             | ✅                |
| 496                | 508             | ✅                |
| 504                | 516             | ❌                |
| 510                | 522             | ❌                |
| 512                | 524             | ❌                |
| 1024 +             | 1036 +          | ❌                |

**ConPTY's OSC forwarding cap is ~512 bytes total per OSC** (so ~503
bytes after `\e]<id>;…\a` overhead with a short ID). OSCs above the
cap are silently dropped — same failure mode as APC, just at a higher
threshold.

**Implication for the side-channel option (#3 in the solution space
above)**: viable but requires a *chunked* protocol. A 1 KB PNG fits in
~3 chunks, a 10 KB PNG in ~27 chunks. Per-chunk overhead inflates the
wire payload to ~1.07x its raw size before base64 (and base64 then adds
its own 1.33x). For a typical 4 KB inline thumbnail that means ~10
chunks, ~5 KB of wire bytes, sub-millisecond at any reasonable PTY
throughput. Workable, but it's now a real protocol design rather than
a one-line escape change.

Sketch of the protocol direction (no commitment yet, design TBD):

```
\e]1338;BEGIN;<image-id>;<format>;<width>;<height>\a
\e]1338;DATA;<image-id>;<chunk-idx>;<base64-block>\a   ← repeat
\e]1338;END;<image-id>\a
```

Engine assembler keys on `image-id`, accumulates `DATA` chunks in
`chunk-idx` order, promotes to `ImageStore` on `END`. A wrapper
script (`scripts/aether-imgcat.{ps1,sh}`) takes a path, reads the
file, splits it, and emits the chunks. Standard `chafa -f kitty …`
still won't work — users must use our wrapper — but inline images
become possible end to end on Windows.

`scripts/diag-osc-size.mjs` stays in the repo as the cap reproducer.
The engine `eprintln` instrumentation has been reverted.

### Sprint 2/3 plan

Detailed plan, deliverables, acceptance criteria, sequencing, and
risks: `docs/chunked-osc-sprint2-3-plan.md`. Five-axis "wizard-grade"
definition lives there too.

### Sprint 1 — Engine assembler (2026-05-01, landed)

Protocol spec: `docs/chunked-osc-image-protocol.md`.

`term::images::chunked_osc` ships a parser + `ChunkAssembler` for
three OSC 1338 verbs (`B` BEGIN, `D` DATA, `E` END) keyed on a
caller-allocated `image-id`. The parser mirrors the existing
`prompt_marks::try_parse` shape (`Consumed | Incomplete | None`) so
the engine's `advance()` loop slots OSC 1338 next to the Kitty /
Sixel scanner without restructuring. The assembler accepts out-of-
order chunks, validates contiguity on `END`, base64-decodes once over
the concatenation, and yields a `DecodedImage` of the declared format
(`png` passes through; `rgba` checks `w*h*4 == len`). Failed
validations retain the partial base64 concatenation with
`decoded=None` for the diagnostic surface, matching the single-shot
Kitty error path.

Per-image caps:
- 50 MiB raw bytes (matches `IMAGE_BYTE_CAP`).
- 16384 chunks per image.
- 8192 max declared dimension.

Engine bytes are *consumed*, never forwarded to alacritty — an in-
flight transfer never leaks `\e]1338;…` text into the grid.

Sprint 2 will land the emitter side
(`scripts/aether-imgcat.{ps1,sh}`); Sprint 3 will re-enable the
`e2e/image-flows.spec.ts` test 2 fixme and run the full Win11
round-trip via the diag script + a real PNG fixture.

### Solution space (no longer ranked — needs investigation)

- **Bypass ConPTY entirely on Windows**: spawn the child with
  CreateProcessW + raw anonymous pipes for stdio. We lose ConPTY's
  Win32 console translation (any cmd.exe-style `cls` / `mode con`
  callers break) but all VT bytes flow byte-perfect. wezterm has
  flirted with this; their `winpty` fallback is one path. Big surgery.
- **Use a different PTY transport on Windows**: `winpty` (older,
  cygwin-style) historically delivered raw bytes for child output.
  Maintenance status uncertain.
- **Side-channel image protocol**: ship our own escape variant that
  rides over a separate IPC (e.g. write to a shared dir + a custom
  OSC 1337-style ID-only escape that ConPTY doesn't strip), then
  resolve to bytes inside the engine. Ugly but pure-software.
- **Wait for Microsoft**: open a Microsoft Console GitHub issue with
  the diagnostic from this session. Long latency, no commitment.
- **Detect at the application layer**: have a side-process tail the
  shell's actual byte output via `tee`-like wrapper. Brittle.

### Acceptance criteria (unchanged target, different vehicle)

- `scripts/diag-image-escape.mjs` reports `images: [...]` non-empty
  and a non-null `term_image_data` hit on the dogfood Win11 machine.
- `e2e/image-flows.spec.ts` test 2 (currently `test.fixme`) is
  re-enabled, runs, and passes.
- No regression in `e2e/pty-flows.spec.ts` or the existing Playwright
  suite — the change is invisible to text-only flows.
- Whatever transport we adopt is gated to keep current behaviour on
  any platform / OS version that doesn't need it (Linux/macOS PTY
  already delivers APC; only Windows needs a workaround).

## 🟡 2 — `chafa`-less visual confirmation

**Status**: ✅ Effectively closed by Sprint 2 of #1. The
`scripts/aether-imgcat.{ps1,sh}` emitter wrappers shipped in
`112bd23` are the `chafa`-less vehicle for Win11 dogfood — both
PowerShell and Git Bash invocations take a PNG path and stream the
chunked OSC 1338 protocol straight to the engine. The 30-second
smoke recipe lives in `docs/inline-image-dogfood.md`, and the
`e2e/fixtures/inline-image-{1x1,32x32}.png` fixtures give a
reproducible regression target. No external tooling required.

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

**Status**: ✅ Closed by Sprint 3 wave 2 + 3 of #1. The
`term_image_metrics(id)` IPC (`bf8076a`) returns
`{ bytesUsed, cap, count }`, the `<InlineImageBudget />` status-bar
widget (`6a4a480`) renders it as a "12.3 MiB / 50 MiB · 3" badge with
warn / danger tints at 80 % / 95 % of the cap, and a structured
`event=image_evicted` WARN log surfaces every FIFO eviction (with
`evicted_count`, `evicted_bytes`, `remaining_bytes_used`, `cap`,
`terminal_id`) into the Tier 🟡 #7 in-app log viewer. The "my image
disappeared" case is now self-diagnosable from the badge tooltip +
log filter.

---

Items not on this list yet — `project_dogfood_log.md` will accumulate
痛み through ~2026-05-14 (two-week window from re-open) and feed
priorities here.
