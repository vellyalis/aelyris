# Aelyris Verifiable Agent Work OS Detailed Design

Status: approved target design; not an implementation or release claim

Version: 1.1

Last reviewed: 2026-07-29 JST

## 0. Purpose And Source Order

This document turns the Verifiable Agent Work OS product specification into
backend ownership, schemas, state machines, protocols, failure behavior, and
acceptance gates. It extends existing Aelyris spines; it does not authorize a
parallel runtime.

Read in this order:

1. `docs/requirements.md` for claim policy.
2. `audit-remediation-instructions.md` and the active R0-A9 tracked plan.
3. `AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md` for requirements.
4. This document for architecture and detailed design.
5. `AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md` for sequencing.
6. Existing owner specs for visible PTY, TaskGraph, Qralis/message bus,
   Proofbooks, ownership, merge intent, and Remote Continuity.

If a conflict exists, preserve current claim policy and active remediation order,
then update this design. A7 implements only the finite canonical Core Mission
journey frozen by the 2026-07-29 scope lock. Deferred product requirements and
Apex features remain outside A7 Core unless the tracked plan explicitly promotes a
bounded slice without weakening release completion.

## 1. Architecture Invariants

1. Rust/backend owners hold authoritative Mission, runtime, proof, capability,
   review, merge, and learning state. React renders projections and issues intents.
2. `TaskManager`/TaskGraph evolves into the Mission/WorkGraph owner; no second DAG.
3. Existing mux/PTY/agent session owners remain the Runtime Fabric.
4. The audit journal is the WorkEvent migration origin; do not create a third log.
5. Event, Intent, Message, Directive, Activity, and Ownership are distinct types;
   their lifecycle facts share one causal envelope.
6. Existing Proofbook parser/runner/ledger remains the automation owner.
7. Existing review and exact-OID merge-intent owners remain authoritative.
8. One capability kernel governs MCP, IPC, CLI, REST, WebSocket, SSH, Proofbook,
   agent adapters, schedulers, and future extensions.
9. Unsupported adapter capabilities fail explicitly. Terminal text is not a typed
   tool result, approval, cost record, or completion signal.
10. Every state transition is idempotent or has an idempotency key, produces a
    causal event, and either commits atomically with domain state or reconciles.
11. External/operator proof stays distinct from repo-owned implementation proof.
12. An aggregate product gate never implies release readiness without A8/A9 and
    the unchanged final claim chain.

### 1.1 Threat Model And Trust Boundary

The design assumes every content-bearing input is untrusted until validated:

- an agent/model may be wrong, compromised, prompt-injected, or deliberately
  attempt capability escalation;
- repository files, issue text, instructions, terminal output, and retrieved
  memory may contain hostile instructions or poisoned facts;
- an MCP/tool/extension/skill may be malicious, over-permissioned, or return
  forged results;
- another local process may race files, impersonate a PID after reuse, alter
  sockets, or inspect broadly readable material;
- a remote device/session may be stolen or compromised and may exfiltrate data
  through read-only terminal, clipboard, OSC, evidence, or artifact streams;
- the operator may approve an irreversible action, but the system must preserve
  exact authority, scope, effect, and inability to roll it back.

Security goals cover least privilege, scoped effects, secret minimization,
prompt/data separation, durable provenance, stale/race rejection, explicit
reconciliation, and fail-closed claims. A fully compromised administrator/kernel
or a malicious actor who can rewrite the database, artifact store, application,
and local integrity keys together is outside the local integrity boundary.

SHA-256 content addressing detects accidental, stale, and partial mutation; it is
not by itself proof against that fully privileged attacker. WorkEvent and packet
chains therefore carry previous digests, anchor identity, verification policy, and
an optional OS-protected local signer. A9 release artifact signing/provenance is a
separate supply-chain claim and must not be inferred from local Mission integrity.

## 2. Bounded Contexts And Owners

| Context | Existing owner to extend | Target responsibility | Forbidden duplication |
| --- | --- | --- | --- |
| Mission & Work | `src-tauri/src/task/*`, orchestrator | Mission definitions/revisions, WorkGraph v2, progress projection, rehearsal | new frontend planner or second task DB |
| Runtime Fabric | mux, PTY, session, agent runtime | stable runtime identity, adapters, pane baton, domain capability | agent-specific session graphs |
| Control API | existing control owners plus Tauri/MCP/REST/WS/CLI adapters | canonical command registry, envelopes, all-face policy/evidence equivalence | transport dispatcher as business owner or second command registry |
| Qralis Coordination | Intent Bus, EventBus, context, message-bus work | messages, directives, delivery, role lease, bounded packets | peer chat as source of truth |
| Chronicle | audit journal + EventBus projection | typed causal lifecycle, replay cursor, snapshot hash, reconciliation | third append-only journal |
| Trust | governance, watchdog, approval | principals, capability leases, credential broker, cross-surface denial | adapter-specific permission policy |
| Proof & Settlement | Proofbook, evidence artifacts, review, merge intent | EvidenceRefV2, gate records, CompletedWorkPacket | frontend completion logic |
| Learning | decisions/context + Proofbook distillation | MemoryClaim, SkillCandidate, evaluation, activation, rollback | raw-chat auto-memory |
| Project Twin | ownership + knowledge graph + WorkGraph projection | temporal symbol/proof/dependency views | second index/ownership store |
| Experience | backend projections + React feature surfaces | Now/Next/Unlocks, attention, rehearsal/replay views | local heuristic status |
| Remote | Remote Continuity adapters | same projection, read-only first, scoped leases | remote-owned workspace state |
| Extension | future local registry | signed manifests and capability-brokered adapters | private DB mutation or grant authority |

Proposed module paths are targets, not current implementation claims:

```text
src-tauri/src/mission/          Mission contract, WorkGraph v2, projection, rehearsal
src-tauri/src/work_event/       canonical envelopes, journal adapter, replay/reconcile
src-tauri/src/capability/       principal, leases, credential broker, policy adapter
src-tauri/src/control/command/   command descriptors, envelopes, application ports
src-tauri/src/completion/       packets, digests, settlement, verification
src-tauri/src/agent/adapters/   PTY/ACP/SDK adapter capability surfaces
src-tauri/src/learning/         candidates, evaluation, promotion, rollback
src/features/mission/           typed read projections and user intents only
```

Before creating a target module, A7 inventory must prove which existing owner is
renamed, extended, or adapted. No module is created merely to match this diagram.

## 3. Identity Model

### 3.1 Stable identifiers

Identifiers are opaque UUID/ULID-like values and never array indexes or labels.

```text
WorkspaceId
ProjectId
MissionId
MissionRevision
WorkUnitId
RuntimeDomainId
PaneId
TerminalSessionId
LogicalAgentSessionId
PrincipalId
CapabilityLeaseId
ProofbookRunId
DecisionCaseId
CheckpointId
CompletedWorkPacketId
WorkEventId
```

`RuntimeIdentity` binds:

```text
workspace + project + mission + workUnit + runtimeDomain
+ pane + terminalSession + logicalAgentSession + agent identity
```

Reconnect may replace a process/transport identity while preserving the logical
session only when adoption proof succeeds. Respawn is a new process generation.

### 3.2 Schema, ID, Sequence, And Canonicalization Authority

- persistent identifiers use canonical lowercase hyphenated UUIDv7; labels,
  array indexes, PID alone, timestamps alone, and "UUID/ULID-like" strings are
  invalid identifiers;
- WorkEvent `Sequence` is an unsigned 64-bit decimal string, monotonically
  increasing within one canonical workspace journal; cross-workspace ordering is
  expressed by causation/correlation, not numeric comparison;
- Rust serde domain types are the implementation authority and generate/version
  machine-readable JSON Schema; TypeScript types are generated or runtime-
  validated projections, not handwritten competing schemas;
- accepted persistent schemas reject unknown fields and unknown enum variants;
  compatibility requires an explicit version reader/migration. Unknown event
  payload schemas are retained as opaque audit data but cannot drive mutation or
  completion;
- canonical JSON digests use RFC 8785 JSON Canonicalization Scheme over UTF-8;
  human text is NFC-normalized before validation, while Windows resource identity
  uses canonical handles rather than case-folded strings;
- every digest is domain-separated by schema id/version and names all excluded
  fields. Volatile display timestamps and locale may be excluded only by schema;
- numbers declare bounds and units. Values that can exceed JSON safe integer range
  use decimal strings.

A7.0 must freeze machine-readable definitions and owners for every referenced
type, including `AcceptanceClause`, `RiskPolicy`, `BudgetPolicy`, `RuntimePolicy`,
`GateRequirement`, `ArtifactRequirement`, `CapabilityTemplate`, `CapabilityScope`,
`ProofCoverage`, `RepositoryTruth`, `RedactionRecord`, `SymbolIntent`,
`ResourceIntent`, `ResourceRequest`, `CanonicalResourceHandle`,
`CanonicalResourceScope`, `NetworkScope`, `BudgetLimit`,
`NormalizedPolicyScore`, `EvidenceFreshnessPolicy`, `IntegrityEnvelope`,
`EvidenceLocator`, `AcceptanceCoverageEntry`, `ChronicleRangeProof`,
`ReviewerIndependenceProof`, `SafeOperatorCommand`, `RecoveryInstruction`, and
`ReplayInstruction`. Implementers may not invent placeholder shapes inside an
adapter.

### 3.3 Principal kinds

```ts
type PrincipalKind =
  | "human_operator"
  | "local_agent"
  | "remote_principal"
  | "extension_driver"
  | "system_reconciler";
```

An agent or extension may request, consume, or surrender a capability but cannot
mint or widen one.

### 3.4 Shared Portable References And Reconciliation

```ts
interface PrincipalRef {
  principalId: string;
  kind: PrincipalKind;
  workspaceId: string;
  logicalSessionId?: string;
}

interface VersionedRef {
  id: string;
  contractVersion: string;
  contentDigest: string;
}

interface RepositoryResourceRef {
  repositoryId: string;
  repoRelativePath: string;
  baseOid: string;
  headOid: string;
  blobOid?: string;
}

interface DissentRecord {
  principal: PrincipalRef;
  rubricId: string;
  summary: string;
  evidenceRefs: string[];
}

interface ExternalEffectRecord {
  effectId: string;
  action: string;
  resourceRef: string;
  reservationId: string;
  status: "not_started" | "observed" | "committed" | "uncertain" | "compensated";
  evidenceRefs: string[];
}

interface CompensationStep {
  stepId: string;
  preconditions: string[];
  requiredCapabilityTemplateId: string;
  expectedResult: string;
  evidenceRefs: string[];
}

interface ProvenanceEnvelopeRef {
  schema: "aelyris.evidence-provenance/v1";
  artifactPath: string;
  headOid: string;
  verifierDigest: string;
  inputHashes: Record<string, string>;
  executionIdentity: string;
  generatedAt: string;
  freshnessPolicyId: string;
  envelopeDigest: string;
}

interface ReconciliationCase {
  caseId: string;
  missionId: string;
  workUnitId?: string;
  commandId?: string;
  capabilityLeaseId?: string;
  state:
    | "opened"
    | "investigating"
    | "effect_confirmed"
    | "effect_absent"
    | "compensated"
    | "operator_required"
    | "closed";
  ownerPrincipalId: string;
  exactNextAction: string;
  deadline?: string;
  evidenceRefs: string[];
  openedByEventId: string;
  closedByEventId?: string;
}
```

`RepositoryResourceRef` is portable packet identity. Host-local
`CanonicalResourceHandle` remains mandatory for capability enforcement but is not
serialized as the only portable proof of an owned repository file.

Reconciliation is owner-controlled:

```text
opened -> investigating
investigating -> effect_confirmed | effect_absent | compensated | operator_required
effect_confirmed | effect_absent | compensated -> closed
operator_required -> investigating | closed
```

Only authoritative effect evidence closes a case. Timeout keeps
`operator_required`; it never converts uncertainty to failure or success.

## 4. Mission And WorkGraph Contracts

### 4.1 MissionDefinitionRevision And MissionExecutionProjection

```ts
interface MissionDefinitionRevision {
  schema: "aelyris.mission_definition/v1";
  missionId: string;
  revision: number;
  workspaceId: string;
  projectId: string;
  goal: string;
  desiredOutcome: string;
  capabilityOutcome: string;
  nonGoals: string[];
  baseOid: string;
  acceptance: AcceptanceClause[];
  riskPolicy: RiskPolicy;
  budgetPolicy: BudgetPolicy;
  runtimePolicy: RuntimePolicy;
  teamPolicy: TeamExecutionPolicy;
  workGraphDefinitionRevision: number;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
}

interface TeamExecutionPolicy {
  roles: Array<{
    roleId: string;
    capabilityProfileIds: string[];
    budgetProfileId: string;
    proofProfileId: string;
    mayImplement: boolean;
    mayReview: boolean;
    mayAuthorizeCompletion: boolean;
  }>;
  reviewerIndependencePolicyId: string;
  ownershipPolicyId: string;
  governancePolicyId: string;
}

interface MissionExecutionProjection {
  schema: "aelyris.mission_execution_projection/v1";
  missionId: string;
  acceptedDefinitionRevision: number;
  state: MissionState;
  activeWorkUnitIds: string[];
  nextWorkUnitId?: string;
  derivedFromWorkGraphRevision: number;
  decisionCaseIds: string[];
  checkpointIds: string[];
  proofbookRunIds: string[];
  completedWorkPacketIdsByWorkUnit: Record<string, string>;
  blockedWorkPacketIdsByWorkUnit: Record<string, string>;
  missionCompletionPacketId?: string;
  missionBlockedPacketId?: string;
  latestEventSequence: Sequence;
  projectionHash: string;
  updatedAt: string;
}

interface MissionRecord {
  definition: MissionDefinitionRevision;
  execution: MissionExecutionProjection;
}

type MissionState =
  | "draft"
  | "preflight"
  | "running"
  | "paused"
  | "waiting_decision"
  | "blocked"
  | "failed"
  | "needs_reconcile"
  | "review"
  | "merge_ready"
  | "settling"
  | "completed"
  | "cancelled"
  | "rollback_pending"
  | "rolled_back";
```

`MissionDefinitionRevision` is immutable after acceptance. Mutable state, active
and next work, packet refs, and projection hash live only in
`MissionExecutionProjection`, derived from TaskGraph/domain state and WorkEvents.
The aggregate `MissionRecord` is a read model, not a third persistence owner.

`TeamExecutionPolicy` is the minimal Team Constitution semantics compiled into the
Mission contract. It does not schedule work or create a fixed team size. Role
leases, assignments, and progress remain projections of existing ownership,
capability, TaskGraph, and event owners; WorkUnit role bindings do not create a
`MissionOperation` or `OperationJournal`.

Work-unit packets and Mission settlement are different scopes. A Mission with
3-12 work units cannot point at one work-unit packet as if it proved the aggregate.
`missionCompletionPacketId` is populated only after every required work-unit packet
and Mission-level clause/gate is accepted. Packet authority becomes effective for
Mission/A7 only after the A7.0 activation event; R0-A6 historical phase evidence is
not backfilled or reinterpreted, and A8/A9/final-goal completion remains separate.

### 4.2 WorkUnitDefinition

```ts
interface WorkUnitDefinition {
  workUnitId: string;
  missionId: string;
  definitionRevision: number;
  title: string;
  objective: string;
  dependsOn: string[];
  requiredRole: string;
  completionAuthorityRoleIds: string[];
  requiredAdapterCapabilities: AdapterCapability[];
  fileIntents: ResourceIntent[];
  symbolIntents: SymbolIntent[];
  requiredCapabilityTemplates: CapabilityTemplate[];
  requiredGates: GateRequirement[];
  requiredArtifacts: ArtifactRequirement[];
  riskClass: "low" | "moderate" | "high" | "irreversible";
  capabilityUnlock: CapabilityUnlock;
}
```

Symbol intents are durable. A restart cannot reduce ownership precision from
symbol to file merely because the current process lost an in-memory field.

### 4.3 WorkUnitStateProjection

```ts
interface WorkUnitStateProjection {
  workUnitId: string;
  attempt: number;
  executionGeneration: number;
  state:
    | "planned"
    | "ready"
    | "leased"
    | "running"
    | "paused"
    | "waiting_gate"
    | "blocked"
    | "failed"
    | "needs_reconcile"
    | "review"
    | "settling"
    | "accepted"
    | "cancelled"
    | "rollback_pending"
    | "rolled_back";
  assignee?: PrincipalRef;
  runtime?: RuntimeIdentity;
  baseOid: string;
  observedHeadOid?: string;
  ownershipClaimIds: string[];
  proofCoverage: ProofCoverage;
  blocker?: TypedBlocker;
  completedWorkPacketId?: string;
  blockedWorkPacketId?: string;
  reconciliationCaseId?: string;
  latestEventSequence: Sequence;
}
```

