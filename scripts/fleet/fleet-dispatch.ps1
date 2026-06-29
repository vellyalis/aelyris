#requires -Version 7
<#
.SYNOPSIS
  Fleet dispatcher for Aelyris worktree-based parallel development.

.DESCRIPTION
  Turns a fleet Work Unit id into a ready-to-run agent task:
  creates an isolated git worktree + branch, writes a self-contained brief
  into it, and prints the launch command. Also reports fleet status and
  drives the sequential-merge tail.

  This script ONLY orchestrates git worktrees and briefs. It never edits
  Aelyris source — the agent you launch does the implementation.

.EXAMPLE
  ./fleet-dispatch.ps1 list
  ./fleet-dispatch.ps1 dispatch 1.3 0.5 0.1 -DryRun
  ./fleet-dispatch.ps1 dispatch 1.3
  ./fleet-dispatch.ps1 status
  ./fleet-dispatch.ps1 collect 1.3
  ./fleet-dispatch.ps1 cleanup 1.3 -DeleteBranch
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('list', 'dispatch', 'status', 'collect', 'cleanup')]
  [string]$Command = 'list',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$WorkUnits,

  # Print the git/agent commands without executing destructive git ops.
  [switch]$DryRun,

  # On cleanup, also delete the WU branch (default: keep it).
  [switch]$DeleteBranch
)

$ErrorActionPreference = 'Stop'

# --- Setup -----------------------------------------------------------------
$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) { throw 'Not inside a git repository.' }
$repoRoot = $repoRoot.Trim()
$repoParent = Split-Path $repoRoot -Parent
$baseBranch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD).Trim()

$manifestPath = Join-Path $PSScriptRoot 'wu-manifest.json'
if (-not (Test-Path $manifestPath)) { throw "Manifest not found: $manifestPath" }
$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json

function Get-WorkUnit([string]$id) {
  $wu = $manifest.workUnits.$id
  if (-not $wu) { throw "Unknown Work Unit '$id'. Run 'fleet-dispatch.ps1 list'." }
  return $wu
}

function Get-WorktreePath([string]$id) {
  Join-Path $repoParent ("{0}{1}" -f $manifest.worktreePrefix, $id)
}

function Get-BranchName([string]$id, $wu) { "wu/$id-$($wu.slug)" }

# Compose the self-contained brief an agent reads from FLEET_BRIEF.md.
function New-Brief([string]$id, $wu) {
  $agent = if ($wu.suggestedAgent) { $wu.suggestedAgent } else { 'claude' }
  $files = ($wu.files -join ', ')
  $deps = if ($wu.deps.Count -gt 0) { $wu.deps -join ', ' } else { '(none)' }
  $notes = if ($wu.notes) { "`nWU-specific note: $($wu.notes)" } else { '' }
  @"
# Fleet brief — WU-${id}: $($wu.title)

Read the master plan first: $($manifest.handoff)
Then implement **Work Unit $id — $($wu.title)**.

- Spec section: $($wu.spec)
- Likely files: $files
- Depends on (must be merged first): $deps
- Suggested agent: $agent$notes

## Rules (binding)
- Honor the current spec contracts in docs/specs/README.md and the referenced phase/spec section.
- This worktree is isolated on branch '$(Get-BranchName $id $wu)' off '$baseBranch'. Stay in scope: touch only this WU's files.
- Do NOT commit FLEET_BRIEF.md (it is the brief, not source).
- Communicate via the orchestrator only (no peer-to-peer). Write progress to .fleet/status.md if asked.

## Before you finish, run the gates
- cd src-tauri; cargo test; cargo clippy --all-targets -- -D warnings; cargo fmt --check
- (repo root) pnpm test
Report the diff and which gates passed.
"@
}

function Invoke-Step([string]$desc, [scriptblock]$action) {
  if ($DryRun) {
    Write-Host "  [dry-run] $desc" -ForegroundColor DarkGray
  }
  else {
    & $action
  }
}

# --- Commands --------------------------------------------------------------
function Cmd-List {
  Write-Host "Work Units (from $($manifest.handoff)):`n" -ForegroundColor Cyan
  $manifest.workUnits.PSObject.Properties |
    Sort-Object { [version](($_.Name -replace '[^0-9.]', '') + '.0') } |
    ForEach-Object {
      $id = $_.Name; $wu = $_.Value
      $deps = if ($wu.deps.Count) { "deps: $($wu.deps -join ',')" } else { 'no deps' }
      '{0,-6} P{1,-3} {2,-42} {3} [{4}]' -f $id, $wu.phase, $wu.title, $deps, $wu.suggestedAgent
    }
  Write-Host "`nDispatch with:  ./fleet-dispatch.ps1 dispatch <id> [<id> ...] [-DryRun]" -ForegroundColor DarkGray
}

