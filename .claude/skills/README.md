# Aelyris Claude Skills

These skills are repo-local workflow helpers for Aelyris. They are safe
to track when reviewed because they contain process guidance only; they are not
product capability proof.

Tracked skills must follow these rules:

- Aelyris-specific workflows only.
- No secrets, tokens, personal machine paths, or local account names.
- No generic external skill packs copied wholesale.
- No hooks, slash commands, personas, or hidden session injection.
- No file-rewrite automation that changes the review surface during a session.
- Release and world-class claims must defer to verifier commands and artifacts.

Runtime state such as `.claude/settings.local.json`, `.claude/launch.json`,
locks, worktrees, and local scheduling data is developer-local and ignored.