### 4.4 Work-unit state transitions

```text
planned -> ready | cancelled
ready -> leased | blocked | cancelled
leased -> running | ready | blocked | needs_reconcile | cancelled
running -> paused | waiting_gate | blocked | failed | needs_reconcile | review | cancelled
paused -> running | blocked | needs_reconcile | cancelled | rollback_pending
waiting_gate -> running | blocked | cancelled | needs_reconcile
blocked -> ready | cancelled | rollback_pending
failed -> ready | cancelled | rollback_pending
needs_reconcile -> ready | running | blocked | cancelled | rollback_pending
review -> running | settling | blocked | needs_reconcile
settling -> accepted | blocked | needs_reconcile
accepted -> rollback_pending
cancelled -> rollback_pending
rollback_pending -> rolled_back | needs_reconcile
```

Each new attempt increments `attempt`; re-execution increments
`executionGeneration`, revokes older leases/batons, and rejects late results.
`accepted` requires the exact valid `CompletedWorkPacket`. Retry never reuses a
one-use reservation or uncertain effect.

### 4.5 Mission state transitions

```text
draft -> preflight
preflight -> running | waiting_decision | blocked | cancelled
running -> paused | waiting_decision | blocked | failed | needs_reconcile | review | cancelled
paused -> running | blocked | needs_reconcile | cancelled | rollback_pending
waiting_decision -> running | blocked | cancelled | rollback_pending
blocked -> preflight | running | cancelled | rollback_pending
failed -> preflight | cancelled | rollback_pending
needs_reconcile -> preflight | running | blocked | cancelled | rollback_pending
review -> running | settling | blocked | needs_reconcile
settling -> running | merge_ready | completed | blocked | needs_reconcile
merge_ready -> settling | blocked | needs_reconcile
completed -> rollback_pending
cancelled -> rollback_pending
rollback_pending -> rolled_back | needs_reconcile
```

Rules:

- only accepted contract revisions enter `preflight`;
- `review` requires candidate completion evidence, not agent self-report;
- `merge_ready` requires independent review and exact-OID readiness;
- `completed` requires a valid immutable `MissionCompletionPacket` aggregating
  every exact required work-unit packet, accepted reviewer verdicts, current proof,
  final exact OID, and zero repo/policy/operator/external acceptance blockers;
- a durable handoff emits `BlockedWorkPacket`, keeps the Mission/work unit
  blocked, and cannot satisfy completion;
- repo-owned implementation progress may be classified separately, but a work
  unit/Mission whose acceptance requires external proof remains blocked and cannot
  be completed by a handoff;
- `rolled_back` records a compensating outcome and retains the original packet.
- pause, resume, cancellation, failure, reconciliation, settlement, and rollback
  each emit typed events; no state is reconstructed from missing heartbeats alone;
- an `unknown` external effect forces `needs_reconcile`; it cannot transition
  directly to running, completed, or rolled_back without a reconciliation result.

## 5. Progress And Attention Projections

### 5.1 MissionProgressProjection

```ts
interface MissionProgressProjection {
  schema: "aelyris.mission_progress/v1";
  missionId: string;
  missionRevision: number;
  current: ActiveWorkProjection[];
  recommendedNext: ReadyWorkProjection | BlockerReleaseProjection | null;
  readyWork: ReadyWorkProjection[];
  unlocks: CapabilityUnlock[];
  blockers: TypedBlocker[];
  attention: AttentionItem[];
  criticalPath: string[];
  proofCoverage: ProofCoverage;
  budget: MeasuredAndEstimatedBudget;
  repositoryTruth: RepositoryTruth;
  latestEvidenceSequence: Sequence;
  projectionHash: string;
}
```

`projectionHash` is produced from a canonical serialization excluding display
locale and volatile render timestamps. Equal owner state at equal sequence must
produce the same hash.

The cockpit renders one `recommendedNext` as **Next** but may show `readyWork` as
parallel opportunity. The backend critical-path/policy owner selects the
recommendation; the UI must not hide or invent other ready lanes.

### 5.2 Typed blockers

```ts
type BlockerClass = "repo" | "policy" | "operator" | "external";

interface TypedBlocker {
  blockerId: string;
  class: BlockerClass;
  owner: string;
  condition: string;
  exactNextAction: string;
  requiredAuthority: string;
  requiredInputs: string[];
  exactCommand?: SafeOperatorCommand;
  expectedResult: string;
  expectedArtifacts: string[];
  acceptanceImpact: string[];
  evidenceRefs: EvidenceRefV2[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  freshness: EvidenceFreshnessPolicy;
}
```

### 5.3 AttentionItem

```ts
interface NormalizedPolicyScore {
  scale: "integer_0_to_100";
  value: number;
  policyVersion: string;
  evidenceRefs: EvidenceRefV2[];
}

interface AttentionItem {
  attentionId: string;
  missionId: string;
  rootCauseKey: string;
  kind:
    | "clarification"
    | "approval"
    | "conflict"
    | "failed_gate"
    | "stale_evidence"
    | "budget_pressure"
    | "blocked_dependency"
    | "agent_idle"
    | "operator_action"
    | "merge_ready"
    | "recovery_decision";
  taxonomyVersion: string;
  rankingPolicyVersion: string;
  risk: NormalizedPolicyScore;
  blockingDepth: number;
  costOfDelay: NormalizedPolicyScore;
  reversibility: Reversibility;
  owner: string;
  exactNextAction: string;
  consequenceOfInaction: string;
  evidenceRefs: EvidenceRefV2[];
  createdAt: string;
  expiresAt?: string;
}
```

`NormalizedPolicyScore.value` is an integer in `[0, 100]`. Each policy defines
inputs and meaning; scores from different policy versions are not silently
compared. Risk, confidence, and cost are never unitless unbounded numbers.

Items with one root cause are grouped without losing individual evidence. Ranking
is deterministic for equal inputs. `rootCauseKey`, risk, and cost-of-delay are
computed by a versioned backend taxonomy/policy from causal and blocker evidence;
agents may propose context but cannot choose a dedupe key or score that hides
another item. Tie-break order is risk, critical-path depth, cost of delay, age,
then stable `attentionId`.

## 6. Universal Agent And Runtime Fabric

### 6.1 AgentAdapterDescriptor

```ts
type AdapterCapability =
  | "prompt"
  | "steer"
  | "interrupt"
  | "resume"
  | "fork"
  | "approve_reject"
  | "tool_event_stream"
  | "diff_stream"
  | "usage_cost"
  | "attention_state"
  | "session_export";

interface AgentAdapterDescriptor {
  adapterId: string;
  kind: "pty" | "acp" | "sdk" | "a2a";
  version: string;
  capabilities: Record<
    AdapterCapability,
    {
      support: "supported" | "unsupported" | "conditional";
      preconditions: string[];
    }
  >;
  requiredRuntimeDomainCapabilities: string[];
  eventSchemas: string[];
  trustProfile: string;
}
```

A `conditional` capability names its precondition. Missing or malformed structured
data does not fall back to optimistic terminal parsing.

### 6.2 AgentSession lifecycle

```ts
type AgentSessionState =
  | "declared"
  | "starting"
  | "running"
  | "paused"
  | "approval_waiting"
  | "disconnected"
  | "adopting"
  | "stopping"
  | "stopped"
  | "failed"
  | "needs_reconcile";
```

```text
declared -> starting | stopped
starting -> running | failed | needs_reconcile | stopping
running -> paused | approval_waiting | disconnected | stopping | failed | needs_reconcile
paused -> running | disconnected | stopping | failed | needs_reconcile
approval_waiting -> running | paused | disconnected | stopping | needs_reconcile
disconnected -> adopting | stopping | failed
adopting -> running | paused | approval_waiting | failed | needs_reconcile
stopping -> stopped | needs_reconcile
failed -> starting | stopping          (new process generation required)
needs_reconcile -> adopting | stopping | failed
```

Every transition records process generation, adapter/session identity, baton
generation, lease effect, and causation. `stopped` is terminal for that generation.
Agent session state never proves work completion. Disconnect releases write
authority; adoption must reconcile process tree, logical session, Mission/work
unit, ownership, and lease before returning to a writable state.

### 6.3 RuntimeDomain

```ts
interface RuntimeDomain {
  domainId: string;
  kind: "local" | "ssh" | "container" | "devbox" | "remote_service";
  machineFingerprint: string;
  processIsolation: "host" | "job" | "container" | "remote";
  filesystemBoundary: CanonicalResourceScope;
  networkPolicyId: string;
  credentialBrokerId?: string;
  supportedAdapterKinds: string[];
  supportsDurableAttach: boolean;
  supportsSnapshot: boolean;
  trustLevel: "local_trusted" | "scoped" | "untrusted";
}
```

The same Mission can span domains, but no cross-domain operation inherits a local
capability implicitly.

### 6.4 PaneControlBaton

```ts
interface PaneControlBaton {
  paneId: string;
  generation: number;
  mode:
    | "human"
    | "agent"
    | "shared_observe"
    | "approval_waiting"
    | "detached"
    | "replaying";
  controllerPrincipalId?: string;
  capabilityLeaseId?: string;
  missionId?: string;
  workUnitId?: string;
  acquiredAt: string;
  expiresAt?: string;
  transitionEventId: string;
}
```

Baton changes use compare-and-swap on `generation`. Process exit, disconnect,
lease expiry, Mission cancellation, or failed adoption releases write authority.

The baton owns exclusive controller selection; `CapabilityLease` owns
authorization; the existing A1 `TerminalInputAuthority` remains the sole owner of
terminal byte classification and delivery. Every baton-authorized IPC/MCP/REST/WS/
native/sidecar write still constructs the existing typed terminal-write envelope
and receives its ACK/NACK only after `TerminalInputAuthority` accepts the effective
target set. Baton or capability success alone is never a write receipt.

Transition rules:

- `agent` always has an expiry and process-tree-bound capability;
- `human -> agent` requires explicit handoff, a generation bump, and settlement or
  rejection of buffered human input;
- human emergency steal is always available locally: it revokes the agent lease,
  increments generation, records the interrupt, and rejects old-writer input;
- `approval_waiting` accepts no terminal write until a current fingerprint-bound
  decision returns it to the previous valid controller or to `human`/`detached`;
- `shared_observe` means multiple observers but still exactly one writer;
- every input frame is tagged with baton generation; simultaneous or delayed
  frames from an earlier generation are rejected rather than replayed;
- reconnect/attach begins `detached` and may adopt an earlier controller only after
  process identity, Mission/work unit, lease, and generation reconciliation;
- `replaying` renders inert sanitized content and can transition only to an
  observed live state, never directly acquire write authority.

### 6.5 SemanticCommandRecord

```ts
interface SemanticCommandRecord {
  commandId: string;
  runtime: RuntimeIdentity;
  principalId: string;
  capabilityLeaseId: string;
  redactedCommand: string;
  commandDigest: string;
  cwd: CanonicalResourceHandle;
  startedAt: string;
  endedAt?: string;
  result: "running" | "exited" | "cancelled" | "timed_out" | "unknown";
  exitCode?: number;
  touchedResourceRefs: string[];
  evidenceRefs: EvidenceRefV2[];
  baseOid?: string;
  headOid?: string;
}
```

Prompt marks and shell integration identify boundaries; process owner and gate
evidence establish truth. Visual parsing is supplementary only.

## 7. Trust And Capability Kernel

### 7.1 ActionIntent

```ts
interface ActionIntent {
  intentId: string;
  principalId: string;
  adapterSurface:
    | "ipc"
    | "mcp"
    | "cli"
    | "rest"
    | "ws"
    | "ssh"
    | "proofbook"
    | "agent_adapter"
    | "scheduler"
    | "extension";
  action: string;
  resourceRequest: ResourceRequest;
  argsDigest: string;
  missionId?: string;
  workUnitId?: string;
  baseOid?: string;
  requestedScopes: CapabilityScope[];
  idempotencyKey: string;
}
```

### 7.2 CapabilityLease

```ts
interface CapabilityLease {
  schema: "aelyris.capability_lease/v1";
  leaseId: string;
  principalId: string;
  action: string;
  resource: CanonicalResourceHandle;
  workspaceId: string;
  projectId?: string;
  missionId?: string;
  workUnitId?: string;
  paneId?: string;
  runId?: string;
  processBinding: ProcessTreeBinding;
  executionNonce: string;
  clockBinding: MonotonicClockBinding;
  fileScopes: CanonicalResourceScope[];
  symbolScopes: SymbolIntent[];
  networkScopes: NetworkScope[];
  secretRefs: string[];
  budgetLimits: BudgetLimit[];
  argsDigest?: string;
  baseOid?: string;
  headOid?: string;
  oneUse: boolean;
  state:
    | "issued"
    | "reserved"
    | "committed"
    | "uncertain"
    | "revoked"
    | "expired"
    | "compensated";
  reservationId?: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  approvalEventId: string;
  committedByEventId?: string;
}
```

Validation order is deterministic: schema -> principal -> expiry/revocation ->
surface/action -> resource/lane -> args/OID -> budget/network/secret policy ->
one-use consumption. A denial records a redacted event and no secret value.

Filesystem authority is not a raw path prefix. `CanonicalResourceHandle` records
the final resolved Windows path, volume serial and file identity when available,
case/Unicode normalization policy, reparse/junction traversal, UNC/device-path and
alternate-data-stream classification, and the approved root handle. Each open or
rename revalidates containment against the handle; string normalization alone is
insufficient.

`ProcessTreeBinding` includes runtime domain, process creation fingerprint, job/
namespace/container identity, root process generation, and allowed descendants so
PID reuse cannot inherit authority. `MonotonicClockBinding` includes boot/session
identity plus monotonic issue/deadline; wall-clock rollback cannot extend a lease.

`NetworkScope` binds scheme, canonical host, allowed resolved IP/CIDR set, port,
redirect count/policy, TLS identity policy, and explicit private/link-local/
loopback/metadata-endpoint rules. DNS is resolved and policy-checked at connection
and every redirect; a hostname grant is not an arbitrary later IP grant.

`BudgetLimit` always names a unit: currency+ISO code, tokens, wall-time ms, CPU ms,
disk bytes, or network bytes. Bare numeric budgets are invalid.

One-use effects use `reserve -> effect -> commit`. Reservation and intent/audit
persist before mutation. If the effect succeeds but receipt/commit persistence
fails or the process crashes, the lease becomes `uncertain`, the Mission enters
`needs_reconcile`, and the action is never blindly retried. A reserved lease cannot
be consumed by a second process or surface.

```text
issued -> reserved -> committed
issued -> revoked | expired
reserved -> revoked | expired | uncertain
uncertain -> committed | revoked | compensated  (only after recorded reconciliation)
```

`reserved -> revoked | expired` is legal only while the durable command record
proves `effect_started` was never entered. After effect start, expiry, process loss,
missing receipt, or cancellation always produces `uncertain` until reconciliation;
it can never reopen the reservation or authorize a retry.

Every transition is compare-and-swap on lease state plus execution nonce. Required
negative fixtures cover concurrent reservation, replay after commit, PID reuse,
descendant escape, clock rollback, junction/reparse and rename race, UNC/device
path, alternate data stream, Unicode/case alias, DNS rebinding, redirect to a
private/metadata address, budget-unit mismatch, and crash at every state boundary.

### 7.3 Credential broker

- stores references, never plaintext credentials in Mission/events/packets;
- issues short-lived process-bound material only after capability validation;
- redacts stdout/stderr/evidence and scans outbound payloads;
- blocks metadata endpoints and undeclared egress;
- revokes on lease expiry, process exit, Mission cancellation, or operator action;
- records provider/reference/digest metadata without the secret.

### 7.4 Cross-surface equivalence

A fixture set sends the same allowed and denied intent through every enabled
surface. All surfaces must produce equivalent authorization result, typed reason,
event kind, and one-use behavior. Adapters cannot add local bypasses.

### 7.5 Canonical Control API And MCP Boundary

`AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md` is the detailed authority. One
Rust-authoritative command descriptor registry generates or validates schemas,
MCP catalog entries, adapter metadata, error codes, capability requirements,
idempotency/cancellation policy, and evidence obligations. Tauri IPC, MCP, REST,
WebSocket, CLI, visible PTY, Proofbook, review, and merge are adapters over the same
application command path.

