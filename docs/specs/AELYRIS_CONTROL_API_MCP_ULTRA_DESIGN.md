# Aelyris Control API And MCP Ultra Design

Status: design authority; current implementation remains alpha and gated

Parent: `AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md` FR-18

Activation gate: audit-remediation A7.0; no runtime claim before implementation,
adversarial equivalence proof, and current release gates

## 0. Authority And Claim Boundary

This document owns the target cross-face command, identity, authorization,
versioning, failure, and evidence contract for Tauri IPC, MCP, REST, WebSocket,
CLI, visible PTY, Proofbook, review, merge, and later adapters.

It does not claim that the current API/MCP implementation already satisfies this
design. `MCP_TOOL_SURFACE_SPEC.md` remains a current/historical catalog inventory;
its adapter-local `FREE`/`GATED` labels and proposed transports cannot grant
authority or override this contract. Runtime truth remains source plus focused
verifiers. R0-A9 completion criteria remain unchanged.

Authority order:

1. `docs/requirements.md` owns current public and release claims.
2. the active remediation plan owns A6-A9 order and completion gates.
3. the Work OS spec owns product requirements.
4. this document owns target Control API/MCP security and behavior.
5. canonical Rust domain descriptors and schemas, once accepted in A7.0, own wire
   generation; adapters and prose catalogs are projections.

## 1. Current Audit Findings At HEAD `3db3932`

These findings are migration inputs, not proof that the target contract exists:

- `src-tauri/src/api/mcp.rs` contains a large MCP-specific dispatcher and paths
  that construct actor `operator` rather than carrying the authenticated principal;
- REST and WebSocket terminal input paths also construct operator identity after
  middleware resolves a principal;
- Proofbook `mcpTool` execution invokes the MCP transport dispatcher on a fresh
  runtime, risking loss of run principal, causation, idempotency, and budget scope;
- `ApiState` exposes many domain state owners directly to transport handlers;
- review/merge and Proofbook gate faces include caller-supplied reviewer/actor
  values that cannot be accepted as identity evidence;
- WebSocket defaults/tickets do not yet bind the full principal/capability/pane-
  baton contract, and an unbounded reply channel exists;
- generated bearer-token handling includes a warning-log path that must be treated
  as secret exposure debt rather than operational convenience;
- the bounded in-memory MCP pending projection can evict old entries; a loss-
  intolerant approval/capability request cannot use that projection as authority;
- `aelys db-smoke` writes the database directly instead of using an application
  command owner;
- frontend code can append audit-shaped records, so future Chronicle ingestion
  must distinguish untrusted observations from authoritative domain facts;
- Tauri review/merge-intent paths can best-effort commit a source worktree before
  binding/reviewing its OID, while the MCP merge-intent path binds existing tips;
  the same apparent operation therefore has different hidden effects by face;
- MCP catalog JSON Schemas are maintained inside the adapter and may drift from
  IPC/REST/domain types despite current catalog/schema consistency tests.

A7.0 must re-inventory these paths against current source. A moved or already-fixed
path is recorded as such; no finding is silently assumed closed.

## 2. Non-Negotiable Invariants

1. A transport authenticates and maps a caller; it never authorizes an effect.
2. Every face calls one Control Kernel/application command path. No face owns
   business logic, state transitions, policy, settlement, or evidence truth.
3. Domain owners remain the only state writers. The Control Kernel orchestrates
   them through typed ports and never becomes a duplicate database or scheduler.
4. `TerminalInputAuthority`, A0 evidence provenance, governance, ownership,
   Proofbook runner/ledger, review, and exact-OID merge behavior are extended by
   lossless adapters, not replaced.
5. Identity is resolved from trusted process/session/token/device/run context.
   Caller-supplied actor, reviewer, principal, or tenant strings are claims to
   validate, never identity evidence.
6. Bearer possession, loopback origin, local process, MCP connection, tool name,
   or UI gesture is insufficient capability.
7. The same intent through enabled faces yields the same allow/deny class, domain
   result, authoritative events, evidence obligations, and one-use behavior.
8. Unknown or possibly completed effects are never retried blindly.
9. Secrets are references at rest and redacted before events, logs, errors, MCP
   content, artifacts, or remote projections.
10. MCP, ACP, SDK, A2A, extensions, and UI are replaceable adapters. None enters
    the canonical Mission ontology.
11. A read, review, or intent-request command never performs a hidden preparatory
    commit. Candidate freezing is an explicit capability-bound domain effect with
    its own receipt and OID.

## 3. Canonical Command Registry

One Rust-authoritative registry is generated into JSON Schema and adapter metadata:

