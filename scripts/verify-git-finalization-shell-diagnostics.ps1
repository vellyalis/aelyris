param()

$ErrorActionPreference = "Stop"

function Get-AelyrisLocalDate {
  try {
    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Tokyo Standard Time")
    return [System.TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $tz).ToString("yyyy-MM-dd")
  } catch {
    return (Get-Date).ToString("yyyy-MM-dd")
  }
}

function Invoke-DiagnosticCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $global:LASTEXITCODE = $null

  try {
    $output = & $Command *>&1 | Out-String
    $exitCode = if ($null -ne $global:LASTEXITCODE) { [int]$global:LASTEXITCODE } else { 0 }
    return [ordered]@{
      command = $Name
      ok = $exitCode -eq 0
      exitCode = $exitCode
      error = $null
      output = $output.Trim()
    }
  } catch {
    return [ordered]@{
      command = $Name
      ok = $false
      exitCode = $null
      error = $_.Exception.Message
      output = ""
    }
  } finally {
    $ErrorActionPreference = $previousEap
  }
}

function Read-AclEntries {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Paths
  )

  $entries = @()
  foreach ($path in $Paths) {
    try {
      $resolved = (Resolve-Path -LiteralPath $path -ErrorAction Stop).Path
      $acl = Get-Acl -LiteralPath $resolved -ErrorAction Stop
      foreach ($entry in $acl.Access) {
        $entries += [ordered]@{
          path = $resolved
          owner = $acl.Owner
          identity = $entry.IdentityReference.Value
          type = $entry.AccessControlType.ToString()
          rights = $entry.FileSystemRights.ToString()
          inherited = [bool]$entry.IsInherited
        }
      }
    } catch {
      $entries += [ordered]@{
        path = $path
        owner = $null
        identity = $null
        type = "AclReadError"
        rights = $_.Exception.Message
        inherited = $null
      }
    }
  }
  return @($entries)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path -LiteralPath (Join-Path $scriptDir "..")).Path
Set-Location -LiteralPath $root

$qualityDir = Join-Path $root ".codex-auto\quality"
$outPath = Join-Path $qualityDir "git-finalization-shell-diagnostics.json"
$gitDir = Join-Path $root ".git"
$indexLockPath = Join-Path $gitDir "index.lock"
$aclTargets = @(".git", ".git\index", ".git\objects")

$commands = [ordered]@{
  whoamiUser = Invoke-DiagnosticCommand "whoami /user" { whoami /user }
  whoamiGroups = Invoke-DiagnosticCommand "whoami /groups" { whoami /groups }
  indexLockExists = Invoke-DiagnosticCommand "Test-Path .git\index.lock" { Test-Path -LiteralPath ".git\index.lock" }
  getAcl = Invoke-DiagnosticCommand "Get-Acl .git, .git\index, .git\objects | Format-List Path, Owner, AccessToString" {
    Get-Acl -LiteralPath ".git", ".git\index", ".git\objects" -ErrorAction Stop |
      Format-List Path, Owner, AccessToString
  }
  icaclsGit = Invoke-DiagnosticCommand "icacls .git" { icacls .git }
  icaclsIndex = Invoke-DiagnosticCommand "icacls .git\index" { icacls .git\index }
  icaclsObjects = Invoke-DiagnosticCommand "icacls .git\objects" { icacls .git\objects }
  gitBranch = Invoke-DiagnosticCommand "git branch --show-current" { git branch --show-current }
  gitStatus = Invoke-DiagnosticCommand "git status --short --branch" { git status --short --branch }
  gitAddDryRun = Invoke-DiagnosticCommand "git add -A --dry-run" { git add -A --dry-run }
}

$icaclsDenyLines = @(
  $commands.icaclsGit.output,
  $commands.icaclsIndex.output,
  $commands.icaclsObjects.output
) |
  ForEach-Object { ($_ -split "`r?`n") } |
  Where-Object { $_ -match "\(DENY\)" } |
  ForEach-Object { $_.Trim() }
$aclEntries = Read-AclEntries -Paths $aclTargets
$denyAces = @($aclEntries | Where-Object { $_.type -eq "Deny" })
$denyEvidenceCount = [Math]::Max([int]$denyAces.Count, [int]$icaclsDenyLines.Count)
$repositoryPresent = Test-Path -LiteralPath $gitDir -PathType Container
$noExistingIndexLock = -not (Test-Path -LiteralPath $indexLockPath)
$gitAddDryRunOk = [bool]$commands.gitAddDryRun.ok
$readyForGitFinalization = $repositoryPresent -and $noExistingIndexLock -and $gitAddDryRunOk

$report = [ordered]@{
  version = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  localDate = Get-AelyrisLocalDate
  timeZone = "Asia/Tokyo"
  ok = $true
  status = if ($readyForGitFinalization) { "ready-for-commit-and-merge" } else { "blocked-by-git-metadata-permissions" }
  gitFinalizationReady = [bool]$readyForGitFinalization
  root = $root
  checks = [ordered]@{
    repositoryPresent = [bool]$repositoryPresent
    noExistingIndexLock = [bool]$noExistingIndexLock
    gitAddDryRunOk = [bool]$gitAddDryRunOk
    getAclReadable = [bool]$commands.getAcl.ok
    getAclDenyAceCount = [int]$denyAces.Count
    icaclsDenyLineCount = [int]$icaclsDenyLines.Count
    denyAceCount = [int]$denyEvidenceCount
  }
  aclTargets = $aclTargets
  aclEntries = $aclEntries
  denyAces = $denyAces
  icaclsDenyLines = $icaclsDenyLines
  commands = $commands
  runbook = [ordered]@{
    nodeReadiness = "pnpm verify:goal:git-finalization"
    shellDiagnostics = "pnpm verify:goal:git-finalization:shell"
    artifact = ".codex-auto/quality/git-finalization-shell-diagnostics.json"
    safety = "This script does not stage, commit, merge, push, mutate ACLs, delete lock files, or persist Git metadata changes; Git may attempt a transient index lock during dry-run."
    nextAction = "If git add -A --dry-run reports index.lock Permission denied, run finalization from a non-sandbox owner/admin shell or repair only the reviewed .git metadata Deny ACEs there."
  }
}

New-Item -ItemType Directory -Force -Path $qualityDir | Out-Null
$json = $report | ConvertTo-Json -Depth 12
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $json + [Environment]::NewLine, $utf8NoBom)
Write-Output $json
