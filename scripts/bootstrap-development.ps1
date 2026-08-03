[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$VerifyBuild
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
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

$git = Require-Command "git.exe" "Install Git for Windows, then reopen PowerShell."
$scriptRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (& $git -C $scriptRepository rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw "The bootstrap script must be stored inside an Aelyris Git clone."
}
Set-Location -LiteralPath $repoRoot

$node = Require-Command "node.exe" "Install Node.js 24.x. The tracked version is in .node-version."
$pnpm = Require-Command "pnpm.cmd" "Install pnpm 10.x (for example: npm install --global pnpm@10.33.0)."
$rustc = Require-Command "rustc.exe" "Install the stable Rust MSVC toolchain with rustup."
$cargo = Require-Command "cargo.exe" "Install the stable Rust MSVC toolchain with rustup."

$nodeVersion = (& $node --version).Trim()
$pnpmVersion = (& $pnpm --version).Trim()
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

Write-Host "Aelyris toolchain: Node $nodeVersion; pnpm $pnpmVersion; $rustVersion; $cargoVersion"

if (-not $SkipInstall) {
  Invoke-Checked -FilePath $pnpm -Arguments @("install", "--frozen-lockfile")
} elseif (-not (Test-Path -LiteralPath (Join-Path $repoRoot "node_modules"))) {
  throw "-SkipInstall requires an existing node_modules directory."
}

Invoke-Checked -FilePath $node -Arguments @("scripts/bootstrap-fresh-clone-continuation.mjs")
Invoke-Checked -FilePath $pnpm -Arguments @("verify:fresh-clone")

if ($VerifyBuild) {
  Invoke-Checked -FilePath $pnpm -Arguments @("exec", "tsc", "--noEmit")
  Invoke-Checked -FilePath $cargo -Arguments @("check", "--manifest-path", "src-tauri/Cargo.toml", "--lib")
}

Write-Host "Fresh-clone bootstrap PASS. Start development with: pnpm tauri dev"
