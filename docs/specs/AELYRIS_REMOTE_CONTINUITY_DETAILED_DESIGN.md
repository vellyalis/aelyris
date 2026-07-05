# Aelyris Remote Continuity Detailed Design

Status: detailed design. Not implemented, not release-ready.
Parent design: `AELYRIS_REMOTE_CONTINUITY_DESIGN.md`.
Last reviewed: 2026-07-05 JST.

This document defines concrete contracts and work units for Remote Continuity
and SSH attach.

## 1. Data Contracts

### 1.1 RemoteWorkspaceSnapshot

```ts
interface RemoteWorkspaceSnapshot {
  schema: "aelyris.remote.workspace_snapshot.v1";
  workspaceId: string;
  projectPath: string;
  generatedAt: string;
  cursor: string;
  tabs: RemoteTabProjection[];
  panes: RemotePaneProjection[];
  agents: RemoteAgentProjection[];
  approvals: RemoteApprovalProjection[];
  proofbooks: RemoteProofbookProjection[];
  ownership: RemoteOwnershipProjection;
  mergeReadiness: RemoteMergeReadinessProjection[];
  degradation: RemoteDegradationNotice[];
}
```

### 1.2 RemotePaneProjection

```ts
interface RemotePaneProjection {
  paneId: string;
  terminalId?: string;
  shortId?: string;
  tabId: string;
  title: string;
  role?: string;
  backend: "sidecar" | "native" | "unknown";
  durability: "tmux-durable" | "degraded" | "unknown";
  lifecycle: "running" | "waiting_approval" | "blocked" | "done" | "error" | "detached";
  agentId?: string;
  worktreeBranch?: string;
  lastActivityAt?: string;
  summary: string;
  evidenceRefs: EvidenceRef[];
}
```

### 1.3 RemoteApprovalProjection

```ts
interface RemoteApprovalProjection {
  approvalId: string;
  paneId: string;
  terminalId: string;
  promptSummary: string;
  expectedPromptKey: string;
  risk: "low" | "medium" | "high" | "critical";
  status: "waiting" | "stale" | "resolved";
  createdAt: string;
  evidenceRefs: EvidenceRef[];
}
```

### 1.4 RemoteAttachLease

```ts
interface RemoteAttachLease {
  leaseId: string;
  principalId: string;
  transport: "web" | "ssh" | "local-cli" | "mcp";
  scope: "observe" | "pane.read" | "approval.resolve" | "pane.input" | "fleet.steer";
  targetId: string;
  issuedAt: string;
  expiresAt: string;
  mutable: boolean;
  auditEventId: string;
}
```

## 2. API Shape

Initial MCP/HTTP verbs should be thin adapters over existing state owners.

| Verb | Safety | Purpose |
| --- | --- | --- |
| `aelyris.remote.snapshot` | FREE or scoped `remote.read` | Return `RemoteWorkspaceSnapshot`. |
| `aelyris.remote.events` | FREE or scoped `remote.read` | Return coalesced events since cursor. |
| `aelyris.remote.attach_begin` | GATED | Issue a read or mutable attach lease. |
| `aelyris.remote.attach_end` | FREE | Release a lease. |
| `aelyris.remote.approval.resolve` | GATED | Delegate to stale-safe approval resolve. |
| `aelyris.remote.input` | GATED | Send pane input through command-risk policy and lease check. |

HTTP endpoints can mirror these verbs, but MCP/catalog schema remains the typed
contract. Do not create a second schema source.

## 3. SSH Attach Design

### 3.1 Client Entrypoints

```text
aelys attach
aelys attach --pane %3 --read-only
aelys remote snapshot --json
aelys remote approvals
aelys remote approve <approval-id> --expected-prompt-key <key>
```

When invoked through SSH, the command resolves daemon credentials from the
operator-approved environment or a scoped token file. Missing credentials fail
closed.

### 3.2 Forced Command Mode

For a hardened setup, an SSH key can be configured with a forced command such as:

```text
aelys attach --ssh-principal <principal-id>
```

The forced command maps the SSH key to an Aelyris principal and allowed scopes.
It must not grant default write/control access.

### 3.3 TUI Read Model

The first SSH TUI is read-only:

- workspace header,
- tabs and panes with short ids,
- agent statuses,
- waiting approvals,
- Proofbook timeline summary,
- merge readiness,
- selected pane scrollback tail only after `pane.read` lease.

Full interactive pane input is a later RC6 feature.

## 4. Security Model

### 4.1 Principal And Scopes

Required scopes:

- `remote.read`,
- `pane.read`,
- `approval.resolve`,
- `pane.input`,
- `fleet.steer`,
- `proofbook.read`,
- `merge.read`.

