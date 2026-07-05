# Aelyris Remote Continuity Design

Status: architecture design. Not implemented, not release-ready.
Parent spec: `AELYRIS_REMOTE_CONTINUITY_SPEC.md`.
Last reviewed: 2026-07-05 JST.

This document defines the architecture for Remote Continuity and SSH attach. The
key decision is simple: the daemon owns state; remote clients attach to it.

## 1. Architecture Principle

Remote Continuity is not a second cockpit and not a second terminal backend.

Single owners:

- mux/tab/pane state: existing terminal/mux owners,
- PTY streams: sidecar/daemon or native PTY owner,
- agent status: existing agent runtime and event stream,
- approvals: existing decision/approval owner,
- ownership: existing file/symbol ownership repositories,
- Proofbook status: `src-tauri/src/proofbook` runner and ledger,
- merge readiness: durable merge intent/review owners,
- remote auth: governance/principal resolver.

Remote surfaces are projections and controlled attach clients.

## 2. Component Model

### 2.1 Remote State Projection

A backend projection builds a bounded snapshot for remote clients:

- `RemoteWorkspaceSnapshot`
- `RemoteTabProjection`
- `RemotePaneProjection`
- `RemoteAgentProjection`
- `RemoteApprovalProjection`
- `RemoteProofbookProjection`
- `RemoteOwnershipProjection`
- `RemoteMergeReadinessProjection`

The projection is read-only. It is assembled from existing state owners and
includes an event cursor for incremental sync.

### 2.2 Remote Event Stream

Remote clients subscribe from a cursor. The stream is bounded and coalesced.

Rules:

- pane raw bytes are not part of the default event stream,
- activity summaries and evidence refs are included,
- large output is referenced by artifact/log id,
- dropped/coalesced events are explicit in the cursor response,
- clients can request a fresh snapshot after a gap.

### 2.3 Read-Only Web Monitor

The read-only monitor is the first UX surface.

Surfaces:

- fleet summary,
- tab/pane tree overview,
- waiting approvals,
- Proofbook timelines,
- blockers,
- merge readiness,
- fleet briefing.

It should be served by the daemon or by the app through the same authenticated
state projection. It must work over loopback and private network setups such as
Tailscale before any broader exposure is considered.

### 2.4 SSH/TUI Attach

SSH attach should be designed as a client adapter, not as a state backend.

Preferred shape:

```text
ssh <host> aelys attach
ssh <host> aelys attach --pane %3 --read-only
ssh <host> aelys status --json
```

On Windows, this likely depends on operator-installed OpenSSH Server or an
operator-managed tunnel. Aelyris may provide `aelys attach` and forced-command
support, but it should not silently install or expose SSH.

The SSH-side command connects to the local daemon using scoped credentials and
renders a TUI or JSON status. It does not talk directly to PTYs without the
daemon lease layer.

### 2.5 Attach Leases

A remote client must obtain a lease before streaming or controlling a pane.

Lease properties:

- lease id,
- principal id,
- transport: `web`, `ssh`, `local-cli`, or `mcp`,
- scope,
- target pane/session/terminal id,
- issued-at and expires-at,
- read-only or mutable,
- audit event id.

Mutable leases must be short-lived and revocable.

## 3. Transport Choices

### Loopback HTTP/MCP

Used by local app, local CLI, and tests. This is the baseline.

### Private Network Web

Used for phone/browser monitoring. Tailscale or an equivalent private network is
the preferred first deployment model.

### SSH Forced Command

Used by power users. SSH authenticates the operator, then starts an Aelyris
client command that talks to the daemon. SSH does not replace the daemon auth,
governance, or audit model.

### No Public Internet Default

Public exposure is out of scope until a separate hardening phase defines TLS,
RBAC, threat model, rate limiting, and operator setup.

## 4. Dependency Order

Remote Continuity should land after or alongside these foundations:

1. D1 Center-Pane Agent Fleet, so remote state has real panes to inspect.
2. D2 Durable Visible Runtime, so attach/recover is meaningful.
3. A1 `aelyris.approval.resolve`, so remote approval uses the same stale-safe
   backend path.
4. C5 governance principal, so remote clients are not all `operator`.
5. D3 live activity + symbol/function ownership.
6. D4 bounded shared brain.
7. D7 governed merge-ready lane.

## 5. UX Modes

### Monitor Mode

Read-only. Shows state and proof. Safe for first remote release.

### Approval Mode

Allows approve/deny only for prompts that still match expectedPromptKey.

### SSH Observe Mode

Terminal-native read-only TUI for engineers. Useful for checking panes and logs
from another machine.

### SSH Control Mode

Mutable. Requires explicit lease, risk gate, audit, and preferably local
operator opt-in. This is later than observe mode.

## 6. Failure Behavior

- If the event cursor is stale, client refreshes snapshot.
- If a pane disappeared, remote attach fails closed with current lifecycle state.
- If lease expired, stream/input stops.
- If approval prompt changed, remote approval returns stale approval error.
- If private-network binding is unavailable, remote monitor stays local-only.
- If principal is unknown, all remote verbs fail closed.

## 7. Plan Integration

Remote Continuity is inserted into the differentiation plan as D2R, after D2
Durable Visible Runtime and before D3 Live Activity + Symbol Ownership becomes a
remote claim. Some RC phases can be developed earlier as read-only projections,
but SSH attach and remote input claims wait for D2 durability and principal
proof.