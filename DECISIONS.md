# Aelyris Decisions

Status: active decision log. Add entries when a repeated design question should
not be re-litigated by future agents.

## Decision Rule

A decision entry records why, not just what. If the reason changes, update the
entry and the owning spec/verifier in the same work unit.

## Promotion Rule (Memory To Decisions)

Session memory, local-only handoff files, and chat context are not authority.
When a judgment from those sources is reused twice, or would change how a
future agent decides, promote it into an ADR entry here (or into the owning
spec) in the same work unit. Promotion is one-way: tracked docs never copy
from local-only files without re-verifying against current source and
verifier truth.

## ADR-001 Tauri + Rust Backend

Decision: Use Tauri v2 with a Rust backend and React frontend.

Why:

- Windows-native terminal/runtime integration matters.
- Rust can own PTY, sidecar, persistence, governance, and native process safety.
- React is used for cockpit projection and workflow UI.

Implication: Runtime truth belongs in Rust; React projects it.

## ADR-002 Visible PTY For Human-Visible Agents

Decision: Human-visible implementation agents run in visible PTY panes with
interactive TUI. Do not use `-p` / `--print` for GUI-visible panes.

Why:

- Operators need to see and steer real sessions.
- Hidden stdout drains are not debuggable enough for supervised work.
- Pane truth must match what the agent sees.

Implication: Headless `-p` remains for planner/reviewer/batch/no-webview flows
only.

## ADR-003 Worktree Isolation

Decision: Parallel agent work should use isolated git worktrees and branches.

Why:

- Prevents agents from overwriting one working tree.
- Makes review, proof, and merge intent easier to bind to exact commits.
- Keeps rollback and cleanup tractable.

Implication: A task that edits the project should declare its worktree/branch
lane or explain why it is not needed.

## ADR-004 Contracts Before UI

Decision: Backend contracts and verifiers precede product UI claims.

Why:

- UI-only flows create false confidence.
- Proofbooks, Remote Continuity, MCP, and merge readiness need durable state and
  typed errors before visual polish.

Implication: UI can render Rust runner/state projections, but cannot synthesize
executable mock flows.

## ADR-005 Proofbooks Over Generic Playbooks

Decision: Proofbooks are evidence-backed automation routines, not generic prompt
chains.

Why:

- Aelyris differentiates through proof: artifacts, hashes, verifier output,
  gates, residual blockers, and merge readiness.
- Generic automation without evidence does not solve trust.

Implication: The Proofbook runner/ledger is rigid. Unsupported future step types
fail closed.

## ADR-006 MCP Is An Adapter, Not A Second Runtime

Decision: MCP exposes the same capability layer through typed tools,
inputSchema validation, governance, and audit.

Why:

- Cockpit and AI control plane must not drift.
- A second dispatcher or catalog would create inconsistent authority.

Implication: New MCP verbs delegate to existing domain owners.

## ADR-007 Remote Continuity Uses Daemon-Owned State

Decision: Remote Continuity syncs daemon-owned state. SSH attach is a transport,
not the state owner.

Why:

- tmux-style SSH access is valuable, but Aelyris's advantage is whole-fleet
  state: panes, agents, Proofbooks, approvals, ownership, and merge readiness.
- Letting SSH own state would bypass governance and fragment truth.

Implication: Remote monitor ships read-only first; SSH/TUI observe mode uses
leases; remote input waits for scoped principal, command-risk, and audit proof.

## ADR-008 No Premature Abstraction

Decision: Duplication is acceptable until a real pattern appears. Abstract only
when it removes meaningful complexity or matches an established local pattern.

Why:

- Early abstraction hides domain boundaries.
- AI agents often over-generalize from one or two call sites.

Implication: Prefer small explicit modules. Extract after the third repeated
shape or when the owner boundary is already clear.

## ADR-009 Verifier-Backed Claims

Decision: Product and capability claims require matching verifier evidence.

Why:

- Aelyris has historical stale green snapshots.
- Current machine truth must outrank old prose.

Implication: Release/capability copy does not change unless the relevant gate is
green and current.

## ADR-010 One Keyboard Binding Owner Per Surface

Decision: Remove the unreferenced `src-tauri/src/config/keybindings.rs` TOML
binding layer and the unused `Sidebar` section state. Global cockpit shortcuts
are defined by `src/shared/lib/shortcutRegistry.ts`; terminal prefix commands
remain owned by the Rust mux keymap.

Why:

- The Rust TOML layer had no runtime consumer and its `Ctrl+Shift+H/V` split
  defaults did not fire.
- The old Sidebar component and `sidebarSection` store field had no consumer,
  so retaining them created capability-shaped dead code.
- Separate frontend, Rust-config, and mux binding tables can advertise or
  handle different shortcuts. One owner per surface keeps execution and help
  copy aligned.

Implication: Shortcut help and palette hints must be generated from the shared
registry, and pane splits are documented as the mux prefix sequence (`Ctrl+B`
then `%` or `"`). A future user-configurable shortcut system needs a new
design decision and must not be reintroduced as a second owner.

## ADR-011 Mission Is The Top-Level Work Contract

Decision: Position the target product as a **Verifiable Agent Work OS** and make a
backend-owned, versioned `Mission` the top-level contract that composes TaskGraph,
runtime, ownership, capability, Chronicle, Proofbook, review, merge, and governed
learning. Every Mission exposes canonical Now, Next, and Unlocks projections.

Why:

- terminal panes, agent grids, worktrees, Kanban, and shared memory are becoming
  common substrate and do not by themselves explain why work is complete;
- Aelyris already has strong separate runtime, ownership, Proofbook, review, and
  merge spines, but needs one outcome and causal contract across them;
- agent self-report and frontend heuristics cannot provide restart-safe,
  auditable, evidence-backed completion;
