# Aelyris Verifiable Agent Work OS Roadmap — 2026-07-13

Status: tracked product roadmap; active execution is product-delivery `GMV-0` while
A9 operator/external certification remains non-exclusive

Last reviewed: 2026-08-04 JST

## 0. Roadmap Contract

This roadmap integrates the 2026-07-13 product/architecture audit without
shrinking or indefinitely expanding the Comprehensive Audit Remediation goal.

- **Now**: execute `GMV-0`, separating the general Mission contract from the frozen
  A7 conformance fixture through existing owners.
- **Next**: expose the approved general plan preview in `GMV-1` after `GMV-0` proof.
- **Destination**: build the Apex capabilities after release trust is established
  or through later explicitly gated programs.

The new product direction does not authorize skipping A6, weakening A8 evidence,
deferring A9 external/operator proof, or treating design documents as runtime
completion. A7 Core and post-A9 Apex have separate completion claims.

## 1. North Star

```text
Terminal substrate       where work runs
Agent Fabric             who can work and how they interoperate
Aelyris Mission          what outcome is pursued and what happens next
Capability Kernel        why each action is allowed
Chronicle + Proof Plane  what actually happened and why completion is trusted
Learning Plane           how proven work becomes reusable team capability
```

The destination is a **local-first Verifiable Agent Work OS**, not merely a
tmux/WezTerm/Ghostty shell with more agent panes.

## 2. Permanent Now / Next / Unlocks Rule

Every product planning and status surface must expose:

```text
NOW
- active phase and exact slice
- actor/owner and current action
- current Git/runtime truth
- running or last verifier and evidence freshness
- blocker class and owner

NEXT
- one exact dependency-unblocked action
- expected output and artifact
- expected proof/gate
- estimated human attention need

UNLOCKS
- concrete user-visible capability enabled by completion
- acceptance contract
- remaining repo, policy, operator, and external work
```

These fields eventually come from `MissionProgressProjection`. Until A7 lands,
the tracked work order, exact continuation worklog, canonical local handoff, and
fresh verifier artifacts remain the authority under
`WORK_RECORD_AND_CONTINUATION_PROTOCOL.md`. Existing worklog/handoff fields provide
the underlying Now and Next facts; Unlocks is a presentation derived from the
tracked plan. This roadmap does not silently change the continuation schema. Any
machine-required Unlocks field needs an explicit versioned protocol/verifier
migration in its own focused slice.

## 3. Current Position

This stable roadmap does not copy the exact current phase or slice. Read
`audit-remediation-instructions.md` and the canonical local handoff for that
volatile frontier. The durable position is:

- finish the corrective A4 sequence through A4.12, then resume the frozen A6
  frontier at A6.2e1;
- finish A6 by owner, dependency, behavior, and concurrency evidence rather than a
  universal line-count target;
- enter A7 through a scope lock and prove one canonical Core Mission;
- keep A8.1, A9, blocking CI, and external/operator release evidence open until
  their own gates pass; A8.0 is complete with accepted-with-amendments outcome;
- current public status remains alpha and not release-ready.

The durable A6 resume slice is `A6.2e1`; the root work order owns when that
frontier becomes active.

The current design checkpoint unlocks a frozen product direction and prevents
random feature accumulation. It does not unlock a shipped capability.

## 4. Remediation Program Integration

| Phase / slice | Now: work | Acceptance | What completion unlocks |
| --- | --- | --- | --- |
| A6.2v1 | freeze Work OS spec, detailed design, roadmap, authority, and verifier | docs/spec/design/plan/index/claim gate PASS | one coherent product target and finite A7 contract; no runtime claim |
| A4.7-A4.12 corrective | authoritative commit order, durable event delivery, execution fence, all-owner startup reconciliation, handoff quarantine, crash matrix | fail-closed failure injection plus combined restart proof | truthful durable substrate; resume A6.2e1 without a second graph/journal |
| A6.2e1-e4 | dependency boundaries, narrow subscriptions, project/tab semantics, concurrent state owners | executed behavior plus fail-closed ratchets | trustworthy frontend owners that can render Mission state without duplicating it |
| A6.2f-g | split only proven ownership boundaries and pass blocking frontend acceptance | dependency direction, owner behavior, concurrency, diagnostic non-growth ratchets, and CI green | modular cockpit ready to receive Mission projections |
| A6.3-A6.8 | IPC/MCP/DB/native owner splits, dead-owner proof, aggregate ratchet | owner-specific and combined blocking gates | backend seams stable enough for one Mission vertical |
| A7.0-A7.5 | canonical Core Mission Loop | request, versioned plan preview, visible implementation, fresh tests, independent review, exact-OID settlement, and immutable completion packets | one trusted brief-to-proof workflow without destination-feature bundling |
| A8.0 | native product-goal/architecture decision (complete) | native coverage v2, same-condition evidence, alternatives, ownership cost, rollback, Windows support, and release timing | accepted with amendments; post-A9 N4 direction, no pre-A9 takeover, framework selected in NUI-F0 |
| A8.1 | measured native terminal spike | parity/perf/soak decision evidence | evidence-based renderer direction, including a valid no-promote result |
| A9 | blocking CI, signed/update/install/relaunch/rollback, real-host and operator proof | current repo+CI+external completion matrix | release claim only if every existing claim-policy gate passes |

