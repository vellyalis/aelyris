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
   - First target: Phase 0 baseline, then Phase 1 CX-4 stale approval safety.
   - This closes the approval TOCTOU hole before broader hardening.
   - One phase = one commit. Stage explicit paths only.

2. `hardening-instructions.md`
   - Starts only after refactor is complete or its report is filed.
   - API/core priority lives here: H1 verifier integrity, H2 `session_*` MCP
     face, H8 MCP schema enforcement and queue bounds.

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
/goal C:\Users\owner\Aether_Terminal で AGENTS.md -> docs/requirements.md -> docs/AGENT_WORKFLOWS.md -> docs/specs/README.md -> refactor-instructions.md -> hardening-instructions.md -> renderer-instructions.md -> docs/specs/WU_RT_1_CONTINUATION.md を順に読み、active work order の優先順に従って refactor-instructions.md Phase 0 から開始して。Phase 0 baseline を記録し、Phase 1 CX-4 stale approval safety までを最初の実装対象にする。1フェーズ=1コミット、明示 stage、gate 緑、main/PR/force push 禁止。renderer は既に進んでいるので、今は refactor -> hardening を優先。
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

Then execute `refactor-instructions.md` Phase 0 exactly:

```powershell
git status --short
git log --oneline -3
pnpm exec tsc --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Do not start by rerunning `pnpm verify:goal:safe`; it is broader than the next
work order and can obscure the Phase 0 regression baseline.
