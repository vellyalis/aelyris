# Visible Agent Pane Runtime Spec

作成: 2026-06-23
対象: Aelyris を可視エージェント作業台にするための runtime 境界仕様（tmux 等のマルチプレクサを参照点とする）。

## 0. 結論

ユーザー仮説は半分正しい。

- 以前の失敗モードは確かに存在した。自律ループが hidden subprocess の `claude -p` を使い、stdout を裏で drain するだけだと、GUI ペインには AI CLI の TUI が表示されない。
- 現在のコードはかなり修正済み。`spawn_interactive_agent`、`agent_command_spec`、`agent_shell_command_spec`、`PaneFleet` は visible PTY / interactive TUI を明示しており、no `-p` をテストでも縛っている。
- ただし製品体験としてはまだ未完成。手動 Orchestra dispatch は複数 `InteractiveSession` を作るが、中央の terminal pane tree / shell workspace に自動で 1 agent = 1 pane としてマウントしない。Task Graph の `orchestrator_step` だけが実 split pane へ出る。
- 仕様の一部が古い。`MCP_TOOL_SURFACE_SPEC.md` は `task -> initial_prompt` を `-p` で渡すと書いており、現在実装と矛盾する。
- tmux 上位互換を名乗るには、loop-dispatched agent pane も sidecar/daemon-owned PTY に寄せ、UI/WebView の再起動と attach/detach に耐える必要がある。現在の loop pane は in-process `PtyManager` 経路で、表示はできるが tmux 的な永続性は弱い。

この spec の判断:

> 人間に見せる agent は必ず visible PTY + interactive TUI。`-p` / `--print` は可視ペイン禁止。headless `-p` は planner / reviewer / MCP batch / no-webview automation だけに限定する。

## 1. 現状確認

### 1.1 headless 経路はまだ存在し、存在してよい

`src-tauri/src/agent/claude.rs` の `AgentManager::start_session` は headless runtime である。

- Claude: `-p <prompt> --output-format stream-json --verbose --model <model>`
- Codex/Gemini: `-p <prompt>`
- `src-tauri/src/ipc/commands.rs` の `start_agent` がこの経路を呼ぶ。
- `src-tauri/src/control/agent.rs` の `start_headless` は stdout/stderr を drain して OS pipe deadlock を避ける。
- `src-tauri/src/api/mcp.rs` の `aelyris.spawn_agent` も現在は headless を明示している。

この経路は UI 表示用ではない。プロセス終了を completion signal にできる batch runtime であり、stream-json / stdout 解析向き。

### 1.2 visible interactive 経路は no `-p` で修正済み

`src-tauri/src/agent/interactive.rs` は可視 TUI 用 runtime である。

- `agent_command_spec(model, initial_prompt, autonomous)`:
  - Claude は `--model <model>` と、必要なら `--permission-mode acceptEdits` を付ける。
  - prompt は positional arg。
  - `-p` は付けない。
- `agent_shell_command_spec(model, prompt, autonomous)`:
  - visible pane の PowerShell 内で CLI を呼ぶ。
  - prompt は `AELYRIS_AGENT_PROMPT` env var。
  - `-p` は付けない。
  - `; exit $LASTEXITCODE` は crash/backstop 用で、正常完了検出の主経路ではない。

関連テストも no `-p` を直接検査している。

- `agent_command_spec_claude_injects_model_and_interactive_prompt`
- `agent_command_spec_codex_passes_interactive_prompt`
- `agent_shell_command_spec_runs_the_interactive_cli_inside_powershell`

### 1.3 hand-spawned interactive agent は PTY だが、pane tree ではなく agent tab 表示

`src-tauri/src/ipc/interactive_commands.rs::spawn_interactive_agent` は:

- sidecar があれば sidecar PTY に spawn。
- なければ native in-process PTY fallback。
- `InteractiveSessionManager` に登録。
- `run_output_monitor` が native terminal engine に diff を流す。

Frontend 側:

- `src/shared/hooks/useInteractiveAgent.ts` が `spawn_interactive_agent` を呼ぶ。
- `src/App.tsx` は `activeInteractive` を `AgentTerminal` で全幅表示する。
- `WorkspaceTabs` は interactive session を通常 terminal tab とは別の agent tab として並べる。

