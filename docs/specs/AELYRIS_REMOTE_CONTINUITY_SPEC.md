# Aelyris Remote Continuity Spec

Status: design/spec gate. Not implemented, not release-ready.
Parent specs: `AELYRIS_DIFFERENTIATION_POLISH_SPEC.md` and
`VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`.
Last reviewed: 2026-07-05 JST.

This spec adds Remote Continuity and SSH attach to the Aelyris differentiation
plan. The goal is not to become a generic SSH terminal. The goal is to let an
operator leave the desk and still see, approve, and eventually attach to the
same Aelyris fleet state: tabs, panes, agents, Proofbooks, approvals, ownership,
merge readiness, and evidence.

## 0. Claim Boundary

Remote Continuity, SSH attach, and remote tab/pane state sync are not
implemented and not shipped. Aelyris must not claim remote operation, remote SSH
attach, or multi-client remote control until the matching verifiers are green.

Current safe claim remains narrower: local Rust/Tauri terminal, mux, sidecar,
visible-agent, MCP, worktree, ownership, review, merge, and scoped Proofbook
runtime substrate exist, while product-level durability, remote continuity, and
release readiness remain gated.

## 1. Product Position

Traditional tmux is often used through SSH. Aelyris should learn from that, but
not copy it blindly.

Aelyris remote value is stronger than SSH terminal access alone:

- Remote tab/pane state sync for the whole workspace.
- Remote fleet status for visible AI agents.
- Remote Proofbook timeline and proof inspector.
- Remote approval/deny through fingerprint-checked gates.
- Remote merge readiness visibility.
- SSH attach for power users who want a terminal-native path.

SSH is a transport and attach mode; SSH must not own workspace state. The
Aelyris sidecar/daemon and backend repositories own the state.

## 2. Functional Requirements

### RC-FR-1 Remote State Sync

A remote client must read the same state as the local cockpit.

Required state:

- workspace id and active project path,
- windows, tabs, pane tree, pane ids, terminal ids, short ids when available,
- pane titles, roles, backend, durability tier, lifecycle state,
- visible agent status, model, role, task, worktree, current activity,
- approval inbox with risk, prompt fingerprint, and stale state,
- Proofbook run timeline, waiting gates, artifact refs, residual blockers,
- ownership and symbol/function conflict summary,
- merge readiness summary,
- event cursor for incremental sync.

### RC-FR-2 Read-Only Remote Fleet Monitor

The first remote product slice is a read-only remote fleet monitor.

Requirements:

- Works over a user-controlled private network such as Tailscale or localhost
  tunnel.
- Shows fleet, tabs, panes, approvals, Proofbooks, blockers, and merge
  readiness.
- Does not stream secrets or full raw scrollback by default.
- Uses bounded summaries and evidence refs.
- Cannot mutate workspace state in read-only mode.

### RC-FR-3 Remote Approval

Remote approval is allowed only through the existing approval safety model.
This is the fingerprint-checked remote approval requirement.

Requirements:

- Approval/deny uses expectedPromptKey or equivalent fingerprint.
- The backend rechecks that the target pane is still waiting on the same prompt.
- The action is GATED, audited, actor-bound, and stale-safe.
- Remote approval does not imply remote shell input permission.

### RC-FR-4 SSH Attach

SSH attach is a power-user mode over the same daemon state.

Requirements:

- Supports a forced-command or `aelys attach` style entrypoint.
- Authenticates the operator through SSH key plus Aelyris principal mapping, or
  through an Aelyris token scoped to the SSH session.
- Can show workspace/tab/pane/fleet state in a TUI.
- Can attach read-only to a pane stream after a lease is issued.
- Write/control attach requires a stronger lease, risk gate, and audit event.
- SSH attach must never bypass command-risk policy, approval checks, ownership
  conflict checks, or merge gates.

### RC-FR-5 Multi-Client Leases

Remote clients need explicit leases so local and remote control do not fight.

Lease classes:

- `observe`: read snapshots and bounded event streams.
- `pane.read`: stream a pane read-only.
- `approval.resolve`: resolve a waiting approval by fingerprint.
- `pane.input`: send input to a pane after risk classification.
- `fleet.steer`: steer an agent through governed control verbs.

Every mutable lease has expiry, actor, scope, and audit trail.

### RC-FR-6 Security And Exposure

Remote Continuity cannot expose a local development machine casually.

Requirements:

- Default bind remains loopback/local unless explicitly enabled.
- Internet exposure without a private network, TLS, or equivalent secure tunnel
  is unsupported.
- Token files, SSH keys, raw secrets, signing material, and secret-bearing
  transcripts are never sent to remote clients.
- Remote clients receive scopes, not omnipotent access.
- Rate limits and bounded event buffers apply.
- Every mutation records principal, transport, target, expected fingerprint or
  lease id, and result.

### RC-FR-7 Proof And Claim Gate

Remote Continuity becomes claimable only after proof.

Required proof classes:

- snapshot parity with local cockpit state,
- event replay from cursor,
- stale approval rejection,
- SSH read-only attach proof,
- attach lease expiry proof,
- remote input governance proof,
- private-network or loopback binding proof,
- no-secret remote payload scan,
- restart/reconnect proof.

## 3. Non-Goals

- Do not build cloud sync in this workstream.
- Do not make SSH the source of truth.
- Do not bypass the local daemon/sidecar state model.
- Do not support unauthenticated public internet access.
- Do not allow remote merge approval outside commit-bound merge gates.
- Do not stream all raw terminal logs to mobile clients by default.
- Do not let remote UI mutate Proofbook state without backend runner authority.

## 4. Product Phases

| Phase | Name | Result |
| --- | --- | --- |
| RC0 | Spec/design/verifier | Remote Continuity is documented and indexed. |
| RC1 | Remote snapshot/read model | Remote clients can read tab/pane/fleet/proof state. |
| RC2 | Principal/scopes | Remote tokens and SSH keys map to scoped principals. |
| RC3 | Read-only remote fleet monitor | Phone/web monitor works over private network. |
| RC4 | Fingerprint-checked remote approvals | Remote approve/deny is stale-safe and audited. |
| RC5 | SSH/TUI read-only attach | `aelys attach` over SSH can observe workspace and panes. |
| RC6 | Governed remote input | Remote pane input/steering uses leases, risk gates, audit. |
| RC7 | Remote continuity claim gate | Remote claims are promoted only after live proof. |

## 5. Stop Conditions

Stop before implementation if a phase would:

- expose the daemon beyond loopback without explicit secure-network setup,
- grant remote write/control access without scoped principal and lease,
- resolve approval without a prompt fingerprint recheck,
- send pane input without command-risk policy,
- duplicate tab/pane state outside the existing mux/pane owners,
- make SSH own workspace state,
- persist or transmit secrets, token files, signing material, or raw private
  transcripts,
- claim remote continuity from static source scans only.
