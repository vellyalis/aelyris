#!/usr/bin/env bash
# Pipe a PNG file through the Aether chunked-OSC inline-image protocol.
#
# Win11 ConPTY strips Kitty APC and truncates any single OSC above
# ~512 bytes. This wrapper slices a PNG into ConPTY-friendly OSC 1338
# frames the engine assembles back into one image. Wire format:
# docs/chunked-osc-image-protocol.md. Smoke recipe:
# docs/inline-image-dogfood.md.
#
# Dependencies (Git Bash on Windows ships all of these):
#   - GNU `od` with `--endian=big` (coreutils 8.23+, 2014+)
#   - GNU `base64` with `-w0` (no line wrapping)
#   - bash 4+ for `${var:offset:length}` substring expansion
#
# Usage:
#   aether-imgcat.sh <path> [image-id]
#
# Exit codes:
#   0   success
#   1   file not found / unreadable
#   2   not a PNG (signature mismatch)
#   3   IHDR malformed
#   4   internal: DATA frame exceeded ConPTY's 512-byte cap

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "usage: aether-imgcat.sh <path> [image-id]" >&2
    exit 1
fi

path="$1"
if [ ! -r "$path" ]; then
    echo "file not found or unreadable: $path" >&2
    exit 1
fi

# Random id = $RANDOM (15 bits) << 16 | $RANDOM, kept positive (< 2^31).
default_id=$(( (RANDOM * 65536 + RANDOM) & 0x7FFFFFFF ))
if [ "$default_id" -le 0 ]; then default_id=1; fi
image_id="${2:-$default_id}"

# Verify PNG signature: 89 50 4E 47 0D 0A 1A 0A.
sig_hex=$(od -An -tx1 -N8 -v "$path" | tr -d ' \n')
if [ "$sig_hex" != "89504e470d0a1a0a" ]; then
    echo "not a PNG (signature mismatch): $sig_hex" >&2
    exit 2
fi

# Read width / height from IHDR. PNG layout puts width at byte 16 and
# height at byte 20, both big-endian u32. `--endian=big` is GNU od.
width=$(od -An -tu4 -N4 -j16 --endian=big "$path" | tr -d ' \n')
height=$(od -An -tu4 -N4 -j20 --endian=big "$path" | tr -d ' \n')
if [ -z "$width" ] || [ -z "$height" ]; then
    echo "IHDR malformed: could not read dimensions" >&2
    exit 3
fi
if [ "$width" -le 0 ] || [ "$width" -gt 8192 ] || [ "$height" -le 0 ] || [ "$height" -gt 8192 ]; then
    echo "IHDR malformed: width=$width height=$height (engine cap is 8192)" >&2
    exit 3
fi

# 492 base64 chars = 369 raw bytes. DATA framing of ~20 bytes lands the
# OSC at ~512, right at ConPTY's measured cap (Spike 2 in
# docs/ROADMAP_POST_0_2_4.md).
chunk_b64_len=492

b64=$(base64 -w0 "$path")
total_b64=${#b64}

# BEGIN frame.
printf '\033]1338;B;%d;png;%d;%d\007' "$image_id" "$width" "$height"

# DATA frames. Split base64 into fixed-width substrings; the assembler
# concatenates and decodes once, so chunk boundaries don't need to
# align with raw-byte boundaries.
offset=0
idx=0
while [ "$offset" -lt "$total_b64" ]; do
    chunk="${b64:$offset:$chunk_b64_len}"
    frame=$(printf '\033]1338;D;%d;%d;%s\007' "$image_id" "$idx" "$chunk")
    frame_len=${#frame}
    if [ "$frame_len" -gt 512 ]; then
        echo "DATA frame $idx is $frame_len bytes — exceeds ConPTY's 512-byte cap. Reduce chunk_b64_len." >&2
        exit 4
    fi
    printf '%s' "$frame"
    offset=$((offset + chunk_b64_len))
    idx=$((idx + 1))
done

# END frame, plus a newline so the shell prompt lands cleanly.
printf '\033]1338;E;%d\007\n' "$image_id"
