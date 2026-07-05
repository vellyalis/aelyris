# Aelyris Differentiation Detailed Design

Status: detailed design for future implementation. Not release-ready.
Parent spec: `AELYRIS_DIFFERENTIATION_POLISH_SPEC.md`.
Last reviewed: 2026-07-05 JST.

This design describes how to polish Aelyris toward BridgeSpace-plus and
Scape-plus without creating technical debt. It is intentionally split into
small design gates and implementation slices. A phase that skips its verifier
or creates a parallel owner is incomplete even if the UI appears to work.

## 0. Source-Of-Truth Order

1. `AGENTS.md` and `docs/requirements.md` for claim policy.
2. `docs/specs/README.md` for active spec routing.
3. `AELYRIS_DIFFERENTIATION_POLISH_SPEC.md` for functional requirements.
4. `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` for visible agent runtime rules.
5. `PROOFBOOK_AUTOMATION_SPEC.md` for Proofbook runtime, ledger, and roadmap.
6. `AELYRIS_REMOTE_CONTINUITY_SPEC.md` for remote state sync and SSH attach requirements.
7. `AELYRIS_REMOTE_CONTINUITY_DESIGN.md` for remote architecture.
8. `AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md` for remote contracts and work units.
9. Existing backend modules and verifiers for current machine truth.

If this document conflicts with the visible agent or Proofbook specs, update
both specs and the verifier in the same phase before implementation.

## 1. Architecture Constraint

Do not make a new platform beside Aelyris. The differentiating product is a
composition of existing spines:

- Terminal/mux spine: native PTY, pane tree, sidecar/daemon durability.
- Agent runtime spine: visible interactive agents and allowed headless modes.
- Coordination spine: task graph, event bus, activity, ownership, symbol claims.
- Proof spine: Proofbook runner, append-only ledger, artifact refs, verifiers.
- Governance spine: MCP `tools/call`, inputSchema validation, command risk,
  manual gates, audit.
- Merge spine: durable merge intent, reviewer separation, commit-bound approval.
- Remote continuity spine: daemon-owned snapshot/events, scoped principals, attach leases, read-only monitor, and SSH attach adapters.

Adapters may expose these spines to UI or MCP. Adapters must not own domain
state.

## 2. Shared Data Contracts

These records should be defined in backend-owned contracts first, then projected
to TypeScript.

### 2.1 AgentActivityRecord

```ts
interface AgentActivityRecord {
  agentId: string;
  taskId?: string;
  paneId?: string;
  terminalId?: string;
  runId?: string;
  proofbookStepId?: string;
  phase:
    | "planning"
    | "reading"
    | "editing"
    | "testing"
    | "reviewing"
    | "blocked"
    | "idle"
    | "done";
  summary: string;
  currentCommand?: string;
  currentTool?: string;
  files: AgentFileTouch[];
  symbols: AgentSymbolTouch[];
  evidenceRefs: EvidenceRef[];
  sequence: number;
  updatedAt: string;
}
```

### 2.2 SymbolOwnershipClaim

```ts
interface SymbolOwnershipClaim {
  claimId: string;
  agentId: string;
  taskId?: string;
  path: string;
  symbol: string;
  kind: "function" | "method" | "class" | "component" | "module" | "unknown";
  range: { startLine: number; endLine: number };
  mode: "write" | "review" | "test";
  confidence: "lsp" | "parser" | "diff-hunk" | "inferred";
  leaseExpiresAt: string;
  evidenceRefs: EvidenceRef[];
}
```

### 2.3 BrainSnapshotRecord

```ts
interface BrainSnapshotRecord {
  snapshotId: string;
  scope: "workspace" | "task" | "agent" | "symbol" | "proofbookRun";
  key: string;
  summary: string;
  activeClaims: SymbolOwnershipClaim[];
  decisions: DecisionRecord[];
  blockers: BlockerRecord[];
  validations: ValidationRecord[];
  evidenceRefs: EvidenceRef[];
  stale: boolean;
  updatedAt: string;
}
```

### 2.4 ProofbookRunProjection

This is a read model over the Rust Proofbook ledger. It must never be an
executable schema.