### 4.1 A6.2v1 documentation-only boundary

Allowed:

- requirements/spec/design/roadmap/plan/index corrections;
- a documentation contract verifier and local artifact;
- explicit A7 Core versus post-A9 Apex boundaries.

Forbidden:

- Mission DB/schema/runtime implementation;
- journal migration;
- new UI panels;
- adapter, capability, replay, memory, or marketplace code;
- changing A6.2e1 as the eventual A6 resume slice (a later independent regression
  review may insert a prerequisite corrective phase without rewriting this checkpoint);
- weakening any claim, threshold, verifier, CI, or external gate.

## 5. A7 Core Mission Loop — Release-Blocking Vertical

A7 remains finite. Its product wedge is:

> One useful brief becomes a versioned Mission, executes visibly under scoped
> authority, survives restart, proves its result, receives independent review,
> and settles an immutable completion packet with zero inferred completion truth.

The canonical release-blocking journey is:

```text
request -> versioned plan preview -> visible implementation -> fresh tests
        -> independent review -> exact-OID accept/merge -> immutable settlement
```

Proofbook product UI/recipes, Fleet Briefing, broad budget/cost UX, Remote
Continuity, universal all-face Control Kernel migration beyond the enabled Mission
path, provider-fabric expansion, and learning layers remain destination work and
receive no A7 Core completion credit.

### A7.0 — Core Mission Scope Lock And Owner Inventory

Now:

- freeze one request fixture and the seven-step canonical journey;
- inventory only the TaskGraph, runtime/PTY, ownership, event/evidence, test,
  review, merge, and packet-settlement owners exercised by it;
- freeze the minimum Mission/work-unit, evidence, review, OID, completion,
  blocked-settlement, identity, and versioning contracts;
- inventory the enabled IPC/MCP/PTY actions on that journey and route them through
  existing authority seams or declare them unsupported;
- record deferred destination work explicitly and keep every runtime claim false.

Acceptance:

- no duplicate DAG, journal, runner, dispatcher, completion table, or frontend state
  owner;
- exact journey state transitions, tested/reviewed OID binding, blocker split, and
  negative fixtures are frozen;
- all target runtime claims remain false.

Unlocks:

- implementation can proceed without inventing contracts inside UI/IPC code.

### A7.1 — Request Contract And Versioned Plan Preview

Now:

- accept one request into the existing TaskGraph-backed Mission owner;
- preview a versioned plan with owned targets, expected tests, independent review,
  merge policy, and risk before any effect;
- persist only the causal facts required to explain and resume this journey.

Acceptance:

- cancellation or rejection before plan acceptance creates no worktree, PTY,
  capability, or external effect;
- the accepted plan revision and next exact action restore from existing durable
  owners;
- frontend contains no duplicate Mission or plan state owner.

Unlocks:

- a request becomes an inspectable, resumable plan instead of an opaque launch.

### A7.2 — Visible Implementation And Fresh Tests

Now:

- run one implementation agent in a visible PTY and isolated worktree;
- bind enabled actions to the accepted Mission/work unit, actor, process generation,
  owned targets, and current OID using existing admission, authority, ownership, and
  execution-fence seams;
- execute the declared tests after implementation and record exact command, result,
  evidence digest, and tested OID;
- leave unused adapters and destination faces disabled or typed unsupported.

Acceptance:

- stale generation, widened ownership, wrong target, or changed plan/OID is denied
  before effect or settlement;
- secret values never enter Mission/event/packet evidence;
- agents cannot issue or widen their own authority;
- the test record is bound to the exact implementation OID.

Unlocks:

- one visible implementation produces fresh, OID-bound test evidence.

### A7.3 — Independent Review And Exact-OID Acceptance

Now:

- compute reviewer independence and review the exact tested OID against declared
  acceptance;
- preserve rejection findings and exact next action without completion credit;
- accept or merge only through the existing exact-OID merge-intent owner.

Acceptance:

- same-agent/fork reviewer, stale test evidence, dirty/unowned worktree, changed OID,
  or changed acceptance contract fails;
- no automatic main merge is introduced.

Unlocks:

- tested work receives independent, exact-revision acceptance rather than a model
  self-report.

### A7.4 — Completion Settlement

Now:

- collect exact commit/OID, acceptance-clause coverage, Chronicle range/root,
  owned diff, fresh test evidence, computed reviewer lineage/independence,
  accept/merge receipt, and residual risk;
- create immutable `CompletedWorkPacket` only with accepted independent review,
  current complete coverage, and zero acceptance blockers;
- create a separate `BlockedWorkPacket` for repo/policy/operator/external blockers,
  authority/inputs/command/result/artifacts, and next action; a
  `BlockedWorkPacket` grants zero completion credit;
- aggregate the exact required work-unit packets and Mission-level acceptance into
  a distinct `MissionCompletionPacket`; one work-unit packet cannot complete the
  Mission;
- apply the integrated-OID completion barrier inside packet settlement: reject
  dirty or unowned worktrees, stale/superseded packets, unresolved required
  decisions or obligations, and non-exact integration; any OID, contract, graph,
  or proof-version change invalidates CAS settlement and requires re-proof;
- wire review and exact-OID merge projection without automatic main merge.

Acceptance:

- tamper/integrity mismatch, stale OID/evidence, missing gate/artifact/coverage,
  uncovered symbol, same-agent/fork reviewer, injected raw recovery instruction,
  hidden blocker, and packet/diff mismatch all fail;
- Proofbook PASS, agent self-report, or durable blocked handoff alone cannot render
  trusted Done;
- repo/policy/operator/external blockers remain separately visible.

Unlocks:

- completion becomes portable, inspectable evidence instead of a status label.

### A7.5 — Canonical Core Mission Combined Acceptance

Now:

- run the fixed request through plan preview, visible implementation, fresh tests,
  independent review, exact-OID accept/merge, and immutable settlement in order;
- run a separate blocked scenario that preserves exact continuation and grants no
  completion credit.

Acceptance:

- every required child gate and blocking CI result is current;
- no inferred completion truth, stale evidence, hidden blocker, or unclassified
  failure;
- A7 remains incomplete when the blocked scenario is the only completed scenario;
- deferred product features receive no A7 completion credit.

Unlocks:

- Aelyris has one proven end-to-end Verifiable Agent Work OS vertical.

## 6. A8.1 And A9 Remain Release Gates; A8.0 Decision Is Complete

### A8.0 native product-goal and architecture decision

A8.0 accepted the high-priority full-native Rust migration direction with
amendments. It preserved the A8.1/A9 route, authorized no pre-A9 takeover, and
deferred framework selection to a NUI-F0 same-vertical Slint versus Aelyris
retained-runtime comparison.

The decision includes current native coverage v2, representative
input/render/memory/soak, IME, accessibility, recovery, dependency/license and
maintenance cost, Windows 10/11 support, rollback, and release timing. Historical
v1 `98%` evidence cannot authorize promotion.

ADR-015 amends activation sequencing: latest required-CI repair comes first,
then the general Mission product-access vertical may proceed while A9
operator/external certification remains pending. NUI-F0-F7 remains the accepted
strategic native program, but activation requires that Product-Accessible Mission path
plus measured evidence that the current surface blocks two named core journeys or one
release-blocking defect without a simpler repair. Windows 11 x64 is primary and
Windows 10 compatibility is measured separately when that gate is reached.

### A8.1 measured native terminal decision

A8 uses representative input/render/memory/soak evidence. Promoting a native
renderer is conditional; a measured `do_not_promote` decision can be correct.
Work OS excitement cannot replace IME, accessibility, parity, or performance proof.

### A9 release and external closeout

A9 still owns:

- blocking CI and distribution build;
- signed artifact, provenance, updater lifecycle;
- install/relaunch/rollback and crash diagnostics;
- real Windows/WebView2/DWM and real sleep/resume/long-running proof;
- exact operator/external handoff and current artifact capture;
- final goal audit, completion matrix, quality score, safe no-token chain, and
  truthful `releaseCandidateReady` claim.

No A7 or Apex feature converts an external/operator gate into repo-owned PASS.

## 7. Apex Roadmap — Post-A9 Product Waves