これは「TUI を表示する」点では正しいが、「各 pane に表示する」体験ではない。

### 1.4 Task Graph の visible loop は pane tree に実マウントする

`src-tauri/src/control/loop_ports.rs::run_step_visible` は `PaneDispatcher` を使う。

- ready task を `PaneFleet` に dispatch。
- command は `agent_shell_command_spec` 由来なので no `-p`。
- each task = visible PTY pane。
- completion は interactive TUI の exit ではなく、declared output paths が worktree に現れたかで判断する。

`src-tauri/src/ipc/orchestrator_commands.rs::orchestrator_step` は:

- `run_step_visible` を呼ぶ。
- `spawn_loop_pane_render` で native engine render bridge を張る。
- `agent_event: agent_spawned` を emit する。

`src/App.tsx` / `PaneTreeContainer.tsx` は:

- `agent_spawned` を受けて `paneAgentSpawns` を更新。
- active tab の `PaneTreeContainer` に渡す。
- `splitWithExistingTerminal` で既存 PTY を新 leaf に bind。
- layout を `tiled` に rebalance。

つまり、現状で「各 pane に agent TUI」が一番実現できているのは `orchestrator_step` 経路である。

### 1.5 仕様矛盾

`docs/specs/MCP_TOOL_SURFACE_SPEC.md` の `aelyris.spawn_agent` 行は、`task -> initial_prompt` が `-p` で渡されると書いている。これは現在の interactive runtime と矛盾し、今後の実装者を誤誘導する。

修正方針:

- visible PTY 経路の prompt delivery は positional arg または env var。
- `-p` は headless runtime / oneshot runtime だけ。
- generic な `spawn_agent` には runtime mode を明示させるか、headless/visible を別 tool 名に分ける。

## 2. Product Target

Aelyris の方向性は、賑やかな multi-pane ADE を正面から真似ることではない。

目標は:

> durable mux panes + 可視エージェントワークスペース + Aelyris の worktree / review / audit / merge control を一体化した、可視で監査できる AI 開発ワークスペース。

よって最重要体験は次の 1 画面である。

1. Operator が一つの goal を投入する。
2. Aelyris が N 個の work unit に分ける。
3. 各 agent が独立 worktree の interactive TUI として、中央の terminal pane tree / shell workspace に 1 agent = 1 pane で表示される。
4. Operator は tmux 的に pane を移動・拡大・送信・broadcast できる。
5. 完了、詰まり、承認待ち、差分、merge readiness が同じ cockpit で見える。
6. UI/WebView が落ちても daemon sidecar が PTY と event stream を保持し、再 attach できる。

## 3. Runtime Contract

### 3.1 Run modes

`AgentRunMode` は 3 種に固定する。

```ts
type AgentRunMode = "visible_pty" | "headless_print" | "oneshot";
```

| Mode | Intended use | CLI invocation | Completion signal | UI |
|---|---|---|---|---|
| `visible_pty` | human-visible agent work, cockpit fleet, Orchestra dispatch | interactive CLI, no `-p`; prompt positional/env | declared outputs, explicit done marker, or operator collect | `TerminalCanvas` in central pane tree |
| `headless_print` | no-webview automation, MCP batch worker, legacy headless session | `-p` / `--print`, optional stream-json | process exit + parsed stdout | logs/status only |
| `oneshot` | planner/reviewer semantic call | `claude -p` hidden command | command output returned to caller | no session |

Rules:

- `visible_pty` MUST NOT pass `-p` or `--print`.
- `headless_print` MUST NOT be mounted as an `AgentTerminal`.
- `oneshot` MUST NOT create `AgentSession`.
- Any API that can launch an agent MUST carry an explicit run mode or have the mode encoded in the tool/function name.

### 3.2 Prompt delivery

Visible TUI prompt delivery:

- Direct spawn (`spawn_interactive_agent`): prompt as CLI positional arg where supported.
- Pane shell spawn (`PaneFleet`): prompt via `AELYRIS_AGENT_PROMPT`, referenced inside PowerShell command.
- No prompt shell interpolation.
- No `-p`.