```ts
interface ControlCommandDescriptor {
  action: string;
  contractVersion: string;
  inputSchemaRef: string;
  outputSchemaRef: string;
  unknownFieldPolicy: "reject" | "declared_additive_only";
  effectClass: "read" | "projection_write" | "reversible_effect" | "irreversible_effect";
  requiredCapability: CapabilityTemplate;
  approvalPolicyRef?: string;
  idempotency: "required" | "derived_read" | "not_applicable";
  ordering: "none" | "mission" | "work_unit" | "resource";
  cancellation: "safe_before_effect" | "cooperative" | "reconcile_after_effect";
  retryPolicy: "never" | "same_key_recorded_result" | "read_only";
  budgetDimensions: BudgetUnit[];
  evidenceObligations: EvidenceObligation[];
  supportedFaces: AdapterFace[];
  deprecation?: DeprecationContract;
}
```

The registry must generate or validate:

- MCP `tools/list` names, descriptions, input schemas, and Aelyris annotations;
- HTTP route/body and WebSocket message schemas where those aliases exist;
- Tauri/CLI binding metadata or explicit exceptions;
- TypeScript client types and contract fixtures;
- governance capability names and evidence obligations.

The generator cannot generate domain implementations. A descriptor without a
registered application service fails startup/test and is not advertised.

## 4. Command And Result Envelopes

```ts
interface ControlCommandEnvelope<T> {
  schema: "aelyris.control_command/v1";
  commandId: string;              // UUIDv7
  traceId: string;
  causationEventId?: string;
  parentCommandId?: string;
  action: string;
  contractVersion: string;
  adapterFace: AdapterFace;
  authenticatedPrincipal: PrincipalRef;
  capabilityLeaseId?: string;
  missionId?: string;
  missionRevision?: number;
  workUnitId?: string;
  runtimeDomainId?: string;
  paneId?: string;
  proofbookRunId?: string;
  expectedGeneration?: number;
  baseOid?: string;
  headOid?: string;
  idempotencyKey: string;
  argsDigest: string;
  deadlineMonotonic: MonotonicDeadline;
  requestedAt: string;
  input: T;
}

interface ControlCommandResult<T> {
  schema: "aelyris.control_result/v1";
  commandId: string;
  traceId: string;
  action: string;
  contractVersion: string;
  status:
    | "succeeded"
    | "accepted"
    | "held"
    | "blocked"
    | "cancelled"
    | "failed"
    | "uncertain";
  output?: T;
  error?: ControlError;
  authoritativeEventRange: EventRange;
  evidenceRefs: EvidenceRefV2[];
  retryDisposition: "do_not_retry" | "same_idempotency_key" | "read_may_retry";
  completedAt: string;
}
```

Inputs are canonicalized and redacted before digesting. Secret values are replaced
by broker references before envelope persistence. Adapters cannot overwrite
authenticated principal, adapter face, trace, or capability fields supplied by the
trusted connection context.

## 5. Command Lifecycle And Atomicity

```text
received
  -> schema_validated
  -> principal_resolved
  -> policy_authorized
  -> capability_reserved
  -> intent_persisted
  -> effect_started
  -> committed | held | blocked | failed | uncertain
```

Rules:

1. unsupported major version, unknown effectful input field, stale Mission
   revision/OID/generation, invalid deadline, or args-digest mismatch fails before
   reservation;
2. authorization resolves the current principal and canonical resource, then
   validates the exact lease/action/args/OID/lane/budget binding;
3. idempotency reserves `(principal, action, resource, key, argsDigest)` durably;
   same tuple returns the recorded result; same key with different input fails;
4. mutation intent and reservation persist before effect;
5. domain owner returns an authoritative receipt; the Control Kernel commits the
   lease, result, WorkEvent, and evidence link atomically where one store owns them,
   or through a documented reconciliation protocol where stores differ;
6. loss after possible effect produces `uncertain`, revokes further use, and creates
   an exact reconciliation item. It never reports ordinary failure or retries;
7. cancellation before effect is `cancelled`; after possible effect it is
   `uncertain` until the owner proves the outcome;
8. irreversible effects require explicit policy/approval and a recorded
   compensation or operator-handoff contract before reservation.

## 6. Identity, Capability, And Review Authority

Trusted principal bindings include local Tauri window/process identity, authenticated
API session, WebSocket ticket plus device/session binding, MCP connection/session,
Proofbook run principal, scheduler principal, and later remote/extension identity.

- a bearer authenticates a session but does not grant terminal input, approval,
  review, merge, secret, or filesystem authority;
- UI local-human authority is minted by a trusted backend window/session binding,
  not a frontend `actor` field;
