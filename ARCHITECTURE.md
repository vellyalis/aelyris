# Aelyris Architecture

Status: active architecture knowledge. This file is for placement decisions.

## Architecture Summary

Aelyris is a Tauri v2 application with a Rust backend and React frontend. The
backend owns runtime truth. The frontend projects that truth and requests
governed actions.

Core rule:

> Domain/runtime state has one owner. IPC, MCP, CLI, SSH, and UI are adapters.

## Responsibility Map

| Area | Responsibility | Canonical location |
| --- | --- | --- |
| Product goal / claim policy | current safe claims, release boundaries | `GOAL.md`, `docs/requirements.md`, `docs/PUBLICATION_READINESS.md` |
| Verifiable Agent Work OS target | Mission, Now/Next/Unlocks, trust/proof/learning composition | `docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_*` |
| Decision knowledge | placement and tradeoff rules | `AI_GUIDE.md`, `DECISION_FRAMEWORK.md` |
| Contracts | rigid API/schema/runtime boundaries | `contracts/README.md`, owning specs |
| Task packets | current volatile work | `tasks/README.md`, root work-order docs |
| Terminal / PTY | native sessions, ConPTY, sidecar, scrollback | `src-tauri/src/pty/*`, `src-tauri/pty-server/*` |
| Pane tree / terminal UI | pane layout projection and rendering | `src/features/terminal/*` |
| Agent runtime | headless and visible agent sessions | `src-tauri/src/agent/*`, `src/features/agent-*` |
| Proofbooks | automation definitions, runner, ledger, settlement | `src-tauri/src/proofbook/*`, `docs/specs/PROOFBOOK_AUTOMATION_SPEC.md` |
| MCP/control plane | typed tool catalog, schemas, governance adapter | `src-tauri/src/api/mcp.rs`, `docs/specs/MCP_TOOL_SURFACE_SPEC.md` |
| IPC | Tauri command adapters | `src-tauri/src/ipc/*` |
| Persistence | SQLite repositories and durable state | `src-tauri/src/persistence/*`, `src-tauri/src/db/*` |
| Ownership/conflicts | file/symbol ownership and impact | ownership, knowledge, task, and persistence modules |
| Review/merge | durable merge intent and approval binding | git/review/merge modules and specs |
| Remote Continuity | remote snapshots, events, leases, SSH attach adapters | `docs/specs/AELYRIS_REMOTE_CONTINUITY_*`, future focused modules |
| React feature UI | domain-specific UI projection | `src/features/<domain>/*` |
| Shared frontend code | generic hooks, types, UI primitives, helpers | `src/shared/*` |
| Styling | design tokens and global styling | `src/styles/*`, CSS modules |
| Verifiers | machine proof and source-contract checks | `scripts/verify-*.mjs` |

## Verifiable Agent Work OS Composition

The target product category is **Verifiable Agent Work OS**. `Mission` is the
durable top-level work contract; it composes existing owners rather than replacing
them:

```text
Mission / WorkGraph
  -> Runtime Fabric (mux / PTY / agent session)
  -> Qralis Coordination (intent / message / directive / role lease)
  -> Control Kernel (canonical command registry / all-face application ports)
  -> Capability Kernel (principal / scoped lease / approval)
  -> Chronicle (typed causal journal and projections)
  -> Proof And Settlement (Proofbook / review / merge / work-unit packets / MissionCompletionPacket)
  -> Governed Learning (evidence candidates / evaluation / version / rollback)
```

`MissionProgressProjection` is the backend-owned source for Now, Next, Unlocks,
attention, blockers, proof freshness, and repository truth. React, MCP, CLI, SSH,
and remote surfaces are projections/adapters. Full target capability is not a
current implementation or release-readiness claim.

The active R0-A9 plan implements only a finite A7 Core Mission Loop before A8/A9.
Replay/time travel, Skill Foundry, Decision Lab, Counterfactual Arena, Project
Twin, writable Remote Continuity, extension marketplace, and A2A federation remain
separately gated Apex work.

Tauri IPC, MCP, REST, WebSocket, CLI, visible PTY, Proofbook, review, and merge are
adapters over the Control Kernel. They may authenticate/map a face but never own
principal authority, effect policy, domain state, completion, or evidence. Target
details and current bypass-removal gates are in
`docs/specs/AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md`.

## Dependency Direction

Preferred direction:

```text
source/runtime owner -> adapter -> UI/CLI/MCP/SSH projection
spec/contract -> implementation -> verifier -> claim text
```

Avoid:

```text
UI state -> backend truth
MCP tool -> private duplicate runtime
SSH attach -> direct PTY ownership
Proofbook UI -> executable mock flow
```

## Frontend Placement

- Put feature-specific UI in `src/features/<domain>/`.
- Put reusable primitives and cross-feature helpers in `src/shared/`.
- Keep `src/App.tsx` as composition glue. It must not grow for new feature
  logic.
- UI should render backend truth and call governed actions; it should not own a
  second execution state.

## Backend Placement

- Put business rules in domain modules, not IPC wrappers.
- IPC commands should validate adapter-level inputs and delegate.
- MCP tools should use the existing catalog/schema/governance path and delegate.
- Persistence belongs in repositories, not scattered file writes.
- Long-running runtime truth belongs in managed state or sidecar/daemon-owned
  services.

## Remote Architecture

Remote clients read daemon-owned projections.

- Web monitor: read-only first.
- SSH/TUI attach: power-user transport.
- Remote input: later, gated by scoped leases and command-risk policy.
- SSH must not own workspace state.

## Architecture Stop Conditions

Stop if a change requires:

- a second source of truth,
- a second MCP dispatcher,
- a second Proofbook runner,
- frontend-owned execution truth,
- remote write access without principal and lease,
- hidden visible-agent execution through `-p` / `--print`,
- release-ready claims without current verifier proof.
- a Mission status, Now/Next/Unlocks value, or completion judgment recomputed in
  an adapter instead of projected from backend owners,
- an unverified conversation, model confidence, or agent self-report promoted to
  verified memory or completion,
- an extension or remote client becoming a domain state, capability-grant, or
  merge authority.