Headless prompt delivery:

- `-p <prompt>` is allowed only in `AgentManager`, `claude_oneshot`, and explicitly headless MCP tools.

### 3.3 Presentation modes

`visible_pty` still needs a presentation target.

```ts
type AgentPresentation = "pane" | "agent_tab";
```

Rules:

- Orchestra / fleet / multi-agent dispatch defaults to `pane`.
- Single manual exploratory agent may use `agent_tab`, but the UI should offer "mount in pane" and "detach to tab".
- `pane` presentation means bind an existing PTY to `PaneTreeContainer` via the same mechanism used by loop-dispatched agents.
- `agent_tab` presentation means keep the current `WorkspaceTabs` agent tab behavior.

## 4. Required Fixes

### WU-VP-1: Make Orchestra dispatch center-pane-first

Problem:

- `handleStartRightRailOrchestra` calls `launchOrchestraPrompts(..., handleStartInteractiveSession)`.
- `handleStartInteractiveSession` creates interactive sessions, but those sessions become agent tabs, not pane-tree leaves.
- The user-visible result is multiple hidden-ish agent tabs instead of tiled agents in the central terminal/shell pane tree.

Implementation:

1. Change `launchOrchestraPrompts` to return successful `SpawnResult[]`, not only a count.
2. Add `presentation?: AgentPresentation` to `startInteractiveSession`.
3. For Orchestra dispatch, call with `presentation: "pane"` so the output appears in the central terminal pane tree, regardless of which UI surface initiated the dispatch.
4. After each successful spawn, enqueue `{ terminalId: result.pty_id, model }` into the existing `paneAgentSpawns` bridge.
5. Keep `WorkspaceTabs` listing only for sessions not mounted as panes, or mark pane-mounted sessions with a compact status chip instead of another tab.

Acceptance:

- Dispatching 3 Orchestra roles creates 3 split panes in the active central terminal tab.
- Each pane contains `AgentTerminal` / `TerminalCanvas` bound to its PTY.
- The pane labels show role/model/worktree branch.
- Selecting the agent card focuses the corresponding pane, not only an agent tab.

### WU-VP-2: Unify visible pane mounting

Problem:

- Loop-dispatched agents use `agent_event: agent_spawned` -> `paneAgentSpawns`.
- Hand-spawned interactive agents use `InteractiveSessionManager` -> agent tab.
- Two visible-agent presentation paths will diverge.

Implementation:

Create a single frontend function:

```ts
function mountAgentPtyInPane(input: {
  ptyId: string;
  model: string;
  role?: string;
  worktreeBranch?: string;
  source: "loop" | "orchestra" | "manual";
}): void
```

Use it from:

- `agent_event: agent_spawned`
- Orchestra spawn results
- manual "Mount in pane" action from `InteractiveSessionCard`

Acceptance:

- No duplicated split/bind logic.
- No agent PTY is mounted twice.
- Done panes keep final output until user closes or retention cap evicts them.

### WU-VP-3: Make visible loop panes daemon/sidecar-owned

Problem:

- `spawn_interactive_agent` prefers `PtySidecarState`.
- `PaneFleet` currently owns loop panes through in-process `PtyManager`.
- Verification explicitly notes loop panes may not appear in `list_terminals` because they are in-process.
- This is weaker than tmux: UI/host crash can lose live loop panes.

Implementation:

1. Introduce a `VisiblePtyRuntime` trait or adapter with:
   - `spawn(program,args,cols,rows,cwd,env) -> terminal_id`
   - `subscribe_output(terminal_id)`
   - `resize(terminal_id, cols, rows)`
   - `close(terminal_id)`
   - `list()`
2. Provide sidecar-backed implementation first.
3. Keep in-process fallback only as degraded mode and surface it in reliability UI.
4. Move `PaneFleet` to use `VisiblePtyRuntime` instead of direct `PtyManager`.
5. Ensure `list_terminals` can see loop-dispatched agent panes when sidecar is active.

Acceptance:

- A loop-dispatched agent pane is attachable after WebView reload.
- `list_terminals` includes loop agent PTYs on the sidecar path.
- Reliability panel flags fallback mode as "not tmux-durable".

### WU-VP-4: Fix completion for interactive TUI agents

Problem:

- Interactive TUI sessions often never exit.
- `PaneFleet` already supports structural completion via declared output files.
- Tasks with `outputs: []` cannot auto-complete safely and will ride exit/timeout/manual paths.

Implementation:

1. For auto-dispatched visible agents, require one of:
   - non-empty `outputs`
   - explicit `completionMarker` path
   - manual review mode
2. Planner-generated tasks MUST include outputs or marker.
3. Orchestra prompts should include the marker/output contract in the prompt.
4. UI should label no-output tasks as "manual collect" instead of "auto merge ready".

Recommended marker:

```text
.aelyris/tasks/<task_id>/done.json
```

Marker shape:

```json
{
  "taskId": "string",
  "summary": "string",
  "changedFiles": ["relative/path"],
  "testsRun": ["command"],
  "result": "done" | "blocked"
}
```

Acceptance:

- Visible agents do not wedge in Running merely because the TUI remains open.
- Empty-output tasks do not auto-complete immediately.
- A blocked marker creates an attention state, not a merge-ready state.

### WU-VP-5: Make MCP/headless naming explicit

Problem:

- Current MCP implementation says `aelyris.spawn_agent` is headless.
- Older spec text says `aelyris.spawn_agent` maps to `spawn_interactive_agent`.
- Generic naming hides the most important product boundary.

Implementation:

For MCP v1 compatibility:

- Keep `aelyris.spawn_agent` as deprecated alias for headless, because current implementation already behaves that way.
- Add `aelyris.spawn_headless_agent` with identical schema.
- Add `aelyris.spawn_visible_agent` only when the API state has a visible PTY runtime attached. It returns `{ sessionId, ptyId, presentation }`.

For MCP v2:

```json
{
  "tool": "aelyris.spawn_agent",
  "input": {
    "runMode": "visible_pty",
    "presentation": "pane",
    "prompt": "...",
    "cwd": "...",
    "model": "sonnet",
    "branch": "agent/foo"
  }
}
```

Acceptance:

- Tool descriptions never say a visible agent is spawned with `-p`.
- Headless and visible sessions are distinguishable in `AgentSession.run_mode`.
- `webviewRequiredForToolCalls:false` remains true for headless tools.

### WU-VP-6: Update docs and gates

Docs to update:

- `docs/specs/MCP_TOOL_SURFACE_SPEC.md`
- `docs/specs/COCKPIT_UX_SPEC.md`
- `docs/specs/PHASE_0_1_ARCHITECTURE_SPEC.md`
- `docs/specs/README.md`
- `scripts/fleet/wu-manifest.json`

New / updated gates:

- Static grep gate: `agent_command_spec` and `agent_shell_command_spec` must not contain `-p` / `--print`.
- Static doc gate: docs must not claim interactive prompt delivery uses `-p`.
- Frontend unit gate: Orchestra dispatch enqueues central pane mounts for all successful visible spawns.
- Live gate: `scripts/verify-orchestra-center-panes.mjs`.
- Existing live gates remain:
  - `scripts/verify-dispatch-pane.mjs`
  - `scripts/verify-interactive-tui.mjs`
  - `scripts/verify-inspector-interactive.mjs`

## 5. UX Requirements

### 5.1 Pane behavior

- Each visible agent occupies a real pane leaf.
- Agent panes participate in existing tmux-like operations:
  - focus next/previous
  - swap/rotate
  - resize/even/tiled
  - maximize
  - close
  - send keys / steer
  - broadcast when explicitly enabled
- Agent panes must not disappear immediately on process exit. Keep final output visible.
- Retention cap should evict oldest done agent panes only after a clear cap is exceeded.

### 5.2 Session/card behavior

- Agent rail/card click focuses the pane if mounted.
- If not mounted, click opens the agent tab.
- Card shows:
  - role
  - model
  - worktree branch
  - run mode
  - presentation
  - backend: `sidecar` / `native`
  - completion mode: `outputs` / `marker` / `manual`