```ts
interface ProofbookRunProjection {
  runId: string;
  proofbookId: string;
  status: string;
  currentSteps: ProofbookStepProjection[];
  timeline: ProofbookTimelineEvent[];
  artifacts: EvidenceRef[];
  waitingGates: WaitingGateProjection[];
  residualBlockers: BlockerRecord[];
  mergeReadiness?: MergeReadinessSummary;
}
```

### 2.5 EvidenceRef

```ts
interface EvidenceRef {
  kind: "event" | "log" | "diff" | "command" | "file" | "verifier" | "ledger";
  id: string;
  path?: string;
  sha256?: string;
  range?: { startLine: number; endLine: number };
}
```

## 3. D0 - Spec And Verifier Gate

Scope:

- `docs/specs/AELYRIS_DIFFERENTIATION_POLISH_SPEC.md`
- `docs/specs/AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md`
- `docs/specs/README.md`
- `scripts/verify-differentiation-polish-spec.mjs`
- `package.json`

Verifier:

- `pnpm verify:differentiation-polish-spec`
- artifact: `.codex-auto/quality/differentiation-polish-spec.json`

Acceptance:

- Both docs exist and are indexed.
- The docs contain BridgeSpace-plus, Scape-plus, center terminal pane tree,
  1 agent = 1 visible PTY pane, no `-p` / `--print`, bounded shared brain,
  evidence refs, symbol/function ownership, Proofbook canvas + run timeline +
  proof inspector, append-only ledger, no duplicate runner, no second
  dispatcher, claim boundary, not release-ready, and
  `releaseCandidateReady=false`.
- The detailed design names D0 through D8.

No runtime code is allowed in D0.

## 4. D1 - Center-Pane Agent Fleet

Objective:

Make the multi-agent default experience center-terminal-first.

Owner modules:

- Frontend mount adapter under `src/features/terminal/pane-tree/`.
- Existing `paneAgentSpawns` bridge in `src/App.tsx` should delegate out, not
  grow.
- Existing interactive agent hook and Orchestra dispatch helper may call the
  new mount adapter.

Implementation shape:

1. Extract one shared `mountAgentPtyInPane` adapter that accepts PTY id, model,
   role, source, worktree branch, backend, and durability tier.
2. Use it from loop-dispatched `agent_spawned`, Orchestra dispatch, and manual
   "mount in pane."
3. Store mounted-session state in the pane tree/persistence owner.
4. Keep right rail cards as controls and status, not execution owners.

Tests and gates:

- Frontend unit test: dispatching three successful roles enqueues three pane
  mounts.
- Static no-duplicate-mount test.
- Existing `pnpm verify:visible-agent-pane-binding`.
- Future live gate: `scripts/verify-orchestra-center-panes.mjs`.

Debt controls:

- `src/App.tsx` must not grow. Move glue into a hook or feature module.
- Do not introduce a second representation of mounted agent sessions.
- Do not duplicate pane split/bind logic.

## 5. D2 - Durable Visible Runtime

Objective:

Move loop/Orchestra visible agent panes toward sidecar/daemon-owned PTY so
tmux-level durability can eventually be claimed.

Owner modules:

- Existing sidecar/native PTY owner modules.
- Pane tree persistence.
- Visible agent runtime boundary spec.

Implementation shape:

1. Introduce a `VisiblePtyRuntime` adapter over sidecar first, native fallback
   second.
2. Route visible implementation agent spawn through that adapter.
3. Persist backend and durability on every mounted pane.
4. `list_terminals` must include sidecar-owned loop agent panes.
5. Recovery must reattach matching sidecar PTYs; degraded missing native panes
   become ended/error placeholders.

Tests and gates:

- Rust adapter tests for sidecar/native selection.
- Frontend recovery test for missing degraded PTY.
- Live attach/recover gate before any tmux-level claim.
- Existing mux durability and visible-agent binding gates.

Debt controls:

- In-process fallback remains explicit and user-visible.
- No silent shell respawn on restore.
- Do not claim durable if the backend is native/degraded.


## 5.5 D2R - Remote Continuity And SSH Attach

Objective:

Let operators connect from outside the desktop and sync tab, pane, fleet,
approval, Proofbook, ownership, and merge-readiness state. SSH attach is a
power-user transport over daemon-owned state, not a second terminal backend.

Owner docs:

- `AELYRIS_REMOTE_CONTINUITY_SPEC.md`
- `AELYRIS_REMOTE_CONTINUITY_DESIGN.md`
- `AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md`

Owner modules when implemented:

- daemon/API projection module for remote snapshots and events,
- governance principal resolver and scoped token/SSH key mapping,
- `aelys` CLI for SSH/TUI attach,
- existing pane tree, sidecar, approval, Proofbook, ownership, and merge owners.

Implementation shape:

1. Build a read-only `RemoteWorkspaceSnapshot` from existing state owners.
2. Add cursor-based remote event sync with coalescing and evidence refs.
3. Add scoped principals: `remote.read`, `pane.read`, `approval.resolve`,
   `pane.input`, `fleet.steer`, `proofbook.read`, and `merge.read`.
4. Ship read-only remote fleet monitor over loopback/private network first.
5. Route remote approval through the stale-safe expectedPromptKey backend path.
6. Add SSH/TUI observe mode through `aelys attach`, using daemon leases.
7. Add governed remote input only after mutable attach leases and command-risk
   policy are proven.

Tests and gates:

- snapshot parity between local cockpit state and remote projection,
- stale remote approval rejection,
- SSH read-only attach proof,
- attach lease expiry proof,
- no-secret remote payload scan,
- restart/reconnect proof,
- future `pnpm verify:remote-continuity:*` gates.

Debt controls:

- SSH must not own workspace state.
- Remote UI must not duplicate pane tree, Proofbook, ownership, or merge state.
- Remote input must not bypass command-risk policy.
- Remote approval must not bypass prompt fingerprint checks.
- No public-internet default exposure.
- `src/App.tsx` must not grow.
## 6. D3 - Live Activity And Symbol Ownership

Objective:

Make collision avoidance a live product feature.

Owner modules:

- Existing ownership persistence modules.
- Symbol extraction / knowledge graph modules.
- Event bus/activity adapter.
- MCP ownership/activity verbs.

Implementation shape:

1. Normalize activity events from agent runtime, file watcher, command blocks,
   and Proofbook steps.
2. Map touched files to touched symbols/functions through LSP, parser, diff
   hunk, or inferred fallback.
3. Write/refresh `SymbolOwnershipClaim` with leases.
4. Scheduler blocks or serializes overlapping write claims.
5. UI shows confidence and conflict reason.
6. MCP shared snapshot includes activity and symbol/function ownership.

Tests and gates:

- Conflict tests for overlapping ranges.
- Parallel-safe tests for disjoint ranges in the same file.
- Lease expiry tests.
- MCP snapshot schema test.
- Existing shared-brain ownership persistence gate extended with symbol detail.

Debt controls:

- Do not use file-level locks as the only product feature.
- Do not hard-block on inferred ranges unless policy marks the file exclusive.
- Do not store ownership in frontend-only state.

## 7. D4 - Bounded Shared Brain

Objective:

Replace noisy state sharing with compact, queryable records.

Owner modules:

- Context store / decision records.
- Event bus and audit trail.
- Brain snapshot projection module.
- Proofbook ledger evidence refs.

Implementation shape:

1. Keep raw PTY/event streams as evidence with retention pointers.
2. Normalize events into activity, claims, decisions, blockers, validations,
   and merge/proof records.
3. Maintain rolling current state per agent/task/symbol/file.
4. Compact long output into summaries with evidence refs.
5. Prompt agents with bounded relevant context only.
6. Mark stale snapshots when compaction fails.

Tests and gates:

- Backpressure test: high-volume log creates bounded brain records.
- Prompt cap test.
- Evidence ref preservation test.
- Restart replay test for brain snapshots.

Debt controls:

- No raw log flood in prompts.
- No lossy summary without evidence refs.
- No second decision store.

## 8. D5 - Proofbook Canvas, Run Timeline, Proof Inspector

Objective:

Turn Proofbooks into a usable Scape-plus surface without bypassing the Rust
runner.

Owner modules:

- `src-tauri/src/proofbook` remains runner/ledger owner.
- `src/features/proofbook/` renders projection state only.
- MCP Proofbook verbs remain adapter calls through existing governance.

Implementation shape:

1. Define a read-only `ProofbookRunProjection` from existing ledger state.
2. UI list/canvas renders definition, DAG, current run, waiting gate, residual
   blockers, artifacts, and proof completeness.
