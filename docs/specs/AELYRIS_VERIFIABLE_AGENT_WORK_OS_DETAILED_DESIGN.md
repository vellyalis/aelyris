# Aelyris Verifiable Agent Work OS Detailed Design

Status: approved target design; not an implementation or release claim

Version: 1.0

Last reviewed: 2026-07-13 JST

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
then update this design. A7 implements only the finite Core Mission Loop. Apex
features remain post-A9 unless the tracked plan explicitly promotes a bounded
slice without weakening release completion.

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
  workGraphDefinitionRevision: number;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
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

### 9.4 Settlement algorithm

1. lock Mission/work unit and read exact accepted contract revision;
2. freeze base/head and reject moving/stale OIDs;
3. prove ownership scope covers the candidate diff;
4. resolve every required gate to fresh evidence or classify a typed blocker; no
   missing item is inferred and no blocker can satisfy acceptance;
5. classify current repo/policy/operator/external acceptance blockers; if any
   exist, create/digest `BlockedWorkPacket` with available review state and keep
   the work unit/Mission blocked;
6. for a completion candidate, compute reviewer independence from lineage/policy
   evidence and require an accepted verdict;
7. validate approval capability and exact-OID merge outcome when applicable; a
   failure becomes a typed blocker and `BlockedWorkPacket`;
8. require zero work-unit acceptance blockers and create/digest
   `CompletedWorkPacket`;
9. for Mission settlement, resolve the exact required work-unit packet set, verify
   every Mission-level clause/gate and final exact OID, then create/digest
   `MissionCompletionPacket`;
10. append the chosen settlement event and update projection atomically;
11. mark a work unit completed only for its valid `CompletedWorkPacket`, and mark
    Mission completed only for its valid `MissionCompletionPacket`; a handoff never
    satisfies Mission, phase, release, or goal completion.

Negative cases include tamper, stale OID, stale evidence, missing artifact, wrong
reviewer, uncovered symbol, replayed capability, hidden blocker, and packet/diff
digest mismatch.

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
  results: GateExecutionRecord[];
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

A7 is intentionally finite. It proves one useful Core Mission Loop and does not
make all Apex features release blockers.

### A7.0 Mission Contract Gate

- freeze machine-readable Rust/JSON Schema authority, UUIDv7/sequence/JCS/digest
  rules, Mission, WorkUnit, progress, blocker, packet, evidence, integrity,
  recovery instruction, adapter, budget, and capability contracts;
- inventory journal convergence and existing owner seams before migration;
- inventory every Tauri IPC, MCP, REST, WebSocket, CLI, visible PTY, Proofbook,
  review, merge, frontend-audit, and direct-DB face against the Control API ultra
  design; freeze canonical descriptors/envelopes/errors and bypass-removal gates;
- keep all target runtime claims false;
- freeze the First Mission fixture and finite performance/durability envelope:
  - one local repository fixture with 3-12 work units, at least two owned source
    files/symbols, one visible implementation agent, one independent reviewer,
    one Proofbook run, one negative capability denial, one mid-mission restart,
    one exact-OID accepted merge, and one scoped read-only remote observation;
  - maximum 20 work units, 4 concurrent agents, and 8 panes in the A7 contract;
  - WorkEvent payload <=256 KiB after redaction and observational backlog <=10,000
    events or 64 MiB, whichever comes first;
  - local persisted-event-to-projection p95 <=250 ms and freshness <=1 second;
  - restart reconstruction RTO <=15 seconds and RPO=0 for accepted Mission,
    mutation intent/reservation, capability consumption, gate, review, merge, and
    packet facts;
  - mutation leases expire within 15 minutes and one-use reservations within 60
    seconds unless an explicitly stricter risk policy applies;
  - packet/acceptance evidence is retained while referenced; raw observational
    streams use an explicit privacy/retention policy and a gap marker, never silent
    deletion.

