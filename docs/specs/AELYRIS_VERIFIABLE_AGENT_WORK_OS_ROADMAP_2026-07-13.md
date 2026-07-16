# Aelyris Verifiable Agent Work OS Roadmap — 2026-07-13

Status: tracked product roadmap; active execution remains the R0-A9 remediation
program

Last reviewed: 2026-07-13 JST

## 0. Roadmap Contract

This roadmap integrates the 2026-07-13 product/architecture audit without
shrinking or indefinitely expanding the Comprehensive Audit Remediation goal.

- **Now**: finish the active R0-A9 phase/slice in dependency order.
- **Next**: implement a finite Core Mission Loop in A7 after A6 acceptance.
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

At this roadmap checkpoint:

- R0-A3 and A5 repo-owned remediation remain recorded complete; A4 was reopened by
  a fresh runtime-integrity regression review;
- A2 signed lifecycle and A4 real-host power/sleep proof remain explicit A9
  operator/release gates rather than repo-owned PASS;
- A4.7 authoritative mutation correction is complete and A4.8-A4.12 are active/planned;
- A6 modularity is paused at its existing frontier, not superseded;
- A6.2c-A6.2d extraction is landed but A6.2 acceptance is reopened by review;
- A6.2e0 exact continuation/worklog hardening is complete;
- A4.8 is the next runtime implementation slice; A6.2e1 remains the exact A6 resume
  slice after A4.12 closes the corrective runtime-integrity sequence;
- A7, A8, A9, blocking CI, and external/operator release evidence remain open;
- current public status remains alpha and not release-ready.

The current design checkpoint unlocks a frozen product direction and prevents
random feature accumulation. It does not unlock a shipped capability.

## 4. Remediation Program Integration

| Phase / slice | Now: work | Acceptance | What completion unlocks |
| --- | --- | --- | --- |
| A6.2v1 | freeze Work OS spec, detailed design, roadmap, authority, and verifier | docs/spec/design/plan/index/claim gate PASS | one coherent product target and finite A7 contract; no runtime claim |
| A4.7-A4.12 corrective | authoritative commit order, durable event delivery, execution fence, all-owner startup reconciliation, handoff quarantine, crash matrix | fail-closed failure injection plus combined restart proof | truthful durable substrate; resume A6.2e1 without a second graph/journal |
| A6.2e1-e4 | dependency boundaries, narrow subscriptions, project/tab semantics, concurrent state owners | executed behavior plus fail-closed ratchets | trustworthy frontend owners that can render Mission state without duplicating it |
| A6.2f-g | split composition/hotspot tests and pass blocking frontend acceptance | App and extracted owners <=800, behavior/CI green | modular cockpit ready to receive Mission projections |
| A6.3-A6.8 | IPC/MCP/DB/native owner splits, dead-owner proof, aggregate ratchet | owner-specific and combined blocking gates | backend seams stable enough for one Mission vertical |
| A7.0-A7.8 | Core Mission Loop | restart-safe successful First Mission, Proofbook/recipes/cost, remote read-only, and immutable completion packet | trusted brief-to-proof workflow in one local/remote-observable cockpit |
| A8 | measured native terminal spike | parity/perf/soak decision evidence | evidence-based renderer direction, including a valid no-promote result |
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

### A7.0 — Mission Contract Gate

Now:

- inventory exact TaskGraph, audit journal/EventBus, governance, ownership,
  Proofbook, review, merge, and projection owners;
- freeze the immutable `MissionDefinitionRevision`, derived
  `MissionExecutionProjection`, `WorkUnitDefinition`, progress/ready-work,
  blocker/handoff, evidence/integrity, capability, `CompletedWorkPacket`,
  `BlockedWorkPacket`, and `MissionCompletionPacket` v1 contracts plus every
  referenced machine schema;
- inventory Tauri IPC, MCP, REST, WebSocket, CLI, visible PTY, Proofbook, review,
  merge, frontend-audit, and direct-DB faces; freeze the canonical Control Command
  registry/envelopes/errors and bypass-removal gates from
  `AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md`;
- freeze canonical UUIDv7, journal sequence scope, RFC 8785 serialization,
  digest/integrity tiers, unknown-field/version policy, units, and owner mapping;
