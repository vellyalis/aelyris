$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$TauriDir = Join-Path $Root "src-tauri"
$IsWindowsPlatform = ($env:OS -eq "Windows_NT") -or [bool](Get-Variable -Name IsWindows -ValueOnly -ErrorAction SilentlyContinue)

Push-Location $Root
try {
  $RustcVerbose = & rustc -Vv
  if ($LASTEXITCODE -ne 0) {
    throw "rustc -Vv failed with exit code $LASTEXITCODE"
  }

  $HostTriple = ($RustcVerbose | Where-Object { $_ -like "host:*" } | Select-Object -First 1) -replace "^host:\s*", ""
  if (-not $HostTriple) {
    throw "Unable to determine Rust target triple from rustc -Vv"
  }

  & cargo build --manifest-path "src-tauri/pty-server/Cargo.toml" --release
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build pty-server failed with exit code $LASTEXITCODE"
  }

  & cargo build --manifest-path "src-tauri/Cargo.toml" --release --bin "aelys"
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build aelys failed with exit code $LASTEXITCODE"
  }

  $Extension = if ($IsWindowsPlatform) { ".exe" } else { "" }
  $Built = Join-Path $TauriDir "pty-server/target/release/aelyris-pty-server$Extension"
  $Bundled = Join-Path $TauriDir "binaries/aelyris-pty-server-$HostTriple$Extension"
  $BuiltCtl = Join-Path $TauriDir "target/release/aelys$Extension"
  $AccidentalMainPackageBin = Join-Path $TauriDir "target/release/aelyris-pty-server$Extension"

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Bundled) | Out-Null
  Copy-Item -LiteralPath $Built -Destination $Bundled -Force
  (Get-Item -LiteralPath $Bundled).LastWriteTime = Get-Date
  (Get-Item -LiteralPath $BuiltCtl).LastWriteTime = Get-Date
  Remove-Item -LiteralPath $AccidentalMainPackageBin -Force -ErrorAction SilentlyContinue

  Write-Host "Prepared PTY sidecar: $Bundled"
  Write-Host "Prepared aelys: $BuiltCtl"
}
finally {
  Pop-Location
}
