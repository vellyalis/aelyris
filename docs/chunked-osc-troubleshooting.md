# Chunked OSC inline-image — troubleshooting catalogue

Failure modes, their root causes, and how to fix or work around each.
Companion of [`docs/inline-image-user-guide.md`](inline-image-user-guide.md)
(power-user) and [`docs/inline-image-dogfood.md`](inline-image-dogfood.md)
(30-second smoke).

## Symptom: Nothing happens, no garbage on the grid

### Cause A — Emitter exited early

Most likely the emitter never got past PNG validation.

**Diagnose**:

```powershell
.\scripts\aether-imgcat.ps1 image.png; "exit=$LASTEXITCODE"
```

Exit codes:

| Code | Meaning                                |
|------|----------------------------------------|
| 0    | Success                                |
| 1    | File not found / unreadable            |
| 2    | Not a PNG (signature mismatch)         |
| 3    | IHDR malformed (or W/H out of 1..8192) |
| 4    | Internal: DATA frame > 512 B (bug)     |

**Fix**:

- Code 1: check the path. PowerShell wants backslashes, bash wants
  forward slashes; the wrappers don't auto-convert.
- Code 2: convert the file. `magick in.jpg out.png` works for any
  format ImageMagick understands.
- Code 3: the PNG is malformed at the IHDR level. Re-export from the
  source tool; rare in the wild.
- Code 4: file an issue with the script version, fixture size, and
  the failing chunk index. Should not happen on a fresh checkout.

### Cause B — ConPTY truncated a DATA frame

The emitter ran cleanly but a `DATA` frame > 512 bytes got silently
dropped, so `END` validation failed with `ChunkGap`.

**Diagnose**:

Run the diag harness while the failing emitter is still in the
terminal's history:

```bash
node scripts/diag-chunked-osc.mjs
```

If the diag prints `4/4 PASS` but your manual emit fails, the
emitter you're running may be a customised copy. Check the in-script
chunk size (`$ChunkRawBytes` in ps1 / `chunk_b64_len` in sh) — it
must keep total OSC length ≤ 512.

### Cause C — Image piped through a wrapper that re-buffered the bytes

If the emitter's stdout is piped through a shell that line-buffers
binary (e.g. `Out-Default | …` in PowerShell), base64 chunks land on
the PTY split in the wrong places. The OSC parser re-syncs at the
next `\e]1338;`, but missing bytes still cause `ChunkGap`.

**Fix**: invoke the emitter directly. The wrappers themselves use
`[Console]::Out.Write` / `printf '%s'` precisely so the host UI
doesn't intervene.

## Symptom: Garbage characters on the grid (`]1338;…` text)

OSC 1338 frames are leaking past the parser into alacritty.

This is an engine regression — the parser should consume every
recognised OSC 1338 frame off the wire whether or not it parses
successfully. `cargo test --lib` should catch it; if it doesn't,
the missing test is itself a bug.

**Fix**:

```bash
cd src-tauri
cargo build --release   # ensure release matches debug
cargo test --lib chunked_osc
```

Re-run the dogfood smoke after rebuild.

## Symptom: Image appears, then disappears

FIFO eviction triggered. Per-session storage caps at 50 MiB; once
exceeded, oldest entries drop until the new entry fits.

**Diagnose**: open a fresh terminal pane and re-emit. If the new pane
shows the image and the old one is missing, it's just eviction.

**Fix options**:

- Close older terminal panes that hold images you don't need.
- If you need many large images live, file an issue with the
  workflow — we can raise the cap or add per-pane budgeting.

## Symptom: `term_image_data` returns null for an `ImageRef.id` that exists

Two cases:

1. **The image was evicted between snapshot and IPC** — race condition
   on a heavily-loaded session. Retry the IPC call once.
2. **The transfer failed validation** — the engine kept the partial
   bytes (with `decoded=None`) so the diagnostic surface still sees
   them, but `term_image_data` only returns entries with a decoded
   payload. The engine error is not surfaced to the user (yet — Tier
   🟢 #6 will ship metrics). Re-emit and watch the `images_bytes_used`
   widget if it's enabled.

## Symptom: `not a PNG (signature mismatch)` from the emitter

The first 8 bytes of the file don't match `89 50 4E 47 0D 0A 1A 0A`.

**Diagnose**:

```bash
od -An -tx1 -N8 your-file.png
```

**Fix**: convert with ImageMagick or any PNG-aware tool. The emitters
intentionally fail fast rather than try to detect / convert other
formats — a misclassified file would emit garbage bytes the engine
would faithfully store as a corrupt PNG entry.

## Symptom: `DATA frame N is X bytes — exceeds ConPTY's 512-byte cap`

Internal sanity-check fired in the emitter. This means the script
was modified to use a chunk size that overflows the cap.

**Fix**: revert the chunk size constant. The default 369 raw bytes
is calibrated for the worst-case framing (`\e]1338;D;<10-digit id>;<10-digit idx>;<base64>\a`)
to stay just under 512 B.

## Symptom: PowerShell ExecutionPolicy refuses to run the .ps1

```
File … cannot be loaded because running scripts is disabled on this system.
```

**Fix one-off**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\aether-imgcat.ps1 image.png
```

**Fix permanent (per user)**:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

(`RemoteSigned` is the recommended baseline; `Bypass` opens broader
exposure than necessary for a local script.)

## Symptom: Bash emitter prints `od: invalid argument '--endian=big'`

You're running BSD `od` (macOS / OpenBSD). Git Bash on Windows ships
GNU `od` so this only hits non-Windows hosts.

**Fix**: install GNU coreutils. On macOS:

```bash
brew install coreutils
# then in the script, change `od` to `god` or prepend the GNU bin:
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
```

The emitter is Win11-first by design; portable fallbacks land in a
later sprint.

## Symptom: Diag script says `no Tauri page found at localhost:1420`

`pnpm tauri:dev` isn't running, or it's running but on a different
port.

**Fix**: start it.

```bash
pnpm tauri:dev
```

Wait for the app window to open before re-running the diag.

## Reporting issues

If your symptom doesn't match anything above, the engine internals
log structured JSON to the logger viewer (Tier 🟡 #7). Open the log
viewer, filter for `chunked_osc`, and attach the entries to the
issue. Include:

- Aether Terminal version (`pnpm tauri --version` or git SHA).
- Windows build (`winver`).
- Emitter command + fixture size.
- Last 5 s of structured log entries around the failure.