- add requirement/spec/design/traceability and fail-closed schema verifier.

Acceptance:

- no duplicate owner or migration before inventory;
- exact state transitions, OID binding, freshness, blocker split, and negative
  fixtures are frozen;
- the fixed First Mission has 3-12 work units, one visible implementer, independent
  reviewer, Proofbook run, denial fixture, restart, exact-OID accepted merge, and
  scoped read-only remote observation; A7 caps 20 work units, 4 agents, 8 panes,
  256 KiB event payloads, 10,000/64 MiB observational backlog, 250 ms projection
  p95, 1 second freshness, 15 second restart RTO, and RPO=0 for critical facts;
- all target runtime claims remain false.

Unlocks:

- implementation can proceed without inventing contracts inside UI/IPC code.

### A7.1 — Mission Spine And Chronicle Minimum

Now:

- evolve the existing TaskGraph owner to persist accepted Mission revision,
  desired outcome, proof requirements, capability unlock, and symbol intents;
- define the minimal typed `WorkEventEnvelope` used by First Mission;
- converge required audit/EventBus paths without creating a third journal;
- project Now/Next/Unlocks from backend owners and reconstruct after restart.

Acceptance:

- restart yields the same Mission/work state and projection hash;
- event sequence, causation, redaction, idempotency, and no-silent-drop fixtures
  pass for the bounded First Mission path;
- frontend contains no duplicate Mission status logic.

Unlocks:

- a durable Mission can explain current work, next exact action, and intended
  capability before and after process restart.

### A7.2 — Capability And Agent Fabric Minimum

Now:

- implement human operator, local agent, and system reconciler principals;
- issue short-lived capability leases for the PTY, IPC, MCP, Proofbook, review,
  and merge paths used by First Mission;
- route enabled actions through one canonical Control Kernel with generated
  schemas/catalog metadata, principal propagation, idempotency, cancellation,
  backpressure, and event/evidence equivalence; no adapter-local business owner;
- bind process tree/generation, monotonic clock, canonical Windows resource handle,
  network/DNS/redirect policy, budget units, action/resource/lane, args, base/head
  OID, expiry, one-use reserve/effect/commit/uncertain, and approval;
- prove equivalent allow/deny behavior across enabled surfaces.
- freeze PTY/ACP/SDK/A2A capability descriptors and conformance fixtures; A7 runs
  the visible PTY path and reports unavailable structured capabilities as typed
  unsupported rather than claiming production ACP/SDK/A2A adapters.

Acceptance:

- replayed/concurrently reserved, expired, widened, stale-OID, wrong-lane,
  wrong-args, PID-reused, junction/UNC/ADS-escaped, DNS-rebound/redirected, or
  clock-rolled-back capability is denied before effect;
- secret values never enter Mission/event/packet evidence;
- agents cannot issue or widen their own lease.

Unlocks:

- the visible PTY agent is governed by one enforceable trust boundary, and future
  ACP/SDK/A2A adapters have a fixed conformance boundary instead of a bypass.

### A7.3 — Plan Preview And Visible First Mission

Now:

- render Mission Rehearsal with dependencies, critical path, symbol collisions,
  agents/panes/worktrees, capability queue, proof, risk, irreversible effects,
  and measured-versus-estimated budget;
- run one real implementation through a visible PTY and existing ownership,
  TaskGraph, Proofbook, review, and merge spines;
- expose pane control baton and semantic command evidence for that path.

Acceptance:

- rehearsal invokes no effectful port;
- every write is correlated to Mission/work unit/principal/capability/ownership;
- unsupported adapter capability fails explicitly;
- hidden/headless mode is not used for the visible implementation agent.

Unlocks:

- a user can preview and then watch a governed plan execute rather than trust an
  opaque background agent.

### A7.4 — Completion Settlement

Now:

- collect exact commit/OID, acceptance-clause coverage, Chronicle range/root,
  owned diff, executed gates, artifact integrity, computed reviewer lineage/
  independence, capability provenance, residual risk, and typed recovery/replay;
- create immutable `CompletedWorkPacket` only with accepted independent review,
  current complete coverage, and zero acceptance blockers;
