<#
.SYNOPSIS
    Pipe a PNG file through the Aether chunked-OSC inline-image protocol.

.DESCRIPTION
    Win11 ConPTY strips Kitty APC and truncates any single OSC above ~512
    bytes, so standard `chafa -f kitty` and `kitty +kitten icat` never
    deliver image bytes to the terminal engine. This wrapper splits a PNG
    into ConPTY-friendly OSC 1338 frames the engine assembles back into
    a single image. See docs/chunked-osc-image-protocol.md for the wire
    format and docs/inline-image-dogfood.md for the smoke recipe.

.PARAMETER Path
    Path to a PNG file. Other formats are not yet supported.

.PARAMETER ImageId
    Optional caller-allocated image id. Defaults to a positive random
    32-bit integer so back-to-back invocations don't collide on id.

.OUTPUTS
    Nothing — writes the framed bytes directly to stdout via
    [Console]::Out.Write so PowerShell's host UI never line-buffers the
    base64 payload.

.EXAMPLE
    PS> aether-imgcat.ps1 .\e2e\fixtures\inline-image-32x32.png

.NOTES
    Exit codes:
        0   success
        1   file not found
        2   not a PNG (signature mismatch)
        3   IHDR malformed
        4   internal: DATA frame exceeded ConPTY's 512-byte cap
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    [Parameter(Position = 1)]
    [int]$ImageId = (Get-Random -Minimum 1 -Maximum ([int]::MaxValue))
)

$ErrorActionPreference = 'Stop'

# `` `e `` (ESC) is only expanded in PowerShell 6+. Windows ships
# PowerShell 5 by default — using `[char]` keeps both versions happy.
$ESC = [char]27
$BEL = [char]7

# Resolve before any I/O so a relative path failure surfaces immediately.
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-Error "file not found: $Path"
    exit 1
}
$resolved = (Resolve-Path -LiteralPath $Path).Path
$bytes = [IO.File]::ReadAllBytes($resolved)

# PNG signature: 89 50 4E 47 0D 0A 1A 0A
$signature = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
if ($bytes.Length -lt 24) {
    Write-Error "not a PNG (file too short, $($bytes.Length) bytes)"
    exit 2
}
for ($i = 0; $i -lt 8; $i++) {
    if ($bytes[$i] -ne $signature[$i]) {
        Write-Error "not a PNG (signature mismatch at byte $i)"
        exit 2
    }
}

# IHDR: bytes 8..15 = chunk header (length=13 + name="IHDR"), bytes 16..23 =
# width + height as big-endian u32 each.
$width = ([uint32]$bytes[16] -shl 24) -bor ([uint32]$bytes[17] -shl 16) -bor `
         ([uint32]$bytes[18] -shl 8)  -bor  [uint32]$bytes[19]
$height = ([uint32]$bytes[20] -shl 24) -bor ([uint32]$bytes[21] -shl 16) -bor `
          ([uint32]$bytes[22] -shl 8)  -bor  [uint32]$bytes[23]
if ($width -le 0 -or $width -gt 8192 -or $height -le 0 -or $height -gt 8192) {
    Write-Error "IHDR malformed: width=$width height=$height (engine cap is 8192)"
    exit 3
}

# 369 raw bytes -> 492 base64 chars. With "\e]1338;D;<id>;<idx>;…\a"
# framing of ~20 bytes that lands the DATA OSC at ~512 bytes — right at
# ConPTY's measured cap (see docs/ROADMAP_POST_0_2_4.md Spike 2).
$ChunkRawBytes = 369

# BEGIN frame.
$beginFrame = "${ESC}]1338;B;${ImageId};png;${width};${height}${BEL}"
[Console]::Out.Write($beginFrame)

# DATA frames.
$total = $bytes.Length
$idx = 0
for ($offset = 0; $offset -lt $total; $offset += $ChunkRawBytes) {
    $end = [Math]::Min($offset + $ChunkRawBytes, $total) - 1
    $slice = $bytes[$offset..$end]
    $b64 = [Convert]::ToBase64String($slice)
    $frame = "${ESC}]1338;D;${ImageId};${idx};${b64}${BEL}"
    if ($frame.Length -gt 512) {
        Write-Error ("DATA frame {0} is {1} bytes — exceeds ConPTY's 512-byte cap. Reduce ChunkRawBytes." -f $idx, $frame.Length)
        exit 4
    }
    [Console]::Out.Write($frame)
    $idx++
}

# END frame, plus a newline so the shell prompt lands cleanly.
$endFrame = "${ESC}]1338;E;${ImageId}${BEL}"
[Console]::Out.Write($endFrame)
[Console]::Out.Write("`n")
