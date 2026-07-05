# Aelyris Differentiation Polish Spec

Status: design/spec gate for product differentiation. Not release-ready.
Last reviewed: 2026-07-05 JST.

This document turns the "above BridgeSpace and Scape" product target into
functional requirements. It does not claim that the target is shipped. Current
machine truth remains alpha: `pnpm verify:quality-score` currently records
`releaseCandidateReady=false`, and larger product claims remain blocked by
current proof gates. Regenerate the artifact locally instead of quoting scores
from prose.

## 0. Claim Boundary

Aelyris can safely say it has a Rust/Tauri terminal, mux, sidecar,
visible-agent, MCP, worktree, ownership, review, merge, and Proofbook runtime
substrate. It must not claim production readiness, BridgeSpace-plus workspace
completion, Scape-plus automation completion, or tmux-level durability until the
matching verifiers are green.

This spec is a design authority for future implementation, not a release
announcement. If the current verifier artifacts disagree with prose, trust the
fresh artifacts.

## 1. Differentiation Thesis

Aelyris should not compete by adding another chat panel or a generic playbook
canvas. The target is a proof-first AI-team OS:

1. **BridgeSpace-plus**: a center-terminal-first workspace where every
   human-visible implementation agent is a real interactive PTY pane, not a
   hidden subprocess, fake transcript, or right-rail-only session.
2. **Scape-plus**: reusable Proofbooks that run governed local automation and
   produce append-only evidence, rather than merely chaining prompts and
   commands.
3. **Parallel-safe by construction**: symbol/function ownership and live
   activity records decide when agents may run concurrently and when they must
   serialize.
4. **Merge-ready evidence lane**: a task is not "done" until proof, reviewer
   separation, commit-bound merge intent, and residual blocker classification
   agree.
5. **Restart-aware operation**: durable panes, run ledgers, event replay, and
   shared brain records survive UI/WebView restart before the product claims
   tmux-level persistence.

The practical product sentence is:

> Aelyris is a local-first visible AI team workspace where each agent works in a
> real pane, shared state prevents collisions down to symbol/function ownership,
> Proofbooks turn successful work into rerunnable proof, and merge is gated by
> evidence instead of trust.

## 2. Current Substrate

Existing specs and code already define most foundations. Future polish must
reuse them:

- `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` owns visible PTY, interactive TUI,
  no `-p` / `--print`, central terminal pane tree, live activity, and
  symbol/function ownership rules.
- `PROOFBOOK_AUTOMATION_SPEC.md` owns Scape-style Proofbooks, append-only
  ledger proof, governed MCP/tool execution, PB-2/PB-3/PB-4 runtime slices, and
  future PB-5/PB-6/PB-7 phases.
- `MCP_TOOL_SURFACE_SPEC.md` owns the typed MCP catalog, schema validation,
  governance, and audit path.
- `src-tauri/src/proofbook` remains the Proofbook contract spine.
- `src-tauri/src/api/mcp.rs` remains the MCP tool catalog and governance
  adapter, not a place for a second dispatcher.
- Durable ownership and merge persistence already have repository modules; new
  product polish must delegate to those owners rather than duplicate them.

## 3. Non-Goals

- Do not build a separate orchestration backend.
- Do not build a second Proofbook runner.
- Do not build a second MCP dispatcher or second schema validator.
- Do not create a frontend-only executable workflow shape.
- Do not show headless `-p` output as a fake terminal.
- Do not move raw terminal logs into every agent prompt as "shared brain."
- Do not claim release readiness from design documents.
- Do not grow god files as a shortcut. `src/App.tsx` must not grow for this
  workstream; large additions belong in focused feature modules.

## 4. Functional Requirements

### FR-1 Center-Pane Agent Fleet

The main multi-agent experience must be the active center terminal pane tree.
Orchestra, planner, and Proofbook implementation agents must mount into that
tree by default.

Requirements:

- 1 agent = 1 visible PTY pane for human-visible implementation work.
- Visible panes run the interactive TUI and use no `-p` / `--print`.
- The right rail may initiate, summarize, approve, or inspect work, but it must
  not be the primary execution surface for implementation agents.
- A pane-mounted session must not be duplicated as a full competing agent tab.
- Existing pane operations still apply: focus, split, resize, close, zoom,
  broadcast when explicitly enabled, and final-output retention.

### FR-2 Durable Visible Runtime

Visible implementation panes need a durability tier.

Requirements:

- Sidecar/daemon-owned PTY is the tmux-durable target.
- In-process native PTY fallback is allowed only when surfaced as degraded.
- Attach/recover/list proof is required before claiming tmux-level persistence.
- A recovered degraded pane without a live PTY must show an ended/error state,
  not spawn a fresh shell silently.

### FR-3 Live Activity Map

Every active agent must publish a bounded activity record.

Required fields:

- agent id, task id, pane id, terminal id when available,
- phase: planning, reading, editing, testing, reviewing, blocked, idle, done,
- short summary,
- current command or tool,
- touched files,
- touched symbols/functions with ranges and confidence,
- updated-at timestamp and evidence refs.

The activity map is a product feature only if it is consumed by the scheduler,
operator UI, and agent prompt context. A passive dashboard is not enough.

### FR-4 Symbol/Function Ownership

File-level locking is too coarse for a fast AI team. Aelyris must track
symbol/function ownership with confidence.

Requirements:

- Overlapping write ranges conflict.
- Same file with disjoint symbol/function ranges can be parallel-safe.
- Parser/LSP-backed ranges can hard-block; diff-hunk or inferred ranges warn
  unless policy marks the file exclusive.
- Shared schemas, migrations, package files, and config default to file-level
  exclusivity unless exact extraction proves otherwise.
- Claims expire unless refreshed by file watcher, tool event, or heartbeat.
- UI and MCP output must show confidence, not pretend inferred ownership is
  exact.

### FR-5 Bounded Shared Brain

The shared brain is a bounded shared brain, not raw log mirroring.

Requirements:

- Raw PTY logs remain evidence/replay material.
- Shared brain records are compact typed records: activity, ownership, decision,
  validation, blocker, merge intent, and proof summary.
- Large command output is summarized with evidence refs.
- Prompt context is capped by relevance, active ownership, latest blockers,
  latest decisions, and requested evidence refs.
- If summarization fails, raw evidence remains durable and the brain marks the
  snapshot stale instead of blocking the run.

### FR-6 Proofbook Product Surface

Scape-plus means Proofbooks become a real product surface only after backend
contracts lead the UI.

Requirements:

- Proofbook canvas + run timeline + proof inspector renders Rust runner state.
- The UI cannot synthesize executable mock flows.
- Each run exposes append-only ledger events, artifact refs, hashes, gate
  decisions, residual blockers, and completion proof.
- `mcpTool`, `agentSession`, `fanOut`, `subProofbook`, `distill`, and Evidence
  Store work must land as separate PB phases with design gates.
- Unsupported future behavior fails closed with explicit typed errors.

### FR-7 Proofbook Fan-Out And Settlement

Future PB-5 fan-out must be ownership-aware.

Requirements:

- fanOut branches run under a concurrency cap.
- Branches declare write lanes before execution.
- Overlapping write lanes serialize or fail preflight unless symbol/function
  ownership proves disjoint ranges.
- Settlement classifies partial failures as implementation failure, policy
  block, external/operator block, or cancellation.
- SubProofbook child runs keep their own ledgers and parent lineage.

### FR-8 Distillation

Future PB-6 distillation turns a successful exploratory run into a deterministic
Proofbook proposal.

Requirements:

- Distill emits a patch proposal and risk summary.
- Distill never mutates source Proofbooks automatically.
- It cannot remove verifiers, gates, redaction, evidence refs, reviewer
  separation, or visible-agent requirements without an explicit failure.
- It cannot inline secrets or token-bearing transcripts.
- It cannot silently convert visible implementation work into headless mode.

### FR-9 Merge-Ready Lane

The differentiator ends at merge.

Requirements:

- Reviewer and implementer are different actors or agents.
- Approval binds to an exact commit/object id.
- Mechanical gates run before merge.
- Ownership conflicts and Proofbook blockers are resolved or explicitly carried
  as residual blockers.
- Merge readiness is visible in the same cockpit, MCP surface, and Proofbook
  proof lane.

### FR-10 Claim Verification

Every differentiating claim needs a verifier.

Requirements:

- The spec/index/package contract is checked by
  `pnpm verify:differentiation-polish-spec`.
- Runtime implementation phases add focused gates before the claim can be
  promoted.
- The generated artifact is
  `.codex-auto/quality/differentiation-polish-spec.json`.
- Public copy must still state alpha / not release-ready while
  `releaseCandidateReady=false`.


### FR-11 Remote Continuity And SSH Attach

