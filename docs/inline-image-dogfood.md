# Inline-image dogfood — 30-second smoke recipe

If you're sitting at the dogfood Win11 machine and want to know
whether the chunked-OSC inline-image protocol is working today, this
is the shortest path. Spec: `docs/chunked-osc-image-protocol.md`.
Roadmap: `docs/ROADMAP_POST_0_2_4.md` Tier 🔴 #1.

## TL;DR

```
pnpm tauri:dev
# in another shell, with the Tauri window open
node scripts/diag-chunked-osc.mjs
```

Expect: `4/4 cases PASS`. Anything else is a regression.

## Manual recipe (interactive, no diag script)

1. Run `pnpm tauri:dev` and wait for the app window to open.
2. Inside the app's terminal pane, depending on which shell you spawned:
   - **PowerShell**:
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File scripts/aether-imgcat.ps1 e2e/fixtures/inline-image-32x32.png
     ```
   - **Git Bash**:
     ```bash
     bash scripts/aether-imgcat.sh e2e/fixtures/inline-image-32x32.png
     ```
3. The 32×32 gradient should paint at the prompt's cursor location.

## What success looks like

- A small 32×32 colour gradient appears at the prompt position.
- `term_snapshot.images` is non-empty — confirm via the diag script
  or `node scripts/diag-image-escape.mjs`.
- `term_image_data(<term-id>, <image-id>)` returns
  `{format: "png", dataBase64: "iVBORw0…"}`.

## Failure-mode crib

| What you see                                  | Likely cause                                                                      | Fix |
|------------------------------------------------|------------------------------------------------------------------------------------|-----|
| No image, no garbage on the grid               | Engine never received the OSC. Most likely chunk size > 512 B in the emitter.       | Re-run; if reproducible, lower `ChunkRawBytes` (ps1) / `chunk_b64_len` (sh). |
| Garbage characters on the grid (`]1338;…`)     | OSC scanner regression — frames reaching alacritty as text.                         | `cargo test --lib` should catch this; rebuild and rerun. |
| Image appears, then disappears later           | Cap eviction (50 MiB) — too many images in the same session.                        | Open a new terminal pane or close older ones. |
| `term_image_data` returns null for a known id  | The transfer failed validation (e.g. `ChunkGap`); engine kept partial bytes only.   | Re-emit; if reproducible, file an issue with the chunk count + emitter. |
| `not a PNG (signature mismatch)` from emitter  | Input file isn't a PNG. Other formats will land in Sprint 3+.                       | Convert to PNG first (`magick in.jpg out.png`). |
| `DATA frame N is X bytes — exceeds…` from emitter | Bug in the emitter's chunk math.                                                   | Open an issue; this should never happen on a fresh checkout. |

## Why a wrapper instead of `chafa -f kitty`?

Win11 25H2 ConPTY silently strips Kitty APC sequences (`\e_G…\e\\`)
and truncates any single OSC above ~512 bytes (verified 2026-04-30
with `scripts/diag-image-escape.mjs` and `scripts/diag-osc-size.mjs`).
Standard CLI emitters that expect those vehicles will not deliver a
single byte of image data to the engine.

The chunked OSC 1338 protocol works around both limits by splitting
each image into many short OSC frames the engine assembles back into
one decoded buffer. `aether-imgcat.{ps1,sh}` are the canonical
emitters; the wire format is documented in
`docs/chunked-osc-image-protocol.md` for anyone wanting to write
their own.

Linux / macOS PTYs deliver Kitty APC end-to-end; users there can
keep using `kitty +kitten icat` / `chafa -f kitty …` unchanged.

## Regenerating the fixtures

```bash
node scripts/build-image-fixtures.mjs
```

Outputs:
- `e2e/fixtures/inline-image-1x1.png` — single-chunk path
- `e2e/fixtures/inline-image-32x32.png` — multi-chunk path (~8 chunks)

Re-run only when intentionally changing the gradient — the byte
content matters for the (future) pixel-sample E2E spec.