A8.0 accepted ADR-014 with amendments, and ADR-015 retained that strategic direction
while adding product-delivery and measured-necessity entry gates. NUI-F0-F7 is no
longer the automatic first repo mutation after A9; the general Mission vertical in
`product-delivery-instructions.md` precedes activation. These Apex waves still begin
after NUI closes or is retired once NUI is actually activated, preserving the internal
V1-V9 dependency order without turning an unactivated migration into current work.

These waves are tracked destination work, not hidden R0-A9 completion criteria.
Each wave gets its own spec inventory, focused commits, verifiers, CI, and claim.

Apex capabilities are post-release product waves. Before release, only isolated,
non-shipping research spikes may be separately authorized. A spike may not modify
the shipping path, enter public capability claims, block or satisfy R0-A9, or
receive release-completion credit.

Wave numbers express product sequencing, not a sufficient linear dependency.
Every wave must enter through the declared gates, freeze baseline and target
measures before claiming impact, retain a disable/rollback or retirement path,
state data compatibility, and keep an explicit claim boundary. If no baseline
exists, instrumentation is the first slice and no impact claim is promoted.

| Wave | Entry gates | Required measure | Reversibility / data compatibility | Claim boundary |
| --- | --- | --- | --- | --- |
| V1 Universal Agent Fabric | A7 adapter/capability contract + A9 release baseline; accepted V1-R0 decision artifact before a production adapter | conformance parity, unsupported-capability honesty, resume/fork loss rate | PTY fallback; adapter-disable; Mission ids/events remain portable | no provider parity until each adapter gate passes |
| V2 Mission Time Machine | A7 Chronicle/checkpoint/packet integrity | projection hash equality, replay side-effect count `0`, recovery RTO/RPO | disable effectful recovery; keep inert replay; never rewrite accepted history | no time-travel claim from snapshot restore alone |
| V3 Qralis Coordination | Mission/Chronicle/capability gates | delivery loss `0` within tier, duplicate idempotency, coordination attention | revoke role leases; fall back to bounded single-lane dispatch | no swarm/autonomy claim from messaging alone |
| V4 Skill Foundry | existing Proofbook runner/ledger plus packet/evaluation provenance and V2 durability | held-out delta, unsafe-promotion count `0`, rollback success | deactivate candidate; restore prior signed/digested version; retain lineage | no self-improvement claim from candidate generation |
| V5 Decision Lab | V3 coordination plus cost and human-gate policy | decision quality rubric, dissent retention, bounded cost/latency | disable council policy; retain ordinary Mission decision path and record | no consensus-as-truth claim |
| V6 Counterfactual Arena | V2 replay, V5 decision contract, isolated capability boundary | isolation escapes `0`, comparable-proof coverage, budget guardrail | kill Shadow runtime, revoke leases, preserve immutable comparison evidence | no winner claim from model vote |
| V7 Temporal Project Twin | Chronicle, ownership, and proof lineage | stale-proof recall/precision, false-conflict rate, rebuild determinism | rebuild projection from owners; never mutate source ownership/proof | no canonical-state claim for the projection |
| V8 Governed Remote Control | A7 Mission/packet projection plus capability/recovery proof; establish scoped read-only before any write | parity, stale-fingerprint denial, disconnect recovery, secret leak `0` | revoke all remote-write leases; local emergency steal; read-only fallback | no remote-write claim before its read-only tier passes |
| V9 Extension/Federation | A9 signing/provenance/revocation plus V1 conformance | signature/revocation coverage, sandbox escape `0`, uninstall integrity | quarantine/uninstall/revoke; preserve core data and adapter compatibility | no marketplace/A2A trust claim from discovery alone |

### Apex V1 — Universal Agent Fabric Expansion

Build:

- run V1-R0 against OpenCode as the first named structured-runtime candidate,
  compare ACP, HTTP/SSE, and the current visible PTY under one fixed Mission
  fixture, and select at most one OpenCode production path from evidence;
- production ACP adapter and conformance suite for supported external agents;
- SDK adapter for typed embedded runtimes with isolation and event mapping;
- capability-aware session resume/fork/export and structured tool/diff/usage
  streams across adapters;
- explicit capability negotiation and version compatibility; no text inference;
- A2A remains V9 after signing/federation trust.

Acceptance:

- shared Mission/runtime/capability/evidence identity across PTY, ACP, and SDK;
- unsupported/conditional capability and disconnect/resume/fork negative fixtures;
- adapter cannot become a state, permission, completion, or event owner.

