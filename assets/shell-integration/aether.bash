# Aether Terminal — OSC 133 shell integration for Bash 4+.
#
# Installation: source this file from ~/.bashrc, e.g.
#
#     source /path/to/aether.bash
#
# On Windows + Git Bash, typical path:
#
#     source "/c/Program Files/Aether Terminal/shell-integration/aether.bash"
#
# What this does:
#   - On each command start (DEBUG trap), emit OSC 133;C to mark the
#     output-start boundary.
#   - Before each prompt (PROMPT_COMMAND), emit OSC 133;D;<exit> for the
#     previous command, and wrap PS1 with OSC 133;A + OSC 133;B so Aether
#     can identify the prompt region.
#
# The integration is idempotent: re-sourcing will not double-wrap PS1 or
# double-register the DEBUG trap.

if [[ -n "${AETHER_SHELL_INTEGRATION:-}" ]]; then return; fi
export AETHER_SHELL_INTEGRATION=1

# Tracks whether the DEBUG trap has already fired for the current command,
# so a command that internally calls other functions still only emits a
# single OSC 133;C at the top of the pipeline.
__aether_command_running=0

__aether_pre_run() {
    # Skip during PROMPT_COMMAND execution — otherwise the DEBUG trap
    # would fire while we're emitting our own escape sequences.
    if [[ "$BASH_COMMAND" == "$PROMPT_COMMAND" ]]; then return; fi
    if [[ "$__aether_command_running" == "0" ]]; then
        printf '\033]133;C\007'
        __aether_command_running=1
    fi
}
trap '__aether_pre_run' DEBUG

# Capture PS1 once so re-sourcing doesn't nest OSC sequences.
__aether_original_ps1="$PS1"

__aether_pre_prompt() {
    local exit_code=$?
    if [[ "$__aether_command_running" == "1" ]]; then
        printf '\033]133;D;%d\007' "$exit_code"
        __aether_command_running=0
    fi
    # \[ ... \] tells Bash the enclosed bytes are non-printing so the
    # terminal's line-length accounting stays correct when wrapping.
    PS1=$'\001\033]133;A\007\002'"$__aether_original_ps1"$'\001\033]133;B\007\002'
}

# Prepend our precmd to PROMPT_COMMAND without clobbering the user's.
if [[ -z "${PROMPT_COMMAND:-}" ]]; then
    PROMPT_COMMAND='__aether_pre_prompt'
else
    PROMPT_COMMAND='__aether_pre_prompt; '"$PROMPT_COMMAND"
fi
