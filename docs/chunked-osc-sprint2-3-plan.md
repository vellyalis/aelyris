# Chunked OSC inline image — Sprint 2/3 plan

Status: drafted 2026-05-01 right after Sprint 1 (`a627cb7`) landed.
This document is the contract Sprint 2 / 3 should land against. The
protocol itself is frozen by `docs/chunked-osc-image-protocol.md` —
this file is purely about *the work that takes the engine assembler
end-to-end on Win11 and stresses it to a wizard-grade quality bar*.

## Definition of "wizard-grade"

What we mean when we say the chunked-OSC pipeline is wizard-grade:

1. **Real Win11 ConPTY round-trip** — a dogfood machine pipes an
   actual PNG file through `aether-imgcat`, the engine assembles it,
   the snapshot exposes it, and the frontend paints it. No
   workaround, no synthetic byte stream. The diag script proves it.
2. **Hostile-input-safe** — a runaway / malicious emitter cannot OOM
   the host, hang the engine, leak partial frames into the grid, or
   wedge the assembler. This is already mostly true at the Sprint-1
   layer (caps + validation) but we need stress tests that prove it.
3. **Concurrent transfers don't corrupt one another** — interleaved
   image-ids are already supported in the assembler; we need an E2E
   spec that exercises the path under real PTY load.
4. **Observable** — when something goes wrong (cap eviction, decode
   failure, abandoned transfer) the user can see what happened. A
   silent failure is worse than a loud one for a power-user.
5. **Documented** — a power user can read one page and know how to
   pipe an image, what failure modes look like, and where the limits
   are.

Sprint 2 covers (1). Sprint 3 covers (2)–(5).

## Sprint 2 — Emitter wrappers + Win11 dogfood verify

### Goal

Land the emitter half of the protocol. After Sprint 2:

- `aether-imgcat <path>` works in PowerShell and in Git Bash on the
  dogfood Win11 machine.
- `scripts/diag-chunked-osc.mjs` proves end-to-end round-trip:
  `term_snapshot` reports `images: [...]` non-empty, and
  `term_image_data` returns a `\x89PNG…` blob.
- A small PNG fixture lives under `e2e/fixtures/` so the diag is
  reproducible without hand-rolling test data.

### Deliverables

1. **`scripts/aether-imgcat.ps1`** (PowerShell 5.1+ / 7+ compatible)
   - Param: `[string]$Path` (positional), `[int]$ImageId` (optional,
     defaults to a random `[Random]::new().Next(1, [int]::MaxValue)`).
   - Reads `[IO.File]::ReadAllBytes($Path)`.
   - Validates PNG signature `89 50 4E 47 0D 0A 1A 0A`. Anything else
     fails fast with a clear message — no silent base64 bypass for
     non-PNG until RGBA support is added.
   - Extracts width / height from IHDR (big-endian u32 at offsets
     16 and 20).
   - Splits the byte stream into 369-byte raw chunks, base64-encodes
     each (`[Convert]::ToBase64String($chunk)`), and writes
     `\x1b]1338;D;<id>;<idx>;<b64>\x07` via `[Console]::Out.Write`.
   - Wraps with `BEGIN` / `END` frames keyed on the same `<id>`.
   - Emits a final `\n` so the shell prompt lands cleanly on the
     next line (matches `chafa -f kitty …` UX).
   - Exit codes: `0` success, `1` file not found, `2` not a PNG,
     `3` IHDR malformed.
   - **Why `[Console]::Out.Write` and not `Write-Host`**: `Write-Host`
     is line-buffered through PowerShell's host UI, which mangles
     binary base64 strings. `[Console]::Out.Write` hits stdout as a
     single byte sequence — same trick used in
     `e2e/image-flows.spec.ts` line 205.
   - **Why 369 bytes**: ConPTY caps a single OSC at ~512 bytes total.
     `\x1b]1338;D;<id>;<idx>;<b64>\x07` framing is ~20 bytes for a
     short id+idx; 369 raw bytes → 492 base64 chars → ~512 total.

2. **`scripts/aether-imgcat.sh`** (Git Bash, POSIX-clean)
   - Same surface as the `.ps1` (positional `$1` path, optional
     `$2` image-id).
   - Reads the PNG with `od -An -tx1 -N0 -v "$path"` discarded
     pre-flight, `od -An -tu4 -j16 -N4 --endian=big "$path"` to
     read width, `j20` for height. (`--endian=big` is GNU-od; Git
     Bash ships GNU coreutils so this is portable on Windows.)
   - Streams the file through `base64 -w0 < "$path"` once, then
     slices the resulting base64 string into 492-char chunks via
     parameter expansion.
   - Emits via `printf '\e]1338;…\a'`.
   - **Sanity check**: every emitted DATA OSC must be ≤ 512 bytes;
     the script asserts this with a runtime check so a regression in
     chunk size is caught locally instead of silently failing on
     ConPTY.