Capability-scoped tool discovery is a read projection of that same registry. The
query binds principal, Mission/work unit, runtime, resource scope, risk class, and
remaining budget, and returns only compatible descriptors plus typed reasons for
unsupported or gated entries. Discovery never grants, widens, reserves, or
consumes a `CapabilityLease`, and no adapter may maintain a broader private tool
catalog.

The current A7.0 audit must explicitly inventory hardcoded actor/reviewer paths,
transport recursion, direct state-owner/DB access, WebSocket ticket/baton and
backpressure gaps, adapter-owned schemas, frontend audit-shaped input, and hidden
review/merge preparatory commits. Identity comes from trusted connection/run/
window context, never payload strings. A bearer or tool name authenticates a face;
it does not authorize an effect.

Every mutation uses a versioned `ControlCommandEnvelope` and persisted
`validate -> authorize -> reserve -> intent -> effect -> commit|uncertain`
lifecycle. The same idempotency key with different canonical input fails. Cancel
after possible effect enters reconciliation. Authoritative queues are bounded and
durable before notification; loss emits a gap/degraded marker and blocks no-loss
claims. Proofbook calls the Control Kernel internally with a narrowed run principal
and causation, never by recursively entering an MCP transport handler.

Review and merge have no hidden write:

```text
candidate.freeze | worktree.snapshot_commit
  -> review.run(frozenOid)
  -> merge_intent.request(frozenOid)
  -> merge.execute_exact_oid
```

Only the first and last steps are effects. Adapter-local `FREE`/`GATED` wording is
non-authoritative; effect class and human-approval policy are independent canonical
descriptor fields.

## 8. Canonical WorkEvent And Chronicle

### 8.1 WorkEventEnvelope

```ts
interface IntegrityEnvelope {
  tier: "content_addressed" | "local_signed" | "externally_anchored";
  digestAlgorithm: "sha256";
  digest: string;
  previousDigest?: string;
  anchorId: string;
  verificationPolicyId: string;
  signerKeyId?: string;
  signatureRef?: string;
  externalAnchorRef?: string;
}

interface WorkEventEnvelope<T> {
  schema: "aelyris.work_event/v1";
  eventId: string;
  sequence: Sequence;
  workspaceId: string;
  correlationId: string;
  causationId?: string;
  idempotencyKey?: string;
  principalId: string;
  subject: {
    missionId?: string;
    workUnitId?: string;
    taskId?: string;
    proofbookRunId?: string;
    paneId?: string;
    sessionId?: string;
  };
  kind: string;
  payloadSchema: string;
  payload: T;
  evidenceRefs: EvidenceRefV2[];
  redaction: RedactionRecord;
  occurredAt: string;
  persistedAt: string;
  integrity: IntegrityEnvelope;
}
```

`IntegrityEnvelope` names one explicit tier:

```text
content_addressed   digest/previousDigest/anchor detect accidental and stale change
local_signed        above plus OS-protected local signer key id and signature ref
externally_anchored above plus a trusted external transparency/timestamp anchor ref
```

The digest is domain-separated and covers the canonical envelope, payload digest,
evidence refs, previous digest, anchor, verification policy, and integrity tier. It
excludes only the integrity digest/signature values themselves and schema-declared
local render metadata. Missing signer/anchor is visible and limits the authenticity
claim; A9 release signing remains separate.

### 8.2 Journal convergence

Migration order:

1. inventory `audit_event_journal`, EventBus persistence, and `agent_events`;
2. freeze sequence, hash, retention, compatibility, and startup adoption contract;
3. add typed payload schema/version and transactional outbox where domain DB state
   and event share a transaction;
4. make EventBus the hot broadcast/replay adapter over canonical persisted facts;
5. make legacy agent events a compatibility projection, not independent truth;
6. reconcile file-backed mux/Proofbook owners through digest events and startup
   adoption without pretending cross-file writes are one DB transaction;
7. prove no silent drop under DB outage, disk full, backpressure, restart, duplicate
   delivery, and slow consumer recovery.

No migration is coded before the inventory and rollback contract are accepted.

### 8.3 Deterministic replay

Replay reads a bounded event range plus a versioned snapshot and produces a
read-only projection. It never executes effectful ports.

```text
deterministic owner logic -> recompute
LLM/network/process output -> replay recorded receipt/evidence
known idempotent external operation -> show receipt; do not resend
uncertain external effect -> needs_reconcile
irreversible effect -> external_irreversible
```

Equal snapshot + event range + projection version must yield the same hash. A
schema version not understood by the replay owner fails closed.

Recorded PTY, tool, MCP, remote-pane, and artifact content is untrusted replay
data. Replay strips or inert-encodes control/escape/OSC52/clipboard/navigation
effects, disables active links by default, and never feeds the content back as a
system/policy instruction. A user may copy an explicitly revealed redacted value,
but replay itself performs no side effect.

## 9. Evidence And Completion Settlement

Owner boundary:

- the existing Proofbook runner settles one Proofbook run;
- the existing append-only Proofbook ledger remains the primary run evidence and
  artifact-reference authority;
- the future Evidence Store is a content-addressed projection/index over immutable
  evidence, not a second Proofbook ledger or settlement owner;
- Mission settlement consumes immutable Proofbook/gate evidence plus ownership,
  review, approval, and merge facts. It does not rerun steps or mutate a ledger;
- A7.0 inventory freezes the canonical `EvidenceRefV2` owner, compatibility
  mapping, and migration before a new repository/module is created.

### 9.1 EvidenceRefV2

```ts
interface EvidenceRefV2 {
  evidenceId: string;
  kind: "command" | "artifact" | "gate" | "review" | "approval" | "merge" | "operator";
  locator: EvidenceLocator;
  contentDigestAlgorithm: "sha256";
  contentDigest: string;
  producedByEventId: string;
  environmentFingerprint?: string;
  baseOid?: string;
  headOid?: string;
  generatedAt: string;
  validUntil?: string;
  redactionCount: number;
  provenance: ProvenanceEnvelopeRef;
  integrity: IntegrityEnvelope;
}
```

`provenance` losslessly references the existing A0
`aelyris.evidence-provenance/v1` authority: HEAD, verifier digest, input hashes,
execution identity, generation time, freshness policy, and envelope digest. V2 is
a typed reference/composition over that evidence, not a second provenance owner or
an mtime replacement.

### 9.2 GateExecutionRecord

```ts
interface GateExecutionRecord {
  gateId: string;
  contractVersion: string;
  commandFingerprint: string;
  runtimeDomainId: string;
  baseOid: string;
  headOid: string;
  startedAt: string;
  endedAt: string;
  result: "passed" | "failed" | "blocked" | "cancelled";
  artifactRefs: EvidenceRefV2[];
  freshness: "current" | "stale";
  blocker?: TypedBlocker;
}
```

### 9.3 CompletedWorkPacket And BlockedWorkPacket

```ts
interface WorkPacketBase {
  packetId: string;
  missionId: string;
  missionRevision: number;
  workUnitId: string;
  implementer?: PrincipalRef;
  operator?: PrincipalRef;
  adapterDescriptor?: VersionedRef;
  modelRef?: VersionedRef;
  skillRefs: VersionedRef[];
  environmentFingerprint?: string;
  baseOid: string;
  headOid: string;
  contractProofVersion: string;
  settlementExpectedVersion: string;
  ownedFiles: RepositoryResourceRef[];
  ownedSymbols: SymbolIntent[];
  gateRecords: GateExecutionRecord[];
  evidenceRefs: EvidenceRefV2[];
  approvalCapabilityLeaseId?: string;
  acceptanceCoverage: AcceptanceCoverageEntry[];
  chronicleRange: ChronicleRangeProof;
  rollbackRecipe: RecoveryInstruction[];
  replayRecipe: ReplayInstruction[];
  supersedesPacketId?: string;
  createdAt: string;
  integrity: IntegrityEnvelope;
}

interface CompletedWorkPacket extends WorkPacketBase {
  schema: "aelyris.completed_work_packet/v1";
  implementer: PrincipalRef;
  reviewer: PrincipalRef;
  adapterDescriptor: VersionedRef;
  environmentFingerprint: string;
  reviewerVerdict: "accepted";
  reviewerIndependence: ReviewerIndependenceProof;
  dissent: DissentRecord[];
  outcome: "accepted" | "merged";
  mergeIntentId?: string;
  mergeResult?: "not_required" | "merged_exact_oid";
  integratedOid: string;
  fulfilledObligationRefs: VersionedRef[];
  residualRisks: NonBlockingResidualRisk[];
  repoBlockers: [];
  policyBlockers: [];
  operatorBlockers: [];
  externalBlockers: [];
}

interface BlockedWorkPacket extends WorkPacketBase {
  schema: "aelyris.blocked_work_packet/v1";
  outcome: "blocked_handoff";
  repoBlockers: TypedBlocker[];
  policyBlockers: TypedBlocker[];
  operatorBlockers: TypedBlocker[];
  externalBlockers: TypedBlocker[];
  reviewer?: PrincipalRef;
  reviewerVerdict?: "accepted" | "changes_requested" | "blocked";
  reviewerIndependence?: ReviewerIndependenceProof;
  dissent: DissentRecord[];
  exactNextAction: string;
  requiredInputs: string[];
  expectedArtifacts: string[];
}

interface MissionCompletionPacket {
  schema: "aelyris.mission_completion_packet/v1";
  packetId: string;
  missionId: string;
  missionRevision: number;
  requiredWorkUnitPacketIdsByWorkUnit: Record<string, string>;
  missionAcceptanceCoverage: AcceptanceCoverageEntry[];
  missionGateRecords: GateExecutionRecord[];
  chronicleRange: ChronicleRangeProof;
  finalHeadOid: string;
  integratedOid: string;
  contractProofVersion: string;
  settlementExpectedVersion: string;
  fulfilledObligationRefs: VersionedRef[];
  mergeResult: "merged_exact_oid";
  repoBlockers: [];
  policyBlockers: [];
  operatorBlockers: [];
  externalBlockers: [];
  createdAt: string;
  integrity: IntegrityEnvelope;
}
```

`AcceptanceCoverageEntry` binds every accepted clause id to required gates,
evidence refs, freshness, result, and (for blocked packets) typed blockers. Missing
or duplicate clause coverage fails settlement. `ChronicleRangeProof` binds start/
end sequence, root/anchor digest, projection hash, and integrity tier.

`ReviewerIndependenceProof` is computed by a versioned policy owner, not supplied
as a boolean. It records reviewer and builder principals, logical sessions,
provider/model lineage, shared ancestor/fork relationships, policy version,
disqualifying relations, computation event, and evidence refs. The same logical
agent, its fork/descendant, the builder principal, or a reviewer that participated
in the candidate diff is ineligible. A policy may require a different provider for
specific risk classes and records that decision explicitly.

Recovery/replay instructions are typed, redacted data with preconditions, expected
state/result, required capability template, and evidence refs. They are never raw
shell strings or trusted instructions retrieved from project content, and are not
executed automatically.

Both work-unit packet variants are created by settlement, not mutated in place. Corrections
supersede them. Digest calculation uses canonical serialization and
content-addressed evidence. A `BlockedWorkPacket` is durable continuation evidence,
not a `CompletedWorkPacket` and not completion credit.

`MissionCompletionPacket` is a separate aggregate settlement record. It references
immutable work-unit packets rather than copying or weakening them. Any missing,
superseded, stale, blocked, wrong-revision, or wrong-OID child keeps Mission
settlement blocked.

The completion barrier is this packet validation plus compare-and-swap settlement,
not a `CompletionBarrier` table or owner. `integratedOid` is the exact reviewed
result incorporated into the settlement target: it equals `headOid` for an
accepted/no-merge work unit and the exact integration result for
`merged_exact_oid`. A dirty or ownership-uncovered worktree, unresolved required
`DecisionCase` or fulfillment obligation, changed OID/Mission/WorkGraph/proof
version, or non-exact merge invalidates the expected version. The candidate must
re-freeze and re-prove against the new integrated OID.
A Qralis Result Capsule is only a coordination projection referencing a
`CompletedWorkPacket` or `BlockedWorkPacket`.

### 9.4 Settlement algorithm

1. lock Mission/work unit and read exact accepted contract revision;
2. freeze base/head, contract/proof versions, and settlement expected version;
   reject moving/stale OIDs;
3. prove the candidate worktree is clean and ownership scope covers the complete
   diff;
4. resolve every required gate to fresh evidence or classify a typed blocker; no
   missing item is inferred and no blocker can satisfy acceptance;
5. classify current repo/policy/operator/external acceptance blockers; if any
   exist, create/digest `BlockedWorkPacket` with available review state and keep
   the work unit/Mission blocked;
6. for a completion candidate, compute reviewer independence from lineage/policy
   evidence and require an accepted verdict;
7. require every completion-blocking `DecisionCase` and fulfillment obligation to
   resolve through its authoritative event/decision/packet/human-action evidence;
8. validate approval capability and exact-OID merge outcome when applicable,
   proving `headOid` was the immutable reviewed merge input and `integratedOid` is
   the resulting current target OID; a failure becomes a typed blocker and
   `BlockedWorkPacket`;
9. compare-and-swap the frozen OID/revision/proof version; on change invalidate
   the candidate and require re-proof;
10. require zero work-unit acceptance blockers and create/digest
   `CompletedWorkPacket`;
11. for Mission settlement, resolve the exact required work-unit packet set, verify
   every Mission-level clause/gate and final exact OID, then create/digest
   `MissionCompletionPacket`;
12. append the chosen settlement event and update projection atomically;
13. mark a work unit completed only for its valid `CompletedWorkPacket`, and mark
    Mission completed only for its valid `MissionCompletionPacket`; a handoff never
    satisfies Mission, phase, release, or goal completion.

Negative cases include tamper, dirty or unowned worktree, stale/integrated-OID or
CAS-version drift, stale evidence, unresolved Decision/obligation, missing
artifact, wrong reviewer, uncovered symbol, replayed capability, hidden blocker,
and packet/diff digest mismatch.

## 10. Checkpoints And Reversible Autonomy

```ts
interface ReplayCheckpoint {
  checkpointId: string;
  missionId: string;
  workGraphRevision: number;
  eventSequence: Sequence;
  baseOid: string;
  headOid: string;
  dirtyDiffDigest?: string;
  ownershipClaimIds: string[];
  paneSnapshotRefs: EvidenceRefV2[];
  proofbookLedgerRefs: EvidenceRefV2[];
  decisionCaseIds: string[];
  activeCapabilityLeaseIds: string[];
  externalEffects: ExternalEffectRecord[];
  compensationPlan: CompensationStep[];
  projectionHash: string;
}
```

Recovery creates a new isolated worktree/branch from a known OID and applies a
verified diff or compensation. It does not rewrite shared history. Capability
leases do not survive recovery automatically. An external effect is classified:

```text
reversible | compensatable | external_irreversible | unknown
```

`unknown` requires reconciliation before continuation.

## 11. Rehearsal, Decision Lab, And Counterfactual Arena

### 11.1 Mission Rehearsal

Rehearsal is a pure projection over the accepted Mission, WorkGraph, ownership,
runtime/domain capabilities, gate catalog, policy, and measured history. It emits:

- critical path and available parallelism;
- ownership collision and unowned write risks;
- missing adapter/domain capability;
- proposed capability leases and approval queue;
- irreversible/unknown side effects;
- required proof and evidence freshness;
- estimated ranges with source and confidence, never false measured values;
- likely operator/external handoffs;
- per-work-unit capability unlock.

Effectful ports use fakes/deny adapters in rehearsal. A plan change increments the
Mission revision and invalidates an earlier approval if its digest changes.

### 11.2 DecisionCase

```ts
interface DecisionCase {
  caseId: string;
  missionId: string;
  missionRevision: number;
  question: string;
  constraints: string[];
  alternatives: DecisionAlternative[];
  rubric: DecisionCriterion[];
  independentProposalRefs: EvidenceRefV2[];
  critiqueRefs: EvidenceRefV2[];
  dissent: DissentRecord[];
  selectedAlternative?: string;
  selectedBy?: string;
  decisionDigest?: string;
  expiresOnCondition?: string;
  budgetCap: number;
}
```

Proposal isolation, fixed rubric, bounded agent count/cost, preserved dissent, and
human-gate policy are verifier-visible requirements.

### 11.3 Shadow Mission

Each candidate uses:

- identical base OID, acceptance pack, gate versions, and budget class;
- isolated worktree/runtime and disjoint write capability;
- no publication, signing, shared migration, external mutation, or main merge;
- separate Chronicle correlation and completion packet;
- an independent reviewer that did not build either candidate.

The comparison ranks correctness/proof first, then residual risk, maintainability,
human attention, latency, and measured cost. Synthesis becomes a new candidate and
must run the same gates.

## 12. Governed Learning And Skill Foundry

