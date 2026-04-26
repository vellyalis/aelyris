# Chunked OSC 1338 inline-image protocol

Status: **Sprint 1 — engine assembler**. Sprint 2 will land emitter
wrapper scripts (`scripts/aether-imgcat.{ps1,sh}`); Sprint 3 unblocks
the E2E spec and re-enables `e2e/image-flows.spec.ts` test 2.

## Why a custom protocol

`docs/ROADMAP_POST_0_2_4.md` Tier 🔴 #1 documents in detail why the
standard escape vehicles do not deliver image bytes on Win11 25H2
ConPTY:

- **Kitty `\e_G…\e\\` (APC)** is silently stripped by ConPTY even with
  `PSEUDOCONSOLE_PASSTHROUGH_MODE=0x8` enabled (verified 2026-04-30).
- **OSC of any kind > ~512 bytes** is silently truncated by ConPTY's
  forwarding buffer (also verified 2026-04-30 with
  `scripts/diag-osc-size.mjs`).

A 4 KB PNG never fits in a single OSC, so the only ConPTY-friendly
vehicle is a chunked OSC where every frame stays under the cap. This
document specifies the exact wire format the engine assembler accepts.

Linux / macOS PTYs already deliver Kitty APC end-to-end; users there
can keep using `kitty +kitten icat` / `chafa -f kitty …` unchanged.
The chunked OSC protocol is portable, but its primary purpose is
restoring inline-image rendering on Windows.

## Wire format

Three OSC verbs, all framed by `ESC ] 1338 ; … ( BEL | ESC \ )`:

```
ESC ] 1338 ; B ; <image-id> ; <format> ; <width> ; <height>   BEL
ESC ] 1338 ; D ; <image-id> ; <chunk-idx> ; <base64-block>     BEL
ESC ] 1338 ; E ; <image-id>                                    BEL
```

| Field            | Type / range                          | Meaning |
|------------------|---------------------------------------|---------|
| `<image-id>`     | u32 decimal                           | Caller-allocated id, unique within the session. Re-use abandons the earlier transfer. |
| `<format>`       | `png` \| `rgba`                       | Pixel encoding of the assembled bytes. `rgba` requires `width*height*4 == raw.len()`. |
| `<width>`        | u32 decimal, clamped to 8192          | Pixel width. |
| `<height>`       | u32 decimal, clamped to 8192          | Pixel height. |
| `<chunk-idx>`    | u32 decimal (0..N-1)                  | Zero-based chunk index. `END` validates that 0..N-1 are present. |
| `<base64-block>` | standard base64 (RFC 4648, no URL-safe) | Per-chunk slice of the image's raw byte stream. May be empty. |

Terminator may be `BEL` (`0x07`) or `ST` (`ESC \`). The engine accepts
both; emitters SHOULD use `BEL` since `printf '\\a'` is universally
available and one byte shorter on the wire.

The verbs `B` / `D` / `E` are single ASCII letters — they are the
shortest unambiguous codes, which matters when the OSC body has
~492 bytes of headroom under the ConPTY cap.

## Engine behaviour

A per-engine `ChunkAssembler` keyed by `image-id` consumes verbs:

- **BEGIN** opens (or replaces) a pending image, recording `format`,
  `width`, `height`, and an empty chunk map.
- **DATA** stores the base64 block under `chunk-idx`. Out-of-order
  chunks are accepted. Duplicate `chunk-idx` aborts the image
  (`DuplicateChunk`). Per-chunk size is unbounded but the running
  total is checked against `MAX_RAW_BYTES_PER_IMAGE` and the chunk
  count against `MAX_CHUNKS_PER_IMAGE`; either ceiling aborts.
- **END** validates 0..N-1 contiguous, decodes base64 once over the
  concatenation, builds a `DecodedImage` of the declared format, and
  yields `AssemblerOutcome::Completed`.

Validation failures (`AssemblerError::*`) abandon the entry. The
caller still receives a best-effort partial-byte concatenation so
the diagnostic surface (matching the single-shot Kitty path) can keep
the bytes around even when decode fails.

### Per-image limits

- `MAX_RAW_BYTES_PER_IMAGE` = 50 MiB (matches `IMAGE_BYTE_CAP`).
- `MAX_CHUNKS_PER_IMAGE`    = 16384.

These caps are intentionally loose: real images (a 4 MP PNG ≈ 4 MB
raw, ~88 chunks at the ConPTY cap) round-trip without trouble, but a
runaway emitter can't OOM the host.

### Concurrency

Multiple `image-id` values may be in flight simultaneously — the
assembler is keyed on id so interleaved transfers do not corrupt one
another. Real emitters allocate ids monotonically, but the engine
makes no such assumption.

## Sizing budget under ConPTY's ~512 B/OSC cap

| Component                                        | Bytes |
|--------------------------------------------------|-------|
| `ESC ] 1338 ; D ; <id> ; <idx> ; …` framing      | ~20   |
| Available for `<base64-block>`                   | ~492  |
| Decoded raw bytes per chunk (base64 0.75x)       | ~369  |

A 4 KB PNG ≈ 12 chunks. A 32 KB PNG ≈ 88 chunks. The 16384-chunk
ceiling leaves comfortable headroom.

Emitters MUST keep each `DATA` OSC's full byte length (including the
introducer and BEL) under 512 B; otherwise ConPTY drops the chunk
silently and `END` fails with `ChunkGap`.

## Emitters (Sprint 2)

`scripts/aether-imgcat.ps1` (PowerShell) and `scripts/aether-imgcat.sh`
(Git Bash / POSIX) will:

1. Read a path, detect format (PNG passthrough, others via `magick` /
   ImageMagick when available, or fail clearly).
2. Allocate `<image-id>` from a per-shell counter.
3. Emit `BEGIN`.
4. Slice the byte stream into `<= 369 byte` raw chunks, base64-encode
   each, emit `DATA`.
5. Emit `END`.

Until those scripts ship, `scripts/diag-image-escape.mjs` plus a
hand-rolled `printf` invocation is the canonical reproducer.

## What is intentionally not in Sprint 1

- Emitter wrapper scripts (Sprint 2).
- E2E spec re-enable + `image-flows.spec.ts` test 2 unfixme (Sprint 3).
- Sub-millisecond throughput optimisation: the assembler decodes
  base64 once at `END`, fine for typical inline-image sizes.
- Streaming partial paint: `BEGIN` could trigger a placeholder render,
  but the visible value is small and the snapshot already paints once
  the entry promotes to `ImageStore` on `END`.
- Memory budget telemetry (already Tier 🟢 #6 in the roadmap).
- ST-only emitter mode: the parser accepts both terminators; emitters
  use BEL by contract.
