# Aelyris — OSC 133 shell integration for Zsh.
#
# Installation: source this file from ~/.zshrc, e.g.
#
#     source /path/to/aelyris.zsh
#
# What this does:
#   - preexec hook emits OSC 133;C (output-start) when the user's
#     command begins.
#   - precmd hook emits OSC 133;D;<exit> for the previous command, and
#     prepends OSC 133;A / appends OSC 133;B to $PROMPT so Aelyris can
#     identify the prompt region.
#
# Idempotent: re-sourcing will not double-wrap $PROMPT or double-register
# hooks.

if [[ -n "${AELYRIS_SHELL_INTEGRATION:-}" ]]; then return; fi
export AELYRIS_SHELL_INTEGRATION=1

autoload -Uz add-zsh-hook

__aelyris_command_running=0

__aelyris_pre_run() {
    if [[ "$__aelyris_command_running" == "0" ]]; then
        print -n $'\e]133;C\a'
        __aelyris_command_running=1
    fi
}

__aelyris_pre_prompt() {
    local exit_code=$?
    if [[ "$__aelyris_command_running" == "1" ]]; then
        print -n $'\e]133;D;'"$exit_code"$'\a'
        __aelyris_command_running=0
    fi
    print -n $'\e]133;A\a'
}

add-zsh-hook preexec __aelyris_pre_run
add-zsh-hook precmd __aelyris_pre_prompt

# %{ ... %} is zsh's non-printing escape group; without it, line length
# accounting breaks on wrapped prompts. Appended to whatever $PROMPT was at
# source time so theme-provided prompts (powerlevel10k, spaceship, …) keep
# rendering.
PROMPT="$PROMPT"$'%{\e]133;B\a%}'