### 5.3 Failure states

- If visible PTY spawn falls back from sidecar to in-process native, UI marks it as durability-degraded.
- If prompt delivery fails, show launch failure and do not create an empty pane.
- If pane mount fails after PTY spawn, keep the session reachable in agent tab and show "Mount in pane" retry.
- If a visible TUI waits for approval, surface it in the same approval inbox as headless/manual gates.

## 6. Live Shared Awareness

This is the speed multiplier. Aelyris must not be "N AI CLIs open at once"; it must be a shared live workspace where every agent can see what the other agents are doing and which code surface they are touching.

Current foundation:

- Event stream: `agent_event`, task graph transitions, escalation events.
- File ownership: `file_ownership` state and ownership IPC.
- Frontend telemetry: `changedFileDetails`, `writeSet`, run graph, conflict detection.
- Worktree/ghostdiff: each agent's isolated branch/worktree can be watched and diffed.

Target:

> Every visible agent pane has live activity metadata: current task, current command/tool, current files, and current symbols/functions touched. Other agents and the operator can see that state in real time.

### 6.1 Activity event contract

Add a normalized activity event emitted by every runtime:

```ts
interface AgentActivityEvent {
  agentId: string;
  taskId?: string;
  paneId?: string;
  terminalId?: string;
  phase: "planning" | "reading" | "editing" | "testing" | "reviewing" | "blocked" | "idle" | "done";
  summary: string;
  files: AgentFileTouch[];
  symbols: AgentSymbolTouch[];
  updatedAt: number;
}

interface AgentFileTouch {
  path: string;
  mode: "read" | "write" | "test" | "review";
  confidence: "exact" | "inferred";
}

interface AgentSymbolTouch {
  path: string;
  symbol: string;
  kind: "function" | "method" | "class" | "component" | "module" | "unknown";
  range: { startLine: number; endLine: number };
  mode: "read" | "write" | "test" | "review";
  confidence: "lsp" | "parser" | "diff-hunk" | "inferred";
}
```

### 6.2 Function/symbol ownership

File-level ownership is necessary but too coarse for "parallel and fast." Two agents should be allowed to work in the same file if they own disjoint symbols, but conflicts must be loud when they overlap.

Add a symbol ownership layer:

```ts
interface SymbolClaim {
  claimId: string;
  agentId: string;
  taskId?: string;
  path: string;
  symbol: string;
  range: { startLine: number; endLine: number };
  mode: "write" | "review" | "test";
  leaseExpiresAt: number;
  confidence: "lsp" | "parser" | "diff-hunk";
}
```

Rules:

- Write claims conflict when path and line ranges overlap.
- Same file but disjoint symbols is allowed and shown as parallel-safe.
- Low-confidence inferred claims warn but do not hard-block.
- Shared config/types/schema files default to file-level exclusivity unless the language server can prove safe symbol boundaries.
- Claims expire unless refreshed by file watcher, tool events, or explicit agent heartbeat.

### 6.3 Symbol extraction

Preferred extraction order:

1. LSP `textDocument/documentSymbol` for supported languages.
2. Parser fallback where already available or cheap.
3. Diff-hunk range to nearest known symbol.
4. File-level fallback.

The UI must show the confidence. Do not pretend inferred function ownership is exact.

### 6.4 Operator and agent UX

Center pane overlays:

- Pane header shows `editing src/foo.ts:updateInvoiceTotal()`.
- Conflict badge lights only for overlapping symbol/range claims, not merely same repository.
- Hovering an agent pane shows its current files/symbols and latest tool/command.

Agent rail / graph:

- Run graph edges include `agent -> symbol -> file -> tests`.
- Clicking a symbol focuses the pane and opens the editor at that range.
- A parallel-safe indicator appears when active agents touch disjoint symbols.

Agent-to-agent context:

- New agent prompts include active symbol claims: "Do not edit symbols currently claimed by @tester unless explicitly assigned."
- `send_steer` can target an agent with "avoid X; @impl is editing Y."
- Planner decomposes WUs by symbol/file ownership where possible.

### 6.5 Speed claim boundary