- create a separate `BlockedWorkPacket` for repo/policy/operator/external blockers,
  authority/inputs/command/result/artifacts, and next action; a
  `BlockedWorkPacket` grants zero completion credit;
- aggregate the exact required work-unit packets and Mission-level acceptance into
  a distinct `MissionCompletionPacket`; one work-unit packet cannot complete the
  Mission;
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

### A7.5 — Proofbook Product, Recipes, Budget/Cost, And Fleet Briefing

Now:

- ship the pre-existing A7 Proofbook canvas, run timeline, and proof inspector as
  projections of the current runner/ledger;
- provide versioned fleet recipes and daily since-last-seen Fleet Briefing;
- show measured currency/token/time/resource cost with explicit units and label
  estimates separately;
- keep Evidence Store a projection and forbid frontend run/settlement ownership.

Acceptance:

- UI/ledger consistency, no duplicate runner, no source-Proofbook auto-mutation,
  recipe precondition/version, and cost-unit/unknown-value fixtures pass.

Unlocks:

- users can inspect proof, repeat governed fleet patterns, and understand accepted
  work cost without trusting invented metrics.

### A7.6 — Remote Read-Only Continuity

Now:

- ship the pre-existing A7 read-only remote requirement for Mission progress,
  Attention, Fleet Briefing, pane preview, Chronicle, Proofbook, decisions, and
  packet review;
- bind device/session and project/Mission/pane/evidence/event-range read scopes,
  byte/rate caps, expiry, revocation, redaction, and inert rendering.

Acceptance:

- OSC52/clipboard/link/escape/tool/artifact secret exfiltration, stale cursor,
  revoked device, over-scope, and disconnect buffering negative fixtures pass;
- no remote steer/approval/write or remote-owned workspace state.

Unlocks:

- users can safely inspect current work and proof away from the workstation.

### A7.7 — Mission Cockpit And Attention

Now:

- render backend-owned Now/Next/Unlocks in the existing cockpit header;
- rank/deduplicate attention items with owner, next action, evidence, freshness,
  and consequence;
- generate since-last-seen Fleet Briefing from causal events and packets;
- show measured cost/time separately from estimates.
- render one backend `recommendedNext` while retaining all backend `readyWork[]`
  lanes for parallel visibility.

Acceptance:

- project change, restart, stale event, or out-of-order result cannot publish a
  mixed generation;
- each warning maps to an exact owner and action;
- a frontend timer, token heuristic, or agent string cannot create a trust claim.

Unlocks:

- the user can leave, return, and understand progress or intervene in minutes.

### A7.8 — Successful First Mission Acceptance

Scenario:

1. submit one useful brief;
2. accept versioned plan/rehearsal;
3. execute in a visible PTY with ownership and capability leases;
4. restart midway and reconstruct exact projection;
5. run fresh gates and independent review;
6. inspect Proofbook/recipe/cost and the scoped read-only remote projection;
7. merge the exact accepted OID successfully;
8. verify immutable `CompletedWorkPacket` children, acceptance coverage, integrity
   tier, reviewer lineage, and Chronicle root;
9. verify the exact `MissionCompletionPacket` aggregate;
10. render truthful Now/Next/Unlocks throughout.

Acceptance:

- all A7.0-A7.7 child gates and blocking CI are current and green;
- no inferred completion truth, no acceptance blocker, and no unclassified failure;
- a separate negative scenario produces `BlockedWorkPacket`, preserves exact
  continuation, and proves Mission/A7 remain incomplete; it cannot replace the
  successful First Mission;
- A7 aggregate alone does not claim release-ready.

Unlocks:

- Aelyris has one proven end-to-end Verifiable Agent Work OS vertical.

## 6. A8 And A9 Remain Unchanged Release Gates