Remote Continuity makes Aelyris stronger than a local-only terminal workspace.
The target is remote tab/pane state sync, remote fleet/proof visibility, and SSH
attach as a power-user transport over daemon-owned state.

Requirements:

- Remote clients read the same tab, pane, agent, approval, Proofbook, ownership,
  and merge readiness state as the local cockpit.
- The first remote slice is a read-only remote fleet monitor over loopback or a
  private network such as Tailscale.
- Remote approve/deny uses fingerprint-checked approval and cannot bypass stale
  prompt protection.
- SSH attach is supported as a client/transport path, not as the state owner.
- SSH/TUI observe mode is read-only until attach leases, scoped principals,
  command-risk policy, and audit are proven.
- Remote input, fleet steering, and broadcast require explicit scoped leases and
  governance.
- Remote Continuity remains not release-ready and not shipped until live gates
  prove snapshot parity, SSH read-only attach, stale approval rejection, lease
  expiry, secret scanning, and restart/reconnect behavior.

Owning specs:

- `AELYRIS_REMOTE_CONTINUITY_SPEC.md`
- `AELYRIS_REMOTE_CONTINUITY_DESIGN.md`
- `AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md`
## 5. Product Experience Requirements

The first screen for serious work is not a landing page. It is the workspace.

Required surfaces:

- Center: active terminal pane tree with real visible agent panes.
- Left/project: files, Proofbooks, workflows, worktrees, and run history.
- Right/control: approvals, blockers, merge readiness, run timeline, and proof
  inspector.
- Overlay/header: current task, command/tool, touched symbol/function, conflict
  confidence, backend durability tier.

The UX must make the safe path the shortest path:

- start a goal,
- decompose into work units,
- spawn visible panes,
- watch live activity and ownership,
- run tests/verifiers,
- collect Proofbook evidence,
- review/merge through commit-bound gates.

## 6. Technical-Debt Controls

Each future implementation phase must satisfy these controls:

- One owner per state. UI can project backend state, not own a second truth.
- No duplicate runner.
- No second dispatcher.
- No second MCP catalog.
- No second ownership model.
- No frontend-only executable schema.
- No unverified `as` casts for new public contracts.
- No fake-success ledger states.
- No TODO placeholders in shipped paths.
- `src/App.tsx` must not grow; add focused modules/hooks instead.
- Large Rust files such as `src-tauri/src/api/mcp.rs`,
  `src-tauri/src/ipc/commands.rs`, and `src-tauri/src/bin/aelyris_native.rs`
  must not absorb new product logic without an extraction plan.
- Each phase updates requirement/spec/design/verifier together.
- The claim boundary remains alpha / not release-ready until green gates exist.

## 7. Phase Map

These phases define the recommended implementation order. They are not all in
scope for one PR.

| Phase | Name | Claim unlocked only when green |
| --- | --- | --- |
| D0 | Spec/verifier gate | The differentiation design is indexed and machine-checked. |
| D1 | Center-pane Agent Fleet | Orchestra/planner agents mount in the center terminal pane tree. |
| D2 | Durable Visible Runtime | Agent panes have sidecar/daemon attach/recover proof. |
| D2R | Remote Continuity + SSH Attach | Remote clients sync tabs, panes, fleet, approvals, Proofbooks, and proof state; SSH/TUI attach is read-only until scoped leases and governance are proven. |
| D3 | Live Activity + Symbol Ownership | Scheduler/UI/MCP consume live symbol/function ownership. |
| D4 | Bounded Shared Brain | Agents receive compact state and evidence refs, not raw log flood. |
| D5 | Proofbook Canvas/Timeline/Proof Inspector | UI renders backend ledger truth without mock execution. |
| D6 | PB-5/PB-6/PB-7 Automation Depth | fanOut/subProofbook/distill/Evidence Store land as gated slices. |
| D7 | Governed Merge-Ready Lane | Proofbook and ownership evidence feed commit-bound merge intent. |
| D8 | Differentiation Claim Gate | Public claims are promoted only after fresh aggregate proof. |

## 8. Stop Conditions

Stop before implementation if a phase would:

- add `-p` / `--print` to a visible pane path,
- bypass MCP schema validation or governance,
- persist raw secrets, token-bearing transcripts, signing material, or private
  keys,
- mark a Proofbook step passed from frontend-only state,
- infer agent completion from first-file-exists,
- claim parallel-safe without ownership/conflict proof,
- claim tmux-level persistence without attach/recover proof,
- add substantial logic to god files without extraction,
- create a mock UI that can run actions before backend contracts exist.