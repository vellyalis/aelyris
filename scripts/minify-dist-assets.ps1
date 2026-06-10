$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$distAssets = Join-Path $root "dist\assets"
$pnpmStore = Join-Path $root "node_modules\.pnpm"

if (-not (Test-Path -LiteralPath $distAssets)) {
  throw "dist assets directory is missing: $distAssets"
}

$esbuild = Get-ChildItem -LiteralPath $pnpmStore -Recurse -Filter esbuild.exe -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($null -eq $esbuild) {
  throw "esbuild.exe was not found under $pnpmStore"
}

$targets = Get-ChildItem -LiteralPath $distAssets -Recurse -File |
  Where-Object { $_.Extension -eq ".js" -or $_.Extension -eq ".css" }

foreach ($target in $targets) {
  $tmp = "$($target.FullName).min"
  if (Test-Path -LiteralPath $tmp) {
    Remove-Item -LiteralPath $tmp -Force
  }

  & $esbuild.FullName $target.FullName --minify --log-level=warning "--outfile=$tmp"
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $tmp) {
      Remove-Item -LiteralPath $tmp -Force
    }
    throw "esbuild minify failed for $($target.FullName)"
  }

  Move-Item -LiteralPath $tmp -Destination $target.FullName -Force
}

Write-Host "Minified $($targets.Count) dist JS/CSS assets with $($esbuild.FullName)"