- Proofbook child commands inherit a narrowed run principal, Mission/work unit,
  causation, budget, and capability subset;
- reviewer identity is resolved from the accepted review session and lineage
  policy; caller-supplied `reviewerId` is metadata only and must match;
- pane input additionally requires current pane/runtime generation and baton;
- approval additionally requires the current prompt/decision fingerprint and
  one-use approval lease;
- merge additionally requires accepted independent review, immutable intent, and
  exact current OIDs.

The cross-face review/merge sequence is explicit:

```text
candidate.freeze | worktree.snapshot_commit
  -> review.run(frozenOid)
  -> merge_intent.request(frozenOid, reviewedEvidence)
  -> merge.execute_exact_oid
```

`review.run` and `merge_intent.request` are mutation-free over the frozen OID.
Failure to freeze is an exact blocker; no face may best-effort commit and continue.

## 7. Adapter Contract

| Face | Adapter responsibility | Forbidden ownership |
| --- | --- | --- |
| Tauri IPC | bind trusted local session, map typed invoke to envelope, render result | human identity from payload; domain writes in command module |
| MCP JSON-RPC/HTTP | map protocol request/session, advertise generated registry, return MCP-compliant tool result | policy from tool description; custom business dispatcher; completion from tool success |
| REST | authenticate session, map route alias, preserve idempotency/deadline/result | route-local authorization or actor defaults |
| WebSocket | bind ticket/principal/capability/pane generation, enforce baton and bounded flow | shared read-write default; unbounded reply; connection as authority |
| CLI | bind local principal/process and call Control Kernel | direct DB/domain mutation |
| visible PTY | deliver through `TerminalInputAuthority` and semantic command owner | raw byte write bypass or approval by Enter inference |
| Proofbook | invoke Control Kernel internally with narrowed run context | recursive transport call; caller-supplied actor; second settlement owner |
| review/merge | resolve reviewer lineage and exact immutable intent | caller-selected reviewer authority or repointed merge fields |

An adapter may be unsupported. Unsupported is a typed capability result and cannot
fall back to a weaker face or text inference.

`effectClass` and `humanApprovalPolicy` are independent. A policy that does not
require a human click still requires authenticated principal, capability, evidence,
and idempotency. The word `FREE` is not a security state.

## 8. MCP-Specific Contract

1. The current implemented HTTP/JSON-RPC surface is the only MCP runtime that may
   be claimed until another transport gate passes.
2. `tools/list` is derived from descriptors and includes contract version, effect
   class, idempotency requirement, required capability template, deprecation, and
   evidence obligation as Aelyris annotations.
3. `tools/call` resolves the authenticated MCP principal, constructs an envelope,
   and calls the Control Kernel. It contains no action switch with business logic.
4. MCP success means protocol delivery of a typed result; `isError=false` never
   means the Mission work unit, gate, review, merge, or release is complete.
5. MCP resources/prompts are read projections only until separately specified.
6. Streamable HTTP, stdio, ACP, SDK, and A2A support require transport/session,
   cancellation, progress, capability negotiation, and compatibility proof.
7. A2A Agent Card/Task/Artifact maps at the federation edge. A2A terminal Task
   status is input evidence, never Aelyris acceptance.

## 9. Versioning And Compatibility

- schema identifiers carry a major version; every command carries an independent
  contract version and descriptor digest;
- unsupported major input fails closed with supported versions and no side effect;
- effectful objects reject unknown fields by default;
- additive outputs are allowed only under a declared compatibility policy and
  consumers preserve unknown enum/variant safety;
- a deprecated action has replacement, first/last supported versions, warning
  event, telemetry, and removal gate;
- persisted commands/results/events remain decodable or migrate through a tested,
  idempotent, restart-safe migration with rollback/forward recovery;
- adapters negotiate from the same registry digest. A mismatched catalog/schema/
  descriptor digest blocks effectful calls.

## 10. Backpressure, Streaming, And Cancellation

- every queue is bounded and declares byte/item caps, overflow behavior, and owner;
- authoritative approval, blocker, capability, gate, packet, and merge facts are
  durable before notification and can be recovered by cursor/snapshot;
- observational loss emits an explicit gap/degraded marker and blocks no-loss or
  complete-replay claims;
- slow consumers receive bounded pages/snapshots and resume cursors rather than
  unbounded buffering;
- cancellation is correlated to command id and principal; it cannot cancel a
  different generation, Mission revision, or principal's command;
- progress events are advisory projections and never completion evidence;
- WebSocket/MCP disconnect does not revoke durable truth, but may revoke the
  connection-bound lease/baton according to policy.

