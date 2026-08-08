$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$DevConfig = Join-Path $Root 'src-tauri\tauri.dev.conf.json'
$VerificationConfig = Join-Path $Root 'src-tauri\tauri.verification.conf.json'

foreach ($Path in @($DevConfig, $VerificationConfig)) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Aelyris verification config is missing: $Path"
  }
}

$Verification = Get-Content -LiteralPath $VerificationConfig -Raw | ConvertFrom-Json
$Window = @($Verification.app.windows)[0]
if (
  $null -eq $Window -or
  $Window.visible -ne $false -or
  $Window.focus -ne $false -or
  $Window.skipTaskbar -ne $true -or
  $Window.alwaysOnTop -ne $false
) {
  throw 'Aelyris automated UI verification must remain hidden, non-focusing, off-taskbar, and not always-on-top.'
}

Push-Location $Root
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-pty-sidecar-dev.ps1
  if ($LASTEXITCODE -ne 0) {
    throw "PTY sidecar build failed with exit code $LASTEXITCODE"
  }

  $env:AELYRIS_AUTOMATED_UI_VERIFICATION = '1'
  & node_modules\.bin\tauri.CMD dev --config $DevConfig --config $VerificationConfig
  if ($LASTEXITCODE -ne 0) {
    throw "Hidden Tauri verification runtime failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
