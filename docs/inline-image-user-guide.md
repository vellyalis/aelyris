# Inline images on Aether Terminal — user guide

This is the power-user-facing guide. If you want a 30-second smoke
recipe for the dogfood machine, read
[`docs/inline-image-dogfood.md`](inline-image-dogfood.md) instead. If
you want the wire format, read
[`docs/chunked-osc-image-protocol.md`](chunked-osc-image-protocol.md).

## TL;DR

Pipe a PNG into the terminal:

```powershell
# PowerShell (Windows)
.\scripts\aether-imgcat.ps1 path\to\image.png
```

```bash
# Git Bash (Windows) / any POSIX bash
bash scripts/aether-imgcat.sh path/to/image.png
```

The image renders inline at the cursor position. That's it.

## Why a bespoke wrapper?

On Win11 25H2, the standard inline-image escape vehicles do not
deliver bytes through ConPTY:

- **Kitty graphics protocol** (`\e_G…\e\\`) is silently stripped by
  ConPTY even with `PSEUDOCONSOLE_PASSTHROUGH_MODE=0x8` enabled
  (verified 2026-04-30 — see
  [`docs/ROADMAP_POST_0_2_4.md`](ROADMAP_POST_0_2_4.md) Tier 🔴 #1).
- **Single-shot OSC of any kind > ~512 bytes** is silently truncated
  by ConPTY's forwarding buffer (verified 2026-04-30 with
  `scripts/diag-osc-size.mjs`).

That kills `chafa -f kitty`, `kitty +kitten icat`, and any tool that
emits a large escape in one go. Aether Terminal speaks an
**Aether-specific chunked OSC 1338 protocol** that splits images into
many short frames and reassembles them in the engine. The emitter
wrappers (`aether-imgcat.{ps1,sh}`) are the canonical way to drive it.

On Linux / macOS, PTYs deliver Kitty APC end-to-end and you can keep
using the standard tools. The chunked-OSC protocol still works there
— it's portable — but using it is not necessary unless you want a
single recipe across platforms.

## Limits

| Limit                          | Value     | What happens when you hit it |
|--------------------------------|-----------|------------------------------|
| Per-image raw bytes            | 50 MiB    | `SizeLimitExceeded` — image is dropped, partial bytes retained for diagnostic. |
| Chunks per image               | 16384     | `ChunkLimitExceeded` — same. |
| Max declared dimension (W/H)   | 8192 px   | Rejected at `BEGIN` parse. |
| Per-session image storage      | 50 MiB    | FIFO eviction — oldest images drop silently. |
| Per-OSC byte ceiling           | ~512 B    | Hard ConPTY constraint. The emitters chunk under this. |

If your workflow regularly approaches these limits, file an issue
with the use case so we can raise / instrument them.

## What the emitters do (and don't)

Both `aether-imgcat.ps1` and `aether-imgcat.sh`:

- Validate the input is a PNG by signature.
- Read width / height from the IHDR chunk.
- Allocate a random image-id (or accept one as the second positional
  arg).
- Emit `BEGIN` / `DATA` / `END` OSC 1338 frames keyed on that id.

They do **not**:

- Convert other formats (JPEG, GIF, WebP) — convert to PNG first
  (`magick in.jpg out.png`).
- Resize / re-encode — bytes are passed through verbatim.
- Display anything themselves — the terminal engine paints the image
  on receipt.
- Survive `ExecutionPolicy Restricted` (Windows default for `.ps1`).
  Run with `-ExecutionPolicy Bypass` or sign the script.

## Diagnosing failures

The 30-second triage tree:

1. **Nothing happens, no garbage on the grid.**
   - Most likely the emitter exited early. Run it manually and check
     the exit code:
     ```powershell
     .\scripts\aether-imgcat.ps1 image.png; "exit=$LASTEXITCODE"
     ```
   - Exit codes: 0 success / 1 file not found / 2 not a PNG / 3 IHDR
     malformed / 4 internal cap violation.

2. **Garbage characters on the grid (e.g. `]1338;…`).**
   - The OSC 1338 parser is not consuming frames. This is a regression
     in the engine; `cargo test --lib` should catch it. Rebuild:
     ```bash
     cd src-tauri && cargo build
     ```

3. **Image appears, then disappears later.**
   - Cap eviction (50 MiB). Open a new pane or close older ones.

4. **`term_image_data` returns null for a known id.**
   - Validation failed — likely a `ChunkGap` (a DATA frame was
     dropped by ConPTY). Re-emit; if reproducible, file an issue with
     the chunk count + emitter version.

The full failure-mode catalogue lives in
[`docs/chunked-osc-troubleshooting.md`](chunked-osc-troubleshooting.md).

## Going further

- **Programmatic access**: the protocol is documented byte-for-byte
  in [`docs/chunked-osc-image-protocol.md`](chunked-osc-image-protocol.md)
  so you can write your own emitter in any language.
- **Diag harness**: `scripts/diag-chunked-osc.mjs` runs four cases
  (PowerShell + Bash) × (1×1 + 32×32) and exits non-zero on any
  FAIL. Suitable as a pre-commit smoke gate.
- **Engine internals**: `src-tauri/src/term/images/chunked_osc.rs`
  has the parser + assembler. Sprint 1 commit `a627cb7` is the
  canonical landing.
