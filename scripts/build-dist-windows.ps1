$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Tauri = Join-Path $Root "node_modules\.bin\tauri.CMD"
$TauriConfig = "src-tauri\tauri.dist.conf.json"
$BundleRoot = Join-Path $Root "src-tauri\target\release\bundle"
$WixDir = Join-Path $Root "src-tauri\target\release\wix\x64"
$PackageJson = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$MsiPath = Join-Path $BundleRoot "msi\Aelyris_$($PackageJson.version)_x64_en-US.msi"
$UpdaterSigningEnvPresent = -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY) -or -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH)
$NoSignArgs = if ($UpdaterSigningEnvPresent) { @() } else { @('--no-sign') }

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)"
  }
}

function Invoke-WixIceFallback {
  $Light = Join-Path $env:LOCALAPPDATA "tauri\WixTools314\light.exe"
  $Locale = Join-Path $WixDir "locale.wxl"
  $WixObj = Join-Path $WixDir "main.wixobj"

  if (-not (Test-Path -LiteralPath $Light)) {
    throw "WiX light.exe not found at $Light"
  }
  if (-not (Test-Path -LiteralPath $Locale)) {
    throw "WiX locale.wxl not found at $Locale"
  }
  if (-not (Test-Path -LiteralPath $WixObj)) {
    throw "WiX main.wixobj not found at $WixObj"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $MsiPath) | Out-Null
  & $Light -sval -ext WixUIExtension -cultures:en-us -loc $Locale -out $MsiPath $WixObj
  if ($LASTEXITCODE -ne 0) {
    throw "WiX ICE fallback failed (exit code $LASTEXITCODE)"
  }
  Write-Host "Prepared MSI via WiX ICE fallback: $MsiPath"
}

Push-Location $Root
try {
  Invoke-Checked `
    -FilePath "powershell" `
    -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\build-pty-sidecar.ps1") `
    -FailureMessage "PTY sidecar preparation failed"

  Invoke-Checked `
    -FilePath $Tauri `
    -Arguments (@("build", "--ci", "--config", $TauriConfig) + $NoSignArgs + @("--bundles", "nsis")) `
    -FailureMessage "Tauri NSIS build failed"

  $MsiBuildStarted = Get-Date
  & $Tauri build --ci --config $TauriConfig @NoSignArgs --bundles msi
  $MsiExitCode = $LASTEXITCODE

  if ($MsiExitCode -eq 0) {
    Write-Host "Prepared MSI via Tauri: $MsiPath"
    exit 0
  }

  $WixObj = Get-Item -LiteralPath (Join-Path $WixDir "main.wixobj") -ErrorAction Stop
  if ($WixObj.LastWriteTime -lt $MsiBuildStarted.AddMinutes(-1)) {
    throw "Tauri MSI build failed before producing a fresh WiX object (exit code $MsiExitCode)"
  }

  Write-Warning "Tauri MSI build failed after producing fresh WiX output; retrying linker with ICE validation suppressed."
  Invoke-WixIceFallback
  exit 0
}
finally {
  Pop-Location
}