### A8 measured native terminal decision

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
| V1 Universal Agent Fabric | A7 adapter/capability contract and current release baseline | conformance parity, unsupported-capability honesty, resume/fork loss rate | PTY fallback; adapter-disable; Mission ids/events remain portable | no provider parity until each adapter gate passes |
| V2 Mission Time Machine | A7 Chronicle/checkpoint/packet integrity | projection hash equality, replay side-effect count `0`, recovery RTO/RPO | disable effectful recovery; keep inert replay; never rewrite accepted history | no time-travel claim from snapshot restore alone |
| V3 Qralis Coordination | Mission/Chronicle/capability gates | delivery loss `0` within tier, duplicate idempotency, coordination attention | revoke role leases; fall back to bounded single-lane dispatch | no swarm/autonomy claim from messaging alone |
| V4 Skill Foundry | Proofbook/packet/evaluation provenance plus V2 durability | held-out delta, unsafe-promotion count `0`, rollback success | deactivate candidate; restore prior signed/digested version; retain lineage | no self-improvement claim from candidate generation |
| V5 Decision Lab | V3 coordination plus cost and human-gate policy | decision quality rubric, dissent retention, bounded cost/latency | disable council policy; retain ordinary Mission decision path and record | no consensus-as-truth claim |
| V6 Counterfactual Arena | V2 replay, V5 decision contract, isolated capability boundary | isolation escapes `0`, comparable-proof coverage, budget guardrail | kill Shadow runtime, revoke leases, preserve immutable comparison evidence | no winner claim from model vote |
| V7 Temporal Project Twin | Chronicle, ownership, and proof lineage | stale-proof recall/precision, false-conflict rate, rebuild determinism | rebuild projection from owners; never mutate source ownership/proof | no canonical-state claim for the projection |
| V8 Governed Remote Control | A7 remote read-only plus capability/recovery proof | parity, stale-fingerprint denial, disconnect recovery, secret leak `0` | revoke all remote-write leases; local emergency steal; read-only fallback | no remote-write claim while read-only is the proven tier |
| V9 Extension/Federation | A9 signing/provenance/revocation plus V1 conformance | signature/revocation coverage, sandbox escape `0`, uninstall integrity | quarantine/uninstall/revoke; preserve core data and adapter compatibility | no marketplace/A2A trust claim from discovery alone |

### Apex V1 — Universal Agent Fabric Expansion

Build:

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

Build:

- addressed inbox/history/read state and delivery policies;
- role leases, directives, driver trust, bounded context packets;
- event-driven coordination rather than periodic agent polling;
- causal linking to Mission, ownership, pane, proof, and decisions.

Acceptance:

- no lost directive under restart within the documented durability tier;
- duplicate delivery is idempotent;
- message is never mistaken for completed work or verified memory.

Unlocks:

- agents coordinate as a durable team rather than a noisy swarm.

### Apex V4 — Verified Skill Foundry And Team Memory

Build:

- expand the A7 Proofbook product with fan-out/subProofbook and Evidence Store;
- scheduled/event-triggered and deterministic no-agent jobs;
- evidence-backed MemoryClaim and SkillCandidate proposal/evaluation/activation;
- prompt-injection/poison/PII/consent/retention/deletion policy;
- held-out evaluation, capability manifest, sandbox/Proofbook boundary, provenance,
  signing/digest pin, versioning, expiry, monitoring, and rollback.

Acceptance:

- UI matches runner/ledger truth;
- raw chat/log/self-report cannot promote;
- candidate beats or safely equals baseline on frozen evals;
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

- extend the A7 read-only companion with scoped steer/approve/deny/stop;
- writable attach with pane baton, process/domain identity, capability expiry,
  stale-fingerprint checks, disconnect recovery, and local emergency steal;
- RuntimeDomain parity for SSH/devbox/container targets.

Acceptance:

- A7 read-only proof remains green; writable projection parity, fingerprint checks,
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
| Universal Agent Fabric expansion | very high | high | A7 adapter/capability contract | Apex V1 |
| Mission Time Machine | very high | high | Chronicle convergence | Apex V2 |
| Verified Skill Foundry | very high | highest | packets/evals/Proofbook UI | Apex V4 |
| Decision Lab | high | medium-high | Qralis/cost/evidence | Apex V5 |
| Counterfactual Arena | very high | high | replay/isolation/packets | Apex V6 |
| Temporal Project Twin | high | highest | ownership/proof lineage | Apex V7 |
| Governed Remote Control | high | medium-high | A7 read-only/capability/parity | Apex V8 |
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
