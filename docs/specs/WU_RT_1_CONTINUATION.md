# Aelyris Next Session Continuation

Updated: 2026-07-10 JST

Purpose: keep the next cleared Codex/Claude/Gemini session pointed at current
machine truth after the refactor and hardening closeout work, without reviving
older RT-1-only task lists.

## Current Branch

- Repo: `C:\Users\owner\Aether_Terminal`
- Branch: `main`
- Latest pushed commits at this refresh:
  - `94b416b docs: refresh ja README and GitHub introduction to current positioning`
  - `c165e6a docs: add final-goal score-path triage ledger; refresh machine-truth numbers`
  - `7f6f4ae docs: assign deepening to owner-side session; executors stop on design mismatch`
- Push status: `main` has been pushed to `origin/main` through `94b416b`.
  Recheck with `git status --short --branch` before any next action.
- Known dirty files at this refresh: none. If the next session starts dirty,
  classify that diff before unrelated work and do not overwrite it.

Do not push to `main`, do not force-push, and do not open or merge a PR from an
agent session. Owner controls merge timing.

## Mandatory Read Order After Session Clear

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/requirements.md`
4. `docs/AGENT_WORKFLOWS.md`
5. `docs/specs/README.md`
6. This file

### Fable / World-Class Continuation Override

If the next request mentions `Fable`, `world-class`, `Fable返答後`, or
`P1 command evidence`, this file is not the primary entrypoint. Use the
local-only Fable continuation instead:

1. `.claude/agent-memory-local/CLAUDE_MUST_READ_FABLE_REVIEW_WORLD_CLASS_BLOCKERS_LOCAL_ONLY.md`
2. `.claude/agent-memory-local/CLAUDE_MUST_READ_NEXT_SESSION_FABLE_WORLD_CLASS_IMPLEMENTATION_LOCAL_ONLY.md`
3. `docs/specs/README.md`
4. The current generated artifacts and verifier commands listed in that
   local-only handoff.

Those local-only files are intentionally ignored and must not be committed or
moved into tracked docs. Their current default next Work Unit is P1 Command
Evidence Durability: command identity, scrollback anchors, split-pane evidence,
and reconnect/recovery evidence. Do not redirect that continuation to UI
density or generic release documentation unless the local handoff is missing.

Read the root work-order files only when the selected next action needs their
details. `refactor-instructions.md` and `hardening-instructions.md` are no
longer the next implementation target unless a current verifier shows a
repo-owned regression.

## Work Order State

1. `refactor-instructions.md`
   - Status: complete on this branch; re-check current machine truth only.
   - Do not restart refactor phases unless a verifier shows a regression.

2. `hardening-instructions.md`
   - Status: H1-H8 repo-owned completion audit is superseded by the current
     final-goal audit truth.
   - Current proof shape: the final-goal audit is blocked with
     `implementationFixableCount=196`, `policyBlockedCount=12`, and
     `externalBlockedCount=15`; do not reuse older external-only closeout text.
   - Remaining blockers must be read from the current final-goal audit before selecting the next workstream.
   - Do not restart H1-H8 unless a verifier regresses from the current contract.

3. `renderer-instructions.md`
   - Status: follow-up work order, not a hidden prerequisite for claiming the
     hardening closeout.
   - R0-R6 renderer work already exists on this branch. Treat renderer as the
     next selectable implementation work only if the owner explicitly chooses it.

Do not run work orders concurrently. They can touch shared files such as
`package.json`, `scripts/`, and terminal feature code.

## Current Machine Truth

This continuation doc is not itself release-readiness proof. Fresh verifier
artifacts must be regenerated before claiming quality, readiness, or score.

Last confirmed machine truth for the hardening closeout:

- `pnpm verify:quality-score` -> `19/100` (`62/327`), grade `D`,
  `releaseCandidateReady=false`; final-goal audit is downstream and does not
  feed points back into the score.
- `pnpm verify:final-goal-audit` -> `blocked`,
  `implementationFixableCount=196`, `policyBlockedCount=12`,
  `externalBlockedCount=15`.
- Safe proof registry target -> `28/28`; `authenticated-ai-cli-prompt-smoke`
  requires `authenticated-ai-cli-consent-packet` and
  `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.