The enabled A7 effect surfaces are Tauri UI/IPC, visible PTY adapter, MCP,
Proofbook, review, and merge. The read-only Remote Continuity fixture uses the
scoped remote projection transport. REST/WS/SSH write, SDK/A2A, extension, and
scheduler mutation are not silently disabled to pass; they are explicitly
unsupported in A7 and belong to later gates.

### A7.1 Mission Spine And Chronicle Minimum

- persist accepted Mission/WorkGraph revision and durable symbol intents;
- produce typed causal events for the First Mission lifecycle;
- reconstruct the same Now/Next/Unlocks projection after restart;
- converge only the event paths required for this vertical, with no third log.

### A7.2 Capability And Agent Fabric Minimum

- local human, local agent, and system reconciler principals;
- capability leases for the PTY/IPC/MCP/Proofbook paths used by First Mission;
- reserve/effect/commit/uncertain, process-tree and monotonic-clock binding,
  canonical Windows resource handles, network/DNS/redirect policy, expiry,
  one-use, OID/args/lane binding, and deny equivalence;
- Universal Agent Fabric descriptors and conformance fixtures for PTY, ACP, SDK,
  and A2A; A7 binds the visible PTY adapter to the First Mission and proves typed
  `unsupported` for unavailable structured capabilities rather than claiming a
  production ACP/SDK/A2A adapter;
- broader production adapters, remote write principals, and extensions remain
  later gated work.

### A7.3 Plan Preview And Visible First Mission

- rehearsal shows task dependencies, ownership, worktrees, gates, risks, measured
  versus estimated budget, irreversible effects, and capability unlock;
- one real agent runs in a visible PTY with stable Mission/runtime correlation;
- work proceeds through existing TaskGraph, ownership, Proofbook, review, merge.

### A7.4 Completion Settlement

- immutable `CompletedWorkPacket` with exact commit, acceptance coverage,
  Chronicle range/root, diff ownership, gates/evidence integrity, computed
  reviewer independence, zero acceptance blockers, and accepted/merged outcome;
- separate `BlockedWorkPacket` with exact repo/policy/operator/external blockers,
  authority, inputs, command/result/artifacts, and next action; it grants zero
  completion credit;
- aggregate the exact required work-unit packets and Mission-level coverage into a
  distinct `MissionCompletionPacket`; one work-unit packet cannot complete Mission;
- negative tests cover tamper, stale OID, missing/stale evidence, capability replay,
  hidden blocker, same-agent/fork reviewer, packet coverage gaps, raw/injected
  recovery instruction, and wrong reviewer;
- only a valid `CompletedWorkPacket` may render trusted work-unit Done, and only a
  valid `MissionCompletionPacket` may render trusted Mission Done.

### A7.5 Proofbook Product, Recipes, And Budget/Cost

- Proofbook canvas, run timeline, and proof inspector render the existing runner/
  ledger truth without a frontend runner or Evidence Store owner;
- preserve the pre-existing A7 requirement for useful fleet recipes and daily
  Fleet Briefing, with versioned inputs/preconditions and no automatic source
  Proofbook mutation;
- budget/cost control reports measured currency/token/time/resource data with
  explicit units and separately labeled estimates;
- Mission settlement consumes immutable Proofbook refs and does not alter run
  settlement.

### A7.6 Remote Read-Only Continuity

- implement the existing read-only Remote Continuity requirement for Now/Next/
  Unlocks, Attention, Fleet Briefing, pane preview, Chronicle, decision, Proofbook,
  and packet projections;
- read leases bind device/session, project/Mission/pane/evidence scope, event range,
  byte/rate cap, expiry, and revocation;
- redact and inert-render terminal/OSC52/clipboard/link/tool/artifact content;
- no steer, approve, stop, writable SSH/WS, or remote state ownership in A7.

### A7.7 Mission Cockpit And Attention

- backend-owned Now/Next/Unlocks and typed attention render in existing cockpit;
- Fleet Briefing explains since-last-seen change, active work, exact next action,
  blocker owner, proof freshness, and unlocked capability;