## 11. Error Contract

`ControlError` has stable `code`, safe `message`, typed `details`, `retryDisposition`,
and `evidenceRef`; it never embeds secrets or raw untrusted instructions. Required
codes include:

- `invalid_schema`, `unsupported_contract_version`, `unknown_action`;
- `unauthenticated`, `capability_required`, `capability_scope_mismatch`;
- `approval_required`, `stale_approval`, `pane_baton_required`;
- `stale_mission_revision`, `stale_generation`, `stale_oid`;
- `idempotency_conflict`, `deadline_exceeded`, `rate_limited`, `backpressure`;
- `cancelled_before_effect`, `uncertain_effect`, `needs_reconcile`;
- `owner_unavailable`, `unsupported_face`, `descriptor_digest_mismatch`.

Transport status is mapped separately. HTTP status, JSON-RPC error, or MCP tool
error cannot erase the domain result/status.

## 12. Chronicle And Evidence

Every accepted or denied command emits or references a redacted authoritative
record containing command/trace/causation ids, descriptor digest, adapter face,
resolved principal, lease/reservation, Mission/work unit/revision, resource and
args digest, OID/generation, policy decision, owner receipt, result, and evidence.

Frontend, agent, extension, and remote observations are tagged untrusted until an
owning backend validates and promotes a typed fact. Raw adapter logs are diagnostic
evidence only. The Chronicle does not ingest an audit-shaped payload as authority
merely because it came through IPC or MCP.

## 13. Migration And Rollback

A7.0 produces a face/action/owner inventory before code changes. Migration order:

1. freeze descriptors, envelopes, error codes, and parity fixtures;
2. wrap existing domain owners and `TerminalInputAuthority` without behavior loss;
3. route one read-only fixture through the Control Kernel;
4. route one reversible effect with idempotency/cancellation/reconciliation proof;
5. migrate MCP, REST, WS, IPC, Proofbook, CLI, review, and merge faces one action
   family at a time; disable the old path only after parity and negative gates;
6. generate catalogs/types/schemas and make hand-maintained drift fail CI;
7. remove direct state-owner access and adapter-local policy only after zero caller
   inventory and restart/rollback proof.

Rollback keeps the last compatible descriptor and adapter mapping, disables the
new action version, revokes its leases, and preserves durable intents/results for
reconciliation. It may not restore a known authority bypass. Database/event
migrations require forward recovery when rollback cannot safely decode new facts.

## 14. Verification Matrix

| Gate | Required proof | Required negative cases |
| --- | --- | --- |
| `verify:control-command-registry` | descriptor/schema/type/catalog generation and owner binding | duplicate action, orphan implementation, mismatched digest, unknown major/field |
| `verify:control-face-equivalence` | same allow/deny/result/event/evidence across enabled faces | hardcoded actor, route-local policy, adapter fallback, different one-use result |
| `verify:control-idempotency` | durable same-key result and ordered resource execution | key/input conflict, concurrent reserve, replay, crash before/after effect |
| `verify:control-cancellation` | pre-effect cancel and post-effect reconciliation | cross-principal cancel, stale generation, blind retry, lost receipt |
| `verify:control-backpressure` | bounded queue, cursor/snapshot recovery, explicit gap | slow consumer, overflow, disconnect/restart, unbounded channel |
| `verify:mcp-control-adapter` | generated catalog, principal propagation, MCP result mapping | business-logic switch, caller actor/reviewer, tool-success completion |
| `verify:proofbook-control-adapter` | narrowed run principal/causation/budget and direct kernel call | transport recursion, privilege widening, recursive Proofbook, lost idempotency |
| `verify:control-secret-redaction` | broker refs and redacted errors/events/artifacts | token/path secret in input, error, MCP content, Chronicle, evidence |
| `verify:control-compatibility` | version negotiation, deprecation, restart-safe migration/rollback | old/new mixed session, stale catalog, unknown enum, downgrade data loss |
| `verify:control-authority-adversarial` | terminal/review/merge/gate/DB/Chronicle owner integrity | bearer-only input, stale approval, fake reviewer, exact-OID re-point, CLI DB write, UI audit promotion |

A7 cannot claim the Control API/MCP trust boundary until all enabled effectful
faces pass this matrix and blocking CI. A9 and current external/operator release
proof remain separately required.

## 15. Stop Conditions

Stop and redesign if implementation requires a second command registry, transport-
specific business owner, caller-selected identity, bearer-only mutation authority,
unbounded authoritative queue, unversioned effect schema, silent fallback, raw
secret persistence, blind retry, frontend completion inference, or a weaker path
kept alive without an explicit compatibility removal gate.