- a Mission gives every action a reason, owner, capability boundary, required
  proof, exact next step, and user-visible completion outcome.

Implication: Evolve existing owners; do not add a second TaskGraph, lifecycle
journal, dispatcher, Proofbook runner, or frontend progress owner. A7 proves one
finite Core Mission Loop, work-unit `CompletedWorkPacket`, and aggregate
`MissionCompletionPacket`. All transport faces delegate through one canonical
Control Command registry/kernel; adapter-local `FREE/GATED`, caller actor/reviewer,
or bearer possession cannot grant authority. Full replay,
reversible recovery, governed Skill Foundry, Decision Lab, Counterfactual Arena,
Project Twin, writable remote control, marketplace, and A2A federation remain
separately gated Apex work. This target category is not a shipped or release-ready
claim.

## ADR-012 Structured Runtimes Are Replaceable Adapters

Decision: Evaluate OpenCode as the first named structured-runtime candidate in
the post-A9 Apex V1 program. Compare OpenCode ACP, OpenCode HTTP/SSE, and the
current visible PTY under one fixed Aelyris Mission. Promote at most one
structured path from executed evidence; do not make OpenCode a core owner or
mandatory dependency by design.

Why:

- structured session, tool, diff, permission, usage, and disconnect events may
  reduce brittle terminal-text inference;
- OpenCode exposes both an ACP subprocess and a programmatic server, making it a
  useful falsifiable candidate rather than a reason to invent a proprietary
  protocol first;
- Aelyris becomes differentiated when Mission identity, scoped authority,
  evidence, restart continuity, review, and exact merge truth survive runtime
  replacement;
- merely adding OpenCode features or another TUI is integration breadth, not a
  strategic moat.

Implication: `V1-R0` is a comparison and safety gate, not production
implementation. It cannot change the active A4/A6/A7/A8/A9 order, satisfy a
release criterion, introduce a second session graph/journal/permission or
completion owner, or weaken visible PTY fallback. A production adapter is
conditional Apex V1 work. An Aelyris Runtime TUI remains a separate value
hypothesis after the adapter and daemon-owned projection are proven.

## ADR-013 External Team Patterns Extend Existing Owners

Decision: Treat external agent-team, messaging, runtime-TUI, and automation
documents as discovery input for the existing Verifiable Agent Work OS contracts.
Adopt compatible semantics only through the current owners: team policy through
`MissionDefinitionRevision` and `WorkUnitDefinition`, capability-scoped discovery
through the Control Kernel, completion through `CompletedWorkPacket` and
`MissionCompletionPacket`, coordination through Qralis, and distillation through
Proofbook PB-6.

Why:

- a role constitution, integrated-OID completion barrier, typed coordination, and
  proof-preserving distillation strengthen the current Goal without changing its
  owner model;
- importing a second operation journal, scheduler, completion table, Decision
  store, or generic message truth would split authority and make restart and
  completion claims less trustworthy;
- external product descriptions are useful hypotheses, but their claims do not
  prove behavior in Aelyris or in a pinned local dependency;
- A4.10-A4.12 are active runtime-integrity work and must not be displaced by later
  product design.

Implication: A7.0 freezes a minimal team policy without a fixed agent count; A7.2
adds capability-scoped tool discovery; A7.4 applies an integrated-OID completion
barrier inside the existing packet settlement. A Result Capsule is only a
coordination projection referencing a `CompletedWorkPacket` or
`BlockedWorkPacket`, never completion authority. Post-A9 V1 may add structured
state and quarantined external-run adoption, with a Runtime TUI only after
`promote_one` and daemon-owned projection proof. V3 adds typed team operations and
obligation-driven dispatch. V4 evaluates proof-preserving PB-6 distillation as an
Aelyris design hypothesis with differential replay, canary, rollback, stale
invalidation, and capability non-broadening. No parallel `MissionOperation`,
`OperationJournal`, `CompletionBarrier`, scheduler, Proofbook, assurance score, or
Decision owner is authorized.

## ADR-014 Full-Native Rust Product Surface

Status: **proposed / queued**. This entry reserves the canonical decision ID and
does not yet supersede ADR-001 or `TERMINAL_CORE_DESIGN.md §3`.

Proposal: migrate the primary operator surface from Tauri/React/WebView2 to a
Rust-native Windows surface through the reversible NUI-F0-F7 plan. Reuse the
canonical Control/Mission/runtime owners, winit, wgpu, windows-rs, DirectWrite,
Taffy, and AccessKit; keep Tauri as the rollback/compatibility face until an N4
aggregate proves a WebView-free distribution.

Why tracked now:

- the repository already has substantial native proof and renderer-neutral
  terminal/input contracts;
- the supplied design package defines requirements, architecture, framework,
  editor, migration, verification, and traceability as one falsifiable program;
- making it a numbered proposal prevents the high-priority direction from being
  lost without presenting it as current architecture.

Decision gate: A8.0 evaluates the product Goal, Windows support boundary,
current hybrid baseline, mature Rust framework alternatives, custom-framework
ownership cost, rollback, and release timing. Default execution is priority 1
after A9. A pre-A9 takeover requires explicit owner approval and a versioned
rebaseline of the active program. A8.0 records one total result here:
accepted-as-written, accepted-with-amendments, deferred, or rejected. Both
accepted results enter the same activation branch. NUI-0.1 may only ratify that
already accepted decision for implementation activation; it is not a second
architecture decision gate.

Implication: current `audit-remediation/A4.10 -> A4.12 -> A6.2e1` routing,
measured A8 terminal decision, Tauri/React architecture, and alpha claim remain
unchanged. The detailed queued draft and source-package integration record live
under `docs/plans/full-native-rust-migration/`.
