# Sixel + Kitty inline images — spike (Tier 🟡 #5)

Status: **All three sprints landed (foundation + decode + paint).**
Started: 2026-04-28. Sprint 2 landed 2026-04-29 — Sixel decoder is an
in-tree minimal implementation (no `sixel-image` crate adopted; the
audit / bundle-size cost outweighed the spec subset we needed to
implement). Sprint 3 landed 2026-04-30 — `GridSnapshot.images`,
`term_image_data` IPC, and `TerminalCanvas` paint pass close the
post-0.2.3 Tier 🟡 backlog entirely.

The post-0.2.3 roadmap (`docs/ROADMAP_POST_0_2_2.md`, item 5) calls
for inline image rendering of two protocols:

- **Kitty graphics protocol** — `\x1b_G<key=value,...>;<base64-payload>\x1b\\`
- **Sixel** — DCS `\x1bP<params>q<bitmap>\x1b\\`

Estimated 3–5 days end-to-end. This document records the staged plan
so each sprint produces something landable on its own and the next
session has an unambiguous merge target.

## Why these two formats

Most modern image-emitting CLI tools target one of the two:

| Tool | Default protocol |
|------|------------------|
| `kitty +kitten icat` | Kitty `_G` |
| `chafa -f kitty` | Kitty `_G` |
| `chafa -f sixel` | Sixel |
| `viu` | Kitty when supported, Sixel fallback |
| `wezterm imgcat` | iTerm2 OSC 1337 (out of scope for v1) |

iTerm2's OSC 1337 (`\x1b]1337;File=...\x07`) is a clear "yes, later"
candidate but is intentionally out of scope here — the encoding lives
inside an OSC payload that already overlaps the OSC 133 scanner, so
adding it after Kitty/Sixel land cleanly is much easier than doing all
three at once.

## Sprint plan

### Sprint 1 — Foundation (this commit)

Goal: every byte that could plausibly be an image escape is recognised
and *removed from the alacritty stream* so it never lands as garbage
text on the grid. Decoding and rendering land in subsequent sprints.

- `src-tauri/src/term/images/sequences.rs` — pure scanner over a byte
  slice that returns one of `ParseStep::Consumed { bytes, payload } |
  Incomplete | None` mirroring the existing OSC 133 parser shape.
  Recognises both Kitty `\x1b_G…\x1b\\` and Sixel
  `\x1bP…q…\x1b\\` boundaries. The scanner does **not** decode;
  the payload is returned to the caller as a raw byte vector tagged
  with the protocol it came from.
- `src-tauri/src/term/images/kitty.rs` — Kitty header parser
  (`a=T,f=100,t=d`) returning a typed `KittyHeader` with the keys we
  care about (`a`, `f`, `t`, `m`, `i`, `s`, `v`, `c`, `r`).
- `src-tauri/src/term/images/store.rs` — `ImageStore` keyed by
  monotonic `ImageId`. FIFO eviction triggers when stored bytes
  exceed `IMAGE_BYTE_CAP` (50 MiB per the roadmap risk hedge). Lookup
  + insert + size-tracking only — decode + paint live in later
  sprints.
- `engine.rs` — wire the scanner alongside the existing OSC 133 scan
  so both run on the same combined buffer. Image bytes are *consumed*
  (not forwarded to alacritty) so the grid never sees the escape.
  Captured payloads are passed to `ImageStore::insert` but not yet
  surfaced anywhere; that wiring is Sprint 3.

What we are **not** doing in this sprint, on purpose:

- No Sixel pixel decode. The scanner just records the raw DCS body.
- No Kitty chunked re-assembly (`m=1` continuation chunks). The
  Sprint-1 scanner treats each Kitty escape as standalone; chunking
  is a Sprint-2 problem.
- No `Snapshot::images: Vec<ImageRef>`. The current snapshot serde
  contract stays untouched so the IPC and frontend ship as-is.
- No frontend changes.

This means after Sprint 1 the *only* visible difference is "if you
`echo`d a sixel/kitty escape into the terminal, you no longer see the
control bytes printed as ASCII garbage." That's a real correctness
fix — pre-spike, the bytes leaked through to alacritty and corrupted
the grid.

