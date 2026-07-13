# Aelyris Verifiable Agent Work OS Specification

Status: approved design authority; implementation remains gated by the active R0-A9
remediation program

Version: 1.0

Last reviewed: 2026-07-13 JST

## 0. Authority And Claim Boundary

This specification defines the product contract that unifies Aelyris terminal,
multiplexer, agent, TaskGraph, ownership, Proofbook, review, merge, governance,
and Remote Continuity spines. It does not claim that the complete product is
implemented or release-ready.

Authority order:

1. `docs/requirements.md` owns current public and release claim policy.
2. `audit-remediation-instructions.md` and
   `COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md` own active R0-A9 order.
3. This document owns the target product requirements and acceptance language.
4. `AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md` owns the proposed data,
   module, state-machine, and protocol design.
5. `AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md` owns the staged
   implementation and capability-unlock map.

Current Aelyris remains alpha and not release-ready. A passing documentation
verifier proves only that this contract is complete and internally indexed. It
does not prove any target runtime capability, A7 completion, A8 native quality,
A9 release proof, or `releaseCandidateReady=true`.

## 1. Product Thesis

Aelyris is not a terminal with agent tabs. It is a local-first, proof-first
operating environment for human-AI software teams:

> **Aelyris is a Verifiable Agent Work OS. It turns intent into a durable
> Mission, runs work through visible and interoperable agents, binds every
> mutation to scoped authority and causal evidence, and converts proven outcomes
> into governed reusable capability.**

Terminal substrate answers **where** work runs. Agent runtimes answer **who**
works. An Aelyris Mission answers **what outcome is being pursued, why each action
is allowed, what happens next, what proof establishes completion, and what the
user can do when it is complete**.

The canonical product loop is:

```text
Intent -> Model -> Rehearse -> Lease -> Execute -> Observe
       -> Verify -> Review -> Settle -> Learn
```

The emotional promise is not merely "run more agents." It is:

> Aelyris turns agents into a team that remembers, proves, recovers, and improves.

## 2. Four-Layer Differentiation Audit

Comparison systems are evidence about available substrate, not a feature backlog,
product ontology, or imitation list. The design decision is:

> **Standardize the substrate; own the project's semantic truth.**

### 2.1 Borrowed Substrate

Aelyris may adopt or adapt these established primitives behind its own ports. None
of them is sufficient differentiation or may become a second state owner.

Every concrete reuse decision requires a `BS-*` record naming the generic pattern,
primary source, reuse/adapt/reimplement choice, license/SBOM/attribution impact,
data/schema boundary, existing owner, and explicit no-copy boundary. Research text
or a competitor UI is never an implementation specification.