3. **`e2e/fixtures/inline-image-8x8.png`** (≤ 4 KB)
   - Hand-crafted 8×8 transparent PNG with a single red pixel at
     `(0, 0)` so a pixel-sample test in Sprint 3 has a known
     ground truth. Generate once with a one-off Node script
     committed as a comment header in the fixture itself, or with
     ImageMagick `magick -size 8x8 xc:transparent -fill red -draw …`.

4. **`scripts/diag-chunked-osc.mjs`**
   - Mirrors `scripts/diag-image-escape.mjs`'s shape: CDP attach to
     `localhost:9222`, `__TAURI_INTERNALS__.invoke` for IPC.
   - For each shell `["powershell", "gitbash"]`:
     - Spawn a terminal.
     - Write the appropriate `aether-imgcat` invocation.
     - Wait up to 8 s for `term_snapshot.images` to be non-empty.
     - Pull `term_image_data(id, imageId)` and assert
       `format === "png"` + `dataBase64` is a valid `\x89PNG…` blob.
     - Log PASS / FAIL with timing.
   - Exits with non-zero on any FAIL so the script is suitable as a
     pre-commit / pre-release smoke gate.

5. **`docs/inline-image-dogfood.md`** (smoke runbook)
   - 30-second recipe for the dogfood machine: open the app, run
     `scripts/aether-imgcat.ps1 e2e/fixtures/inline-image-8x8.png`,
     expect to see the red dot in the terminal.
   - Failure-mode crib: what each visible behaviour means
     (truncated chunk → `ChunkGap` with no image; bad b64 → image
     entry exists with `decoded=None`; cap eviction → silent drop).

### Acceptance

- `pnpm tauri:dev` running, `node scripts/diag-chunked-osc.mjs`
  reports both PowerShell and Git Bash PASS.
- Existing 16 Playwright specs still pass (`pnpm playwright test`).
- `pnpm test` (Vitest) and `cargo test --lib` (462 → unchanged) both
  pass.
- The 8×8 fixture is < 4 KB so the round-trip exercises ~12 chunks,
  not just one — proves the chunked path actually fires.

### Out of scope for Sprint 2

- RGBA emitter (`format=rgba` path). PNG covers 99% of real CLI
  tooling; RGBA is a Sprint-3+ extension.
- iTerm2 OSC 1337 fallback in the emitter. Tier 🟢 #4.
- A Rust binary equivalent of the wrappers (`scripts/aether-imgcat.exe`)
  for Tauri-bundled distribution. Useful long-term but the script
  form is enough to dogfood.

## Sprint 3 — E2E + stress + telemetry

### Goal

Prove the chunked-OSC pipeline is wizard-grade against the criteria
in the introduction: hostile inputs, concurrent transfers, and
observability.

### Deliverables

1. **Re-enable `e2e/image-flows.spec.ts` test 2** (`test.fixme` →
   `test`). Replace the Kitty APC escape with the chunked-OSC
   emitter — shell out to `aether-imgcat.ps1` and assert the same
   `\x89PNG…` round-trip the original test wanted.

2. **New `e2e/chunked-osc-flows.spec.ts`** — at least these specs:
   - 4 KB PNG round-trip (~12 chunks; happy path).
   - 32 KB PNG round-trip (~88 chunks; long path).
   - Two concurrent transfers (image-ids 1 and 2 interleaved at the
     wire level — assert both surface independently).
   - One malformed `BEGIN` (unknown format `jpeg`) followed by a
     valid transfer — the malformed frame must drop and the valid
     transfer must succeed.
   - One transfer where the emitter is `kill`-ed mid-stream (no
     `END`) followed by a valid transfer — the abandoned id must not
     prevent the second from completing.