Write/control scopes are never implied by read scopes.

### 4.2 Secret Safety

Remote payloads must exclude:

- token files,
- SSH private keys,
- signing material,
- raw secret-bearing transcripts,
- `.env*` values,
- unredacted command output marked sensitive.

The verifier must scan remote snapshot fixtures for known secret patterns.

### 4.3 Audit Events

Every remote mutation records:

- principal id,
- transport,
- scope,
- lease id if any,
- target pane/session/run/approval id,
- expectedPromptKey or input hash,
- result and error code.

## 5. Work Units

### RC0 - Docs And Verifier

Files:

- `AELYRIS_REMOTE_CONTINUITY_SPEC.md`
- `AELYRIS_REMOTE_CONTINUITY_DESIGN.md`
- `AELYRIS_REMOTE_CONTINUITY_DETAILED_DESIGN.md`
- `AELYRIS_DIFFERENTIATION_POLISH_SPEC.md`
- `AELYRIS_DIFFERENTIATION_DETAILED_DESIGN.md`
- `docs/specs/README.md`
- `scripts/verify-differentiation-polish-spec.mjs`

Acceptance:

- Remote Continuity, SSH attach, read-only remote fleet monitor, tab/pane state
  sync, fingerprint-checked approval, attach lease, forced command, and scoped
  principal are all indexed and verifier-checked.
- No document claims Remote Continuity as shipped.

### RC1 - Remote Snapshot Projection

Owner modules:

- backend projection module near the existing API/state layer,
- no frontend state ownership,
- no direct PTY reads except through existing terminal owners.

Acceptance:

- Local cockpit snapshot and remote snapshot agree on tabs, panes, agents,
  approvals, Proofbooks, ownership summary, and merge readiness.
- Snapshot includes cursor and degradation notices.

### RC2 - Principal And Scope Binding

Owner modules:

- governance/principal resolver,
- daemon token handling,
- SSH principal mapping config.

Acceptance:

- Unknown principal fails closed.
- Read scope cannot mutate.
- SSH key mapping can grant observe-only access.

### RC3 - Read-Only Remote Fleet Monitor

Owner modules:

- daemon/app web surface,
- remote snapshot/events client,
- no mutation actions except disabled placeholders.

Acceptance:

- Works over loopback and documented Tailscale/private network setup.
- Shows pane/fleet/proof/approval state.
- Does not expose raw secret-bearing payloads.

### RC4 - Remote Approval Resolve

Owner modules:

- existing stale-safe approval resolve function,
- MCP/HTTP remote adapter.

Acceptance:

- Matching expectedPromptKey resolves.
- Changed prompt returns stale approval error.
- Audit records principal and transport.

### RC5 - SSH Read-Only Attach

Owner modules:

- `aelys` CLI,
- SSH forced-command adapter docs/config,
- remote snapshot/events API.

Acceptance:

- `ssh <host> aelys attach` renders workspace/pane/fleet state.
- `--pane %N --read-only` streams bounded pane output after `pane.read` lease.
- No pane input is accepted in RC5.

### RC6 - Governed Remote Input

Owner modules:

- command-risk policy,
- pane input path,
- attach lease store,
- audit/event bus.

Acceptance:

- Mutable lease required.
- Input passes command-risk classification.
- Waiting approval panes reject raw input unless matching approval path is used.
- Broadcast requires explicit high-risk confirmation.

### RC7 - Remote Continuity Claim Gate

Acceptance:

- Live remote monitor proof.
- SSH read-only attach proof.
- Restart/reconnect proof.
- Secret payload scan proof.
- Lease expiry proof.
- Remote approval stale rejection proof.
- Current release/readiness artifacts still block release-ready overclaim when
  `releaseCandidateReady=false`.

## 6. Verifier Plan

Future focused verifiers:

- `pnpm verify:remote-continuity:spec`
- `pnpm verify:remote-continuity:snapshot`
- `pnpm verify:remote-continuity:approval`
- `pnpm verify:remote-continuity:ssh-readonly`
- `pnpm verify:remote-continuity:lease`
- `pnpm verify:remote-continuity:secret-scan`

RC0 is currently covered by `pnpm verify:differentiation-polish-spec`.

## 7. Stop Conditions

Stop implementation if:

- SSH attach would read/write PTY state without daemon lease,
- remote snapshot requires duplicating pane tree state,
- approval resolve cannot reuse stale-safe backend logic,
- remote client needs omnipotent token access,
- private network setup cannot be documented without exposing the daemon,
- secret redaction is unproven,
- implementation would grow `src/App.tsx` or `src-tauri/src/api/mcp.rs` without
  an extraction plan.