Unlocks:

- Codex, Claude, Hermes, OpenHands-like runtimes, and future agents can join one
  governed Mission without provider-specific core ontology.

#### V1-R0 — OpenCode Candidate Adapter Comparison

Execution position: after A9 establishes the current release baseline and before
any V1 production adapter. This plan does not alter the active
`A4 through A4.12 -> A6.2e1-A6.8 -> A7 -> A8 -> A9` order. A pre-release experiment
would require a separate authorization under the isolated non-shipping rule above;
it may not block, satisfy, or receive credit for R0-A9.

Value hypothesis:

- a structured runtime can expose session, tool, diff, permission, usage, and
  disconnect facts without terminal-text inference;
- Aelyris can preserve one Mission/runtime/capability/evidence identity while the
  execution engine is replaced;
- the defensible edge is proof-carrying runtime portability and fail-closed
  governance, not bundling OpenCode features or rebranding its TUI.

Comparison contract:

- run the same repository, task, model/provider class, budget class, acceptance
  clauses, and Aelyris Mission identity through visible PTY, OpenCode ACP, and
  OpenCode HTTP/SSE;
- compare capability coverage, event fidelity, permission deny equivalence,
  diff/evidence completeness, reconnect loss, operator visibility, latency/cost,
  and secret exposure;
- pin the OpenCode binary/version, provenance, license, auto-update policy,
  OpenAPI/schema digest, and adapter compatibility range;
- prove loopback-only launch, race-safe port ownership, short-lived server
  credentials, process-tree cleanup, and configuration/provider-auth isolation.
  `OPENCODE_CONFIG_DIR` alone is not an isolation proof because OpenCode merges
  configuration sources;
- map all accepted facts into the existing `AgentSession`,
  WorkExecutionAttempt/execution-generation, WorkEvent/Chronicle, capability,
  Proofbook, review, and merge owners. Do not create an OpenCode-owned Mission,
  TaskGraph, journal, permission authority, completion truth, or merge owner;
- treat missing OpenCode, unsupported capability, schema drift, ambiguous event
  replay, and disconnect uncertainty as typed non-success. Preserve the visible
  PTY fallback and never claim exactly-once delivery.

Decision:

- **promote one path** only when it materially beats visible PTY for structured
  fidelity or recovery while every authority, secret, and owner invariant passes;
- **hold** when the benefit is plausible but a required capability or negative
  fixture is unresolved;
- **reject/retire** when the adapter bypasses the Control Kernel, leaks config or
  credentials, cannot reconcile uncertain effects, duplicates an owner, or has no
  meaningful advantage over PTY;
- a production OpenCode adapter remains Apex V1 work. An Aelyris Runtime TUI is a
  separate value hypothesis after the adapter and daemon projection are proven;
  it is not bundled into V1-R0 or allowed to replace the Tauri cockpit by default.