- `pnpm verify:goal:finalize` excludes git finalization by default;
  `AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` is optional, and git is not required for
  product/safe/finalize evidence.
- `pnpm verify:goal:safe` -> `blocked`; failed steps include authenticated
  preflight/consent packet, anti-stall, final-goal audit, documentation
  freshness before this refresh, real OS sleep/operator handoff, completion
  matrix, external-gate readiness, and operator finish.
- `pnpm verify:goal:closeout` -> rerun after the docs/safe refresh before using
  it as a handoff claim.
- `pnpm verify:goal:docs` -> `pass-current-goal-docs-contract`.
- `pnpm verify:goal:finalize` excludes git finalization by default; optional
  git finalization requires `AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` and is not
  required for product/safe/finalize evidence.
- RT-1e resume/reset_context remains owned by
  `scripts/verify-session-resume-idempotent.mjs` and package script
  `pnpm verify:runtime-core:session-resume`; keep this verifier green when
  editing continuation docs because it checks that the resume/reset scope is
  still discoverable.

The remaining release blockers must be read from current artifacts before release claims. Current external/operator/upstream gates include:

- real Windows sleep/resume proof.
- upstream dependency movement for supply-chain findings.
- release readiness aggregate proof for tmux/shared-workspace/native-terminal
  claims.
- WebView2/CDP host proof.
- `authenticated-ai-cli-prompt-smoke` / `authenticated-ai-cli-consent-packet`
  are current; refreshes still require documented provider env such as
  `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.

Known caution: older generated `.codex-auto/quality/*` artifacts may be stale.
Use them as local evidence only after rerunning the owning verifier.

## Next Session Goal

Pasteable goal for the cleared session:

```text
/goal C:\Users\owner\Aether_Terminal で git status --short --branch を確認し、AGENTS.md -> docs/README.md -> docs/requirements.md -> docs/AGENT_WORKFLOWS.md -> docs/specs/README.md -> docs/specs/WU_RT_1_CONTINUATION.md を順に読み、current machine truth を確認する。refactor と hardening H1-H8 は repo-owned completion audit 済みとして再実装しない。git status が dirty なら差分を先に分類する。その後は renderer follow-up または外部/operator gate handoff のどちらか1つだけを選ぶ。明示 stage、one phase = one commit、追加 push/PR/force push 禁止。
```

Suggested first commands:

```powershell
git status --short --branch
git log --oneline -8
Get-Content -Raw AGENTS.md
Get-Content -Raw docs\README.md
Get-Content -Raw docs\requirements.md
Get-Content -Raw docs\AGENT_WORKFLOWS.md
Get-Content -Raw docs\specs\README.md
Get-Content -Raw docs\specs\WU_RT_1_CONTINUATION.md
pnpm verify:goal:docs
pnpm verify:goal:closeout
```

If the session is the Fable/world-class continuation, use this command block
instead:

```powershell
git status --short --branch
Get-Content -Raw .claude\agent-memory-local\CLAUDE_MUST_READ_FABLE_REVIEW_WORLD_CLASS_BLOCKERS_LOCAL_ONLY.md
Get-Content -Raw .claude\agent-memory-local\CLAUDE_MUST_READ_NEXT_SESSION_FABLE_WORLD_CLASS_IMPLEMENTATION_LOCAL_ONLY.md
pnpm verify:terminal:font-render
pnpm verify:terminal:command-evidence
pnpm verify:terminal:multipane-command-evidence
pnpm verify:terminal:recovered-command-evidence
pnpm verify:terminal:process-reconnect-command-evidence
```

Do not begin by reopening old RT-1 or hardening phase tables. If a current gate
turns red, fix that concrete current failure as the next phase.