function Cmd-Dispatch {
  if (-not $WorkUnits) { throw 'Pass one or more Work Unit ids, e.g. dispatch 1.3 0.5 0.1' }
  foreach ($id in $WorkUnits) {
    $wu = Get-WorkUnit $id
    $path = Get-WorktreePath $id
    $branch = Get-BranchName $id $wu
    $agent = if ($wu.suggestedAgent) { $wu.suggestedAgent } else { 'claude' }

    Write-Host "`n=== WU-$id : $($wu.title) ===" -ForegroundColor Green
    if ($wu.deps.Count) { Write-Host "  ! ensure deps merged first: $($wu.deps -join ', ')" -ForegroundColor Yellow }
    if ($wu.notes -match 'LOCKSTEP') { Write-Host "  ! $($wu.notes)" -ForegroundColor Yellow }

    if ((Test-Path $path) -and -not $DryRun) {
      Write-Host "  worktree already exists: $path (skipping create)" -ForegroundColor DarkYellow
    }
    else {
      Invoke-Step "git -C $repoRoot worktree add -b $branch `"$path`" $baseBranch" {
        & git -C $repoRoot worktree add -b $branch $path $baseBranch
      }
    }

    Invoke-Step "write FLEET_BRIEF.md into the worktree" {
      New-Brief $id $wu | Set-Content -Path (Join-Path $path 'FLEET_BRIEF.md') -Encoding utf8
    }

    Write-Host "  launch:" -ForegroundColor Cyan
    Write-Host "    cd `"$path`"" -ForegroundColor White
    Write-Host "    $agent   # then: 'Read FLEET_BRIEF.md and implement it.'" -ForegroundColor White
  }
  if ($DryRun) { Write-Host "`n(dry-run: nothing was created)" -ForegroundColor DarkGray }
}

function Cmd-Status {
  Write-Host "Active worktrees:`n" -ForegroundColor Cyan
  & git -C $repoRoot worktree list
  Write-Host "`nWU branch divergence vs '$baseBranch' (ahead/behind):`n" -ForegroundColor Cyan
  & git -C $repoRoot for-each-ref --format='%(refname:short)' refs/heads/wu |
    ForEach-Object {
      $b = $_
      $counts = (& git -C $repoRoot rev-list --left-right --count "$baseBranch...$b" 2>$null)
      if ($counts) {
        $parts = $counts -split '\s+'
        '{0,-34} +{1} ahead / -{2} behind' -f $b, $parts[1], $parts[0]
      }
    }
}

function Cmd-Collect {
  if (-not $WorkUnits) { throw 'Pass the Work Unit id to collect, e.g. collect 1.3' }
  foreach ($id in $WorkUnits) {
    $wu = Get-WorkUnit $id
    $branch = Get-BranchName $id $wu
    Write-Host "`n=== Review WU-$id ($branch) ===" -ForegroundColor Green
    & git -C $repoRoot diff --stat "$baseBranch...$branch"
    Write-Host "`n  merge when green:" -ForegroundColor Cyan
    Write-Host "    git -C `"$repoRoot`" merge --no-ff $branch" -ForegroundColor White
    Write-Host "    ./fleet-dispatch.ps1 cleanup $id -DeleteBranch" -ForegroundColor White
  }
}

function Cmd-Cleanup {
  if (-not $WorkUnits) { throw 'Pass the Work Unit id to clean up, e.g. cleanup 1.3' }
  foreach ($id in $WorkUnits) {
    $wu = Get-WorkUnit $id
    $path = Get-WorktreePath $id
    $branch = Get-BranchName $id $wu
    Write-Host "`n=== Cleanup WU-$id ===" -ForegroundColor Green
    Invoke-Step "git -C $repoRoot worktree remove `"$path`" --force" {
      & git -C $repoRoot worktree remove $path --force
    }
    if ($DeleteBranch) {
      Invoke-Step "git -C $repoRoot branch -D $branch" {
        & git -C $repoRoot branch -D $branch
      }
    }
  }
}

switch ($Command) {
  'list' { Cmd-List }
  'dispatch' { Cmd-Dispatch }
  'status' { Cmd-Status }
  'collect' { Cmd-Collect }
  'cleanup' { Cmd-Cleanup }
}