All repository, issue, PTY, tool, remote, MCP, artifact, and retrieved memory
content enters as untrusted data, not policy or executable instruction. The
promotion owner separates content from governing prompts, applies injection and
poisoning fixtures, redacts PII/secrets, records consent and lawful/project
retention, supports scoped deletion, and preserves tombstone/supersession evidence.
A `preference` is eligible only when authored or explicitly confirmed by the human
operator; repeated model inference is not preference authority.

### 12.1 MemoryCandidate And MemoryClaim

```ts
interface MemoryCandidate {
  candidateId: string;
  kind: "fact" | "preference" | "decision" | "warning";
  scope: "workspace" | "project" | "mission" | "symbol" | "tool";
  statement: string;
  sourcePacketIds: string[];
  evidenceRefs: EvidenceRefV2[];
  confidence: NormalizedPolicyScore;
  sensitivity: string;
  redactionState: "pending" | "safe" | "rejected";
  provenanceTrust: "human_confirmed" | "verified_system" | "untrusted_content";
  consentRef?: EvidenceRefV2;
  retentionPolicyId: string;
  deletionState: "active" | "deletion_requested" | "deleted_tombstone";
  proposedExpiry?: string;
}

interface MemoryClaim extends MemoryCandidate {
  status: "verified" | "rejected" | "superseded" | "expired";
  reviewer?: PrincipalRef;
  validFrom: string;
  validUntil?: string;
  supersedes: string[];
}
```

### 12.2 SkillCandidate And EvaluationRun

```ts
interface SkillCandidate {
  candidateId: string;
  skillId: string;
  proposedVersion: string;
  sourcePacketIds: string[];
  inputSchema: string;
  outputContract: string;
  preconditions: string[];
  supportedEnvironments: string[];
  requiredCapabilities: string[];
  capabilityManifestDigest: string;
  executionBoundary: "proofbook" | "sandboxed_extension";
  proofbookDefinitionDigest: string;
  sourceTraceRefs: EvidenceRefV2[];
  sourceEnvironmentSnapshotRef: EvidenceRefV2;
  sideEffectContractRef: EvidenceRefV2;
  proofEquivalenceComparatorRefs: EvidenceRefV2[];
  proposedDiffRef: EvidenceRefV2;
  evalCaseIds: string[];
  compatibilityWindow: string;
  freshnessWindow: string;
  knownRisks: string[];
  licenseAndSourceProvenance: EvidenceRefV2[];
  publisherOrLocalSignerKeyId?: string;
  status: "proposed" | "evaluating" | "review" | "active" | "rejected" | "rolled_back";
}

interface EvaluationRun {
  evaluationId: string;
  candidateId: string;
  baselineVersion: string;
  fixtureDigest: string;
  environmentFingerprint: string;
  runClass: "source" | "repeated" | "held_out" | "canary";
  results: GateExecutionRecord[];
  differentialReplayRef: EvidenceRefV2;
  visualProofRefs: EvidenceRefV2[];
  capabilityDelta: "reduced" | "equal" | "broadened";
  successDelta: number;
  riskDelta: number;
  attentionDelta: number;
  costDelta: number;
  verdict: "better" | "equivalent" | "worse" | "inconclusive";
}
```

Promotion requires safe redaction, no unresolved conflict, fresh deterministic or
reviewed held-out evaluation, compatibility and poison-resistance proof, capability
manifest, Proofbook or sandbox boundary, license/source provenance, signature or
digest pin, independent human/governed approval, versioned activation, and a
rollback target. A candidate cannot approve itself or use its own training/source
runs as the only evaluation set. Retrieval is bounded by scope and freshness and
is passed to agents as quoted data, never higher-priority instructions.

PB-6 proof-preserving distillation remains proposal-only and is an Aelyris design
hypothesis until executed gates support it. The proposal binds the successful
source trace, environment/tool/schema snapshot, declared side effects, and
comparators for required output, evidence, gates, repository diff, and external
effects. Repeated and held-out differential replay must be equivalent within the
declared comparator contract; user-visible behavior also requires visual proof.
Capability delta must be `reduced` or `equal`. A separately approved activation
uses a bounded canary, monitoring, rollback target, and invalidates on source
proof, environment, schema/tool, policy, or capability drift. It never
automatically rewrites the source Proofbook.

## 13. Project Twin

Project Twin is a query/projection layer over authoritative stores. Its minimal
node/reference model includes Mission, work unit, principal, runtime, file,
symbol, proof requirement, evidence, packet, decision, and skill version.

Edges include owns, edits, depends_on, invalidates, proved_by, failed_with,
produced_by, reviewed_by, merged_as, supersedes, and requires_revalidation.

On accepted merge:

1. compare the merged diff with active file/symbol claims;
2. mark intersecting evidence stale according to proof dependency rules;
3. identify worktrees requiring rebase;
4. enqueue exact revalidation actions in Attention Inbox;
5. retain historical relationships rather than overwriting them.

The projection cannot grant ownership or mark proof fresh.

## 14. Remote And Extension Boundaries

### 14.1 Remote continuity

Remote reads the same `MissionProgressProjection`, Attention Items, pane preview,
Chronicle cursor, and packet projections. The server signs/fingerprints every
approval prompt. Read-only capability precedes all input, but it is still a scoped
capability rather than anonymous or workspace-wide access.

Every remote read lease binds device/session identity, project, Mission, pane,
event sequence range, evidence/artifact class, byte/rate cap, expiry, and
revocation. Server-side projection redacts secrets before transport. PTY replay,
OSC (including OSC 52), clipboard, hyperlinks, file URIs, terminal escape data,
tool output, and artifact previews are decoded under a strict allowlist and shown
as inert sanitized data; they cannot write clipboard, navigate, execute, or become
instructions. Disconnect/revoke stops streaming and invalidates buffered cursors.

Writable remote operations require:

- authenticated principal and device/session identity;
- explicit action/resource capability lease with short expiry;
- expected prompt/action fingerprint and current Mission/OID binding;
- secret scan and egress policy;
- local and remote denial-equivalence tests;
- revocation, disconnect, expiry, and stale-state proof.

SSH is transport, not workspace state owner.

### 14.2 ExtensionManifest

```ts
interface ExtensionManifest {
  id: string;
  version: string;
  publisher: string;
  digest: string;
  signature: string;
  compatibility: string;
  runtime: string;
  entrypoint: ExtensionEntrypoint;
  declaredTools: string[];
  requiredCapabilities: string[];
  filesystemScopes: ResourceScopeRequest[];
  networkScopes: NetworkScopeRequest[];
  secretRefs: string[];
  resourceLimits: Record<string, number>;
  uiContributions: string[];
  verifierFixtures: string[];
}
```

Allowed extension types are agent adapter, tool adapter, Proofbook recipe,
parser/indexer, and read-only UI projection. No extension owns domain state,
mutates private DB tables, issues capability, grants approval, merges, reads raw
secrets, or bypasses the existing dispatcher/runner.

Public marketplace remains after A9 signing/provenance/revocation proof.
The Apex V9 contract gate freezes machine schemas for `ExtensionEntrypoint`,
`ResourceScopeRequest`, `NetworkScopeRequest`, publisher identity, resource units,
signature verification, and uninstall/revocation receipts before loading code.

## 15. Storage, Atomicity, And Reconciliation

- Mission definition, state projection, WorkEvent outbox, capability consumption,
  and packet settlement use DB transactions when they share one DB owner.
- effectful mutation classes must persist validated intent, capability reservation,
  and audit/outbox record before effect; if that persistence is unavailable, deny
  the mutation rather than "buffer and hope";
- if an external/process effect may have occurred but its receipt cannot persist,
  record the lease/effect as `uncertain` at the first durable opportunity, enter
  `needs_reconcile`, and prohibit automatic retry;
- only observational streams may use a proved bounded in-memory/disk buffer. On
  overflow they emit a durable gap marker and degrade the claim; they never invent
  a complete Chronicle;
- Immutable packet/evidence payloads are content-addressed; DB rows store digest
  and safe relative locator.
- Mux and Proofbook file owners keep atomic-write and backup rules; their digests
  enter WorkEvent and reconcile at startup.
- Cross-owner operations use prepare/event/reconcile, not fictitious distributed
  transactions.
- Every adoption records adopted/rejected/needs_reconcile with reason.
- Disk full, permission failure, corrupted JSON/DB, duplicate event, stale writer,
  partial artifact, and process crash are negative-test fixtures.
- Retention/compaction preserves packet/evidence references and event hash
  continuity. Unreferenced raw streams may expire only under declared policy.

## 16. Failure Semantics

| Failure | Required behavior |
| --- | --- |
| adapter disconnect | release/expire baton; preserve logical session; classify reattach vs respawn |
| unsupported capability | typed `unsupported`; no text inference or hidden fallback |
| stale Mission revision | reject intent and return current revision |
| ownership collision | block write capability; surface exact conflicting claim |
| DB/journal outage before mutation | deny effect because intent/reservation cannot persist |
| receipt persistence failure after possible effect | mark `uncertain`, enter `needs_reconcile`, never blind retry |
| observational buffer overflow | persist gap/degraded marker and reject no-loss/replay claims |
| slow event consumer | apply backpressure/snapshot recovery; prove no unbounded memory |
| stale/out-of-order result | reject by generation/sequence/contract/OID |
| capability replay/expiry | deny and audit without effect |
| partial evidence | packet settlement fails with exact missing requirement |
| reviewer not independent | cannot reach merge-ready |
| uncertain external effect | `needs_reconcile`; do not retry automatically |
| irreversible effect | preserve marker and require operator-aware continuation |
| projection mismatch | fail closed, rebuild from checkpoint/event, compare hash |
| memory conflict | keep candidate unverified and surface decision item |
| extension crash | revoke lease, stop contribution, retain core owner state |

## 17. Release-Blocking A7 Vertical Design

A7 is intentionally finite. It proves exactly one canonical journey:

```text
request -> versioned plan preview -> visible implementation -> fresh tests
        -> independent review -> exact-OID accept/merge -> immutable settlement
```

It reuses the target contracts in this document only where that journey exercises
them. It does not require every destination surface to be implemented first.
A4.12 remains the owner of `RPO=0` for acknowledged critical state/effect facts;
A7 consumes that durability boundary and does not create another replay or journal
system.

### A7.0 Core Mission Scope Lock And Owner Inventory

A7.0 is a design-only scope lock. The accepted structure is to extend the existing
TaskGraph/runtime/ownership/event/review/merge owners and keep Mission settlement
inside the TaskManager/TaskRepo responsibility. A separate Mission service plus
DAG was rejected because it creates a second work owner. A new completion service
or barrier table was rejected because exact-OID settlement belongs to the same
TaskManager compare-and-swap that advances the work unit. Pre-emptive all-face
migration was rejected because the fixed journey needs only one visible IPC/PTY
path; unused faces receive no A7 Mission authority until their own later gate.

The following JSON block is the single machine-readable A7.0 authority. Its
`route` values are owner destinations for later A7 slices, not current runtime
claims. A `compatibility_no_a7_authority` or `no_a7_authority` disposition is only
an A7 admission/completion classification: existing compatibility IPC/MCP/PTY
actions may still execute under their current contracts, but they cannot create an
A7 Mission, mint A7 evidence, or grant A7 completion credit. It does not claim
that those endpoints return an unsupported error. The Work OS contract verifier
parses this block fail-closed and proves the section 3.2 catalog is exhaustive.

