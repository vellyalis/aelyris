# Aelyris Fusion Coordinator Audit

作成: 2026-06-23
対象: Aelyris に inference-time multi-agent / multi-model composition API を追加する判断。

## 0. Verdict

**PASS, conditional.**

Aelyris に "Fusion Coordinator" を組み込む価値は高い。ただし、これは LLM の重みを混ぜる model merging ではなく、既存の Aelyris control plane 上で複数 agent / model / reviewer / judge を合成する runtime coordination layer として実装する。

この機能は新しい chat panel や新しい agent runtime ではない。`TaskGraph`、`ContextStore`、`EventBus`、`CostManager`、file / symbol ownership、review gate、merge control を束ねる薄い composition layer である。

## 1. Claude `-p` Independent Audit

実行:

```powershell
claude -p "<read-only Aelyris Fusion Coordinator audit prompt>"
```

初回は `HTTP_PROXY` / `HTTPS_PROXY` が `http://127.0.0.1:9` を指していたため `API Error: Unable to connect to API (ConnectionRefused)` で失敗した。恒久設定は変更せず、同プロセス内だけ proxy env を外して再実行し、Claude Code 2.1.186 の headless audit が完了した。

Claude の結論:

- Verdict: **PASS**, with safety boundaries.
- Product fit: Aelyris の AI team OS positioning を強化する。
- Architecture fit: 新 runtime ではなく、既存 `LoopPorts` / review / cost / intent / event substrate の composition layer として実装する。
- Critical warning: Fusion advisor fan-out は visible pane に載せない。advisor はファイルを書かない推論専用なので、`PaneFleet` の outputs-based completion と相性が悪い。headless batch path を使い、process exit で完了収集する。

Claude が指摘した hard boundary:

1. Fusion API は merge / approval / reviewer gate を迂回しない。
2. 合議結果を勝手に `ContextStore` へ永続 decision として書かない。明示的な `context.set` / intent resolution を通す。
3. advisor fan-out は `CostManager` の cap を使って一括で制限する。
4. judge / reviewer は advisor / implementer と同一 identity にしない。
5. MCP tool は既存 `tools_call` governance choke point を通す。
6. 推論専用 advisor は `outputs=[]` / `symbols=[]` で file / symbol lanes を claim しない。

## 2. Product Fit

Aelyris の勝ち筋は、単に複数 LLM を呼ぶことではない。勝ち筋は、複数 AI worker が同じ workspace truth を共有し、衝突を避け、差分を review / merge まで持っていく AI team OS である。

Fusion Coordinator はこの positioning と整合する:

- 複数 model / role の出力を advisory として比較できる。
- planner / implementer / tester / reviewer / judge の役割分離を明示できる。
- `EventBus` と intent bus によって、合議を raw log ではなく typed coordination state として扱える。
- symbol ownership により、"群知能" を単なる投票ではなく collision-aware scheduling にできる。

## 3. Architecture Fit

### 3.1 Existing seams

- `src-tauri/src/orchestrator/autonomy.rs`
  - `LoopPorts` が dispatch / completion / gate / reviewer / merge / symbol blocking の境界を持つ。
  - `autonomy::step` が retry、review、merge、escalation、dispatch を一箇所で制御する。
- `src-tauri/src/control/loop_ports.rs`
  - headless path と visible path の adapter を分ける。
  - `run_step_visible` は cockpit visible execution、`run_step` は MCP / headless execution。
- `src-tauri/src/control/pane_fleet.rs`
  - visible interactive TUI agent を pane に出す。
  - completion は process exit / declared outputs / timeout。
- `src-tauri/src/api/mcp.rs`
  - `aelyris.task.create`、`aelyris.orchestrator.step`、`aelyris.event.*`、`aelyris.symbol.*`、`aelyris.context.*`、`aelyris.intent.*` が既に coordination substrate を提供している。
- `src-tauri/src/agent/interactive.rs`
  - GUI-visible path は interactive PTY / no `-p`。
- `src-tauri/src/agent/claude.rs`
  - headless `-p` path は batch / no-WebView execution に残してよい。
- `src-tauri/src/symbol_ownership/mod.rs`
  - range-based symbol claims, leases, confidence, conflict/warn semantics を持つ。

### 3.2 Recommended module shape

新規 module:

```text
src-tauri/src/orchestrator/fusion.rs
```

Core shape:

```rust
pub struct FusionRunSpec {
    pub prompt: String,
    pub repo_path: Option<String>,
    pub advisors: Vec<FusionAdvisorSpec>,
    pub judge: FusionJudgeSpec,
    pub mode: FusionMode,
}

pub enum FusionMode {
    Advisory,
    GatedApply,
}

pub trait FusionPorts {
    fn spawn_advisor(&mut self, spec: FusionAdvisorSpec) -> Result<String, String>;
    fn poll_advisor(&mut self, session_id: &str) -> FusionAdvisorStatus;
    fn judge(&mut self, input: FusionJudgeInput) -> Result<FusionVerdict, String>;
    fn publish_event(&mut self, event: FusionEvent);
    fn cost_guard(&mut self, requested_agents: usize) -> Result<(), String>;
}
```

