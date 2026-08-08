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

Status: **adapter principle retained / OpenCode-first candidate selection superseded
by ADR-017** (owner direction 2026-08-08).

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
- the active A4 runtime-integrity sequence through A4.12 must not be displaced by
  later product design; the exact current slice is owned by the root work order.

Implication: A7.0 locks one canonical Core Mission; A7.1-A7.3 cover plan preview,
visible implementation, fresh tests, independent review, and exact-OID acceptance;
A7.4 applies the completion barrier inside existing packet settlement. A Result
Capsule is only a coordination projection referencing a `CompletedWorkPacket` or
`BlockedWorkPacket`, never completion authority. Post-A9 V1 may add structured
state and quarantined external-run adoption, with a Runtime TUI only after
`promote_one` and daemon-owned projection proof. V3 adds typed team operations and
obligation-driven dispatch. V4 evaluates proof-preserving PB-6 distillation as an
Aelyris design hypothesis with differential replay, canary, rollback, stale
invalidation, and capability non-broadening. No parallel `MissionOperation`,
`OperationJournal`, `CompletionBarrier`, scheduler, Proofbook, assurance score, or
Decision owner is authorized.

## ADR-014 Full-Native Rust Product Surface

Status: **accepted with amendments / queued for post-A9 activation**
(owner decision 2026-08-02). This strategic decision does not itself activate
NUI-F0-F7 or replace the current Tauri/React implementation.

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

A8.0 outcome: accept N4 WebView-free distribution as the post-A9 strategic
product target with these amendments:

- preserve the measured A8 then A9 execution order; acceptance authorizes no
  pre-A9 takeover and grants no current capability or release claim;
- keep the current Tauri/React face as implementation Current Best and rollback
  compatibility path until the NUI program is activated and its promotion gates
  transfer ownership;
- do not preselect a custom retained runtime. NUI-F0 must compare Slint and the
  Aelyris retained-runtime candidate with one same-vertical prototype and select
  at most one framework from observed ownership cost, Windows integration,
  accessibility, IME/focus, recovery, performance, and rollback evidence;
- treat Windows 11 x64 as the primary target and measure Windows 10
  compatibility separately instead of assuming one identical setting.

The fresh A8.0 inputs were native coverage v2 `88/120` with
`shippingShellReady=false`, native input `17/17` PASS, native boundary `10/14`
with four durability/client/AI-boundary artifacts missing, and renderer
measurements that were not sufficient to promote a framework. These facts
support the direction while refuting immediate activation and framework
preselection.

NUI-0.1 may ratify this already accepted decision for implementation activation
after A9; it is not a second strategic architecture decision gate. ADR-001 and
`TERMINAL_CORE_DESIGN.md §3` remain the current implementation placement until
that activation and later promotion gates. The detailed accepted package and
source-package integration record live under
`docs/plans/full-native-rust-migration/`.

## ADR-015 Product Delivery Before Surface Migration

Status: **accepted** (owner direction 2026-08-03).

Decision:

- current required CI at the current `HEAD` is authoritative and reopens the
  responsible repo lane even when an earlier exact-SHA closeout reported zero
  executable defects;
- an A9 lane containing only signing, real sleep, authenticated operator prompts, or
  external-service evidence continues to block release readiness but does not hold the
  exclusive repository mutation lock;
- after the current required-CI repair, the next repo-mutating product program is the
  general Mission vertical in `product-delivery-instructions.md`, connecting the
  existing request, worktree, visible PTY, ownership, test, review, merge, and
  settlement owners into one supported user path;
- ADR-014 remains the accepted strategic native direction, but NUI activation now has
  a product-delivery prerequisite and a measured necessity gate. It may start only
  after the general Mission path is Product-Accessible and current evidence shows that
  the existing surface blocks at least two named core user journeys, or one
  release-blocking defect has no simpler local repair.

Reason:

The repository already contains substantial Mission and Proofbook Internal Capability,
while the general user-facing brief-to-proof path remains disconnected. Continuing
certification prose, verifier expansion, or shell migration before connecting those
owners would increase substrate cost without resolving the current product bottleneck.

Implication:

Capability completion is reported as `Internal Capability`, `Product-Accessible`, or
`Claim-Eligible`. Product work is not complete because backend code or a focused fixture
passes. Certification and product delivery have separate lanes, while only one lane may
mutate repository files at a time. ADR-014 is not rejected; its activation order and
entry evidence are amended by this decision.

Reconsider when:

- the general Mission vertical is Product-Accessible and its measured operation exposes
  current-surface limits;
- WebView2/Tauri causes a current release-blocking defect without a simpler repair;
- two named core journeys fail defined latency, reliability, IME, accessibility, or
  recovery budgets because of the current surface.

## ADR-016 Path-Aware Fast Feedback And Deferred Full Confidence

Status: **accepted** (owner direction 2026-08-04).

Decision:

- normal product Work Units use changed/related frontend tests, typecheck, and the
  directly touched owner gate as their local completion surface;
- push/PR CI is path-aware and requires only the selected frontend, UI-smoke, Rust,
  dependency-risk, and policy lanes;