<!-- A7_CORE_SCOPE_LOCK_V1_BEGIN -->
```json
{
  "schema": "aelyris.a7_core_scope_lock/v1",
  "contractVersion": 1,
  "runtimeClaimsImplemented": false,
  "fixture": {
    "fixtureId": "a7-core-taskgraph-stable-order-v1",
    "requestId": "0197c000-0000-7000-8000-000000000001",
    "request": "Add a Rust regression test named equal_priority_ready_tasks_preserve_insertion_order in src-tauri/src/task/graph.rs. It must insert two Medium root tasks in order, recompute readiness, and prove ready_tasks() preserves insertion order. Change no production behavior unless the new test first demonstrates a defect.",
    "missionId": "0197c000-0000-7000-8000-000000000002",
    "missionRevision": 1,
    "workUnitId": "0197c000-0000-7000-8000-000000000003",
    "workUnitDefinitionRevision": 1,
    "acceptedPlan": {
      "planId": "0197c000-0000-7000-8000-000000000004",
      "planRevision": 1,
      "status": "accepted",
      "canonicalization": "rfc8785_json_utf8",
      "workUnitIds": [
        "0197c000-0000-7000-8000-000000000003"
      ]
    },
    "revisionRecovery": {
      "appliesBeforeAcceptance": true,
      "headDriftAction": "reject_or_cancel_current_preview",
      "nextRevision": "previous + 1",
      "alignedVersions": [
        "planRevision",
        "missionRevision",
        "workGraphDefinitionRevision",
        "workUnitDefinitionRevision"
      ],
      "previewedOrAcceptedPredecessorMayBeBypassed": false
    },
    "baseOidSource": "accepted_mission_head",
    "ownedTargets": [
      "src-tauri/src/task/graph.rs"
    ],
    "acceptanceClauses": [
      "A7-FIX-01: add exactly the named deterministic regression test",
      "A7-FIX-02: preserve production behavior unless the test first demonstrates a defect",
      "A7-FIX-03: the declared focused test passes at the exact candidate OID",
      "A7-FIX-04: the owned diff contains no path outside src-tauri/src/task/graph.rs"
    ],
    "declaredTest": {
      "commandArgv": [
        "cargo",
        "test",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--lib",
        "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order",
        "--",
        "--exact"
      ],
      "cwd": "mission_worktree",
      "requiredResult": "passed_exact_oid"
    },
    "reviewer": {
      "role": "independent_reviewer",
      "policyId": "a7-core-reviewer-independence/v1",
      "mustDifferFromImplementerBy": [
        "principal_id",
        "logical_session_id",
        "fork_lineage"
      ],
      "requiredVerdict": "accepted_exact_oid"
    },
    "mergeOutcome": {
      "result": "merged_exact_oid",
      "targetBranchRole": "isolated_mission_acceptance_target",
      "automaticMainMerge": false
    }
  },
  "journey": [
    "request",
    "versioned_plan_preview",
    "visible_implementation",
    "fresh_tests",
    "independent_review",
    "exact_oid_accept_merge",
    "immutable_completion_packet"
  ],
  "ownerInventory": [
    {
      "ownerId": "mission_work_settlement",
      "responsibility": "Mission definition, WorkUnit DAG/projection, execution generation, packet settlement, and completion compare-and-swap",
      "existingPaths": [
        "src-tauri/src/task/graph.rs",
        "src-tauri/src/task/manager.rs",
        "src-tauri/src/task/execution.rs",
        "src-tauri/src/persistence/task_repo.rs",
        "src-tauri/src/persistence/work_execution_repo.rs"
      ],
      "a7Gap": "Mission revisions and immutable packet rows are not implemented; A7.1 and A7.4 extend this owner without a completion service or table owner"
    },
    {
      "ownerId": "runtime_visible_pty",
      "responsibility": "visible implementation dispatch, PTY/process generation, and startup admission",
      "existingPaths": [
        "src-tauri/src/control/loop_ports.rs",
        "src-tauri/src/control/pane_fleet.rs",
        "src-tauri/src/pty/manager.rs",
        "src-tauri/src/startup_reconciliation.rs"
      ],
      "a7Gap": "bind the accepted Mission, WorkUnit, OID, and ownership scope in A7.2"
    },
    {
      "ownerId": "ownership",
      "responsibility": "file and symbol write claims for the exact owned diff",
      "existingPaths": [
        "src-tauri/src/file_ownership/mod.rs",
        "src-tauri/src/symbol_ownership/mod.rs",
        "src-tauri/src/persistence/ownership_repo.rs"
      ],
      "a7Gap": "bind claims to Mission revision and execution generation in A7.2"
    },
    {
      "ownerId": "chronicle_event",
      "responsibility": "durable causal event sequence and audit references without a new journal",
      "existingPaths": [
        "src-tauri/src/event_bus/manager.rs",
        "src-tauri/src/persistence/event_repo.rs",
        "src-tauri/src/audit.rs"
      ],
      "a7Gap": "compose the minimum WorkEvent/Evidence references; do not converge every historical journal in A7 Core"
    },
    {
      "ownerId": "evidence_test",
      "responsibility": "fresh command result, artifact digest, tested OID, freshness, and A0 provenance reference",
      "existingPaths": [
        "src-tauri/src/control/gate_runner.rs",
        "src-tauri/src/db/queries.rs",
        "scripts/evidence-provenance.mjs"
      ],
      "a7Gap": "visible IPC currently passes no mechanical gate command; A7.2 must route the frozen command through this owner"
    },
    {
      "ownerId": "review",
      "responsibility": "gate verdict, semantic findings, reviewer lineage, and exact reviewed OID",
      "existingPaths": [
        "src-tauri/src/review/mod.rs",
        "src-tauri/src/review/gates.rs",
        "src-tauri/src/review/judge.rs",
        "src-tauri/src/ipc/review_commands.rs"
      ],
      "a7Gap": "review_branch performs a hidden preparatory commit and accepts caller identity; it stays unsupported for A7. A7.2 freezes and tests the candidate before review, while A7.3 adds derived reviewer lineage and consumes that immutable tested OID without another preparatory commit"
    },
    {
      "ownerId": "merge",
      "responsibility": "immutable source/target OIDs, reviewer evidence, merge CAS, and exact integration receipt",
      "existingPaths": [
        "src-tauri/src/merge_intent/mod.rs",
        "src-tauri/src/merge_intent/store.rs",
        "src-tauri/src/persistence/merge_repo.rs",
        "src-tauri/src/control/merge.rs",
        "src-tauri/src/git/merge.rs"
      ],
      "a7Gap": "A7.3 binds the existing merge intent to Mission revision, tested evidence, and computed reviewer independence"
    },
    {
      "ownerId": "capability_policy",
      "responsibility": "effect admission, terminal-write authority, approval, and resource scope",
      "existingPaths": [
        "src-tauri/src/command_risk/authority.rs",
        "src-tauri/src/command_risk/gate.rs",
        "src-tauri/src/governance/mod.rs",
        "src-tauri/src/startup_reconciliation.rs"
      ],
      "a7Gap": "bind only the enabled journey actions in A7.1-A7.3; all other faces remain unsupported"
    },
    {
      "ownerId": "frontend_projection",
      "responsibility": "render backend TaskGraph/Mission projections and issue intents only",
      "existingPaths": [
        "src/shared/hooks/useTaskGraph.ts",
        "src/features/orchestrator/OrchestratorPanel.tsx"
      ],
      "a7Gap": "A7 UI may render packet/progress projections but may not own Mission, review, or completion state"
    }
  ],
  "schemaCatalogRef": {
    "catalogId": "aelyris.a7_core_schema_catalog/v1",
    "definitionLanguage": "aelyris-field-map/v1",
    "digestAlgorithm": "sha256",
    "catalogDigest": "5c6cc8f6dc98a61fd87143ce2d32493793787dd2b593d62623089de042edc1ea"
  },
  "schemaCatalog": {
    "AcceptanceClause": {
      "schemaId": "aelyris.acceptance_clause/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "clauseId": "uuidv7",
        "statement": "string",
        "requiredGateIds": "string[]",
        "requiredArtifactIds": "string[]",
        "completionBlocking": "boolean"
      }
    },
    "RiskPolicy": {
      "schemaId": "aelyris.risk_policy/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "policyId": "string",
        "policyVersion": "string",
        "maximumRiskClass": "low|moderate|high|irreversible",
        "humanApprovalRiskClasses": "string[]",
        "reconciliationPolicyId": "string"
      }
    },
    "BudgetPolicy": {
      "schemaId": "aelyris.budget_policy/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "policyId": "string",
        "policyVersion": "string",
        "limits": "BudgetLimit[]",
        "exhaustionResult": "blocked|operator_required"
      }
    },
    "RuntimePolicy": {
      "schemaId": "aelyris.runtime_policy/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "policyId": "string",
        "policyVersion": "string",
        "allowedRuntimeDomainIds": "string[]",
        "requiredAdapterCapabilities": "AdapterCapability[]",
        "visiblePtyRequired": "boolean"
      }
    },
    "GateRequirement": {
      "schemaId": "aelyris.gate_requirement/v1",
      "ownerId": "evidence_test",
      "additionalProperties": false,
      "fields": {
        "gateId": "string",
        "contractVersion": "string",
        "commandArgv": "string[]",
        "cwdRole": "mission_worktree",
        "requiredResult": "passed",
        "freshnessPolicy": "EvidenceFreshnessPolicy"
      }
    },
    "ArtifactRequirement": {
      "schemaId": "aelyris.artifact_requirement/v1",
      "ownerId": "evidence_test",
      "additionalProperties": false,
      "fields": {
        "artifactId": "string",
        "kind": "string",
        "locatorPolicyId": "string",
        "digestAlgorithm": "sha256",
        "freshnessPolicy": "EvidenceFreshnessPolicy"
      }
    },
    "CapabilityTemplate": {
      "schemaId": "aelyris.capability_template/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "capabilityTemplateId": "string",
        "version": "string",
        "action": "string",
        "scopeKinds": "string[]",
        "oneUseRequired": "boolean",
        "approvalPolicyId": "string"
      }
    },
    "CapabilityScope": {
      "schemaId": "aelyris.capability_scope/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "scopeId": "string",
        "kind": "filesystem|symbol|network|secret|budget",
        "resourceRequest": "ResourceRequest",
        "operations": "string[]"
      }
    },
    "ProofCoverage": {
      "schemaId": "aelyris.proof_coverage/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "acceptance": "AcceptanceCoverageEntry[]",
        "requiredClauseCount": "u32",
        "satisfiedClauseCount": "u32",
        "blockedClauseCount": "u32",
        "freshness": "current|stale"
      }
    },
    "RepositoryTruth": {
      "schemaId": "aelyris.repository_truth/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "baseOid": "git_oid",
        "headOid": "git_oid",
        "worktreeClean": "boolean",
        "diffResources": "RepositoryResourceRef[]",
        "ownershipComplete": "boolean",
        "observedAt": "rfc3339",
        "evidenceRefs": "EvidenceRefV2[]"
      }
    },
    "RedactionRecord": {
      "schemaId": "aelyris.redaction_record/v1",
      "ownerId": "chronicle_event",
      "additionalProperties": false,
      "fields": {
        "policyId": "string",
        "redactedFieldPaths": "string[]",
        "secretMatchCount": "u32",
        "redactedContentDigest": "sha256"
      }
    },
    "SymbolIntent": {
      "schemaId": "aelyris.symbol_intent/v1",
      "ownerId": "ownership",
      "additionalProperties": false,
      "fields": {
        "resourceRef": "RepositoryResourceRef",
        "language": "string",
        "symbolKind": "string",
        "qualifiedName": "string",
        "stableLocator": "string",
        "operation": "read|update|create|delete"
      }
    },
    "ResourceIntent": {
      "schemaId": "aelyris.resource_intent/v1",
      "ownerId": "ownership",
      "additionalProperties": false,
      "fields": {
        "resourceRef": "RepositoryResourceRef",
        "operation": "read|update|create|delete",
        "expectedBaseDigest": "sha256?"
      }
    },
    "ResourceRequest": {
      "schemaId": "aelyris.resource_request/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "kind": "filesystem|symbol|network|secret|budget",
        "locator": "string",
        "operations": "string[]",
        "requestedBoundary": "string"
      }
    },
    "CanonicalResourceHandle": {
      "schemaId": "aelyris.canonical_resource_handle/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "finalResolvedPath": "string",
        "volumeSerial": "string?",
        "fileIdentity": "string?",
        "normalizationPolicyId": "string",
        "reparseTraversal": "string[]",
        "pathClass": "local|unc|device",
        "alternateDataStream": "string?",
        "approvedRootHandleDigest": "sha256"
      }
    },
    "CanonicalResourceScope": {
      "schemaId": "aelyris.canonical_resource_scope/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "root": "CanonicalResourceHandle",
        "operations": "string[]",
        "recursive": "boolean",
        "revalidateOnOpenOrRename": "boolean"
      }
    },
    "NetworkScope": {
      "schemaId": "aelyris.network_scope/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "scheme": "string",
        "canonicalHost": "string",
        "allowedResolvedIpCidrs": "string[]",
        "port": "u16",
        "maxRedirects": "u16",
        "redirectPolicyId": "string",
        "tlsIdentityPolicyId": "string",
        "privateAddressPolicy": "deny|allow_explicit",
        "metadataEndpointPolicy": "deny|allow_explicit"
      }
    },
    "BudgetLimit": {
      "schemaId": "aelyris.budget_limit/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "kind": "currency|tokens|wall_time_ms|cpu_ms|disk_bytes|network_bytes",
        "unit": "string",
        "amount": "decimal_string",
        "currencyIsoCode": "string?",
        "hard": "boolean"
      }
    },
    "NormalizedPolicyScore": {
      "schemaId": "aelyris.normalized_policy_score/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "scale": "integer_0_to_100",
        "value": "integer_0_to_100",
        "policyVersion": "string",
        "evidenceRefs": "EvidenceRefV2[]"
      }
    },
    "EvidenceFreshnessPolicy": {
      "schemaId": "aelyris.evidence_freshness_policy/v1",
      "ownerId": "evidence_test",
      "additionalProperties": false,
      "fields": {
        "policyId": "string",
        "maxAgeMs": "decimal_string",
        "requireSameHeadOid": "boolean",
        "requireSameContractVersion": "boolean",
        "requireSameEnvironmentFingerprint": "boolean"
      }
    },
    "IntegrityEnvelope": {
      "schemaId": "aelyris.integrity_envelope/v1",
      "ownerId": "chronicle_event",
      "additionalProperties": false,
      "fields": {
        "tier": "content_addressed|local_signed|externally_anchored",
        "digestAlgorithm": "sha256",
        "digest": "sha256",
        "previousDigest": "sha256?",
        "anchorId": "string",
        "verificationPolicyId": "string",
        "signerKeyId": "string?",
        "signatureRef": "string?",
        "externalAnchorRef": "string?"
      }
    },
    "EvidenceLocator": {
      "schemaId": "aelyris.evidence_locator/v1",
      "ownerId": "evidence_test",
      "additionalProperties": false,
      "fields": {
        "kind": "artifact_path|command_record|event_range|external_receipt",
        "value": "string",
        "workspaceRelative": "boolean"
      }
    },
    "AcceptanceCoverageEntry": {
      "schemaId": "aelyris.acceptance_coverage_entry/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "clauseId": "uuidv7",
        "requiredGateIds": "string[]",
        "evidenceRefs": "EvidenceRefV2[]",
        "freshness": "current|stale",
        "result": "passed|failed|blocked",
        "blockerIds": "uuidv7[]"
      }
    },
    "ChronicleRangeProof": {
      "schemaId": "aelyris.chronicle_range_proof/v1",
      "ownerId": "chronicle_event",
      "additionalProperties": false,
      "fields": {
        "startSequence": "u64_decimal_string",
        "endSequence": "u64_decimal_string",
        "anchorId": "string",
        "rootDigest": "sha256",
        "projectionHash": "sha256",
        "integrity": "IntegrityEnvelope"
      }
    },
    "ReviewerIndependenceProof": {
      "schemaId": "aelyris.reviewer_independence_proof/v1",
      "ownerId": "review",
      "additionalProperties": false,
      "fields": {
        "policyVersion": "string",
        "reviewerPrincipalId": "uuidv7",
        "builderPrincipalId": "uuidv7",
        "reviewerLogicalSessionId": "uuidv7",
        "builderLogicalSessionId": "uuidv7",
        "reviewerLineageRef": "VersionedRef",
        "builderLineageRef": "VersionedRef",
        "sharedAncestorOrFork": "boolean",
        "disqualifyingRelations": "string[]",
        "differentProviderRequired": "boolean",
        "eligible": "boolean",
        "computedByEventId": "uuidv7",
        "evidenceRefs": "EvidenceRefV2[]"
      }
    },
    "SafeOperatorCommand": {
      "schemaId": "aelyris.safe_operator_command/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "argv": "string[]",
        "cwd": "CanonicalResourceHandle",
        "expectedResult": "string",
        "requiredCapabilityTemplateId": "string",
        "redactionPolicyId": "string"
      }
    },
    "RecoveryInstruction": {
      "schemaId": "aelyris.recovery_instruction/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "instructionId": "uuidv7",
        "preconditions": "string[]",
        "action": "string",
        "resourceRequest": "ResourceRequest",
        "requiredCapabilityTemplateId": "string",
        "expectedState": "string",
        "evidenceRefs": "EvidenceRefV2[]"
      }
    },
    "ReplayInstruction": {
      "schemaId": "aelyris.replay_instruction/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "instructionId": "uuidv7",
        "preconditions": "string[]",
        "chronicleRange": "ChronicleRangeProof",
        "action": "string",
        "requiredCapabilityTemplateId": "string",
        "expectedResult": "string",
        "evidenceRefs": "EvidenceRefV2[]"
      }
    },
    "AdapterCapability": {
      "schemaId": "aelyris.adapter_capability/v1",
      "ownerId": "runtime_visible_pty",
      "values": [
        "prompt",
        "steer",
        "interrupt",
        "resume",
        "fork",
        "approve_reject",
        "tool_event_stream",
        "diff_stream",
        "usage_cost",
        "attention_state",
        "session_export"
      ]
    },
    "CapabilityUnlock": {
      "schemaId": "aelyris.capability_unlock/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "unlockId": "uuidv7",
        "capability": "string",
        "conditionClauseIds": "uuidv7[]",
        "availableAfterWorkUnitId": "uuidv7"
      }
    },
    "DissentRecord": {
      "schemaId": "aelyris.dissent_record/v1",
      "ownerId": "review",
      "additionalProperties": false,
      "fields": {
        "principal": "PrincipalRef",
        "rubricId": "string",
        "summary": "string",
        "evidenceRefs": "string[]"
      }
    },
    "NonBlockingResidualRisk": {
      "schemaId": "aelyris.non_blocking_residual_risk/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "riskId": "uuidv7",
        "summary": "string",
        "owner": "string",
        "mitigation": "string",
        "evidenceRefs": "EvidenceRefV2[]"
      }
    },
    "PrincipalRef": {
      "schemaId": "aelyris.principal_ref/v1",
      "ownerId": "capability_policy",
      "additionalProperties": false,
      "fields": {
        "principalId": "uuidv7",
        "kind": "human_operator|local_agent|remote_principal|extension_driver|system_reconciler",
        "workspaceId": "uuidv7",
        "logicalSessionId": "uuidv7?"
      }
    },
    "ProvenanceEnvelopeRef": {
      "schemaId": "aelyris.evidence-provenance/v1",
      "ownerId": "evidence_test",
      "additionalProperties": false,
      "fields": {
        "schema": "aelyris.evidence-provenance/v1",
        "artifactPath": "string",
        "headOid": "git_oid",
        "verifierDigest": "sha256",
        "inputHashes": "Record<string,sha256>",
        "executionIdentity": "string",
        "generatedAt": "rfc3339",
        "freshnessPolicyId": "string",
        "envelopeDigest": "sha256"
      }
    },
    "RepositoryResourceRef": {
      "schemaId": "aelyris.repository_resource_ref/v1",
      "ownerId": "ownership",
      "additionalProperties": false,
      "fields": {
        "repositoryId": "uuidv7",
        "repoRelativePath": "string",
        "baseOid": "git_oid",
        "headOid": "git_oid",
        "blobOid": "git_oid?"
      }
    },
    "TeamRolePolicy": {
      "schemaId": "aelyris.team_role_policy/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "roleId": "string",
        "capabilityProfileIds": "string[]",
        "budgetProfileId": "string",
        "proofProfileId": "string",
        "mayImplement": "boolean",
        "mayReview": "boolean",
        "mayAuthorizeCompletion": "boolean"
      }
    },
    "TeamExecutionPolicy": {
      "schemaId": "aelyris.team_execution_policy/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "roles": "TeamRolePolicy[]",
        "reviewerIndependencePolicyId": "string",
        "ownershipPolicyId": "string",
        "governancePolicyId": "string"
      }
    },
    "TypedBlocker": {
      "schemaId": "aelyris.typed_blocker/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "blockerId": "uuidv7",
        "class": "repo|policy|operator|external",
        "owner": "string",
        "condition": "string",
        "exactNextAction": "string",
        "requiredAuthority": "string",
        "requiredInputs": "string[]",
        "exactCommand": "SafeOperatorCommand?",
        "expectedResult": "string",
        "expectedArtifacts": "string[]",
        "acceptanceImpact": "string[]",
        "evidenceRefs": "EvidenceRefV2[]",
        "firstObservedAt": "rfc3339",
        "lastConfirmedAt": "rfc3339",
        "freshness": "EvidenceFreshnessPolicy"
      }
    },
    "VersionedRef": {
      "schemaId": "aelyris.versioned_ref/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "id": "string",
        "contractVersion": "string",
        "contentDigest": "sha256"
      }
    },
    "MissionDefinitionRevision": {
      "schemaId": "aelyris.mission_definition/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "schema": "aelyris.mission_definition/v1",
        "missionId": "uuidv7",
        "revision": "u64",
        "workspaceId": "uuidv7",
        "projectId": "uuidv7",
        "goal": "string",
        "desiredOutcome": "string",
        "capabilityOutcome": "string",
        "nonGoals": "string[]",
        "baseOid": "git_oid",
        "acceptance": "AcceptanceClause[]",
        "riskPolicy": "RiskPolicy",
        "budgetPolicy": "BudgetPolicy",
        "runtimePolicy": "RuntimePolicy",
        "teamPolicy": "TeamExecutionPolicy",
        "workGraphDefinitionRevision": "u64",
        "createdBy": "uuidv7",
        "approvedBy": "uuidv7?",
        "createdAt": "rfc3339"
      }
    },
    "WorkUnitDefinition": {
      "schemaId": "aelyris.work_unit_definition/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "workUnitId": "uuidv7",
        "missionId": "uuidv7",
        "definitionRevision": "u64",
        "title": "string",
        "objective": "string",
        "dependsOn": "uuidv7[]",
        "requiredRole": "string",
        "completionAuthorityRoleIds": "string[]",
        "requiredAdapterCapabilities": "AdapterCapability[]",
        "fileIntents": "ResourceIntent[]",
        "symbolIntents": "SymbolIntent[]",
        "requiredCapabilityTemplates": "CapabilityTemplate[]",
        "requiredGates": "GateRequirement[]",
        "requiredArtifacts": "ArtifactRequirement[]",
        "riskClass": "low|moderate|high|irreversible",
        "capabilityUnlock": "CapabilityUnlock"
      }
    },
    "EvidenceRefV2": {
      "schemaId": "aelyris.evidence_ref/v2",
      "ownerId": "evidence_test",
      "additionalProperties": false,
      "fields": {
        "evidenceId": "uuidv7",
        "kind": "command|artifact|gate|review|approval|merge|operator",
        "locator": "EvidenceLocator",
        "contentDigestAlgorithm": "sha256",
        "contentDigest": "sha256",
        "producedByEventId": "uuidv7",
        "environmentFingerprint": "string?",
        "baseOid": "git_oid?",
        "headOid": "git_oid?",
        "generatedAt": "rfc3339",
        "validUntil": "rfc3339?",
        "redactionCount": "u32",
        "provenance": "ProvenanceEnvelopeRef",
        "integrity": "IntegrityEnvelope"
      }
    },
    "GateExecutionRecord": {
      "schemaId": "aelyris.gate_execution_record/v1",
      "ownerId": "evidence_test",
      "additionalProperties": false,
      "fields": {
        "gateId": "string",
        "contractVersion": "string",
        "commandFingerprint": "sha256",
        "runtimeDomainId": "uuidv7",
        "baseOid": "git_oid",
        "headOid": "git_oid",
        "startedAt": "rfc3339",
        "endedAt": "rfc3339",
        "result": "passed|failed|blocked|cancelled",
        "artifactRefs": "EvidenceRefV2[]",
        "freshness": "current|stale",
        "blocker": "TypedBlocker?"
      }
    },
    "ReviewRecord": {
      "schemaId": "aelyris.review_record/v1",
      "ownerId": "review",
      "additionalProperties": false,
      "fields": {
        "reviewId": "uuidv7",
        "missionId": "uuidv7",
        "missionRevision": "u64",
        "workUnitId": "uuidv7",
        "reviewedOid": "git_oid",
        "testedEvidenceRef": "EvidenceRefV2",
        "reviewer": "PrincipalRef",
        "reviewerIndependence": "ReviewerIndependenceProof",
        "verdict": "accepted|changes_requested|blocked",
        "dissent": "DissentRecord[]",
        "findings": "string[]"
      }
    },
    "ExactOidSettlement": {
      "schemaId": "aelyris.exact_oid_settlement/v1",
      "ownerId": "merge",
      "additionalProperties": false,
      "fields": {
        "baseOid": "git_oid",
        "candidateOid": "git_oid",
        "testedOid": "git_oid",
        "reviewedOid": "git_oid",
        "mergeIntentSourceOid": "git_oid",
        "mergeIntentTargetOid": "git_oid",
        "integratedOid": "git_oid",
        "mergeResult": "not_required|merged_exact_oid"
      }
    },
    "WorkPacketBase": {
      "schemaId": "aelyris.work_packet_base/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "packetId": "uuidv7",
        "missionId": "uuidv7",
        "missionRevision": "u64",
        "workUnitId": "uuidv7",
        "implementer": "PrincipalRef?",
        "operator": "PrincipalRef?",
        "adapterDescriptor": "VersionedRef?",
        "modelRef": "VersionedRef?",
        "skillRefs": "VersionedRef[]",
        "environmentFingerprint": "string?",
        "baseOid": "git_oid",
        "headOid": "git_oid",
        "contractProofVersion": "string",
        "settlementExpectedVersion": "string",
        "ownedFiles": "RepositoryResourceRef[]",
        "ownedSymbols": "SymbolIntent[]",
        "gateRecords": "GateExecutionRecord[]",
        "evidenceRefs": "EvidenceRefV2[]",
        "approvalCapabilityLeaseId": "uuidv7?",
        "acceptanceCoverage": "AcceptanceCoverageEntry[]",
        "chronicleRange": "ChronicleRangeProof",
        "rollbackRecipe": "RecoveryInstruction[]",
        "replayRecipe": "ReplayInstruction[]",
        "supersedesPacketId": "uuidv7?",
        "createdAt": "rfc3339",
        "integrity": "IntegrityEnvelope"
      }
    },
    "CompletedWorkPacket": {
      "schemaId": "aelyris.completed_work_packet/v1",
      "ownerId": "mission_work_settlement",
      "extends": "WorkPacketBase",
      "additionalProperties": false,
      "fields": {
        "schema": "aelyris.completed_work_packet/v1",
        "implementer": "PrincipalRef",
        "reviewer": "PrincipalRef",
        "adapterDescriptor": "VersionedRef",
        "environmentFingerprint": "string",
        "reviewerVerdict": "accepted",
        "reviewerIndependence": "ReviewerIndependenceProof",
        "dissent": "DissentRecord[]",
        "outcome": "accepted|merged",
        "mergeIntentId": "uuidv7?",
        "mergeResult": "(not_required|merged_exact_oid)?",
        "integratedOid": "git_oid",
        "fulfilledObligationRefs": "VersionedRef[]",
        "residualRisks": "NonBlockingResidualRisk[]",
        "repoBlockers": "[]",
        "policyBlockers": "[]",
        "operatorBlockers": "[]",
        "externalBlockers": "[]"
      }
    },
    "BlockedWorkPacket": {
      "schemaId": "aelyris.blocked_work_packet/v1",
      "ownerId": "mission_work_settlement",
      "extends": "WorkPacketBase",
      "additionalProperties": false,
      "fields": {
        "schema": "aelyris.blocked_work_packet/v1",
        "outcome": "blocked_handoff",
        "repoBlockers": "TypedBlocker[]",
        "policyBlockers": "TypedBlocker[]",
        "operatorBlockers": "TypedBlocker[]",
        "externalBlockers": "TypedBlocker[]",
        "reviewer": "PrincipalRef?",
        "reviewerVerdict": "(accepted|changes_requested|blocked)?",
        "reviewerIndependence": "ReviewerIndependenceProof?",
        "dissent": "DissentRecord[]",
        "exactNextAction": "string",
        "requiredInputs": "string[]",
        "expectedArtifacts": "string[]"
      }
    },
    "MissionCompletionPacket": {
      "schemaId": "aelyris.mission_completion_packet/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "schema": "aelyris.mission_completion_packet/v1",
        "packetId": "uuidv7",
        "missionId": "uuidv7",
        "missionRevision": "u64",
        "requiredWorkUnitPacketIdsByWorkUnit": "Record<uuidv7,uuidv7>",
        "missionAcceptanceCoverage": "AcceptanceCoverageEntry[]",
        "missionGateRecords": "GateExecutionRecord[]",
        "chronicleRange": "ChronicleRangeProof",
        "finalHeadOid": "git_oid",
        "integratedOid": "git_oid",
        "contractProofVersion": "string",
        "settlementExpectedVersion": "string",
        "fulfilledObligationRefs": "VersionedRef[]",
        "mergeResult": "merged_exact_oid",
        "repoBlockers": "[]",
        "policyBlockers": "[]",
        "operatorBlockers": "[]",
        "externalBlockers": "[]",
        "createdAt": "rfc3339",
        "integrity": "IntegrityEnvelope"
      }
    },
    "A7ContractVersions": {
      "schemaId": "aelyris.a7_contract_versions/v1",
      "ownerId": "mission_work_settlement",
      "additionalProperties": false,
      "fields": {
        "missionRevision": "u64",
        "workUnitDefinitionRevision": "u64",
        "workGraphDefinitionRevision": "u64",
        "contractProofVersion": "string",
        "settlementExpectedVersion": "string",
        "schemaVersions": "Record<string,string>",
        "invalidationReason": "string?"
      }
    }
  },
  "minimumContracts": {
    "mission": { "schemaRef": "MissionDefinitionRevision", "ownerId": "mission_work_settlement" },
    "workUnit": { "schemaRef": "WorkUnitDefinition", "ownerId": "mission_work_settlement" },
    "evidence": { "schemaRef": "EvidenceRefV2", "ownerId": "evidence_test" },
    "review": { "schemaRef": "ReviewRecord", "ownerId": "review" },
    "exactOid": { "schemaRef": "ExactOidSettlement", "ownerId": "merge" },
    "completedWork": { "schemaRef": "CompletedWorkPacket", "ownerId": "mission_work_settlement" },
    "blockedWork": { "schemaRef": "BlockedWorkPacket", "ownerId": "mission_work_settlement" },
    "missionCompletion": { "schemaRef": "MissionCompletionPacket", "ownerId": "mission_work_settlement" },
    "versioning": { "schemaRef": "A7ContractVersions", "ownerId": "mission_work_settlement" }
  },
  "oidInvariants": [
    "testedOid equals candidateOid",
    "reviewedOid equals testedOid",
    "mergeIntentSourceOid equals reviewedOid",
    "integratedOid is the exact merge receipt OID for the frozen target",
    "any OID or contract version change invalidates settlement and requires fresh test and review"
  ],
  "faceDisposition": [
    {
      "journeyStep": "request",
      "ipc": { "action": "mission_plan_preview", "disposition": "route", "seam": "read-only Git HEAD adapter -> TaskManager::preview_mission_plan -> TaskRepo", "reason": "A7.1 uses a durable inert Mission-plan seam; task_submit_plan still executes as a compatibility TaskGraph writer but grants no A7 authority" },
      "mcp": { "action": "aelyris.task.create", "disposition": "compatibility_no_a7_authority", "seam": "TaskManager", "reason": "the compatibility endpoint still executes, but caller-shaped Task has no accepted Mission revision or fixed-plan digest and grants no A7 authority" },
      "pty": { "action": "terminal prompt text", "disposition": "no_a7_authority", "seam": "none", "reason": "terminal text may execute as input but is not request or Mission authority" }
    },
    {
      "journeyStep": "versioned_plan_preview",
      "ipc": { "action": "mission_plan_get | mission_plan_list | mission_plan_accept | mission_plan_reject | mission_plan_cancel", "disposition": "route", "seam": "TaskManager read/CAS projection -> TaskRepo", "reason": "A7.1 reads and decides the immutable inert plan through its sole owner; orchestrator_plan still executes as a compatibility scheduling projection but grants no A7 authority" },
      "mcp": { "action": "aelyris.orchestrator.plan", "disposition": "compatibility_no_a7_authority", "seam": "TaskManager read projection", "reason": "the compatibility read still executes but omits Mission revision, owned targets, proof, risk, and merge policy and grants no A7 authority" },
      "pty": { "action": "terminal plan text", "disposition": "no_a7_authority", "seam": "none", "reason": "terminal text may be displayed but cannot become an accepted versioned plan" }
    },
    {
      "journeyStep": "visible_implementation",
      "ipc": { "action": "orchestrator_step", "disposition": "route", "seam": "run_step_visible -> PaneFleet -> PtyManager", "reason": "this is the existing visible TaskGraph-owned dispatch path" },
      "mcp": { "action": "aelyris.orchestrator.step | aelyris.spawn_agent | aelyris.agent.spawn_visible", "disposition": "compatibility_no_a7_authority", "seam": "run_step or direct spawn", "reason": "the compatibility actions still execute, but the MCP loop is headless and direct spawn is not accepted-plan, Mission, or ownership bound" },
      "pty": { "action": "PaneFleet initial prompt and process", "disposition": "route", "seam": "PaneFleet -> PtyManager -> TerminalInputAuthority", "reason": "visible execution uses the existing PTY generation and single terminal-write authority" }
    },
    {
      "journeyStep": "fresh_tests",
      "ipc": { "action": "orchestrator_step test phase", "disposition": "route", "seam": "ProcessGateRunner", "reason": "A7.2 wires the frozen argv into the existing gate runner and binds its result to the candidate OID" },
      "mcp": { "action": "aelyris.orchestrator.step.gateCommands", "disposition": "compatibility_no_a7_authority", "seam": "ProcessGateRunner", "reason": "the compatibility path still executes but accepts caller-selected gate commands without the fixed Mission contract and grants no A7 evidence authority" },
      "pty": { "action": "terminal test output", "disposition": "no_a7_authority", "seam": "command evidence projection only", "reason": "raw terminal output may be displayed but cannot prove a fresh gate or tested OID" }
    },
    {
      "journeyStep": "independent_review",
      "ipc": { "action": "review_branch", "disposition": "compatibility_no_a7_authority", "seam": "review module", "reason": "the compatibility command still executes but performs a hidden preparatory commit and accepts caller reviewer identity; it grants no A7 review authority" },
      "mcp": { "action": "aelyris.orchestrator.step reviewerId and gates", "disposition": "compatibility_no_a7_authority", "seam": "review module", "reason": "the compatibility action still executes, but caller-supplied reviewer and verdict are not independent-review authority" },
      "pty": { "action": "agent self-review text", "disposition": "no_a7_authority", "seam": "none", "reason": "implementer text may exist but cannot establish reviewer independence or exact-OID review" }
    },
    {
      "journeyStep": "exact_oid_accept_merge",
      "ipc": { "action": "request_merge_intent + approve_merge_intent", "disposition": "route", "seam": "MergeIntentStore -> MergeRepo -> control::merge", "reason": "the existing immutable source/target OID and CAS owner is extended with Mission and review evidence in A7.3" },
      "mcp": { "action": "aelyris.request_merge + aelyris.review.approve", "disposition": "compatibility_no_a7_authority", "seam": "MergeIntentStore", "reason": "the compatibility actions still execute, but the direct face accepts caller authority and lacks accepted Mission/review lineage binding" },
      "pty": { "action": "git merge command text", "disposition": "no_a7_authority", "seam": "none", "reason": "shell text may execute but is not an exact-OID merge receipt or settlement authority" }
    },
    {
      "journeyStep": "immutable_completion_packet",
      "ipc": { "action": "packet read projection after internal settlement", "disposition": "route", "seam": "TaskManager compare-and-swap -> TaskRepo", "reason": "A7.4 settles inside the existing Mission/WorkUnit owner and IPC only renders the result" },
      "mcp": { "action": "tool success or completion text", "disposition": "compatibility_no_a7_authority", "seam": "none", "reason": "compatibility tool success still returns normally but cannot mint CompletedWorkPacket or MissionCompletionPacket" },
      "pty": { "action": "agent done text or process exit", "disposition": "no_a7_authority", "seam": "none", "reason": "agent self-report and process exit may occur but grant zero completion credit" }
    }
  ],
  "negativeScenario": {
    "scenarioId": "a7-core-stale-tested-oid-v1",
    "mutation": "candidate OID changes after the declared test and before independent review",
    "requiredPacket": "aelyris.blocked_work_packet/v1",
    "blockerClass": "repo",
    "exactNextAction": "run the declared focused test and independent review again at the changed OID",
    "completionCredit": false,
    "missionState": "blocked"
  },
  "deferredDestinations": [
    "proofbook_product_ui_and_recipes",
    "fleet_briefing",
    "broad_budget_and_cost_ux",
    "remote_continuity",
    "all_face_control_kernel_beyond_enabled_mission_path",
    "provider_fabric_expansion",
    "learning_layers"
  ],
  "forbiddenNewOwners": [
    "second_mission_dag",
    "second_operation_journal",
    "second_runner",
    "second_dispatcher",
    "completion_barrier_or_table_owner",
    "frontend_mission_or_completion_state_owner"
  ]
}
```
<!-- A7_CORE_SCOPE_LOCK_V1_END -->