3. Proof inspector links stdout/stderr artifact refs, verifier artifacts, MCP
   call outputs, agent session settlement proof, and hashes.
4. Run/update actions call existing governed IPC/MCP paths.
5. Empty UI states clearly distinguish unsupported future step types.

Tests and gates:

- UI tests render Rust runner fixture state.
- Tests prove UI cannot mark a step passed without runner state.
- Proofbook runner/spec verifiers remain green.

Debt controls:

- No executable mock flows.
- No duplicate Proofbook parser in TypeScript.
- No local UI-only ledger mutations.

## 9. D6 - Proofbook Automation Depth

Objective:

Land PB-5/PB-6/PB-7 as separate, debt-zero slices.

PB-5 fanOut/subProofbook/settlement:

- Branches declare write lanes.
- Ownership preflight rejects or serializes overlap.
- Child runs have parent lineage and max depth.
- Settlement classifies partial failure.

PB-6 distill:

- Converts successful exploratory runs into patch proposals.
- Preserves verifiers, gates, evidence, redaction, and visible mode.
- Never mutates source Proofbooks automatically.

PB-7 Evidence Store:

- Projection over ledgers, not replacement for ledgers.
- Natural-key upsert for query/read models.
- Artifact hashes and redaction status preserved.

Tests and gates:

- `pnpm verify:proofbook:spec`
- phase-specific runner/evidence-store verifier
- focused Rust proofbook tests

Debt controls:

- Each PB phase gets its own design gate before code.
- Unsupported future types fail closed.
- No all-in-one automation rewrite.

## 10. D7 - Governed Merge-Ready Lane

Objective:

Connect visible work, ownership, Proofbook proof, and commit-bound merge.

Owner modules:

- Durable merge intent repository.
- Review/approval backend.
- Proofbook ledger projection.
- Ownership conflict checks.

Implementation shape:

1. Build `MergeReadinessSummary` from commit id, reviewer identity, gate
   results, active conflicts, Proofbook residual blockers, and required proof.
2. Require reviewer != owner for guarded merge.
3. Bind approval to exact object id.
4. Reject merge if branch tip moves after approval.
5. Surface merge readiness in UI, MCP snapshot, and Proofbook inspector.

Tests and gates:

- Old-OID compare-and-swap tests.
- Reviewer separation tests.
- Proofbook blocker prevents ready status.
- MCP/IPC snapshot consistency tests.

Debt controls:

- Do not make Proofbook success auto-merge.
- Do not make UI approval bypass backend merge intent.
- Do not duplicate merge status in frontend state.

## 11. D8 - Differentiation Claim Gate

Objective:

Promote product copy only after evidence supports it.

Gate inputs:

- quality score and release readiness artifacts,
- visible agent center-pane live proof,
- sidecar attach/recover proof,
- symbol/function ownership proof,
- bounded shared brain/restart proof,
- Proofbook canvas/timeline/inspector proof,
- fanOut/subProofbook/distill/Evidence Store phase proof,
- governed merge-ready lane proof.

Acceptance:

- Public docs still say alpha until release gates change.
- Claim text names only green capabilities.
- Stale green artifacts are demoted by current readiness source.
- `releaseCandidateReady=false` blocks release-ready copy.

Debt controls:

- No "world-class" or "above X" public claim without named green gates.
- No score promotion from design docs.
- No copy update without matching verifier artifact.

## 12. Implementation Packet Template

Use one packet per phase.

```text
/goal C:\Users\owner\Aether_Terminal で Aelyris differentiation polish <D#> を進める。
まず AGENTS.md -> docs/requirements.md -> docs/specs/README.md ->
docs/specs/AELYRIS_DIFFERENTIATION_POLISH_SPEC.md ->
docs/specs/AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md と、D# が参照する
owning spec だけを読む。対象ファイルは D# の owner modules に限定する。
visible agent は no `-p` / `--print`、Proofbook は既存 runner/ledger spine、
MCP は既存 tools/call/schema/governance path、UI は backend truth の投影に限定。
src/App.tsx を増やさず、重いロジックは feature module に抽出する。
focused verifier を追加/更新し、pnpm verify:differentiation-polish-spec と
D# の focused gate を通す。release-ready claim はしない。
```