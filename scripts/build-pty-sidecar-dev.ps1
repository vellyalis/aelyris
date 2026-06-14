$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$TauriDir = Join-Path $Root "src-tauri"
$IsWindowsPlatform = ($env:OS -eq "Windows_NT") -or [bool](Get-Variable -Name IsWindows -ValueOnly -ErrorAction SilentlyContinue)
$Retries = 5
if ($env:AETHER_DEV_SIDECAR_REPLACE_RETRIES) {
  $Retries = [int]$env:AETHER_DEV_SIDECAR_REPLACE_RETRIES
}
$RetryDelayMs = 250
if ($env:AETHER_DEV_SIDECAR_REPLACE_RETRY_DELAY_MS) {
  $RetryDelayMs = [int]$env:AETHER_DEV_SIDECAR_REPLACE_RETRY_DELAY_MS
}

function Stop-ProcessesUsingPath {
  param([Parameter(Mandatory = $true)][string]$ExePath)

  if (-not $IsWindowsPlatform) {
    return
  }

  $Target = [System.IO.Path]::GetFullPath($ExePath)
  $Items = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $Target)
    }

  foreach ($Item in $Items) {
    Stop-Process -Id $Item.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Replace-DevSidecarExecutable {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  for ($Attempt = 0; $Attempt -le $Retries; $Attempt += 1) {
    try {
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
      Copy-Item -LiteralPath $Source -Destination $Destination -Force
      return
    }
    catch {
      if ($Attempt -ge $Retries) {
        throw
      }
      Stop-ProcessesUsingPath -ExePath $Destination
      Start-Sleep -Milliseconds $RetryDelayMs
    }
  }
}

Push-Location $Root
try {
  & cargo build --manifest-path "src-tauri/pty-server/Cargo.toml"
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build pty-server failed with exit code $LASTEXITCODE"
  }

  $Extension = if ($IsWindowsPlatform) { ".exe" } else { "" }
  $Built = Join-Path $TauriDir "pty-server/target/debug/aether-pty-server$Extension"
  $Sibling = Join-Path $TauriDir "target/debug/aether-pty-server$Extension"
  Replace-DevSidecarExecutable -Source $Built -Destination $Sibling
  Write-Host "Prepared dev PTY sidecar: $Sibling"
}
finally {
  Pop-Location
}