### Sprint 2 — Decoding

- Pick a Sixel decoder. Candidates:
  - **`sixel-image`** (pure Rust, RGBA output) — preferred unless
    benchmarks reject it.
  - `icy_sixel` — works but pulls in an unmaintained C tree.
- Implement Kitty chunked re-assembly: collect `m=1` chunks under the
  same `i=N` until `m=0` arrives, then promote to a complete image.
  Chunks straddling `advance()` boundaries already work because the
  Sprint-1 scanner handles `Incomplete`.
- Decode to a normalised in-memory representation: pixel format
  (RGBA8), `width × height`, plus the cell rectangle requested by the
  protocol header (`c=cols, r=rows` for Kitty; computed from pixel
  dims for Sixel).
- Per-session memory cap stays at 50 MiB; eviction is FIFO.

Tests: protocol round-trip from raw bytes → decoded pixels for a
small fixture image (10×10 PNG for Kitty, equivalent Sixel hand-
encoded).

### Sprint 3 — Snapshot wiring + paint

- Extend `GridSnapshot` with `images: Vec<ImageRef { id, cell_row,
  cell_col, cell_w, cell_h }>` keyed by `ImageId`. Older snapshots
  serialise with the field omitted via `#[serde(skip_serializing_if =
  "Vec::is_empty")]` so the frontend type can land additively.
- New IPC `term_image_data(id) -> Vec<u8>` returning the raw image
  bytes (PNG for Kitty passthrough, RGBA buffer for decoded Sixel).
  PNG can flow straight to `<img src="data:…">`; RGBA needs a small
  client-side wrapper that pushes the buffer into an `ImageBitmap`.
- `TerminalCanvas` paints images on top of the cell rendering pass at
  the position recorded in the snapshot. A simple `ctx.drawImage`
  scaled to the cell rectangle is enough for v1; sub-pixel placement
  and alpha compositing are future work.
- E2E: a Playwright spec via the CDP attach pattern that pipes a
  fixture Kitty escape into the PTY and asserts an `<img>` element
  shows up at the expected cell offset.

## File layout decisions

The image module sits next to `prompt_marks.rs` because both are
escape-sequence parsers that pre-empt alacritty:

```
src-tauri/src/term/
├── images/
│   ├── mod.rs       — re-exports
│   ├── sequences.rs — Kitty + Sixel boundary scanner
│   ├── kitty.rs     — Kitty header (key=value) parser
│   ├── sixel.rs     — Sixel DCS parameter parser  (Sprint 2)
│   └── store.rs     — ImageStore + eviction
├── engine.rs        — wires scanners
├── prompt_marks.rs
├── snapshot.rs
└── …
```

`sixel.rs` exists in Sprint 1 with `pub struct SixelHeader;` only — a
landing pad so the next sprint has a place to drop the parser without
churning module wiring.

## Memory budget

Per-session cap: **50 MiB** (roadmap risk hedge). `ImageStore` tracks
`bytes_used` as the sum of every retained payload's `len()`. On insert
that would exceed the cap, the oldest entries are evicted first until
the new entry fits. Eviction is FIFO via `VecDeque<ImageId>` because:

- LRU would require an access tracker that adds latency to every
  snapshot read for a payoff that's hard to measure on inline-image
  workloads (most images are written once and shown once).
- FIFO maps to the natural lifecycle of "image scrolls off, gets
  forgotten."

When Sprint 3 wires the snapshot, the `ImageRef` keeps the `ImageId`
even after the entry is evicted. The frontend handles a 404 from
`term_image_data` by leaving the cell rectangle unrendered — the same
graceful degradation as scrollback eviction past `SCROLLBACK_LINES`.

## References

- Kitty graphics protocol — <https://sw.kovidgoyal.net/kitty/graphics-protocol/>
- Sixel DCS spec — DEC STD 070 (PDF in DEC archive). Practical guide:
  <https://saitoha.github.io/libsixel/>
- Existing parser to mirror: `src-tauri/src/term/prompt_marks.rs`
  (the `ParseStep::{Consumed,Incomplete,None}` shape is what the
  image scanner adopts).
