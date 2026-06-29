# Aether Terminal — OSC 133 shell integration for PowerShell 5.1+ / pwsh 7+.
#
# Installation (one-liner): dot-source this file from your $PROFILE, e.g.
#
#     . "${env:ProgramFiles}\Aether Terminal\shell-integration\aether.ps1"
#
# Or print `$PROFILE` to see where to add the line. After reloading the
# shell, Aether Terminal's "jump to prompt" / "copy last output" commands
# will work because PowerShell emits semantic prompt marks.
#
# What this does:
#   - Wraps the `prompt` function so each render emits:
#       OSC 133;D;<exit>  — marks the *previous* command's end + exit code
#       OSC 133;A         — marks where the new prompt begins
#       (original prompt text)
#       OSC 133;B         — marks where the user's command will be typed
#   - Installs a PSReadLine key handler on Enter to emit OSC 133;C right
#     before the command executes (so Aether can delimit command vs output).
#
# Re-sourcing is idempotent: the `QUORUM_SHELL_INTEGRATION` flag guards
# duplicate installation, which also keeps `__aether_original_prompt`
# from being captured twice and producing nested OSC sequences.

if ($env:QUORUM_SHELL_INTEGRATION -eq "1") { return }
$env:QUORUM_SHELL_INTEGRATION = "1"

$script:__aether_esc = [char]27
$script:__aether_bel = [char]7

$script:__aether_A = "$($script:__aether_esc)]133;A$($script:__aether_bel)"
$script:__aether_B = "$($script:__aether_esc)]133;B$($script:__aether_bel)"
$script:__aether_C = "$($script:__aether_esc)]133;C$($script:__aether_bel)"

function script:__aether_commandEnd([int]$exit) {
    "$($script:__aether_esc)]133;D;$exit$($script:__aether_bel)"
}

# Snapshot the *current* prompt function so theme-provided prompts (Oh-My-Posh,
# Starship, PSReadLine defaults) keep working — we only decorate, never replace.
$script:__aether_original_prompt = (Get-Item function:prompt).ScriptBlock

function global:prompt {
    # $? is $true iff the previous statement succeeded. If a command set
    # $LASTEXITCODE explicitly, prefer that number; otherwise map success
    # to 0 and failure to a non-zero sentinel so Aether can color-code it.
    $success = $?
    $lastExit = if ($success) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }
    $cmdEnd = script:__aether_commandEnd $lastExit

    # Pre-prompt: D then A. Post-prompt: B. The original prompt text sits
    # between A and B so "prompt region" is well-defined.
    $body = & $script:__aether_original_prompt
    "$cmdEnd$($script:__aether_A)$body$($script:__aether_B)"
}

# Emit OSC 133;C (output-start) when the user presses Enter — this lets
# Aether delimit "everything before here was the prompt / command input" from
# "everything after is command output". Wrap PSReadLine's AcceptLine; fall
# back silently if PSReadLine isn't loaded.
try {
    if (Get-Module -ListAvailable -Name PSReadLine) {
        Import-Module PSReadLine -ErrorAction SilentlyContinue
        Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
            [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
            [Console]::Write($script:__aether_C)
        }
    }
} catch {
    # Non-fatal — A / B / D still give Aether enough structure to navigate.
}
