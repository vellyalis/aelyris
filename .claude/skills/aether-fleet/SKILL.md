---
name: aether-fleet
description: Orchestrate worktree-isolated parallel implementation of Aether cockpit Work Units (from docs/specs/CODEX_HANDOFF.md). Dispatch coding agents into isolated git worktrees via scripts/fleet/fleet-dispatch.ps1, coordinate them with a star topology (orchestrator-mediated, no peer-to-peer), and merge sequentially behind the gates. Use when the user wants to run multiple coding agents in parallel on Aether, says "fleet"/"並列実装"/"dispatch"/"worktree で並列", or references a Work Unit (WU) id.
---

# Aether fleet orchestration

You are the **orchestrator**. You decompose, dispatch, observe, and integrate. The
worker agents (Claude/Codex CLIs, each in its own git worktree) do the implementation.
Keep planning, integration, and final judgment in yourself — never delegate those.

## Preconditions (check first)
- The plan is `docs/specs/CODEX_HANDOFF.md`; the WU metadata is `scripts/fleet/wu-manifest.json`.
- **Some WUs may already be in progress directly in the main working tree** (a parallel
  Codex session / autonomous loop). Run `git status --short -- src src-tauri` and check
  `wu-manifest.json` files: **never dispatch a WU whose target files are already being
  edited in main** — you would double-implement and collide. Dispatch only untouched WUs.
- Aether is **local-only**: never push or open PRs.

## The loop
```
①pick dispatchable WUs → ②worktree per WU → ③launch one agent each → ④observe/steer → ⑤sequential merge
```

### ① Pick dispatchable WUs
- `pwsh scripts/fleet/fleet-dispatch.ps1 list` — shows id, phase, deps, suggested agent.
- A WU is dispatchable only if: its `deps` are already merged AND its files aren't being
  edited in main (see Preconditions). Contract WUs first (0.1 → 0.2 → 0.3, 0.4).
- **Cap concurrency at 3–4.** More worktrees = more merge/review than you can integrate.
- Only fan out WUs whose `files` don't overlap (check the manifest).

### ② + ③ Dispatch
```powershell
pwsh scripts/fleet/fleet-dispatch.ps1 dispatch <id> <id> ... -DryRun   # verify the plan
pwsh scripts/fleet/fleet-dispatch.ps1 dispatch <id> <id> ...           # create worktrees + briefs
```
Then launch one agent per worktree (separate terminals/panes), routing by `suggestedAgent`
and the model policy (Opus = design/UI/architecture, Codex = backend impl; Codex is
usage-limited until 2026-07-01, so route backend to Opus until then). Each agent runs:
`Read FLEET_BRIEF.md and implement it.`

### ④ Observe + steer — star topology, NOT mesh
Workers never talk to each other. **You are the only bus.**
- **Observe (agent → you):** `pwsh scripts/fleet/fleet-dispatch.ps1 status` (ahead/behind),
  per-worktree `git diff`, and any `.fleet/status.md` the agent writes.
- **Steer (you → agent):** inject guidance with Aether's `send_keys_by_target`
  (`@role` / `role:` / pty-id), or the MCP `aether.send_steer` tool, or `tmux send-keys`.
  Relay cross-agent context yourself; do not let workers coordinate directly.

### ⑤ Sequential merge + gates
For each finished WU, review then merge — one at a time, rebasing later WUs on the new main.
```powershell
pwsh scripts/fleet/fleet-dispatch.ps1 collect <id>      # diffstat + merge hint
# run the gates inside the worktree before merging:
#   (src-tauri) cargo test ; cargo clippy --all-targets -- -D warnings ; cargo fmt --check
#   (root)      pnpm test
git merge --no-ff wu/<id>-<slug>
pwsh scripts/fleet/fleet-dispatch.ps1 cleanup <id> -DeleteBranch
```

## Do-not-break (from CODEX_HANDOFF §6)
- **WU-1.1 lockstep:** `scripts/verify-agent-team-orchestration-readiness.mjs:218` asserts
  the exact Orchestra dispatch string. If a WU changes that dispatch call, update the gate
  string in the SAME commit.
- **UI WUs:** keep the single-blur rule; change only alpha/size/token (UI_TOKEN_DIAL_SPEC).
- **Gate model:** `approval` and `merge-to-main` are GATED — never let an agent (or an MCP
  tool) self-grant; the watchdog engine + human inbox grant.
- Files <800 lines, immutable updates, explicit error handling, no `console.log`.

## References
- Plan: `docs/specs/CODEX_HANDOFF.md` · index `docs/specs/README.md`
- Tool: `scripts/fleet/fleet-dispatch.ps1` (+ `.sh`) · `scripts/fleet/README.md`
- Generic orchestration: `subagent-orchestration` (same-model fan-out), `dmux-workflows`
  (tmux grid mixing Claude + Codex).
