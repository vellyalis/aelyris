# Aelyris Next Session Continuation

Updated: 2026-07-03 JST

Purpose: keep the next cleared Codex/Claude/Gemini session pointed at the
current active work orders instead of the older RT-1-only handoff.

## Current Branch

- Repo: `C:\Users\owner\Aether_Terminal`
- Branch: `feat/wu-rt-1-context-lifecycle`
- Baseline pushed commit before this continuation refresh:
  `71af0b0 docs: track active work orders`
- Push status at update time: synced with `origin/feat/wu-rt-1-context-lifecycle`
- Worktree at update time: clean except this continuation refresh while it is
  being committed.

Do not push to `main`, do not force-push, and do not open or merge a PR from an
agent session. Owner controls merge timing.

## Mandatory Read Order After Session Clear

1. `AGENTS.md`
2. `docs/requirements.md`
3. `docs/AGENT_WORKFLOWS.md`
4. `docs/specs/README.md`
5. `refactor-instructions.md`
6. `hardening-instructions.md`
7. `renderer-instructions.md`
8. This file

The root active work orders are now tracked and must be read explicitly every
time until they are completed or retired.

## Active Work Order Priority

1. `refactor-instructions.md`
   - Status: complete on this branch; re-check current machine truth only.
   - Do not restart refactor phases unless a verifier shows a regression.

2. `hardening-instructions.md`
   - Current target: hardening completion audit from H1 through H8.
   - API/core priority lives here: H1 verifier integrity, H2 `session_*` MCP
     face, H8 MCP schema enforcement and queue bounds.
   - RT-1e resume/reset_context evidence is guarded by
     `scripts/verify-session-resume-idempotent.mjs`; rerun with
     `pnpm verify:runtime-core:session-resume`.

3. `renderer-instructions.md`
   - Intended to run after refactor and hardening.
   - R0-R6 renderer work already exists on this branch. Treat renderer as
     follow-up correction/reporting unless the owner explicitly reopens it.

Do not run these work orders concurrently. They can touch shared files such as
`package.json`, `scripts/`, and terminal feature code.

## Current Machine Truth

This continuation doc is not a release-readiness claim. Fresh verifier artifacts
must be regenerated before claiming quality, readiness, or score.

Last confirmed in this handoff:

- `git status -sb` after push: branch synced to origin before this doc refresh.
- Baseline pushed commit before this doc refresh:
  `71af0b0 docs: track active work orders`.
- Refactor work order phases are complete on this branch; next cleared-session
  target is hardening completion audit.
- RT-1e resume/reset_context gate:
  `scripts/verify-session-resume-idempotent.mjs` / `.codex-auto/quality/session-resume-idempotent.json`.
- Renderer R0-R6 work exists in recent branch history:
  - `347636c test: add renderer parity and perf harness`
  - `984554c feat: add terminal glyph atlas`
  - `b92666d feat: add webgl terminal paint path`
  - `e57c43e feat: wire webgl terminal renderer flag`
  - `759045e test: add renderer transparency and soak gates`
  - `c2edb07 chore: record renderer perf default proposal`
  - `754b426 fix(review): close renderer + approval HIGH findings from whole-branch review`
- Active work orders were tracked in `71af0b0`.

Known caution: older generated `.codex-auto/quality/*` artifacts may be stale.
Use them as local evidence only after rerunning the owning verifier.

## Next Session Goal

Pasteable goal for the cleared session:

```text
/goal C:\Users\owner\Aether_Terminal で AGENTS.md -> docs/requirements.md -> docs/AGENT_WORKFLOWS.md -> docs/specs/README.md -> refactor-instructions.md -> hardening-instructions.md -> renderer-instructions.md -> docs/specs/WU_RT_1_CONTINUATION.md を順に読み、refactor は完了済みとして current machine truth だけ再確認。その後 hardening-instructions.md の H1 から H8 までを existing commits / current source / gates / artifacts で completion audit し、未完・弱証拠・赤 gate があれば one phase = one commit で順に埋める。明示 stage、gate 緑、main/PR/force push 禁止。
```

Suggested first commands:

```powershell
git status --short --branch
git log --oneline -8
Get-Content -Raw AGENTS.md
Get-Content -Raw docs\requirements.md
Get-Content -Raw docs\AGENT_WORKFLOWS.md
Get-Content -Raw docs\specs\README.md
Get-Content -Raw refactor-instructions.md
Get-Content -Raw hardening-instructions.md
Get-Content -Raw renderer-instructions.md
Get-Content -Raw docs\specs\WU_RT_1_CONTINUATION.md
```

Then start hardening completion audit with the already-landed refactor work
treated as baseline evidence:

```powershell
git status --short
git log --oneline -3
pnpm exec tsc --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Do not start by rerunning `pnpm verify:goal:safe`; it is broader than the next
work order and can obscure the Phase 0 regression baseline.