This makes Aelyris parallel and fast only if the scheduler respects the live ownership map.

Fast path:

- independent worktrees
- disjoint files or disjoint symbols
- explicit output/marker contracts
- real-time activity broadcast
- reviewer merge gates

Slow/serialized path:

- same function/range
- shared schema/config/package files
- migration files
- cross-cutting renames
- low-confidence symbol extraction

The product should say "parallel-safe" only on the fast path. Otherwise it should route to review, re-decompose, or serialize the conflicting task.

### 6.6 Shared brain without log flood

The shared brain is not the raw terminal log. Raw logs are evidence and replay material; they are too noisy to be the live coordination state. Aelyris must turn high-volume streams into small, durable, queryable brain records.

Pipeline:

1. Raw stream:
   - PTY bytes, tool output, command blocks, file watcher events, git diffs, task events.
   - Stored with retention and replay pointers, not broadcast wholesale to every agent.
2. Event normalization:
   - Convert raw events into typed records: `AgentActivityEvent`, `SymbolClaim`, `DecisionRecord`, `ValidationRecord`, `BlockerRecord`.
   - Drop duplicate/no-op noise at this layer.
3. Rolling state:
   - Maintain one current state object per agent/task/symbol/file.
   - UI reads this for live panes and graph badges.
4. Periodic compaction:
   - Summarize long runs into compact brain snapshots.
   - Keep links back to raw evidence for audit.
5. Retrieval:
   - New agents receive only relevant active claims, recent decisions, blockers, and task-local summaries.
   - Full logs are fetched only on demand for debug/replay/review.

Required records:

```ts
interface BrainSnapshot {
  snapshotId: string;
  scope: "workspace" | "task" | "agent" | "symbol";
  key: string;
  summary: string;
  activeClaims: SymbolClaim[];
  decisions: DecisionRecord[];
  blockers: BlockerRecord[];
  validations: ValidationRecord[];
  evidenceRefs: EvidenceRef[];
  updatedAt: number;
}

interface EvidenceRef {
  kind: "event" | "log" | "diff" | "command" | "file";
  id: string;
  path?: string;
  range?: { startLine: number; endLine: number };
}
```

Backpressure rules:

- UI event listeners receive coalesced updates, not every byte.
- Per-agent activity state is last-write-wins by event sequence.
- Large command output is chunked and summarized; panes still render the raw stream, but the shared brain stores the summary plus evidence refs.
- If summarization fails or falls behind, raw evidence remains durable and the brain marks the snapshot as stale instead of blocking the run.
- Agents are not prompted with unbounded logs. Prompt context is capped by task relevance, active ownership, latest blockers, latest decisions, and requested evidence refs.

This is what keeps the team fast when logs are noisy: the central terminal can stream everything for human visibility, while the coordination layer shares only the distilled state needed to avoid collisions and finish the work.

## 7. Non-goals

- Do not remove headless runtime. It is useful for planner/reviewer/batch/no-webview flows.
- Do not parse arbitrary TUI output as the primary completion signal.
- Do not fake pane rendering by copying headless stdout into a text panel.
- Do not make every MCP tool require the React WebView.
- Do not claim tmux-level persistence until sidecar/daemon attach is proven for agent panes.
- Do not claim symbol-level certainty when only file-level or diff-hunk inference is available.

## 8. Definition of Done

The product can claim "agent TUI per GUI pane" only when all are true:

1. Orchestra dispatch produces multiple tiled panes in the active central terminal workspace.
2. Each pane renders the real AI CLI TUI through `TerminalCanvas`.
3. None of the visible launches pass `-p` / `--print`.
4. Each visible agent has an isolated worktree when branch is supplied.
5. Completion uses output/marker/manual state, not "TUI process exited".
6. Agent rail/card selection focuses the mounted pane.
7. Sidecar-backed panes can be listed and reattached after UI reload.
8. Headless MCP/batch flows still work without WebView.
9. Live activity shows what each agent is doing and which file/symbol/function it is touching.
10. Overlapping symbol/range claims are surfaced before merge, while disjoint symbol work is allowed to proceed in parallel.
11. Existing gates plus new central-pane live gate pass.