A7.0 freezes this record only. It implements no Mission schema, runtime action,
packet settlement, UI state, or completion claim. A7.1 starts from the existing
`TaskManager`/`TaskRepo` owner and the fixed fixture above.

### A7.1 Request Contract And Versioned Plan Preview

- accept one request into the existing TaskGraph-backed Mission owner;
- produce a versioned plan preview covering owned targets, expected tests,
  independent review, merge policy, and explicit risk before any effect;
- persist only the minimum causal facts required for explanation and resumption;
- reject or cancel before plan acceptance without creating a worktree, PTY, lease,
  or other external effect.

The A7.1 implementation keeps the accepted definition inert. `accepted` proves
only that an immutable versioned plan was selected; it does not materialize a
`Task`, recompute readiness, reserve an execution generation, or authorize the
existing orchestrator to dispatch. A7.2 owns the first explicit activation into
the visible execution path after its authority and fencing contract is present.
SQLite persistence of the preview and its decision is internal causal state, not
an implementation effect.

The frozen A7 Core request is fail-closed at this boundary: the existing read-only
Git owner resolves the canonical repository root and current HEAD for preview, and
acceptance resolves it again before the terminal compare-and-swap. A moved HEAD,
non-canonical UUID, different target, command, runtime domain, adapter capability,
or A7.2 unlock contract cannot be accepted by changing caller-shaped text. A
replacement must align plan, Mission, work-graph, and WorkUnit revisions, advance
the previous plan revision by exactly one, and follow a durable `rejected` or
`cancelled` predecessor; `previewed` and `accepted` revisions cannot be bypassed.
The A7.0 face inventory is correspondingly corrected:
the inert `mission_plan_*` commands are the A7 route, while the immediately
materializing `task_submit_plan` and scheduling-only `orchestrator_plan` remain
executable compatibility faces with no A7 authority.

