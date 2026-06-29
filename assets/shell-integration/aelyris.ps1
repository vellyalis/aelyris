# Aelyris — OSC 133 shell integration for PowerShell 5.1+ / pwsh 7+.
#
# Installation (one-liner): dot-source this file from your $PROFILE, e.g.
#
#     . "${env:ProgramFiles}\Aelyris\shell-integration\aelyris.ps1"
#
# Or print `$PROFILE` to see where to add the line. After reloading the
# shell, Aelyris's "jump to prompt" / "copy last output" commands
# will work because PowerShell emits semantic prompt marks.
#
# What this does:
#   - Wraps the `prompt` function so each render emits:
#       OSC 133;D;<exit>  — marks the *previous* command's end + exit code
#       OSC 133;A         — marks where the new prompt begins
#       (original prompt text)
#       OSC 133;B         — marks where the user's command will be typed
#   - Installs a PSReadLine key handler on Enter to emit OSC 133;C right
#     before the command executes (so Aelyris can delimit command vs output).
#
# Re-sourcing is idempotent: the `AELYRIS_SHELL_INTEGRATION` flag guards
# duplicate installation, which also keeps `__aelyris_original_prompt`
# from being captured twice and producing nested OSC sequences.

if ($env:AELYRIS_SHELL_INTEGRATION -eq "1") { return }
$env:AELYRIS_SHELL_INTEGRATION = "1"

$script:__aelyris_esc = [char]27
$script:__aelyris_bel = [char]7

$script:__aelyris_A = "$($script:__aelyris_esc)]133;A$($script:__aelyris_bel)"
$script:__aelyris_B = "$($script:__aelyris_esc)]133;B$($script:__aelyris_bel)"
$script:__aelyris_C = "$($script:__aelyris_esc)]133;C$($script:__aelyris_bel)"

function script:__aelyris_commandEnd([int]$exit) {
    "$($script:__aelyris_esc)]133;D;$exit$($script:__aelyris_bel)"
}

# Snapshot the *current* prompt function so theme-provided prompts (Oh-My-Posh,
# Starship, PSReadLine defaults) keep working — we only decorate, never replace.
$script:__aelyris_original_prompt = (Get-Item function:prompt).ScriptBlock

function global:prompt {
    # $? is $true iff the previous statement succeeded. If a command set
    # $LASTEXITCODE explicitly, prefer that number; otherwise map success
    # to 0 and failure to a non-zero sentinel so Aelyris can color-code it.
    $success = $?
    $lastExit = if ($success) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }
    $cmdEnd = script:__aelyris_commandEnd $lastExit

    # Pre-prompt: D then A. Post-prompt: B. The original prompt text sits
    # between A and B so "prompt region" is well-defined.
    $body = & $script:__aelyris_original_prompt
    "$cmdEnd$($script:__aelyris_A)$body$($script:__aelyris_B)"
}

# Emit OSC 133;C (output-start) when the user presses Enter — this lets
# Aelyris delimit "everything before here was the prompt / command input" from
# "everything after is command output". Wrap PSReadLine's AcceptLine; fall
# back silently if PSReadLine isn't loaded.
try {
    if (Get-Module -ListAvailable -Name PSReadLine) {
        Import-Module PSReadLine -ErrorAction SilentlyContinue
        Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
            [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
            [Console]::Write($script:__aelyris_C)
        }
    }
} catch {
    # Non-fatal — A / B / D still give Aelyris enough structure to navigate.
}
