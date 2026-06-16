---
name: aether-orchestrate
description: Drive Aether's autonomous build runtime over its MCP capability surface (the aether.* verbs). You are the orchestrator brain; Aether is the hands. Decompose a goal into a Task Graph, set the shared ADR, dispatch real heterogeneous agents (Claude/Codex/Gemini) into isolated worktrees, coordinate them in real time over the shared Event/Intent/Ownership/Activity stream + Knowledge Graph, and review→merge to quiescence — all by calling MCP verbs. Use when the user says "作って"/"build X"/"並列で実装"/"orchestrate"/"autonomous loop", or wants the fleet to self-coordinate. Distinct from aether-fleet (the older PowerShell/send_keys model); this skill drives the in-process MCP runtime.
---

# Aether orchestration (MCP runtime)

You are the **orchestrator (the brain)**. Aether is the **capability layer (the hands)**.
You do not edit files yourself; you drive the runtime by calling `aether.*` MCP verbs,
and the worker agents (real `claude`/`codex`/`gemini` CLIs in isolated worktrees) do the
implementation. Keep decomposition, coordination, review judgment, and integration in
yourself. Aether is local-only — never push or open PRs.

## How to call verbs

The runtime is a local HTTP server. Every verb is one call:
```
POST http://127.0.0.1:9333/mcp/tools/call
  Authorization: Bearer <token>
  { "name": "aether.<verb>", "arguments": { ... } }
→ { "ok": true, "result": { ... } }
```
- **Token:** `$env:AETHER_API_TOKEN`, or grep the dev log for `ephemeral token: <uuid>`
  (printed at startup when the env var is unset). Port is `9333`.
- **Catalog:** `GET /mcp/tools/list` returns every verb with its JSON schema — read it to
  confirm arguments. There are ~54 `aether.*` verbs.
- Call them with the Bash tool (`curl`) or a tiny `node`/`fetch` snippet. See
  `scripts/verify-*-live.mjs` for working examples of every group.
- If calls hang/ECONNREFUSED after a long session, the dev app's WebView2 layer has
  heap-corrupted: kill stale `msedgewebview2` procs, confirm ports 1420/9222/9333 free,
  relaunch `pnpm tauri:dev` — then continue.

## The shared map (read these; don't screen-scrape)

| Concern | Verbs | What it gives you |
|---|---|---|
| **Decisions / ADR** | `context.set/get/all/remove` | The world-model every agent aligns to (auth_method=jwt, …). **Injected into every dispatched agent's prompt.** `set` broadcasts `decision_changed`. |
| **Work** | `task.create/list/transition`, `orchestrator.plan` | Who does what, deps, branches, file lanes; the next dispatchable set. |
| **Structure** | `knowledge.add_node/add_edge/impact/dependents/dependencies/graph` | Code dependency graph; `impact(X)` = the transitive blast radius if X changes. |
| **Lanes** | `ownership.assign/conflicts/owner_of/claims` | Path claims so parallel agents never collide. `conflicts` before dispatch. |
| **Plans (pre-fact)** | `intent.propose/list/resolve` | Proposals shared BEFORE acting, with `targets` (impact). Peers react/converge. |
| **Real-time** | `event.recent/by_channel`, `agent.activity`, `agent.report_activity/report_blocker` | Who is editing what file/function right now; who is stuck. |
| **Runtime** | `worktree.create/list/remove`, `spawn_agent/stop_agent`, `fleet_status` | Isolation + the live agent fleet. |
| **Review** | `orchestrator.step`, `review.approve/reject`, `request_merge` | Gate → real git merge. |

## The loop

```
goal → ① ADR → ② decompose+assign → ③ worktrees → ④ step-loop (spawn→sense→review→merge) → ⑤ coordinate → done
```

**① Set the ADR.** Record the key decisions so every agent starts aligned:
`context.set{key:"auth_method",value:"jwt"}`, `database=postgresql`, `framework=nextjs`.

**② Decompose + assign.** One `task.create` per subtask:
`{id, title, owner:"<model>", priority, dependencies:[…], sourceBranch:"agent/<x>",
targetBranch:"main", outputs:["src/auth/**", …]}`.
- `owner` IS the model the agent runs as: `claude`/`sonnet`/`opus` (design, review,
  glue), `codex` (backend impl), `gemini` (UI/alt). Heterogeneous on purpose.