Keep this pure and unit-testable, following the `LoopPorts` pattern in `autonomy.rs`.

## 4. API Shape

Do not overload current `aelyris.spawn_agent`. It is currently headless in `src-tauri/src/api/mcp.rs`, while visible GUI agents must remain explicit PTY sessions. Fusion should get its own tool namespace.

Recommended MCP tools:

| Tool | Safety | Purpose |
|---|---|---|
| `aelyris.fusion.plan` | FREE | Side-effect-free preview. Returns advisor roles, model allocation, cost estimate, lane plan, and judge plan. |
| `aelyris.fusion.deliberate` | FREE | Starts headless advisor fan-out for an advisory-only decision. |
| `aelyris.fusion.status` | FREE | Reads advisor status, partial outputs, cost, blockers, and events for a run. |
| `aelyris.fusion.consensus` | FREE | Runs or reads judge synthesis. Produces a verdict, not a merge. |
| `aelyris.fusion.cancel` | FREE | Cancels all headless advisor sessions for the fusion run. |
| `aelyris.fusion.apply_as_tasks` | GATED or REVIEWER_AUTHORITY-adjacent | Converts a consensus into `aelyris.task.create` items. It must not merge directly. |

Run modes:

```ts
type FusionRunMode = "advisory" | "gated_apply";
```

- `advisory`: returns synthesis only. No writes, no lanes, no merge.
- `gated_apply`: consensus becomes Task Graph work. It still goes through normal dispatch, review, gate, and merge flow.

## 5. Safety Boundaries

### 5.1 Visible vs headless

Visible agents shown in GUI panes must use the interactive PTY path and must not pass `-p` / `--print`.

Fusion advisor fan-out should use headless batch path by default because advisors are reasoning workers, not visible implementers. This preserves the visible/headless split:

- visible implementers: `visible_pty`, no `-p`, central pane tree.
- headless advisors / judge calls: `headless_print` or oneshot, `-p` allowed.

### 5.2 Completion

Do not run advisory fan-out through `PaneFleet` unless the advisor is explicitly producing declared output files. `PaneFleet` relies on process exit, declared outputs, or timeout. Pure advisory reasoning with `outputs=[]` risks hanging until timeout.

### 5.3 Cost and concurrency

Fusion fan-out multiplies API spend and active agents. It must reserve/check cost and active-agent budget before spawning advisors. It should reuse `CostManager` rather than introduce a parallel budget counter.

### 5.4 Review and merge

Fusion consensus is not merge authority. Merge must remain in existing review / gate / merge flow:

1. consensus creates or updates tasks;
2. normal orchestrator dispatch runs agents;
3. objective gates and semantic review run;
4. reviewer authority approves;
5. existing merge path performs the git operation.

### 5.5 Shared truth

Raw advisor logs are evidence, not shared brain. Fusion should publish compact typed records:

- advisor started / finished / failed;
- candidate answer;
- judge verdict;
- confidence / dissent;
- evidence refs;
- decision proposal;
- task creation refs.

Only explicit accepted decisions should enter `ContextStore`.

## 6. Implementation Order

1. Fix any live compile/test drift before adding Fusion. Current spot check passed for symbol ownership, but full gates still need refreshing before implementation.
2. Add `orchestrator/fusion.rs` pure core and fake-port unit tests.
3. Add headless advisor adapter using existing `start_headless` / `AgentManager` path.
4. Add cost reservation / active-agent cap enforcement.
5. Add judge synthesis, with self-review / same-identity rejection.
6. Add MCP tools under `aelyris.fusion.*` with JSON schemas and `additionalProperties:false`.
7. Add event records for deliberation lifecycle.
8. Add cockpit UI read surface, not a new chat surface: fold into Orchestrator / Fleet HUD / Agent Inspector.
9. Add `gated_apply` path that creates Task Graph nodes and delegates execution to existing orchestrator flow.
10. Add verification scripts for cost cap, no visible `-p`, no direct merge, advisor timeout behavior, and restart-safe event history.

## 7. Current Evidence

Commands run during this audit:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml symbol_ownership --lib
pnpm test -- src/__tests__/agentFleet.test.ts src/__tests__/orchestraDispatch.test.ts
claude -p "<read-only Aelyris Fusion Coordinator audit prompt>"
```

Results:

- `symbol_ownership` Rust tests: 15 passed.
- `agentFleet` / `orchestraDispatch` frontend tests: 8 passed.
- Claude `-p` audit: completed after clearing proxy env for the subprocess only.

Working tree note:

- `docs/specs/CLAUDE_HANDOFF_COCKPIT_REQUIREMENTS_AUDIT_2026-06-23.md` was already untracked before this document was added.

## 8. Product Claim Boundary

Safe claim:

> Aelyris can compose multiple agents and models at runtime, compare their reasoning, and route the accepted result through the same visible workspace, ownership, review, and merge controls as normal autonomous work.

Unsafe claim until implemented and tested:

> Aelyris fuses LLMs into one model.

Unsafe claim unless sidecar recovery and pane attach are proven:

> Fusion advisors run as durable tmux-grade visible panes.

Use the term **Fusion Coordinator** or **Swarm Coordinator**, not "model fusion", when describing this feature in product copy.