## 9. Implementation Order

1. WU-VP-6 docs/gates first to stop regression.
2. WU-VP-1 Orchestra dispatch center-pane-first.
3. WU-VP-2 shared mount function.
4. WU-VP-4 completion marker/output contract.
5. WU-VP-3 sidecar-owned loop panes.
6. WU-VP-5 MCP naming cleanup.
7. WU-VP-7 live symbol/activity map.

This order gives an immediate visible product improvement before the deeper tmux-durability migration.

## 10. Claude Handoff Prompt

Paste this to Claude when assigning implementation work:

```text
You are implementing Aelyris in <repo>.

First read:
1. docs/specs/README.md
2. docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md
3. Only the specific source files named by the work unit you choose.

Goal:
Make Aelyris's multi-agent experience center-terminal-first: every GUI-visible AI agent must run as a real visible PTY / interactive TUI in the central terminal pane tree, with 1 agent = 1 pane. Do not render headless stdout as a fake terminal. Do not use `-p` / `--print` for anything shown in a GUI pane.

Runtime invariant:
- visible agents: interactive CLI, no `-p`, PTY-backed `TerminalCanvas`
- headless agents: `-p` / stream-json allowed only for planner/reviewer/MCP batch/no-webview flows
- oneshot: no session, no pane

Recommended first work unit:
WU-VP-1 + WU-VP-2:
- Make Orchestra dispatch mount successful visible agents into the active central terminal pane tree.
- Reuse the existing `paneAgentSpawns` / `PaneTreeContainer` bridge used by loop-dispatched `agent_spawned` events.
- Add one shared mount function/path so loop, Orchestra, and manual "mount in pane" do not diverge.

Primary files to inspect for WU-VP-1/WU-VP-2:
- src/shared/lib/orchestraDispatch.ts
- src/App.tsx
- src/shared/hooks/useInteractiveAgent.ts
- src/features/terminal/pane-tree/PaneTreeContainer.tsx
- src/features/terminal/pane-tree/usePaneTree.ts
- src/features/agent-terminal/AgentTerminal.tsx
- src-tauri/src/ipc/interactive_commands.rs
- src-tauri/src/agent/interactive.rs

Do not break:
- `agent_command_spec` and `agent_shell_command_spec` must not include `-p` / `--print`.
- Existing headless planner/reviewer/MCP paths may keep `-p`.
- Existing terminal pane operations must continue to work: split, focus, close, resize, tiled rebalance.
- Do not remove headless runtime.
- Do not claim tmux-level durability until sidecar-owned attach/recover is proven.

Acceptance for WU-VP-1/WU-VP-2:
- Dispatching 3 Orchestra roles creates 3 split panes in the active central terminal tab.
- Each pane renders the real AI CLI TUI through `AgentTerminal` / `TerminalCanvas`.
- Each pane is tied to its agent PTY and worktree branch.
- Agent card/rail selection focuses the mounted pane.
- A pane-mounted session is not duplicated as a full separate agent tab, or it is clearly marked as already mounted.
- Done panes keep final output visible until user close or retention cap.

Next work units after that:
1. WU-VP-4 completion marker/output contract.
2. WU-VP-7 live activity + symbol/function ownership map.
3. WU-VP-3 sidecar-owned loop panes for durable attach/recover.
4. WU-VP-5 MCP naming cleanup for visible vs headless agents.

Verification:
- Add or update a static gate that fails if visible launch paths use `-p` / `--print`.
- Add a frontend unit test proving Orchestra dispatch enqueues central pane mounts for all successful visible spawns.
- Add or update a live verification script named `scripts/verify-orchestra-center-panes.mjs`.
- Run focused tests first, then the relevant existing gates:
  - pnpm test -- --runInBand is not required; use the repo's normal vitest command if focused test selection is unavailable.
  - cargo test --manifest-path src-tauri/Cargo.toml interactive
  - node scripts/verify-dispatch-pane.mjs when a Tauri dev app + authenticated AI CLI are available.

Report back with:
- changed files
- exact behavior implemented
- tests/gates run and results
- any blocked live proof, with the missing host condition stated exactly
```
