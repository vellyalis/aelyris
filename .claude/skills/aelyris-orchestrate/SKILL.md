---
name: aelyris-orchestrate
description: Drive Aelyris's experimental local MCP orchestration workflow over the aelyris.* verbs. Use for current Aelyris runtime orchestration when the local MCP server is available: decompose a goal, set shared ADR, create task graph/worktrees, observe agent activity, and run review gates with machine evidence. This is not release-readiness proof; aelyris-fleet is the legacy PowerShell fallback.
---

# Aelyris orchestration (MCP runtime)

You are the **orchestrator (the brain)**. Aelyris is the **capability layer (the hands)**.
You do not edit files yourself; you drive the runtime by calling `aelyris.*` MCP verbs,
and the worker agents (real `claude`/`codex`/`gemini` CLIs in isolated worktrees) do the
implementation. Keep decomposition, coordination, review judgment, and integration in
yourself. Aelyris is local-only — never push or open PRs.

Claim-safety note: this skill drives an experimental local operator workflow. It does not make Aelyris release-ready, world-class, tmux-equivalent, or BridgeSpace-plus complete. Public claims still require the verifier gates in `AGENTS.md`, `docs/requirements.md`, and `docs/AGENT_WORKFLOWS.md`.

## How to call verbs

The runtime is a local HTTP server (`127.0.0.1:9333`, bearer auth). Two faces, same
verb surface:

**Native MCP (preferred — register once, call as native tools).** `POST /mcp` speaks
JSON-RPC 2.0 (Streamable HTTP), so register Aelyris as a standard MCP server and the
`aelyris.*` verbs become native tools (no HTTP boilerplate). Set a *fixed*
`AELYRIS_API_TOKEN` before `pnpm tauri:dev` (otherwise the token rotates each launch), then:
```json
// .mcp.json
{ "mcpServers": { "aelyris": {
  "type": "http", "url": "http://127.0.0.1:9333/mcp",
  "headers": { "Authorization": "Bearer ${AELYRIS_API_TOKEN}" } } } }
```

**Direct REST (no registration — call from Bash/node).**
```
POST http://127.0.0.1:9333/mcp/tools/call
  Authorization: Bearer <token>
  { "name": "aelyris.<verb>", "arguments": { ... } }
→ { "ok": true, "result": { ... } }
```
- **Token:** `$env:AELYRIS_API_TOKEN`, or grep the dev log for `ephemeral token: <uuid>`
  (printed at startup when the env var is unset). Port is `9333`.
- **Catalog:** `GET /mcp/tools/list` (REST) or the `tools/list` JSON-RPC method returns
  every verb with its JSON schema — read it to confirm arguments. ~54 `aelyris.*` verbs.
- Call them with the Bash tool (`curl`) or a tiny `node`/`fetch` snippet. See
  `scripts/verify-*-live.mjs` for working examples of every group (incl.
  `verify-mcp-jsonrpc-live.mjs` for the native endpoint).
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
- **Mechanical gates:** pass `gateCommands{test,lint,types}` (argv per gate) and the
  objective gates are run for real in each worktree — a branch whose tests fail can't
  merge no matter what you claim. Subjective gates (design/context) stay your judgment.
- **Context convergence (mid-flight decisions):** every dispatch re-injects the current
  ADR (`context.all()`), so a re-dispatched task always gets the latest decisions. If an
  agent built on a now-stale assumption, mark its `context_aligned:false` → the loop
  **re-dispatches it for rework with the fresh ADR** (bounded retries, then it lands
  `failed` rather than looping). So no agent's stale-context work can merge, and none
  stays stranded. For a *live interactive* agent you can also `pane_send_input` the new
  decision to nudge it immediately.

## Conventions + guardrails
- **Concurrency cap 4** (the cost gate). The plan won't dispatch past it; pass an accurate
  `activeAgents`.
- **ADR keys:** stable snake_case (`auth_method`, `database`, `framework`, `api_style`).
- **`review.approve` / `request_merge` are reviewer-authority / gated** — the reviewer supplies evidence-backed gate judgments, but approval / merge-to-main authority must follow the configured gate policy and current machine evidence. Full-auto merge remains experimental. Do not fabricate a green verdict.
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
- Spec: `docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md` (BR4–BR9).
- Older manual model (worktree scripts + send_keys, not MCP): `aelyris-fleet`.