- `outputs` are the file lanes — claimed on dispatch (a `file_locked` event fires).
  Before assigning overlapping lanes, check `ownership.conflicts`. Keep lanes disjoint.
- `dependencies` gate ready-ness (an API task waits for the auth task it depends on).

**③ Worktrees.** `worktree.create{repoPath, branchName:"agent/<x>"}` for each task branch.

**④ Drive the loop.** Call `orchestrator.step` repeatedly — it is one tick of the whole
machine:
```
orchestrator.step{ repoPath, reviewerId:"<you, != task owner>", activeAgents:<#running>,
                   gates:{ "<taskId>": {tests_pass, lint_pass, types_pass,
                                        design_consistent, context_aligned} } }
```
Each call: finished agents (process exit) move Running→Review; a task in review with an
all-green verdict and reviewer≠owner is **merged for real** (git FF/3-way) into its target;
ready tasks are **dispatched by spawning real agents** (with the ADR injected). Agents run
*between* your calls — pace them; poll `fleet_status`/`agent.activity` to see progress, then
step again. Repeat until `report.state == "complete"`.

**⑤ Coordinate between steps (this is the point).** Read the shared stream, don't guess:
- `agent.activity` → who is editing which file/function now. `event.recent` → the feed.
- A decision changed mid-flight? `context.set` it → it re-broadcasts AND is re-injected
  into the next dispatched agents. (Fixes "Claude chose JWT, Gemini didn't know.")
- About to change something risky? `knowledge.impact{id}` → the symbols (and their owners)
  affected → notify/avoid. `intent.propose` it first so peers can object/defer.
- `blocker_raised` on the stream → unblock the agent (supply a decision, or another task's
  output). `ownership.conflicts` → re-assign lanes before two agents collide.

**Review judgment is yours.** You are the `reviewerId`; you supply each task's `gates`
(your read of its branch — use `agent_diff`/`worktree` to inspect). Green + reviewer≠owner
is the only path to a real merge. Never self-review (reviewer==owner is blocked).

## Conventions + guardrails
- **Concurrency cap 4** (the cost gate). The plan won't dispatch past it; pass an accurate
  `activeAgents`.
- **ADR keys:** stable snake_case (`auth_method`, `database`, `framework`, `api_style`).
- **`review.approve` / `request_merge` are reviewer-authority / gated** — the AI reviewer
  (you, with green gates) is the gate; there is no human in the critical path under full
  auto, but the gates must genuinely be green. Don't fabricate a green verdict.
- **Local-only:** never push/PR. Files <800 lines, immutable updates, explicit errors.

## Worked example — "ECサイト作って"
```
context.set auth_method=jwt ; database=postgresql ; framework=nextjs
task.create 認証   owner=claude  branch=agent/auth     outputs=[src/auth/**]
task.create 商品   owner=gemini  branch=agent/catalog  outputs=[src/catalog/**]
task.create 決済   owner=codex   branch=agent/payment  deps=[認証]  outputs=[src/payment/**]
task.create UI     owner=claude  branch=agent/ui       deps=[商品,決済] outputs=[src/ui/**]
worktree.create each branch
loop: orchestrator.step{…, gates:{<green for branches you've reviewed>}}
      ↳ 認証+商品 dispatch in parallel (no deps) → agents run → review → merge
      ↳ merges unblock 決済, then UI → dispatched → merged → state:"complete"
between steps: watch agent.activity / event.recent; context.set on new decisions;
               knowledge.impact before cross-cutting changes; resolve blockers.
```

## References
- Verb catalog (authoritative): `GET /mcp/tools/list`; source `src-tauri/src/api/mcp.rs`.
- Live, runnable examples per group: `scripts/verify-mcp-task-surface-live.mjs`,
  `verify-autonomy-loop-live.mjs`, `verify-coordination-stream-live.mjs`,
  `verify-shared-brain-live.mjs`, `verify-knowledge-graph-live.mjs`.
- Spec: `docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md` (BR4–BR9).
- Older manual model (worktree scripts + send_keys, not MCP): `aether-fleet`.