| ID | Substrate pattern | Primary-source evidence | Aelyris boundary |
| --- | --- | --- | --- |
| BS-01 | durable mux graph, stable pane ids, subscriptions, flow control | [tmux](https://github.com/tmux/tmux/wiki/Getting-Started) and [Control Mode](https://github.com/tmux/tmux/wiki/Control-Mode) | native mux identity, backpressure, adoption, and reconciliation remain Aelyris-owned |
| BS-02 | GUI-independent local/SSH runtime domains | [WezTerm multiplexing](https://wezterm.org/multiplexing.html) | one typed `RuntimeDomain` port; a domain never owns Mission or completion |
| BS-03 | native terminal quality and shell integration | [Ghostty](https://github.com/ghostty-org/ghostty) | semantic command evidence binds actor, cwd, exit, duration, artifacts, and commit |
| BS-04 | visible multi-pane fleet, dispatch, mission tree, reattach, and heavy-output handling | [BridgeSpace product](https://www.bridgemind.ai/products/bridgespace), [docs](https://docs.bridgemind.ai/docs/bridgespace), and [changelog](https://www.bridgemind.ai/changelog) | a minimum fleet UX benchmark, not the product moat or canonical work model |
| BS-05 | worktree fleets, playbooks, and mission-oriented child sessions | [Scape / Argus](https://www.scape.work/docs/argus) | Qralis uses durable addressed coordination and evidence-backed Proofbooks without polling-owned truth |
| BS-06 | fact memory, procedural skills, delegation, and isolated execution backends | [Hermes memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/), [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/), [delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation), and [security](https://hermes-agent.nousresearch.com/docs/user-guide/security/) | learning is team/project scoped and promoted only through evidence, evaluation, approval, expiry, and rollback |
| BS-07 | immutable typed events, persistence, fork, and local/container/remote workspaces | [OpenHands events](https://docs.openhands.dev/sdk/arch/events), [persistence](https://docs.openhands.dev/sdk/guides/convo-persistence), and [workspace](https://docs.openhands.dev/sdk/arch/workspace) | events are inputs to one Aelyris Chronicle and project proof model, not the product's semantic truth by themselves |
| BS-08 | dependency-aware tasks, mailbox, steering, and plan approval | [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams) | team progress is restart-safe and evidence-derived rather than agent-reported |
| BS-09 | command center, worktrees, skills, automations, and review | [Codex app](https://openai.com/index/introducing-the-codex-app/) | provider-neutral Mission and proof contracts span visible and structured agents |
| BS-10 | live terminal use and human handoff | [Warp Full Terminal Use](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use) | `PaneControlBaton` has explicit authority, expiry, approval, and causal audit |
| BS-11 | structured agent, tool, and federation protocols | [ACP](https://agentclientprotocol.com/get-started/architecture), [MCP](https://modelcontextprotocol.io/docs/learn/architecture), and [A2A v1](https://a2a-protocol.org/latest/topics/key-concepts/) | protocols are adapters; A2A Task completion never implies Aelyris acceptance |

### 2.2 Aelyris-Owned Higher-Order Concepts

These concepts define the product and must remain provider-, protocol-, UI-, and
runtime-independent backend authorities:

1. **AO-01 — Mission / Project Work-and-Proof Graph** — requirements, work units, semantic
   ownership, change, gate, review, claim, blocker, and unlock form one durable
   outcome contract. Events are material; Mission projection gives them meaning.
2. **AO-02 — Qralis semantic air-traffic control** — planned write sets, symbol/function
   leases, dependencies, behavior contracts, and conflict rehearsal prevent or
   reschedule collisions before Git conflict.
3. **AO-03 — Proof sovereignty** — agent-finished, process-exited, artifact-emitted,
   gate-passed, accepted, merged, and release-ready remain distinct states.
4. **AO-04 — Proof-carrying continuity** — provider, model, process, or runtime may change;
   accepted work order, authority, leases, evidence, blockers, and recovery
   frontier remain durable Aelyris state.
5. **AO-05 — Capability-bound execution** — every effectful face resolves through the same
   principal, scoped lease, approval, budget, and audit contract.
6. **AO-06 — Proof-governed project learning** — memory and skill candidates are promoted
   only after evidence, held-out evaluation, review, versioning, expiry, and
   rollback; raw conversation never becomes verified knowledge.

### 2.3 Original Surprises

The differentiating experience is a set of trust moments, not a larger feature
count:

- **SX-01 — Project Flight Recorder**: select any trusted result and replay brief -> owner
  -> command -> diff -> gate -> review -> claim without treating chat as proof.
- **SX-02 — Conflict Radar**: predict semantic ownership and behavior-contract collisions
  before an agent edits, then reassign or reorder work visibly.
- **SX-03 — Proof-Carrying Handoff**: replace a crashed or unsuitable agent/provider at the
  same authorized proof frontier instead of restarting from a summary.
- **SX-04 — Confidence Topology**: show proven, stale, repo-blocked, policy-blocked,
  operator-required, and external proof as navigable terrain; selecting a gap opens
  its exact work unit, gate, owner, and next action.
- **SX-05 — Trust Unlocks**: completion does not merely remove a task; a valid packet reveals
  the capability, recovery option, or governed skill candidate that the evidence
  now makes safe.

The A7 Core Mission Loop proves only the bounded portions required by R0-A9. Full
Flight Recorder replay, semantic Conflict Radar, governed learning, and richer
Confidence Topology stay behind their named post-release gates.

### 2.4 Post-Release Evolution Waves

Post-release evolution compounds the A7 trust spine instead of moving unfinished
release criteria out of R0-A9:

1. **EV-01 — Interoperate and recover** — production ACP/SDK adapters and Mission Time
   Machine (`Apex V1-V2`).
2. **EV-02 — Coordinate and learn** — durable Qralis team fabric and Verified Skill Foundry
   (`Apex V3-V4`).
3. **EV-03 — Reason over alternatives** — Decision Lab, Counterfactual Arena, and Temporal
   Project Twin (`Apex V5-V7`).
4. **EV-04 — Extend trust outward** — governed remote control, signed extensions, and A2A
   federation (`Apex V8-V9`).

Pane grids, worktree-per-agent, Kanban, shared memory, resume, and agent status are
expected substrate. Aelyris differentiates by making the project's semantic truth,
authority, causal history, completion proof, continuity, and learning portable
across those substrates.

## 3. Existing Substrate And Named Gaps

The target must extend existing owners instead of creating parallel systems.

| Spine | Existing substrate | Gap that this program closes |
| --- | --- | --- |
| terminal/mux | Rust PTY, pane/tab/workspace graph, snapshots, sidecar | full adoption/reconciliation, stable runtime identity, semantic command evidence |
| work graph | durable TaskGraph, dependencies, revisioned apply, scheduler | Mission outcome, required proof, persisted symbol intent, capability unlocks |
| ownership | file/symbol claims, leases, overlap detection | bind claims to Mission, capability, checkpoint, completion packet |
| event/audit | EventBus replay and audit journal | one typed causal envelope, no silent loss, deterministic projections |
| coordination | Intent Bus, context store, Qralis design | addressed messages, delivery, role lease, directive and driver trust |
| Proofbook | typed definition, runner, ledger, CAS, artifacts, gates, agent session | product UI, settlement integration, fan-out, distillation, Evidence Store |
| governance | MCP choke point and principal seam | all-adapter capability kernel, short-lived credentials, deny equivalence |
| review/merge | review queue and exact-OID merge intent | immutable completion settlement as the only trusted `Done` primitive |
| remote | detailed Remote Continuity contracts | read-only implementation proof, then leased steer/approve/stop |
| learning | decisions, context, evidence, Proofbook proposals | evidence promotion, evaluation, expiry, versioning, activation and rollback |

The program must not add a third lifecycle log, a second TaskGraph, a second
Proofbook runner, a second dispatcher, a frontend state owner, or an MCP-specific
business ontology.

## 4. Core Product Objects

### FR-1 Aelyris Mission

Every non-trivial user objective is represented by one durable Mission identity.
Immutable `MissionDefinitionRevision` owns the accepted objective/contract;
`MissionExecutionProjection` derives mutable state, active/next work, packet refs,
and projection hash from authoritative WorkGraph/domain state and causal events.
Their aggregate read model is `MissionRecord`, not another persistence owner. The
Mission binds:

- objective, non-goals, repository/workspace, base OID, and desired outcome;
- versioned acceptance clauses and proof requirements;
- dependency DAG, active/next slice, owners, agents, panes, and worktrees;
- risk, cost, time, network, credential, and approval policies;
- required artifacts, gates, decisions, checkpoints, and residual blockers;
- a human-readable `capabilityOutcome` describing what completion unlocks.

Mission definitions are revisioned. Mutating an accepted contract creates a new
revision and records who approved it; history is not overwritten.

### FR-2 Now / Next / Unlocks

Every Mission exposes one backend-owned `MissionProgressProjection` with:

- **Now**: current phase/slice, actor/owner, pane/session, action, Git truth,
  latest/running verifier, evidence freshness, and blocker;
- **Next**: exactly one dependency-unblocked action or blocker-release action,
  expected output, expected proof, and expected human attention;
- **Unlocks**: user-visible capability enabled by completion, its acceptance
  contract, and remaining repo/policy/operator/external work;
- **Needs attention**: ranked and deduplicated decisions, approvals, conflicts,
  stale proof, cost risks, and operator actions.

The frontend may render this projection but may not recompute Mission status or
completion from local booleans, timer heuristics, token estimates, or agent text.
The projection also carries backend-owned `readyWork[]`; the UI highlights one
recommended Next without hiding other safe parallel lanes.

### FR-3 Universal Agent Fabric

`AgentSession` supports multiple adapters under one capability matrix:

```text
PtyAdapter   real interactive CLIs and human-visible work
AcpAdapter   structured prompt, tool, diff, approval, and session exchange
SdkAdapter   embedded agent runtimes with typed events and runtime isolation
A2aAdapter   future signed remote-agent federation
```

Shared capabilities include prompt, steer, interrupt, resume, fork, approve,
reject, tool-event stream, diff stream, usage/cost, attention state, and session
export. Unsupported capabilities are explicitly `unsupported`; Aelyris must not
infer success or synthesize a capability from terminal text.

Protocol responsibilities remain separate:

- PTY owns human-visible interactive execution;
- ACP owns an agent process/client relationship;
- MCP owns tools, resources, and prompts;
- A2A may later own remote agent discovery, tasks, and artifacts.

### FR-4 Pane Control Baton

Every writable pane exposes one authoritative control state:

```text
human | agent | shared_observe | approval_waiting | detached | replaying
```

The baton identifies controller, principal, capability lease, Mission/work unit,
expiry, and last transition event. Two writers cannot hold the baton. A reconnect
does not silently reacquire write authority. `replaying` is read-only.

### FR-5 Runtime Domains And Semantic Command Evidence

Local host, SSH, container, devbox, and future remote runtimes implement one
`RuntimeDomain` contract with explicit capability and trust differences.

Shell integration emits semantic command boundaries. A proven command block binds:

- command fingerprint or redacted form;
- actor/principal, Mission, work unit, pane, and runtime domain;
- cwd, start/end, exit result, cancellation/timeout state;
- touched resources when knowable;
- evidence and artifact digests;
- base/head commit and resulting checkpoint where applicable.

Terminal rendering alone is not command evidence.

### FR-6 Chronicle / Flight Recorder

All important lifecycle facts use one canonical typed `WorkEventEnvelope` with
monotonic sequence, correlation, causation, idempotency, principal, subject,
payload schema, evidence refs, redaction state, timestamps, and digest.
The envelope declares `content_addressed`, `local_signed`, or
`externally_anchored` integrity. A digest alone is never described as protection
against a fully privileged host attacker, and A9 release signing remains separate.

The Chronicle records at least:

- Mission revision and task assignment;
- agent/session/pane lifecycle and control-baton transition;
- ownership claim and release;
- intent, addressed message, directive, and decision;
- tool/terminal action and result;
- file mutation, commit, test, verifier, and artifact;
- approval, review, merge, pause/resume, crash/adoption, reconciliation;
- memory or skill proposal and promotion.

Replay reconstructs a read-only projection from recorded facts. It must not
reissue network calls, publish artifacts, charge money, sign, merge, or repeat
unknown external effects.

### FR-7 Mission Rehearsal And Counterfactual Arena

Before execution, Mission Rehearsal shows:

- dependency critical path and ready work;
- file/symbol collision and ownership gaps;
- proposed panes, agents, worktrees, runtime domains, and adapters;
- capability/approval queue and irreversible side effects;
- required gates/artifacts and missing proof;
- measured data separately from estimated cost/time bands;
- likely repo/policy/operator/external blockers;
- capability unlocks produced by each accepted work unit.

The later Counterfactual Arena may run two or more isolated Shadow Missions from
the same base OID, acceptance pack, and budget class. It compares immutable
completion packets under one fixed Proofbook and independent review. Model vote
or confidence alone cannot select a winner. External mutation, shared migration,
main merge, signing, and publication are denied by default in Shadow Missions.

### FR-8 Capability And Credential Broker

Every mutation path uses the same capability kernel. A `CapabilityLease` binds:

- principal and requested action;
- workspace/project, Mission/work unit, pane/run, and file/symbol lane;
- argument hash and base/head OID when relevant;
- filesystem, process, network, secret, and cost scopes;
- issue time, expiry, one-use/revocation state, and approval provenance.

Agents may request capabilities but cannot issue them. MCP, IPC, REST, WebSocket,
SSH, Proofbook, agent adapter, scheduler, and extension paths must produce the
same deny result for the same disallowed intent. Credentials are short-lived,
brokered, redacted, and excluded from durable evidence.

Leases bind a process-tree generation and monotonic deadline, canonical Windows
resource identity (including reparse/UNC/ADS policy), DNS/redirect-aware network
scope, and unit-bearing budgets. One-use mutation follows persisted
`reserve -> effect -> commit`; an uncertain crash/effect enters reconciliation and
is never blindly retried.

### FR-9 Proof And Completion Plane

Settlement emits disjoint immutable backend-owned records:

- `CompletedWorkPacket` is the only trusted work-unit completion primitive;
- `BlockedWorkPacket` preserves an exact durable handoff but never advances a
  work unit, Mission, phase, release, or goal to completed;
- `MissionCompletionPacket` aggregates the exact required work-unit packets plus
  Mission-level gates and is the only record that may set a Mission to completed.

This authority is effective only for Mission/A7 state after the A7.0 schema and
migration gate activates it. It does not retroactively replace R0-A6 verifier
history and cannot replace A8, A9, operator/external, or final-goal evidence.

A `CompletedWorkPacket` binds:

- Mission/work unit and contract revision;
- implementer, reviewer, operator, adapter, provider/model, and skill identities;
- environment fingerprint, base/head OID, owned files/symbols;
- exact executed gates, results, evidence/artifact digests, and freshness;
- reviewer independence computed from policy and principal/session/provider/fork
  lineage, accepted verdict, dissent, and non-blocking residual risks;
- approval capability and approver;
- accepted or merged result with exact merge outcome when applicable;
- rollback/compensation and replay/reproduction recipe;
- packet digest and supersession lineage.

It is invalid when any required acceptance blocker remains in the repo, policy,
operator, or external class. A `BlockedWorkPacket` instead binds those separate
blocker arrays, owner, exact next action, required input/command, expected
artifact, current evidence, and the same OID/provenance context. It is progress
and continuation evidence, never completion evidence.

Proofbook PASS, agent self-report, review approval, merge intent, or a durable
blocked handoff alone is not completion. `ready_for_review`, `ready_to_merge`,
`merged`, `blocked`, and `completed` remain distinct states.

### FR-10 Attention Compiler And Ambient Mission Health

The system converts raw activity into a bounded Attention Inbox. It deduplicates
items that share a root cause and orders them by risk, critical-path depth, age,
cost of delay, reversibility, and required human authority.

Supported classes include clarification, approval, conflict, failed gate, stale
evidence, budget pressure, blocked dependency, agent idle, external/operator
action, merge-ready packet, and recovery decision.

Each item carries an owner, exact next action, expiration/freshness, evidence ref,
and consequence of inaction. Mission health is computed from measured backend
evidence; estimates are labeled and never presented as trust truth.

### FR-11 Reversible Autonomy

A Mission checkpoint binds repo OIDs/dirty diff, TaskGraph revision, ownership
leases, pane/session checkpoint, Proofbook ledger revision, decision refs,
capability state, external-effect markers, and compensation plan.

"Undo Mission" creates an isolated recovery branch/worktree or a typed
compensating operation. It never deletes audit history. Publication, billing,
signing, remote API mutation, and other irreversible effects are labeled
`external_irreversible`; Aelyris must not report a fictitious rollback.

### FR-12 Qralis Decision Lab And Adversarial Council

High-blast-radius architecture, security, migration, public contract, and
irreversible decisions may enter a bounded `DecisionCase`:

1. independent proposals are produced without seeing one another;
2. a fixed rubric compares evidence, risk, reversibility, cost, and maintainability;
3. builder, falsifier, security, performance, and user-advocate roles critique;
4. dissent and rejected alternatives remain durable;
5. the selected decision is hash-bound to a Mission revision;
6. required human gates cannot be replaced by model consensus.

Routine work does not trigger a costly multi-model debate.

### FR-13 Verified Skill Foundry And Team Memory

Learning is governed and separated into:

- raw evidence;
- episodic Mission and packet history;
- semantic `MemoryClaim` facts, decisions, constraints, and warnings;
- procedural Proofbooks, recipes, and `SkillCandidate` proposals.

The promotion loop is:

```text
proven outcome -> candidate -> redact -> conflict check -> offline evaluation
-> compare -> governed review -> versioned activation -> monitored use -> rollback
```

Unverified chat, raw PTY logs, model confidence, summaries, and agent self-report
cannot become verified memory. Candidates retain source evidence, scope, expiry,
compatibility, evaluation cases, success/risk deltas, and supersession lineage.
Repository, PTY, tool, remote, and retrieved content is untrusted data, never an
instruction source for the promotion policy. Preferences require human authorship
or confirmation. Promotion enforces prompt-injection/poisoning checks, PII/secret
redaction, consent, retention, deletion, and provenance. Skill activation cannot
be self-approved: it requires held-out evaluation, declared capability manifest,
sandbox/Proofbook execution boundary, license/source provenance, signature or
digest pinning, and rollback. Existing Proofbooks are never rewritten automatically.

### FR-14 Temporal Code Map / Project Twin

The Project Twin projects over existing ownership, dependency, Mission, proof,
and history owners. It answers:

- who currently owns each file/symbol and under which Mission;
- which ready/running work units depend on it;
- which proof becomes stale if it changes;
- which previous approaches failed and with what evidence;
- which worktrees require rebase and revalidation after merge;
- which runtime/adapter/skill versions produced the accepted result.

It is a projection, not a second code index or ownership database.

### FR-15 Proofbook Automation And Scheduling

Proofbooks support interactive, scheduled, and event-triggered execution plus
deterministic no-agent jobs. Scheduling records preconditions and does not wake an
LLM when a script can prove there is no work. Fan-out and subProofbook settlement
remain bound to child ledgers and one parent completion packet.

Success may generate a Proofbook/skill proposal, never an automatic mutation of
the source definition.

### FR-16 Remote Continuity Companion

Remote Continuity is attention-first, not a phone-sized full IDE. Read-only ships
first and projects the same backend truth:

- Now / Next / Unlocks and since-last-seen Fleet Briefing;
- Attention Inbox and Mission health;
- live pane preview and Chronicle timeline;
- evidence packet and decision review.

Steer, approve/deny, stop, or writable attach require scoped expiring leases,
fingerprint checks, secret scanning, and local parity proof. The remote client is
never a workspace state owner. Read-only is not permission-free: every remote
read is device/session-bound and scoped to project, Mission, pane, event range,
and evidence class; terminal/clipboard/OSC/artifact data is redacted and rendered
inert, with expiry, revocation, rate/volume limits, and secret-leak negative tests.

### FR-17 Signed Extension Ecosystem

Only after local trust, release signing, provenance, and revocation are proven may
Aelyris expose a curated ecosystem for agent adapters, tool adapters, Proofbook
recipes, parsers/indexers, and read-only UI projections.

Extensions may not own domain state, mutate private DBs, issue capabilities, grant
approval, merge, access raw secrets, or create a second dispatcher/runner. Each
extension is digest/signature pinned, capability leased, resource bounded,
out-of-process where possible, uninstallable, and backed by verifier fixtures.

### FR-18 Canonical Control API And MCP Adapter

The Aelyris Control API is one backend application contract projected through
Tauri IPC, MCP, REST, WebSocket, CLI, visible PTY, Proofbook, review, and merge
faces. MCP is an adapter, never a scheduler, permission authority, event owner,
Mission ontology, or completion source.

One versioned command descriptor registry owns, for every action:

- canonical input/output schema and unknown-field policy;
- effect class, required principal/capability scope, approval policy, and budget;
- idempotency, ordering, deadline, cancellation, and retry/uncertain-effect rules;
- event/evidence obligations, redaction policy, and supported adapter faces;
- compatibility version, deprecation window, and migration/rollback behavior.

Transport adapters construct the same `ControlCommandEnvelope`, call the same
domain application service, and map the same `ControlCommandResult`. A bearer,
local process, MCP session, UI event, or tool name authenticates a caller/surface;
it never grants an effect. Adapter-local `FREE`/`GATED` labels cannot override the
canonical policy. Every effect is Mission/work-unit, contract-revision, principal,
capability, args-digest, idempotency, OID/generation, causation, and deadline bound.

The MCP tool catalog and JSON Schemas are generated projections of the canonical
registry. Hand-maintained tool schemas must fail drift checks. Current HTTP/JSON-
RPC MCP behavior may be inventoried and compatibility-wrapped; stdio, Streamable
HTTP, ACP, SDK, A2A, and richer resources/prompts are unsupported until their own
implementation and conformance gates pass.

Reads use scoped snapshots/cursors, byte/rate limits, freshness/gap markers, and
inert redacted payloads. Effects follow persisted
`validate -> authorize -> reserve -> record intent -> effect -> commit|uncertain`.
Cancellation before effect is safe; cancellation or receipt loss after possible
effect becomes `uncertain` and requires reconciliation. Slow consumers, queue
overflow, disconnect, and restart cannot silently lose an approval, blocker,
completion fact, or capability state. An in-memory MCP pending queue may be only a
bounded compatibility projection over a durable owner.

Acceptance requires all-face allow/deny/result/evidence equivalence, generated
schema/catalog drift proof, major-version and unknown-field rejection, replay and
idempotency conflict tests, stale Mission/OID/generation denial, capability and
approval bypass tests, cancellation at every effect boundary, backpressure/gap
tests, secret/redaction fixtures, and compatibility/rollback proof. API/MCP design
or catalog presence is not a current production or release-ready claim.

## 5. Product Experience Contract

The pane-first cockpit remains the interaction model:

```text
Top      Mission / Now / Next / Unlocks / Needs Attention / Proof Freshness
Left     Mission Map / tasks / files / worktrees / Proofbooks / verified skills
Center   visible real PTY fleet with control baton and semantic command blocks
Right    attention / decisions / proof / review / merge readiness
Bottom   Chronicle causal timeline and checkpoint navigation
Overlay  Mission Rehearsal / Decision Lab / recovery preview / Arena comparison
```

### 5.1 Pane-First Trust Grammar

UI polish amplifies the visible terminal instead of replacing it with a dashboard:

- a top **Mission Strip** shows canonical Now, Next, Unlocks, blocker owner, and
  proof freshness without recomputing them in React;
- each pane header shows a **Capability Baton** with controller, scope, lease
  state/expiry, and keyboard-accessible request/take/release intents;
- Mission Rehearsal contains a pre-dispatch **Conflict Radar** for planned
  file/symbol/behavior-contract collisions;
- the right rail renders a **Confidence Topology** keyed by acceptance clause;
  every stale or blocked region opens its owner, evidence, exact next action, and
  gate rather than a generic warning;
- the bottom **Chronicle Trail** shows causal events and evidence links as an inert
  projection; replay never implies re-execution;
- **Completion Receipt** and **Blocked Handoff** are different sheets driven only
  by their packet types and can never share a success treatment;
- a since-last-seen **Fleet Briefing** summarizes changes, attention, proof, and
  unlocks from causal backend facts.

Color is never the sole status signal. Labels, icon/shape, freshness timestamp,
and evidence tier remain visible on glass surfaces at existing contrast gates.
Focus order, shortcuts, and hints come from the shared shortcut registry; every
core inspection and decision flow is keyboard-complete. Motion explains baton,
causation, or settlement transitions, respects reduced-motion, and never masks a
state change.

### 5.2 UI Polish Acceptance

A7 bounds these surfaces to the First Mission and proves:

- one glance identifies Now, Next, one blocker owner/action, and proof freshness;
- keyboard-only traversal reaches Mission Strip, active pane/baton, Confidence
  Topology, Chronicle evidence, and packet sheet without a focus trap;
- 320 px right-rail and the existing 584/960 px shell fixtures preserve terminal
  priority, legibility, and action reachability;
- stale/out-of-order generations cannot mix Mission, pane, evidence, or packet UI;
- blocked, uncertain, stale, inferred, accepted, and merged states are visually
  and semantically distinct;
- rendered Playwright, accessibility, reduced-motion, and high-contrast fixtures
  pass, while final live DWM/WebView2/IME proof remains in the existing host gates.

Full historical scrub/recovery, cross-Mission semantic radar, provider hot-swap,
temporal topology, Arena comparison, and governed remote control stay in their
post-release Apex waves.

One user brief should eventually support this proven flow:

1. Aelyris presents scope, blast radius, plan, budget, permissions, proof, and
   rollback limits before execution.
2. High-risk choices receive bounded independent proposals and dissent.
3. Agents run visibly in isolated worktrees with symbol leases and control batons.
4. The user can leave; Fleet Briefing later explains what changed and what needs
   attention.
5. Restart reconstructs the same Mission projection from durable owners.
6. Work-unit completion creates content-addressed packets and Mission completion
   creates their exact aggregate; at the declared local-signed or externally-
   anchored integrity tier, both are tamper-evident proof—not a chat message.
7. The accepted method may become a governed skill proposal for future Missions.

## 6. North-Star Measures

Measure trusted outcomes, not generated activity:

- time to trusted completion;
- human attention minutes per accepted work unit;
- cost/tokens per accepted work unit;
- self-reported versus verified completion divergence;
- restart recovery fidelity and projection-hash reproducibility;
- stale evidence rejection and proof replay success;
- prevented ownership conflicts and false-conflict rate;
- rollback/compensation success rate;
- failed-approach reuse prevention;
- memory/skill proposal acceptance precision;
- Missions rescued by remote intervention;
- external/operator blockers with exact executable handoff.

A7 machine acceptance fixes these values at zero:

- `trustedDoneWithoutValidCompletedWorkPacket`;
- `missionDoneWithoutValidMissionCompletionPacket`;
- `blockedHandoffCompletionCredit`;
- `trustSurfaceWithoutOwnerNextActionEvidence`;
- `mixedProjectionGeneration`;
- `keyboardUnreachableMissionActions`;
- `colorOnlyTrustStates`;
- restart projection-hash mismatch;
- cross-face authority/result/evidence mismatch;
- adapter call with caller-supplied identity accepted as authority.

Human measures require a versioned baseline artifact, target, and guardrail before
claiming improvement: time after return to identify Now/Next/blocker owner, time to
verify trusted Done, and attention minutes per accepted work unit. They combine
with the A7 projection p95, freshness, restart RTO, and critical RPO contracts;
they do not replace them.

## 7. Anti-Features And Stop Conditions

The following weaken the product and are explicitly out of contract:

- a chat panel as the primary product surface;
- agent-count gamification or an unbounded flat swarm;
- hidden background agents as the default for human-visible implementation;
- unrestricted peer chatter or raw PTY logs injected as shared memory;
- global `yolo`, broad permanent credentials, or self-issued capability;
- agent self-report or model confidence as completion truth;
- fake time travel that erases events or repeats unknown side effects;
- proofless self-modifying memory, skills, Proofbooks, or policy;
- provider-specific SDK concepts in the core ontology;
- using MCP as event bus, agent protocol, or second runtime;
- frontend-owned workflow, progress, Proofbook, or completion state;
- cloud account state as the runtime source of truth;
- automatic main merge based only on model review;
- untrusted marketplace or extension code before supply-chain proof;
- unlabeled estimated cost/context/health presented as measured evidence;
- voice, avatar, companion, or IDE-parity work ahead of trust and completion.

If implementation requires a duplicate owner, bypasses the capability kernel,
cannot identify its causal event/evidence, or weakens an acceptance gate, stop and
revise the design before coding.

## 8. Acceptance And Claim Promotion

This specification is accepted as a design contract when:

- spec, detailed design, roadmap, requirements index, tracked remediation plan,
  and spec index are linked and verifier-checked;
- A7 has a finite release-blocking Mission Loop distinct from post-A9 Apex work;
- A7 preserves the pre-existing Proofbook product UI, fleet recipes/Fleet
  Briefing/budget-cost, principal/capability connector, and read-only Remote
  Continuity requirements rather than moving them out of R0-A9;
- current runtime substrate and target capability are never conflated;
- owner, state, failure, replay, authority, evidence, and negative-test contracts
  are detailed for every release-blocking component;
- current claim policy remains alpha/not-release-ready.

Runtime claim promotion requires the focused gate for each slice, the aggregate
A7 First Mission acceptance, A8 measured terminal decision, A9 blocking CI and
external/operator proof, and the unchanged final release claim chain. No roadmap
entry becomes shipped merely because it appears in this specification.