<!-- A7_1_INERT_PLAN_CONTRACT_V1_BEGIN -->
```json
{
  "schema": "aelyris.a7_1_inert_plan_contract/v1",
  "contractVersion": 1,
  "owner": "TaskManager -> TaskRepo",
  "previewSchema": "aelyris.mission_plan_preview/v1",
  "canonicalization": "rfc8785_json_utf8",
  "persistence": {
    "schemaVersion": 7,
    "table": "mission_plan_revisions",
    "contentMutable": false,
    "deletable": false,
    "oneAcceptedPlanPerMissionDefinitionRevision": true
  },
  "states": {
    "initial": "previewed",
    "terminal": ["accepted", "rejected", "cancelled"],
    "transitions": [
      "previewed -> accepted",
      "previewed -> rejected",
      "previewed -> cancelled"
    ]
  },
  "revisionChain": {
    "firstRevision": 1,
    "nextRevision": "previous + 1",
    "alignedVersions": [
      "planRevision",
      "MissionDefinitionRevision.revision",
      "MissionDefinitionRevision.workGraphDefinitionRevision",
      "WorkUnitDefinition.definitionRevision"
    ],
    "predecessorTerminalStates": ["rejected", "cancelled"],
    "previewedOrAcceptedPredecessorMayBeBypassed": false
  },
  "causalFacts": [
    "requestId",
    "normalizedRequest",
    "requestDigest",
    "planId",
    "planRevision",
    "contentDigest",
    "repositoryId",
    "repositoryRoot",
    "acceptedMissionHeadOid",
    "MissionDefinitionRevision",
    "WorkUnitDefinition[]",
    "ownedTargets",
    "expectedTests",
    "reviewRequirement",
    "mergePolicy",
    "explicitRisks",
    "decisionPrincipalId",
    "decisionReason",
    "persistedAtUnixMs",
    "decidedAtUnixMs"
  ],
  "ipc": [
    "mission_plan_preview",
    "mission_plan_get",
    "mission_plan_list",
    "mission_plan_accept",
    "mission_plan_reject",
    "mission_plan_cancel"
  ],
  "frozenAdmission": {
    "baseOidSource": "accepted_mission_head",
    "headReadOwner": "existing read-only Git adapter",
    "headCheckedAt": ["preview", "accept"],
    "runtimeDomainIds": ["visible_pty"],
    "requiredAdapterCapabilities": ["prompt"],
    "riskPolicy": "a7-core-risk/v1@1",
    "budgetPolicy": "a7-budget/v1@1:wall_time_ms=600000:blocked",
    "teamPolicy": "implementer=a7-impl/v1;independent_reviewer=a7-review/v1;a7-core-reviewer-independence/v1;a7-exact-path/v1;a7-core/v1",
    "ownedTargets": ["src-tauri/src/task/graph.rs"],
    "testCommandArgv": [
      "cargo",
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--lib",
      "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order",
      "--",
      "--exact"
    ],
    "gateContractVersion": "1",
    "freshnessPolicy": {
      "policyId": "a7-exact-oid/v1",
      "maxAgeMs": "300000",
      "requireSameHeadOid": true,
      "requireSameContractVersion": true,
      "requireSameEnvironmentFingerprint": true
    },
    "requiredResult": "passed_exact_oid",
    "capabilityUnlock": "a7.2.activate_visible_implementation"
  },
  "compatibilityWithoutA7Authority": [
    "task_submit_plan",
    "orchestrator_plan"
  ],
  "forbiddenBeforeA7_2": [
    "TaskGraph materialization or revision change",
    "worktree creation",
    "PTY creation or input",
    "ownership or capability lease",
    "execution reservation",
    "agent or LLM invocation",
    "gate execution",
    "review or merge",
    "completion or blocked packet settlement"
  ],
  "acceptedNextAction": "A7.2 explicit visible activation",
  "proofCommand": "pnpm verify:a7:mission-plan",
  "phaseComplete": false
}
```
<!-- A7_1_INERT_PLAN_CONTRACT_V1_END -->

### A7.2 Visible Implementation And Fresh Tests

- run one real implementation agent in a visible PTY and isolated worktree with
  stable Mission/work-unit/runtime/ownership correlation;
- bind enabled actions to the accepted plan, actor, generation, owned targets, and
  current OID through existing authority and execution-fence owners;
- run the declared tests after implementation and persist exact command, result,
  evidence digest, and tested OID;
- unused adapters and destination surfaces retain their compatibility behavior but
  receive no A7 Mission authority or completion credit.

The exact candidate is frozen before the declared test. Candidate freeze is a
Git/worktree identity operation, not review or acceptance: the existing owner stages
only backend-derived owned targets, creates one immutable candidate commit, and then
requires a clean worktree whose `HEAD` equals that candidate. The gate runs only after
that check. Consequently `testedOid == candidateOid` is direct runtime evidence, not
an inference that a later commit happened to contain the tested dirty tree. A7.3 must
consume this frozen tested OID and may not create, amend, or silently replace it.

The WorkUnit `CapabilityUnlock` remains a post-work-unit projection. Because its
`availableAfterWorkUnitId` names the same WorkUnit, it cannot circularly authorize
that WorkUnit's own implementation. A7.2 activation authority is instead the
accepted Mission definition plus its implementer role, runtime, ownership, budget,
risk, and proof policies. The unlock gains no dispatch or completion authority here.

<!-- A7_2_VISIBLE_IMPLEMENTATION_CONTRACT_V1_BEGIN -->
```json
{
  "schema": "aelyris.a7_2_visible_implementation_contract/v1",
  "contractVersion": 1,
  "owner": "TaskManager -> TaskRepo",
  "route": "mission_plan_run",
  "activation": {
    "acceptedStatusRequired": true,
    "taskCount": 1,
    "atomicTaskGraphAndBinding": true,
    "idempotent": true,
    "derivedOnly": [
      "MissionId and revision",
      "WorkUnitId and revision",
      "planId, revision, and contentDigest",
      "repository identity and accepted base OID",
      "implementer role and runtime policy",
      "source and target branch",
      "owned targets",
      "declared gate argv"
    ],
    "callerMayWiden": false
  },
  "orderedEffects": [
    "accepted plan integrity and authoritative HEAD recheck",
    "durable activation plus TaskGraph materialization",
    "durable execution-generation reservation",
    "generation-bound ownership claims",
    "exact-base isolated worktree",
    "visible PTY implementation agent",
    "owned-only candidate freeze",
    "clean candidate HEAD verification",
    "frozen declared test argv",
    "immutable exact-OID gate evidence",
    "await independent review"
  ],
  "candidateFreeze": {
    "owner": "existing Git/worktree owner",
    "beforeDeclaredTest": true,
    "stage": "backend-derived owned targets only",
    "reject": [
      "empty candidate",
      "unowned or extra changed path",
      "symlink or repository escape",
      "wrong existing worktree repository or branch",
      "accepted base OID drift",
      "dirty worktree after commit",
      "candidate HEAD mismatch"
    ]
  },
  "visibleCompletion": {
    "primarySignal": "backend-derived marker with exact content done",
    "legacyOutputsFallbackAuthorized": false,
    "reason": "the owned graph.rs target exists before dispatch and cannot prove implementation completion"
  },
  "persistence": {
    "schemaVersion": 8,
    "activationTable": "mission_plan_activations",
    "gateEvidenceTable": "mission_gate_evidence",
    "mutableParallelJournal": false,
    "deletable": false
  },
  "freshTestEvidence": {
    "commandSource": "accepted WorkUnit GateRequirement.commandArgv",
    "commandCallerSelectable": false,
    "requiredFields": [
      "gateId and contractVersion",
      "exact argv and command fingerprint",
      "runtime and execution identity",
      "started and ended time",
      "result and bounded artifact digest",
      "baseOid, candidateOid, and testedOid",
      "accepted plan content digest"
    ],
    "oidInvariant": "testedOid == candidateOid == clean worktree HEAD"
  },
  "authorityBoundary": {
    "capabilityUnlockAuthorizesOwnImplementation": false,
    "compatibilityWithoutA7Authority": [
      "orchestrator_step caller repoPath/reviewerId/gates",
      "aelyris.orchestrator.step",
      "aelyris.spawn_agent",
      "aelyris.agent.spawn_visible",
      "review_branch"
    ],
    "stopsBefore": [
      "independent review",
      "acceptance",
      "merge intent",
      "merge",
      "completion or blocked packet settlement"
    ]
  },
  "proofCommand": "pnpm verify:a7:visible-implementation",
  "phaseComplete": false
}
```
<!-- A7_2_VISIBLE_IMPLEMENTATION_CONTRACT_V1_END -->

Implemented checkpoint:

- the accepted Mission plan atomically and idempotently projects exactly one task;
  the existing persistence lock serializes concurrent first activation and the
  autonomy lease rejects any unrelated graph member before an effect;
- one real visible-PTY Codex implementation run is launched with hooks disabled,
  an intact multiline prompt, an exact four-byte `done` completion signal, and an
  exact-base isolated worktree;
- the existing Git/worktree owner freezes only the backend-derived owned path into
  a clean candidate commit before the declared `--lib` exact test runs;
- immutable SQLite v8 evidence binds accepted plan digest, execution generation,
  visible PTY, argv/environment fingerprints, times, result, base OID, candidate
  OID, and tested OID;
- restart keeps the completed worker at `Review/Reserved`; A7.2 starts no independent
  review, acceptance, merge intent, merge, or packet settlement;
- `pnpm verify:a7:visible-implementation` reports clean-state live provenance,
  14/14 focused tests, `completedSlice=A7.2`, `nextImplementationSlice=A7.3`, and
  `phaseComplete=false`.

### A7.3 Independent Review And Exact-OID Acceptance

- compute reviewer independence and bind review to the exact tested OID and
  acceptance clauses;
- rejection returns exact findings and next action without completion credit;
- acceptance/merge uses the existing exact-OID merge-intent owner and fails on
  dirty/unowned worktrees, stale evidence, changed OID, or changed contract;
- do not introduce automatic main merge.

<!-- A7_3_REVIEW_ACCEPTANCE_CONTRACT_V2_BEGIN -->
```json
{
  "schema": "aelyris.a7_3_review_acceptance_contract/v2",
  "contractVersion": 2,
  "route": "mission_plan_review_accept",
  "callerAuthority": ["planId", "planRevision"],
  "reviewerAuthority": {
    "identity": "sealed successful-process receipt persisted before the review record and bound to builder attempt/runtime/provider lineage",
    "modelCallerSelectable": false,
    "fixedAdapter": "codex exec -m gpt-5.6-sol --ephemeral --ignore-user-config -s read-only --skip-git-repo-check --output-schema <ephemeral-fixed-schema>",
    "outputSchema": "aelyris.a7-review-model-response/v1",
    "windowsTransport": "PowerShell 7 pwsh shim plus process-local prompt environment; no multiline batch argument",
    "policy": "a7-core-reviewer-independence/v1",
    "typedRefs": ["VersionedRef", "EvidenceRefV2"],
    "samePrincipalSessionForkDescendantOrDisallowedProvider": "blocked",
    "builderAdapterFact": "codex-no-hooks",
    "builderProviderFact": "codex",
    "builderModelObservation": "unknown/unobserved"
  },
  "gateRevalidation": {
    "schemaVersion": 9,
    "appendOnly": true,
    "candidateMutation": false,
    "maxAgeMs": 300000,
    "oidInvariant": "testedOid == candidateOid == source branch and clean worktree HEAD"
  },
  "review": {
    "owner": "Review -> ReviewRepo",
    "invocationReceiptTable": "mission_reviewer_invocation_receipts",
    "recordTable": "mission_review_records",
    "exactClauseCoverageRequired": true,
    "missingCoverage": "blocked",
    "rejectionFence": "Review/EffectStarted -> Review/Committed -> Failed/Committed",
    "uncertainFailureFence": "NeedsReconcile",
    "canonicalRepoValidation": ["exact sealed invocation receipt", "exact gate evidence", "activation/task/attempt", "reviewDigest", "independenceDigest", "eligible", "JSON/scalar equality"],
    "rejectionCompletionCredit": false
  },
  "merge": {
    "owner": "MergeIntentStore -> MergeRepo -> control::merge",
    "bindingTable": "mission_merge_bindings",
    "receiptTable": "mission_merge_receipts",
    "targetBranch": "a7-acceptance",
    "targetMustStartAtAcceptedBase": true,
    "integratedOidInvariant": "integratedOid == reviewedOid == testedOid",
    "automaticMainMerge": false,
    "intentCollisionGuard": ["canonicalRepo", "sourceBranch", "targetBranch", "task", "sourceOid", "targetOid", "mergeBaseOid", "state"],
    "resumeBoundaries": [
      "reviewRecord",
      "mergeBinding",
      "reviewCommit",
      "mergeReserve",
      "mergeStart",
      "intentMerged",
      "receiptBeforeTaskCommit"
    ],
    "successTaskFence": "MergeReady/Merge/Committed",
    "mergingRestartCases": ["git tips unchanged before effect", "git target equals exact source before merged state and receipt"]
  },
  "stopsBefore": [
    "CompletedWorkPacket",
    "BlockedWorkPacket",
    "MissionCompletionPacket",
    "A7 combined acceptance"
  ],
  "proofCommand": "pnpm verify:a7:review-acceptance",
  "phaseComplete": false
}
```
<!-- A7_3_REVIEW_ACCEPTANCE_CONTRACT_V2_END -->

Executed A7.3 closeout (2026-08-02): the first live reviewer correctly failed
closed because the prompt exposed only a gate-evidence identifier and not the
executed result. The review context contract now carries the authoritative
`result=passed`, exact test argv, evidence digest, timestamps, and tested OID, with
a focused regression preventing that evidence omission. A fresh isolated run then
produced an independent fixed-`gpt-5.6-sol` receipt, accepted all four clauses with
zero findings, and integrated only
`5be87d52a8493552e4502b1cc58454bda021e372` into `a7-acceptance`. The live artifact
is `.codex-auto/quality/a7-review-acceptance-live.json`; main, origin/main, and the
clean candidate remained unchanged. This completes only A7.3 and activates A7.4;
the work unit remains `Review` and no completion packet or A7 completion is claimed.

### A7.4 Completion Settlement

- immutable `CompletedWorkPacket` with accepted Mission revision, exact tested and
  reviewed OID, diff ownership, fresh test evidence, computed reviewer independence,
  accept/merge receipt, and zero acceptance blockers;
- separate `BlockedWorkPacket` with exact repo/policy/operator/external blockers,
  authority, inputs, command/result/artifacts, and next action; it grants zero
  completion credit;