3. **Stress test** (`scripts/stress-chunked-osc.mjs`, optional but
   high-value):
   - Loop 100 emissions of the 4 KB fixture, alternating image-ids.
   - Assert `images_bytes_used` (see #4) stays below 50 MiB +
     epsilon, that FIFO eviction fires, and that the most recent
     N images remain retrievable.

4. **Memory-budget telemetry IPC + status badge**
   - New IPC: `term_image_metrics(id) -> { bytesUsed, cap, count }`.
   - Status bar widget in `features/statusbar/`: `img: 12.3 / 50 MiB`
     when the live terminal has any inline images, hidden otherwise.
   - When eviction fires, log a structured `image_evicted` event
     through the existing JSON log (Tier 🟡 #7 surface).

5. **Streaming partial paint** (optional, gated on observed dogfood
   pain):
   - On `BEGIN`, register a placeholder `ImageRef` with `decoded =
     None` and let the frontend draw a thin outlined rect of the
     declared dimensions while chunks accumulate.
   - On every `DATA` arrival, update a `progressFraction` field
     so the frontend can fill the rect proportionally.
   - On `END` success, replace with the real bitmap.
   - Ship behind a config flag (`Settings → Terminal → Show inline-
     image upload progress`) so it can be turned off if the visual
     is distracting on slow machines.

6. **`docs/inline-image-user-guide.md`** — power-user-facing doc:
   - How to use `aether-imgcat`.
   - Limits (50 MiB / 16384 chunks / 8192 dim).
   - What error messages mean.
   - How to debug (`scripts/diag-chunked-osc.mjs`, `term_image_metrics`).

7. **`docs/chunked-osc-troubleshooting.md`** — failure-mode catalogue:
   - "I piped an image but nothing showed up" → checklist.
   - "Chunk count exceeds limit" → what the emitter is doing wrong.
   - "Image disappeared after a while" → cap eviction, tune the
     workflow or close older terminals.

### Acceptance

- `pnpm playwright test` passes including the unfixme'd test 2 and
  the new chunked-osc spec.
- Stress script: 100 emissions complete without a panic, the cap is
  respected, and the most recent K images are still retrievable.
- Status bar shows the metrics when an image is live.
- A docs reader can answer "how do I show an inline image on
  Windows?" from `docs/inline-image-user-guide.md` alone.

### Out of scope for Sprint 3 (defer to post-v0.2.4)

- Scrollback inline image rendering (Tier 🟢 #5).
- iTerm2 OSC 1337 (Tier 🟢 #4) — separable.
- Frontend canvas pixel-sample E2E spec (Tier 🟢 #3) — a
  meaningfully different harness.

## Sequencing

Sprint 2 must land before Sprint 3 starts: Sprint 3's E2E spec
shells out to the emitter, and the stress script needs the dogfood
verify path to be green first. Inside Sprint 2, the suggested order
is:

1. Fixture generation (≤ 1 hour).
2. PowerShell emitter — easier to debug because PowerShell errors
   are loud (~3 hours).
3. Git Bash emitter — port of the PowerShell logic (~2 hours).
4. `diag-chunked-osc.mjs` — leverage `diag-image-escape.mjs` shape
   (~1 hour).
5. Dogfood verify on the actual Win11 machine (~30 min).
6. `inline-image-dogfood.md` runbook (~30 min).

Total Sprint 2: ~1 day of focused work.

Sprint 3 is more open-ended depending on which pieces of the
"observable" axis we pull in. A minimal Sprint 3 (E2E + telemetry
IPC + user guide) is ~1 day; a full Sprint 3 with streaming partial
paint and the stress harness is ~2 days.

## Risks & escape hatches

- **ConPTY behaviour shifts on a Win11 future build**: if Microsoft
  raises the OSC cap or restores APC delivery, the chunked-OSC path
  becomes unnecessary on those builds. The protocol is harmless to
  keep around; gate its use behind `cfg!(target_os = "windows")` only
  if there's a measurable overhead reason to.
- **`base64 -w0` not available**: BSD-ish bash environments lack the
  `-w0` flag. Git Bash ships GNU base64 so the wrapper works there;
  document the dependency in the script header.
- **PowerShell ExecutionPolicy blocks the `.ps1`**: ship the wrapper
  with a docs note recommending `-ExecutionPolicy Bypass` for one-off
  use, or sign the script as part of the v0.2.4 release.
- **A user pipes a 100 MB image**: per-image cap (50 MiB) aborts
  with `SizeLimitExceeded` after ~150k chunks. The emitter could
  fail-fast on file size before sending; this is a Sprint-2 polish
  item.

## Verification stack at the end of Sprint 3

| Layer | Test |
|-------|------|
| Parser | 14 unit tests in `chunked_osc.rs` |
| Assembler | 14 unit tests in `chunked_osc.rs` |
| Engine integration | 6 unit tests in `engine.rs` |
| Snapshot wiring | 5 existing snapshot tests in `snapshot.rs` |
| Frontend hook | 8 Vitest tests in `useTerminalImages.test.tsx` |
| Tauri dev round-trip | `scripts/diag-chunked-osc.mjs` |
| Playwright E2E | `image-flows.spec.ts` test 2 + `chunked-osc-flows.spec.ts` |
| Stress | `scripts/stress-chunked-osc.mjs` |
| Observability | `term_image_metrics` IPC + status bar |
| Docs | `inline-image-user-guide.md` + troubleshooting |

When all rows are green, `v0.2.4` can ship.
