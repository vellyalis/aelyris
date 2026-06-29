# Shell integration for Aelyris

These scripts teach your shell to emit the **OSC 133** escape sequences that
Aelyris parses to:

- jump between prompts (previous / next command)
- copy the output of just the last command
- color-code failed commands using the exit code

Without them, the terminal still works — it simply has no way to know where
one command ends and the next begins, so "jump to previous prompt" has
nothing to aim at.

## What OSC 133 is

A four-point convention for shells to tell the terminal about the
command-input lifecycle:

| Mark | Meaning |
|------|---------|
| `ESC ] 133 ; A BEL` | prompt is about to render on the current line |
| `ESC ] 133 ; B BEL` | prompt rendered; cursor is at the command-input point |
| `ESC ] 133 ; C BEL` | command executed; subsequent output is the result |
| `ESC ] 133 ; D [; <exit>] BEL` | command finished; optional exit code |

It works on any VT-compatible terminal that parses it. The scripts here
are minimal wrappers around the standard `precmd` / `preexec` / prompt
hooks each shell provides; they keep your existing theme intact.

## PowerShell (`aelyris.ps1`)

Dot-source from `$PROFILE`:

```powershell
. "C:\Program Files\Aelyris\shell-integration\aelyris.ps1"
```

Works with PowerShell 5.1 and PowerShell 7+. Plays nicely with Oh-My-Posh,
Starship, and the default PSReadLine prompt — we wrap the `prompt`
function and add a PSReadLine `Enter` handler without replacing either.

## Bash (`aelyris.bash`)

```bash
source /path/to/aelyris.bash
```

Requires Bash 4+ (for `PROMPT_COMMAND` support). Safe on Git Bash / WSL /
macOS / Linux. Works with Starship / oh-my-bash prompts.

## Zsh (`aelyris.zsh`)

```zsh
source /path/to/aelyris.zsh
```

Works with powerlevel10k, spaceship, pure, and stock zsh themes. Uses the
standard `add-zsh-hook` machinery so other integrations (nvm, direnv, …)
continue to work.

## Verifying it works

After sourcing the script and reloading the shell, run:

```
echo hello
false
echo $?
```

In Aelyris, the "last command" indicator should turn red after
`false` (exit 1) and recover after `echo $?`. If you see no change, the
OSC 133 emission is not reaching the terminal — the most common cause is
that another program in your prompt chain (for example a terminal multiplexer
or session wrapper) is swallowing the sequences before they reach Aelyris.

## Why the scripts are so small

The whole integration for each shell is under 40 lines. OSC 133 is a
tiny, well-specified surface; there's nothing to hand-roll beyond
writing the four marks at the right points in the prompt lifecycle.
Anything more is shell-specific plumbing (non-printing brackets so line
wrap accounting stays correct, exit-code capture, hook ordering) — which
is exactly what these scripts encapsulate.