- aggregate the exact required work-unit packets and Mission-level coverage into a
  distinct `MissionCompletionPacket`; one work-unit packet cannot complete Mission;
- enforce integrated-OID packet settlement with clean/owned worktree proof,
  unresolved Decision/obligation rejection, compare-and-swap invalidation on
  OID/revision/proof-version change, and mandatory re-proof after integration
  changes; do not add a completion-barrier owner or table;
- negative tests cover tamper, stale OID, missing/stale evidence, capability replay,
  hidden blocker, same-agent/fork reviewer, packet coverage gaps, raw/injected
  recovery instruction, and wrong reviewer;
- only a valid `CompletedWorkPacket` may render trusted work-unit Done, and only a
  valid `MissionCompletionPacket` may render trusted Mission Done.

Initial A7.4 implementation (2026-08-02): packet schemas and typed blocker/recovery data
live with the existing Mission contract, `TaskRepo` owns immutable SQLite v10 packet
persistence and settlement CAS, and `TaskManager` derives review/merge lineage and
the exact owned candidate before atomically publishing trusted `Done` or `Blocked`.
Same sealed retries are idempotent; OID/proof/status drift conflicts and requires
re-proof. Policy/operator/external blockers remain separate typed arrays with zero
completion credit. `pnpm verify:a7:completion-settlement` passes 5 focused tests.
Independent review reopened A7.4 for exact freshness authority, closed blocker-source
classification, superseding immutable settlement generations, and a Git witness bound
to the commit CAS. A7.5 remains frozen; `phaseComplete=false`.

A7.4 regression-repair closeout (2026-08-02): settlement derives the accepted
five-minute freshness contract and closed typed blockers without caller-authored facts;
SQLite v11 retains superseding generations with one current leaf; and the observed
candidate/target/worktree witness is revalidated after the state lock, inside
`BEGIN IMMEDIATE`, after serialization/idempotent reads and immediately before the
settlement-expected-version CAS. Git mutation before or during that final witness changes
the fingerprint and rolls back with no Done; mutation after the witness returns is
post-linearization drift and requires a later generation/re-proof rather than
retroactively changing the committed snapshot. The focused proof now covers eight Rust
tests, including a real two-connection successor race, exact freshness boundaries,
receipt-only recovery through `TaskManager`, populated v10 packet migration for all three
packet kinds, Git-ref drift rollback, blocked-to-completed re-proof, and immutable history.
A later separated review found one legacy decode-order gap: a v10-shaped raw packet could
carry the digest of its defaults-expanded current struct. The repaired decoder now selects
complete-v11, complete-v10, or invalid-partial shape from raw JSON before validation;
legacy shape always requires the exact old raw digest and then current semantic resealing.
Negative completed, Mission, and blocked fixtures prove the defaults-expanded digest is
rejected after the real v11 migration. Final separated independent review passed with
zero major findings. A7.4 is complete; A7.5 is the next slice, remains unstarted until
the closeout commit, and A7 `phaseComplete=false` remains truthful.

### A7.5 Canonical Core Mission Combined Acceptance

Status: next; not started. A7.4 completion does not itself satisfy combined acceptance.

- one useful request passes versioned plan preview, visible implementation, fresh
  tests, independent exact-OID review, exact-OID accept/merge, immutable
  `CompletedWorkPacket`, and exact `MissionCompletionPacket` in order;
- no inferred completion truth, hidden acceptance blocker, or unclassified failure;
- aggregate reports A7 complete only after every required child gate and blocking
  CI evidence is current;
- a separate required negative scenario emits `BlockedWorkPacket`, proves exact
  continuation, and keeps the Mission/A7 aggregate incomplete;
- Proofbook product UI/recipes, Fleet Briefing, broad budget/cost UX, Remote
  Continuity, all-face Control Kernel migration beyond the enabled journey,
  structured provider expansion, and learning layers receive no A7 completion
  credit and remain deferred product work.

## 18. Apex Design Gates

Apex capabilities are post-release product waves. Before release, only isolated,
non-shipping research spikes may be separately authorized. Such spikes may not
modify the shipping path, enter public capability claims, block or satisfy R0-A9,
or receive release-completion credit. Apex work does not silently become R0-A9
completion criteria:

- production ACP/SDK adapters and later signed A2A federation;
- full Chronicle projection replay and historical scrub;
- recovery branch/checkpoint/compensation UI;
- complete Qralis addressed message and role-lease fabric;
- Proofbook product UI, recipes, Fleet Briefing/budget-cost integration, fan-out,
  subProofbook, and Evidence Store productization;
- Verified Skill Foundry and Team Memory promotion;
- Decision Lab and Adversarial Council;
- static Counterfactual rehearsal, then executed Shadow Missions;
- Temporal Code Map revalidation automation;
- scoped Remote Continuity read-only, then governed input and writable attach;
- local signed extension registry, then post-release marketplace;
- A2A multi-machine federation.

### 18.1 OpenCode Candidate Adapter Research Contract

`V1-R0` evaluates OpenCode as the first named structured-runtime candidate. It
does not make OpenCode a product dependency, runtime owner, public capability, or
R0-A9 completion criterion. Normal execution starts after A9; any earlier work is
an independently authorized, isolated, non-shipping experiment and cannot change
the active remediation order or shipping path.

The experiment is implementation-ready only when its packet includes these
requirements:

| ID | Contract |
| --- | --- |
| `OC-R0-01` | Execute one fixed Mission fixture through visible PTY, OpenCode ACP, and OpenCode HTTP/SSE with the same repository, acceptance clauses, provider/model class, and budget class. Missing OpenCode or a transport capability is typed `unsupported`, never silently substituted. |
| `OC-R0-02` | Pin and record the OpenCode artifact, version, source/provenance, license, auto-update state, OpenAPI/schema digest, and compatible adapter range. Schema drift fails closed before effect. |
| `OC-R0-03` | Bind the server to loopback, use race-safe port ownership and short-lived credentials, keep secrets out of arguments/logs/artifacts, and prove child-process termination plus port release. |
| `OC-R0-04` | Inventory every config and credential source, including global, project, custom, inline, managed, environment, `.env`, and provider-auth paths. Prove an isolated effective configuration; `OPENCODE_CONFIG_DIR` by itself is insufficient because sources are merged. |
| `OC-R0-05` | Map external session, tool, diff, permission, status, usage, and error facts into existing `AgentSession`, WorkExecutionAttempt/generation, WorkEvent/Chronicle, capability, Proofbook, review, and merge owners. No second runtime graph, journal, permission authority, completion truth, or merge owner is allowed. |
| `OC-R0-06` | Route every effect through the canonical Control Kernel and Aelyris capability lease. An OpenCode allow/deny prompt is adapter evidence and UI, not authority to grant or widen capability. |
| `OC-R0-07` | Prove abort, disconnect, reconnect, duplicate/out-of-order event, process crash, restart, fork/resume, uncertain effect, and reconciliation behavior. Delivery is at-least-once with idempotent consumers; exactly-once is not claimed. |
| `OC-R0-08` | Measure capability coverage, structured-event fidelity, deny equivalence, diff/evidence completeness, reconnect loss, operator visibility, latency, cost, and secret leakage against the visible PTY Current Best. |
| `OC-R0-09` | Preserve Mission/runtime/evidence identity across adapter disable or retirement and prove visible PTY fallback without rewriting accepted history. |
| `OC-R0-10` | Keep an Aelyris Runtime TUI outside this comparison. It receives a separate product-surface decision only after a structured adapter and daemon-owned projection are proven. |

The decision artifact returns `promote_one`, `hold`, or `reject`:

- `promote_one` names either ACP or HTTP/SSE, demonstrates a material Goal
  improvement over PTY, and passes every authority, isolation, recovery, and
  owner invariant;
- `hold` records the missing capability or negative proof without blocking the
  existing roadmap;
- `reject` retires the candidate when it duplicates ownership, leaks
  config/credentials, cannot reconcile uncertain effects, bypasses the Control
  Kernel, or provides no meaningful advantage.

The experiment may use the upstream
[server contract](https://opencode.ai/docs/server/),
[ACP contract](https://opencode.ai/docs/acp/), and
[configuration precedence](https://opencode.ai/docs/config/) as discovery
inputs. Executed evidence from the pinned artifact remains authoritative.
The V1-R0 packet must trace every `OC-R0-*` requirement to fixed positive and
negative fixtures and emit a machine-readable decision artifact.

### 18.2 External Team-Operations Synthesis Contract

External runtime, messaging, agent-team, and automation documents are discovery
inputs. A pinned implementation and Aelyris-owned gates remain authoritative.

- `V1-R1` follows `V1-R0=promote_one` and maps structured snapshots/events into
  existing `AgentSession`, WorkEvent, capability, and Mission projections with
  source-fact explainability, deterministic reconstruction, gap/stale/reconcile
  states, and adapter-disable fallback.
- `V1-R2` adopts an external run only through a capability-free quarantine
  projection bound to source/version/schema, repository/OID, environment, cursor,
  provenance, and an accepted Mission. Untrusted events cannot mutate owners,
  issue leases, or receive completion credit.
- `V1-R3` is a conditional Runtime TUI value hypothesis after `promote_one`,
  daemon-owned projection proof, and quarantine proof. It is a Control API
  adapter, not a session/state owner or default Tauri cockpit replacement.
- `V3a` adds typed Qralis messages, Task Claims, Role Leases, Decision Ledger
  references, Attention, and Result Capsule projections. A Result Capsule must
  reference a `CompletedWorkPacket` or `BlockedWorkPacket`.
- `V3b` adds an Obligation Ledger projection of typed fulfillment obligations,
  event-driven dispatch, adaptive Mission-bounded governance, Verified Action
  Surface discovery, and team operations projected from existing owners. A
  message read/ack never fulfills an obligation.
- `V4` strengthens PB-6 with the proof-preserving distillation contract in §12;
  it remains proposal-only until repeated, held-out, canary, rollback, stale-
  invalidation, capability non-broadening, and visual-proof gates pass.

The synthesis rejects parallel `MissionOperation`/`OperationJournal`,
`CompletionBarrier`, scheduler, Proofbook, Decision store, generic chat or
arbitrary-JavaScript authority, fixed 11-agent topology, pre-A9 production
OpenCode/Runtime TUI, and a new assurance score. Existing V5 typed deliberation
remains the Decision Lab authority.

## 19. Verification Matrix

| Gate | Proves | Required negative evidence |
| --- | --- | --- |
| `verify:verifiable-agent-work-os-spec` | spec/design/roadmap/index/claim coherence | missing authority, anti-feature, phase boundary, or package script fails |
| `verify:mission-contract` | schema/revision/state/blocker/unlock rules | stale revision, invalid transition, missing proof requirement |
| `verify:work-event-contract` | typed causal envelope, chain, integrity tier | bad schema, causation, redaction, duplicate/idempotency, anchor/signature mismatch |
| `verify:journal-convergence` | canonical owner and bounded persistence | DB outage, disk full, backpressure, silent drop, duplicate adoption |
| `verify:mission-progress-projection` | Now/Next/Unlocks/backend ownership | projection hash mismatch, frontend-derived completion |
| `verify:capability-kernel` | reserve/effect/commit lease and all-surface governance | concurrent reserve, PID reuse, path/reparse/ADS/UNC escape, DNS/redirect, clock rollback, stale OID, adapter bypass |
| `verify:completed-work-packet` | successful immutable settlement | integrity/coverage mismatch, stale evidence/OID, same-agent/fork reviewer, uncovered diff, any acceptance blocker |
| `verify:mission-completion-packet` | exact Mission aggregate over required work-unit packets and mission gates | missing/superseded/blocked child, wrong revision/OID, aggregate from one child |
| `verify:blocked-work-packet` | durable handoff with zero completion credit | missing authority/input/action/artifact, hidden blocker, Mission/A7 falsely complete |
| `verify:control-command-registry` | canonical descriptors generate schemas/catalogs and bind one owner | duplicate/orphan action, digest/version drift, adapter-owned policy |
| `verify:control-face-equivalence` | principal/capability/result/event/evidence parity | hardcoded actor, hidden commit, route bypass, transport recursion, different one-use result |
| `verify:mcp-control-adapter` | generated catalog and direct Control Kernel invocation | caller actor/reviewer, tool-success completion, stale schema, recursive MCP business dispatch |
| `verify:work-os-type-closure` | every referenced persistent/wire type resolves to one versioned owner/schema | undefined placeholder, duplicate Rust/TS schema, adapter-local shape |
| `verify:borrowed-substrate-ledger` | BS reuse decision, license/SBOM/attribution and no-copy boundary | copied UI/schema, missing license, competitor text as implementation contract |
| `verify:opencode-adapter-candidate` | fixed-fixture PTY/ACP/HTTP-SSE comparison and `promote_one`/`hold`/`reject` decision | missing binary, schema drift, merged-config or credential leak, permission bypass, duplicate owner, uncertain replay, fallback loss |
| `verify:mission-rehearsal` | pure preview and measured/estimated split | effectful port, missing irreversible marker, unowned write |
| `verify:first-mission` | successful bounded end-to-end A7 vertical | changed OID, stale test/review, self-report completion, missing packet/exact-merge proof, blocked scenario accepted |
| `verify:work-replay` | deterministic projection replay | external resend, unknown schema, hash mismatch |
| `verify:memory-promotion` | evidence-governed learning | raw-chat promotion, missing eval, secret leak, no rollback |
| `verify:extension-trust` | signed capability-bounded extension | bad digest/signature, private DB mutation, grant/merge bypass |
| `verify:verifiable-agent-work-os` | implemented Work OS aggregate | missing child, stale provenance, false phase/release claim |

The Work OS aggregate remains separate from `verify:quality-score`,
`verify:goal:safe:no-token`, A8 evidence, A9 release lane, and external/operator
proof. All are required before a final release claim when the tracked policy says so.

## 20. Classification-To-Gate Traceability

| Stable class | Product contract | Detailed owner | First release-blocking gate | Post-release gate |
| --- | --- | --- | --- | --- |
| `BS-*` Borrowed Substrate | spec §2.1 reuse/no-copy record | runtime/control adapter plus existing domain owner | A7.0 owner/license/schema inventory and `verify:borrowed-substrate-ledger` | adapter-specific Apex gate |
| OpenCode candidate adapter | `BS-11` + `EV-01` | §18.1 plus existing runtime/control/evidence owners | none; V1-R0 cannot receive R0-A9 credit | `verify:opencode-adapter-candidate` |
| `AO-01` Mission graph | FR-1/FR-2 | §4-§5 | A7.0-A7.1, `verify:mission-contract`, `verify:mission-progress-projection` | V2/V7 projection expansion |
| `AO-02` Qralis semantic control | FR-1/FR-7 | existing TaskGraph/ownership plus bounded coordination | A7.1-A7.3 First Mission dependency/ownership fixtures | V3/V7 |
| `AO-03` Proof sovereignty | FR-9 | §9 settlement | A7.4/A7.5 packet gates | V2/V4/V7 |
| `AO-04` Proof-carrying continuity | FR-6/FR-11 | §8/§10 plus session owner | A4.11-A4.12 handoff/restart plus A7.4 blocked settlement | V1/V2 |
| `AO-05` Capability execution | FR-8/FR-18 | §7 and Control API ultra design | A7.2 enabled-path authority | V1/V8/V9 |
| `AO-06` Governed learning | FR-13/FR-15 | §12 | no A7 Core completion credit | V4 |
| `SX-01` Flight Recorder | FR-6 | Chronicle/packet projection | A7.4 minimum packet evidence links | V2 full replay/recovery |
| `SX-02` Conflict Radar | FR-7 | Mission rehearsal/ownership | A7.1 owned-target/risk preview | V3/V7 semantic/temporal radar |
| `SX-03` Proof-Carrying Handoff | FR-11 | checkpoint/reconciliation | A4.11-A4.12 plus A7.4 exact blocked settlement | V1/V2 provider hot-swap |
| `SX-04` Confidence Topology | FR-2/FR-10 | progress/attention projection | no A7 Core completion credit | V7 project-wide invalidation |
| `SX-05` Trust Unlocks | FR-1/FR-9/FR-13 | Mission settlement projection | A7 valid packet unlock only | V4 evaluated skill activation |
| `EV-01..EV-04` Evolution waves | spec §2.4 | roadmap §7/§9.4 | no R0-A9 completion credit | declared Apex entry/measure/reversibility/claim gates |

Every implemented requirement must resolve through
`classification -> FR -> owner/design -> phase/wave -> verifier -> artifact`.
A missing edge blocks claim promotion. This table is design traceability, not proof
that the corresponding runtime gate exists or passes.
