[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$VerifyBuild
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string[]]$PrefixArguments = @()
  )

  $allArguments = @($PrefixArguments) + @($Arguments)
  & $FilePath @allArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($allArguments -join ' ')"
  }
}

function Require-Command {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$InstallHint
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Name is required. $InstallHint"
  }
  return $command.Source
}

function Resolve-PnpmCommand {
  $direct = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
  if ($direct) {
    return @{
      FilePath = $direct.Source
      PrefixArguments = @()
      Display = "pnpm"
    }
  }

  $corepack = Get-Command "corepack.cmd" -ErrorAction SilentlyContinue
  if (-not $corepack) {
    $corepack = Get-Command "corepack.exe" -ErrorAction SilentlyContinue
  }
  if ($corepack) {
    return @{
      FilePath = $corepack.Source
      PrefixArguments = @("pnpm")
      Display = "corepack pnpm"
    }
  }

  throw "pnpm 10.x is required. Install it directly or provide Corepack with the tracked packageManager version."
}

$git = Require-Command "git.exe" "Install Git for Windows, then reopen PowerShell."
$scriptRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (& $git -C $scriptRepository rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw "The bootstrap script must be stored inside an Aelyris Git clone."
}
Push-Location -LiteralPath $repoRoot
try {

$node = Require-Command "node.exe" "Install Node.js 24.x. The tracked version is in .node-version."
$pnpm = Resolve-PnpmCommand
$rustc = Require-Command "rustc.exe" "Install the stable Rust MSVC toolchain with rustup."
$cargo = Require-Command "cargo.exe" "Install the stable Rust MSVC toolchain with rustup."

$nodeVersion = (& $node --version).Trim()
$pnpmVersionArguments = @($pnpm.PrefixArguments) + @("--version")
$pnpmVersion = (& $pnpm.FilePath @pnpmVersionArguments).Trim()
$rustVersion = (& $rustc --version).Trim()
$cargoVersion = (& $cargo --version).Trim()
$rustDetails = (& $rustc -vV) -join "`n"

if ([int]($nodeVersion -replace '^v(\d+).*$', '$1') -ne 24) {
  throw "Node.js 24.x is required; found $nodeVersion."
}
if ([int]($pnpmVersion -replace '^(\d+).*$', '$1') -ne 10) {
  throw "pnpm 10.x is required; found $pnpmVersion."
}
if ($rustDetails -notmatch '(?m)^host:\s+.+-pc-windows-msvc$') {
  throw "The Rust MSVC host toolchain is required; rustc -vV did not report a windows-msvc host."
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw "Visual Studio Build Tools with the Desktop development with C++ workload is required."
}
$msvcInstall = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (-not $msvcInstall) {
  throw "Visual Studio Build Tools is missing the Microsoft C++ x64/x86 tool workload."
}

$webViewCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\EdgeWebView\Application"),
  (Join-Path $env:ProgramFiles "Microsoft\EdgeWebView\Application"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\EdgeWebView\Application")
)
if (-not ($webViewCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)) {
  throw "Microsoft Edge WebView2 Runtime is required. Install the Evergreen Runtime and rerun this script."
}

Write-Host "Aelyris toolchain: Node $nodeVersion; $($pnpm.Display) $pnpmVersion; $rustVersion; $cargoVersion"

if (-not $SkipInstall) {
  Invoke-Checked -FilePath $pnpm.FilePath -PrefixArguments $pnpm.PrefixArguments -Arguments @("install", "--frozen-lockfile")
} elseif (-not (Test-Path -LiteralPath (Join-Path $repoRoot "node_modules"))) {
  throw "-SkipInstall requires an existing node_modules directory."
}

Invoke-Checked -FilePath $node -Arguments @("scripts/bootstrap-fresh-clone-continuation.mjs")
Invoke-Checked -FilePath $pnpm.FilePath -PrefixArguments $pnpm.PrefixArguments -Arguments @("verify:fresh-clone")

if ($VerifyBuild) {
  Invoke-Checked -FilePath $pnpm.FilePath -PrefixArguments $pnpm.PrefixArguments -Arguments @("exec", "tsc", "--noEmit")
  Invoke-Checked -FilePath $cargo -Arguments @("check", "--manifest-path", "src-tauri/Cargo.toml", "--lib")
}

  Write-Host "Fresh-clone bootstrap PASS. Start development with: pnpm tauri dev"
} finally {
  Pop-Location
}