- recommended Next remains one item while `readyWork[]` preserves other parallel
  lanes;
- no frontend heuristic or duplicate owner.

### A7.8 Successful First Mission Acceptance

- one useful brief runs from accepted contract through visible execution,
  Proofbook product surface, recipes/budget evidence, scoped remote read,
  restart/reconstruction, fresh proof, computed independent review, exact-OID
  accepted merge, immutable `CompletedWorkPacket` children, and the exact
  `MissionCompletionPacket` aggregate;
- no inferred completion truth;
- aggregate reports A7 complete only after every required child gate and blocking
  CI evidence is current;
- a separate required negative scenario emits `BlockedWorkPacket`, proves exact
  handoff continuity, and proves the Mission/A7 aggregate remains incomplete. It
  cannot substitute for the successful First Mission.

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
- Proofbook fan-out/subProofbook/Evidence Store beyond the A7 product surface;
- Verified Skill Foundry and Team Memory promotion;
- Decision Lab and Adversarial Council;
- static Counterfactual rehearsal, then executed Shadow Missions;
- Temporal Code Map revalidation automation;
- governed Remote Continuity input and writable attach after A7 read-only proof;
- local signed extension registry, then post-release marketplace;
- A2A multi-machine federation.

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
| `verify:mission-rehearsal` | pure preview and measured/estimated split | effectful port, missing irreversible marker, unowned write |
| `verify:first-mission` | successful bounded end-to-end A7 vertical | restart/RTO/RPO mismatch, self-report completion, missing Proofbook/remote/packet/exact-merge proof, blocked scenario accepted |
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
| `AO-01` Mission graph | FR-1/FR-2 | §4-§5 | A7.0-A7.1, `verify:mission-contract`, `verify:mission-progress-projection` | V2/V7 projection expansion |
| `AO-02` Qralis semantic control | FR-1/FR-7 | existing TaskGraph/ownership plus bounded coordination | A7.1-A7.3 First Mission dependency/ownership fixtures | V3/V7 |
| `AO-03` Proof sovereignty | FR-9 | §9 settlement | A7.4/A7.8 packet gates | V2/V4/V7 |
| `AO-04` Proof-carrying continuity | FR-6/FR-11 | §8/§10 plus session owner | A7 restart RTO/RPO and blocked handoff | V1/V2 |
| `AO-05` Capability execution | FR-8/FR-18 | §7 and Control API ultra design | A7.2 control/capability equivalence | V1/V8/V9 |
| `AO-06` Governed learning | FR-13/FR-15 | §12 | candidate-only boundary in A7 | V4 |
| `SX-01` Flight Recorder | FR-6 | Chronicle/packet projection | bounded A7 Chronicle Trail | V2 full replay/recovery |
| `SX-02` Conflict Radar | FR-7 | Mission rehearsal/ownership | A7.3 fixed-fixture preview | V3/V7 semantic/temporal radar |
| `SX-03` Proof-Carrying Handoff | FR-11 | checkpoint/reconciliation | A7 restart and exact blocked handoff | V1/V2 provider hot-swap |
| `SX-04` Confidence Topology | FR-2/FR-10 | progress/attention projection | A7.7 acceptance-clause terrain | V7 project-wide invalidation |
| `SX-05` Trust Unlocks | FR-1/FR-9/FR-13 | Mission settlement projection | A7 valid packet unlock only | V4 evaluated skill activation |
| `EV-01..EV-04` Evolution waves | spec §2.4 | roadmap §7/§9.4 | no R0-A9 completion credit | declared Apex entry/measure/reversibility/claim gates |

Every implemented requirement must resolve through
`classification -> FR -> owner/design -> phase/wave -> verifier -> artifact`.
A missing edge blocks claim promotion. This table is design traceability, not proof
that the corresponding runtime gate exists or passes.