Primary capability sources for the experiment are the OpenCode
[server/OpenAPI/SSE contract](https://opencode.ai/docs/server/),
[ACP subprocess contract](https://opencode.ai/docs/acp/), and
[configuration precedence contract](https://opencode.ai/docs/config/). Current
documentation is discovery input, not proof that a pinned local version behaves
correctly.

#### V1-R1 — Structured State Authority And Explainability

After `V1-R0` returns `promote_one`, map the promoted runtime's snapshot/events
into existing `AgentSession`, WorkEvent, capability, and Mission projections. The
adapter must explain which source fact produced each state and must preserve typed
unsupported, gap, stale, and reconcile states. It may not own a second session
graph, journal, permission system, Decision store, or completion truth.

Acceptance requires deterministic snapshot-plus-event reconstruction, causation
links for user-visible state, adapter-disable fallback, and no silent inference
when source facts are absent or contradictory.

#### V1-R2 — Quarantined External-Run Adoption

An external run may be discovered and inspected before it is trusted. Adoption
creates an isolated, capability-free quarantine projection, binds source identity,
version/schema, repository and OID, environment, event cursor, and provenance,
then reconciles it against an accepted Mission contract. External-run inputs
cannot mutate Aelyris owners, issue a lease, or receive completion credit until
explicit adoption and focused negative gates pass.

#### V1-R3 — Conditional Aelyris Runtime TUI

This product-surface hypothesis opens only after `promote_one`, V1-R1
daemon-owned projection proof, and V1-R2 quarantine proof. The TUI is a projection
and control adapter over the same Control Kernel; it cannot replace the Tauri
cockpit by default or become an owner. Schema/snapshot/event/direct-attach ideas
from external runtime tools remain discovery input until pinned execution proves
them.

### Apex V2 — Mission Time Machine

Build:

- canonical WorkEvent/journal convergence beyond the First Mission minimum;
- deterministic projection replay and timeline scrub;
- checkpoint inventory, recovery worktree/branch, compensation plans;
- uncertain/irreversible effect reconciliation.

Acceptance:

- equal snapshot/event stream yields equal projection hash;
- replay causes zero external mutation;
- recovery preserves audit history and revokes old capabilities.

Unlocks:

- inspect why any state exists, return to a proven checkpoint, and explore a
  recovery without destructive history rewrite.

### Apex V3 — Qralis Coordination Fabric

#### V3a — Typed Message And Team Coordination

Build:

- addressed inbox/history/read state and delivery policies;
- typed addressed messages, Task Claims, Role Leases, directives, driver trust,
  bounded context packets, Decision Ledger references, and Attention projection;
- Result Capsule coordination projections that reference a
  `CompletedWorkPacket` or `BlockedWorkPacket` and never own completion;
- a thin transport may be replaceable, but transport rows and read state are not
  Mission, TaskGraph, Decision, obligation-fulfillment, or completion truth;
- event-driven coordination rather than periodic agent polling;
- causal linking to Mission, ownership, pane, proof, and decisions.

#### V3b — Obligation-Driven Team Operations

Build:

- an Obligation Ledger projection of typed fulfillment obligations referencing
  the owner event, DecisionCase, packet, verifier, or human action that can close
  them;
- event-driven dispatch from durable owner events, not periodic agent polling;
- adaptive governance bounded by Mission risk/budget/reviewer policy;
- a Verified Action Surface generated from capability-scoped Control descriptors;
- team-operation projections compiled from existing Mission, ownership, Qralis,
  Attention, decision, and packet owners.

Reading or acknowledging a message never fulfills an obligation. Generic chat,
arbitrary JavaScript, a fixed 11-agent team, a parallel scheduler, or a second
Decision/operation journal is outside the contract.

V3a/V3b acceptance:

- no lost directive under restart within the documented durability tier;
- duplicate delivery is idempotent;
- task claim, role lease, obligation, result, and attention transitions retain
  causal owner references and cannot be forged by message payload alone;
- message is never mistaken for completed work, obligation fulfillment, a
  decision, or verified memory;
- role leases can be revoked and dispatch can fall back to a bounded single lane.

Unlocks:

- agents coordinate as a durable team rather than a noisy swarm.

### Apex V4 — Verified Skill Foundry And Team Memory

Build:

- productize the existing Proofbook runner/ledger with UI, recipes,
  Fleet Briefing/budget integration, fan-out/subProofbook, and Evidence Store;
- scheduled/event-triggered and deterministic no-agent jobs;
- evidence-backed MemoryClaim and SkillCandidate proposal/evaluation/activation;
- proof-preserving PB-6 distillation proposals binding source trace and
  environment snapshot, declared side effects, proof-equivalence comparators,
  repeated and held-out differential replay, and visual proof where behavior is
  user-visible;
- prompt-injection/poison/PII/consent/retention/deletion policy;
- held-out evaluation, capability manifest, sandbox/Proofbook boundary, provenance,
  signing/digest pin, versioning, expiry/stale invalidation, canary, monitoring,
  rollback, and capability reduction/non-broadening.

Acceptance:

- UI matches runner/ledger truth;
- raw chat/log/self-report cannot promote;
- candidate beats or safely equals baseline on frozen evals;
- distilled proposals preserve required effects and proof across supported
  environments, broaden no capability, and fail closed on source/tool/schema/
  environment drift;
- source Proofbook is never auto-mutated.

Unlocks:

- the AI team learns repeatable expert procedures from proven outcomes without
  silently rewriting its own rules.

### Apex V5 — Decision Lab And Adversarial Council

Build:

- bounded independent proposals and fixed-rubric critique;
- builder/falsifier/security/performance/user-advocate roles;
- preserved dissent and decision hash binding;
- policy triggers only for high-blast-radius decisions.

Acceptance:

- proposal isolation, cost cap, dissent retention, human-gate policy, and Mission
  revision binding are proven;
- routine work does not invoke mandatory multi-model debate.

Unlocks:

- difficult choices become inspectable evidence and trade-offs rather than one
  persuasive model answer.

### Apex V6 — Counterfactual Arena

Build in two steps:

1. static plan comparison from the same Mission contract;
2. isolated Shadow Missions with same base, proof, budget class, and independent
   review.

Acceptance:

- worktrees/runtime/capabilities are isolated;
- publication, signing, shared migration, external mutation, and main merge are
  denied by default;
- winner/synthesis is selected by fixed acceptance and proof, not model vote.

Unlocks:

- compare multiple plausible futures and choose the most proven implementation.

### Apex V7 — Temporal Project Twin

Build:

- time-aware Mission/symbol/ownership/proof/dependency projection;
- merge impact, stale-proof invalidation, rebase and revalidation queue;
- failed-approach and accepted-skill lineage.

Acceptance:

- projection cannot mutate authoritative owners;
- every invalidation maps to an evidence dependency rule;
- false conflict and missed stale-proof rates are measured.

Unlocks:

- understand who is changing what, which proof will break, and what must be
  revalidated before conflict reaches merge.

### Apex V8 — Governed Remote Control And Runtime Domains

Build:

- establish the scoped read-only companion first, then add
  steer/approve/deny/stop;
- writable attach with pane baton, process/domain identity, capability expiry,
  stale-fingerprint checks, disconnect recovery, and local emergency steal;
- RuntimeDomain parity for SSH/devbox/container targets.

Acceptance:

- the V8 read-only proof is green before writable projection parity, fingerprint checks,
  secret scan, lease expiry/revocation, disconnect/stale-state and emergency-steal
  proof pass;
- remote client owns no workspace state.

Unlocks:

- safely monitor and unblock the fleet away from the workstation without turning
  a phone into an unsafe full IDE.

### Apex V9 — Signed Extension And Agent Federation

Build:

- local extension registry for adapters/tools/Proofbooks/parsers/read-only UI;
- manifest, digest, signature, compatibility, capabilities, resource limits,
  fixtures, revoke/uninstall;
- later curated marketplace and signed A2A federation.

Acceptance:

- extension cannot own domain state, mutate private DB, issue capability, grant
  approval, merge, or access undeclared secret/network/filesystem scope;
- supply-chain signing, provenance, revocation, and negative fixtures are current.

Unlocks:

- a safe ecosystem where new agents and workflows plug into Aelyris trust and
  proof rather than fragmenting it.

## 8. Prioritization Matrix

| Candidate | Delight | Strategic moat | Dependency | Timing |
| --- | ---: | ---: | --- | --- |
| Now/Next/Unlocks + Mission spine | high | highest | A6 stable owners | A7 Core |
| immutable CompletedWorkPacket | medium-visible, high trust | highest | Mission/proof/review | A7 Core |
| pane control baton + semantic command evidence | high | high | runtime/input authority | A7 Core bounded path |
| capability kernel | low-visible, critical | highest | governance inventory | A7 Core bounded path |
| Mission Rehearsal | high | high | WorkGraph/proof/capability catalog | A7 Core |
| OpenCode structured-adapter comparison | high if portability proof wins; low if it is only another provider integration | high only with one governed identity across runtimes | A7 adapter contract + A9 release baseline | Apex V1-R0 |
| Universal Agent Fabric expansion | very high | high | A7 adapter/capability contract | Apex V1 |
| Mission Time Machine | very high | high | Chronicle convergence | Apex V2 |
| Verified Skill Foundry | very high | highest | packets/evals/existing Proofbook ledger | Apex V4 |
| Decision Lab | high | medium-high | Qralis/cost/evidence | Apex V5 |
| Counterfactual Arena | very high | high | replay/isolation/packets | Apex V6 |
| Temporal Project Twin | high | highest | ownership/proof lineage | Apex V7 |
| Governed Remote Control | high | medium-high | A7 Mission/packet projection plus capability/parity | Apex V8 |
| Marketplace/A2A federation | high | medium, risky early | release supply-chain proof | Apex V9 |

## 9. Four-Layer Differentiation And Evolution Audit

This roadmap is not an imitation backlog. Competitor and protocol research only
establishes what is already commodity substrate and where interoperability ports
are useful. Product sequencing follows four layers.

### 9.1 Borrowed Substrate — Use It, Do Not Brand It

- durable mux identity, subscriptions, flow control, reattach, and backpressure;
- visible pane/worktree fleet, mission tree, mailbox, and review context;
- typed append-only events, snapshot/event persistence, fork, and runtime ports;
- fact memory versus procedural skill separation and isolated delegation;
- structured ACP, MCP, and later A2A adapters;
- native terminal semantics and shell integration.

These enter through bounded adapters and conformance suites. They cannot become a
second Mission, TaskGraph, journal, dispatcher, permission, Proofbook, completion,
or project-state owner.

### 9.2 Aelyris-Owned Higher-Order Concepts

- Mission / Project Work-and-Proof Graph as durable semantic truth;
- Qralis semantic air-traffic control over planned writes, symbol/function leases,
  dependencies, and behavior contracts;
- proof sovereignty that separates activity, gate result, acceptance, merge, and
  release claims;
- capability-bound effects and proof-carrying hot-swap continuity across agents;
- evidence-governed project memory and skill promotion.

These contracts define Aelyris even if every provider, protocol, runtime, and UI
adapter is replaced.

### 9.3 Original Surprises — Experience Unlocks

| Experience | First bounded delivery | Full evolution gate |
| --- | --- | --- |
| Project Flight Recorder | A7 Chronicle range and click-through completion evidence | Apex V2 deterministic historical replay and recovery |
| Conflict Radar | A7 ownership/capability rehearsal for the First Mission | Apex V3/V7 semantic coordination and temporal impact projection |
| Proof-Carrying Handoff | A7 restart reconstruction with exact blockers and evidence | Apex V1/V2 provider hot-swap and replayable recovery |
| Confidence Topology | A7 Now/Next/Unlocks, proof freshness, and typed blocker terrain | Apex V7 cross-project proof invalidation and revalidation |
| Trust Unlocks / Team Memory Compiler | A7 reports the capability unlocked by accepted proof | Apex V4 evidence-evaluated memory and skill activation |

An experience name grants no claim. Each row stays bounded by its current A7 gate
and its separately accepted post-release gate.

### 9.4 Post-Release Evolution Waves

1. **Interoperate and recover (`Apex V1-V2`)** — widen the agent fabric, then make
   Mission history inspectable and recoverable without repeating unknown effects.
2. **Coordinate and learn (`Apex V3-V4`)** — add durable semantic team control,
   then promote only proven repeatable work into governed memory and skills.
3. **Reason over alternatives (`Apex V5-V7`)** — preserve dissent, compare isolated
   futures, and project ownership/proof consequences through time.
4. **Extend trust outward (`Apex V8-V9`)** — add governed remote effects, then a
   signed extension and A2A federation boundary.

R0-A9 remains Wave 0 and retains every existing completion criterion. No borrowed
substrate, original surprise, or Apex design substitutes for a missing repo,
policy, operator, external, native-quality, signing, updater, or release proof.

## 10. Work Packet Template

Every future implementation slice derived from this roadmap must state:

```yaml
work_packet:
  phase: <tracked phase>
  slice: <exact slice>
  now: <one current action>
  next: <one dependency-unblocked action>
  unlocks: <user-visible capability>
  owner: <single state/contract owner>
  dependencies: []
  contracts: []
  source_paths: []
  test_paths: []
  verifier_command: <command>
  artifact_path: <safe relative path>
  negative_cases: []
  entry_gates: []
  success_measures:
    - metric: <id>
      baseline_artifact: <safe relative path>
      target: <value>
      guardrail: <value>
  reversibility:
    kill_switch: <path or explicit none>
    rollback_or_retire: <procedure>
    data_compatibility: <contract>
  rendered_acceptance: []
  repo_blockers: []
  policy_blockers: []
  operator_blockers: []
  external_blockers: []
  claim_boundary: <what this slice does not prove>
```

One phase/slice remains one focused commit after proportionate verification.
Push/PR/merge/rebase/reset/amend/history rewrite remain outside standing commit
authorization.

## 11. Destination Experience

When the Apex roadmap is mature, a user can type a desired outcome such as
"add authenticated collaboration." Aelyris first shows affected symbols, agent
and worktree layout, critical path, cost range, permissions, evidence, risk, and
rollback limits. High-risk choices can enter Decision Lab.

Approved agents then work in visible real PTYs or explicit structured adapters.
Qralis distributes bounded context and ownership; capability leases prevent
unauthorized effects; the Chronicle explains causation. The user may leave and
return to a precise Fleet Briefing, or intervene remotely through scoped control.
Restart restores the same Mission state instead of trusting process memory.

Completion produces an immutable packet binding commit, ownership, exact gates,
artifact hashes, independent review, residual risk, merge, replay, and rollback.
Successful work can propose a versioned expert skill and must beat frozen
evaluations before activation. Counterfactual Arena can compare alternative
implementations from the same contract.

At that point Aelyris is no longer best described as an agent terminal. It is the
trust, coordination, recovery, and learning layer for local AI software teams.