- complete frontend/rendered-UI/Rust confidence runs nightly or by manual dispatch;
  completed A6/A7 aggregate evidence remains bound to its accepted exact SHA and is
  absent from current-main workflows unless that phase is explicitly reopened;
- full-confidence failures remain authoritative and reopen the responsible owner before
  the next mutation checkpoint, but an unrelated historical verifier cannot make every
  product Work Unit wait idle or erase green direct-owner evidence;
- release and public claims still require the applicable full/release/certification lane.

Reason:

The previous workflow ran the full Vitest suite, complete rendered UI matrix, full Rust
tests, historical A6/A7 aggregates, and release hardening on every push. At
`65829f5e`, direct frontend, rendered UI, Rust, and stack-risk owners were green while a
completed A6 aggregate remained capable of making the whole run red. That coupling
optimized evidence volume rather than current product delivery.

Implication:

`pnpm test:changed` and `pnpm verify:fast` are local fast-feedback commands. Existing
deterministic branch review retains full `pnpm test`; `pnpm test:full`, the
`Full Confidence` workflow, historical phase aggregates, and release evidence are
explicit higher lanes. Skipping an unrelated lane is not a PASS for that lane; it is a
scope decision. A direct fresh failure is never ignored or reclassified merely to keep
development moving.

Reconsider when:

- path selection misses a reproducible cross-owner regression;
- fast feedback does not materially reduce local or hosted cycle time;
- repository ownership becomes too dynamic for changed/related test selection to remain
  trustworthy.

## ADR-017 Structured Runtime Admission Is Candidate-Neutral

Status: **accepted** (owner direction 2026-08-08).

Decision:

- visible PTY remains the Universal Agent Fabric `Current Best` until executed
  evidence proves that one structured runtime materially improves fidelity or
  recovery without weakening Aelyris authority;
- `V1-R0` is renamed **Structured Runtime Candidate Comparison** and does not
  require OpenCode, ACP, HTTP/SSE, or any other named third-party runtime to be
  installed merely to populate the comparison;
- a candidate enters V1-R0 only after a bounded admission receipt identifies the
  structured facts it can expose, the expected material advantage over PTY, its
  provenance/configuration/credential boundary, and its reversible retirement path;
- the V1-R0 decision states are `promote_none`, `promote_one`, `hold`, and
  `reject`. `promote_none` is a successful evidence-backed outcome that retains
  visible PTY and creates no production adapter;
- V1-R1, V1-R2, and V1-R3 may open only after `promote_one`. OpenCode remains an
  optional candidate or fixture when it independently satisfies admission; it is
  not a product dependency or privileged roadmap subject.

Reason:

The strategic value is one governed Mission/runtime/capability/evidence identity
surviving runtime replacement. Installing a named harness does not improve model
quality and can duplicate session, permission, configuration, provider-auth, and
process ownership. A comparison with no qualified candidate would manufacture
complexity rather than test a product hypothesis.

Implication:

V1-R0 first freezes the visible PTY baseline, then compares only admitted
candidate transports under the same Mission fixture. Candidate-specific protocols,
schemas, daemons, ports, and configuration rules stay inside disposable adapters.
No adapter is productionized unless it materially beats PTY and passes every
authority, isolation, recovery, secret, and rollback invariant. ADR-012 remains
the historical source of the replaceable-adapter principle; this ADR supersedes
its OpenCode-first selection.

Reconsider when:

- a pinned structured runtime exposes material facts or recovery guarantees that
  the current PTY owners cannot provide reliably;
- a provider-native protocol becomes stable enough to pass the same admission
  and ownership boundary without a third-party harness;
- visible PTY fails a named Mission journey and a structured adapter is the
  simplest reversible repair.

## ADR-018 V1-R0 Promotes None And Retains Visible PTY

Status: **accepted** (executed decision 2026-08-09).

Decision:

- close `V1-R0` as `promote_none`;
- retain visible PTY as the production Current Best;
- do not install or adapt OpenCode, ACP, HTTP/SSE, an SDK runtime, or another harness
  merely to populate the comparison;
- do not activate V1-R1, V1-R2, or V1-R3 without a new admitted candidate that supplies
  the complete bounded material-advantage and ownership receipt from ADR-017;
- move the active Apex frontier to the first inert Mission replay baseline in V2.

Reason:

The current visible PTY path has executed the complete real-provider Mission journey,
including visible work, fresh tests, independent review, exact-OID merge, immutable
settlement, and restart recovery. No structured-runtime candidate exists in the
repository or current runtime environment, and none has proved a material advantage
without duplicating Aelyris session, permission, evidence, or durable-state ownership.
Adding an adapter in that state would manufacture complexity rather than improve the
product.

Implication:

`promote_none` is a completed comparison outcome, not a failed experiment. Universal
runtime support and provider parity remain unclaimed. A future candidate must reopen
admission from evidence and preserve immediate visible-PTY fallback.

Reconsider when:

- a pinned candidate exposes typed facts or recovery guarantees that materially exceed
  the visible PTY baseline;
- the candidate passes provenance, license/update, credential isolation, owner
  non-duplication, compatibility, disable, retirement, and fallback gates;
- the same Mission fixture demonstrates the advantage without weakening operator
  visibility or backend authority.
