# Aelyris Contract Index

Status: active machine contract index.
Purpose: help agents find the rigid contracts before editing. This index does
not replace the owning specs or source files.

## Contract Rule

Contracts are rigid; implementations are disposable. A contract change must
update the contract, implementation, verifier, and claim boundary together in
one slice.

If a task only changes implementation details, preserve the contract unless the
user explicitly selected a contract-changing work unit.

## Contract Map

| Contract | Owner | Source / adapter | Verifier |
| --- | --- | --- | --- |
| Current claim boundary | `docs/requirements.md`, `docs/PUBLICATION_READINESS.md` | public docs and `.codex-auto/quality/*` | `pnpm verify:requirements-spec-design-traceability`, `pnpm verify:current-readiness-source` |
| Visible agent runtime | `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` | `src-tauri/src/agent/*`, `src-tauri/src/ipc/interactive_commands.rs`, `src/features/terminal/*` | `pnpm verify:visible-agent-pane-binding`, terminal gates |
| MCP tool surface | `docs/specs/MCP_TOOL_SURFACE_SPEC.md` | `src-tauri/src/api/mcp.rs` | MCP drift/schema/governance tests and focused verifiers |
| Proofbook automation | `docs/specs/PROOFBOOK_AUTOMATION_SPEC.md` | `src-tauri/src/proofbook/*`, `src-tauri/src/ipc/proofbook_commands.rs` | `pnpm verify:proofbook:spec`, `pnpm verify:proofbook:runner`, `pnpm verify:proofbook:agent-session` |
| Differentiation polish | `docs/specs/AELYRIS_DIFFERENTIATION_POLISH_SPEC.md` | future D0-D8 implementation slices | `pnpm verify:differentiation-polish-spec` |
| Remote Continuity | `docs/specs/AELYRIS_REMOTE_CONTINUITY_SPEC.md` | future remote snapshot/events/SSH attach adapters | `pnpm verify:differentiation-polish-spec`, future `verify:remote-continuity:*` |
| Terminal core / renderer | `docs/specs/TERMINAL_CORE_DESIGN.md` | `src/features/terminal/*`, `src-tauri/pty-server/*` | renderer/terminal verifier suite |
| Cockpit UX projection | `docs/specs/COCKPIT_UX_SPEC.md` | `src/features/*`, `src/shared/*` | focused UI/verifier scripts |
| Type bridge | `docs/specs/TYPE_BRIDGE_SPEC.md` | Rust/TS contract tests | type bridge verifier/tests |
| Planner/orchestrator | `docs/specs/PLANNER_SPEC.md` | orchestrator/task/agent modules | orchestration readiness gates |
| Agent message bus | `docs/specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md` | future message bus implementation | future bus verifier |
| Release and external gates | `docs/PUBLICATION_READINESS.md` | release scripts and operator proof | release/goal verifier suite |

## Contract Change Checklist

Before changing a contract, answer these in the task report:

- Which contract owns this behavior?
- Which source module owns the runtime state?
- Which adapters need updates: IPC, MCP, CLI, UI, docs?
- Which verifier proves the new contract?
- What backwards compatibility or migration is required?
- What public claim changes, if any?

## Placement Hints

- New domain behavior belongs behind a focused Rust or TS owner module.
- IPC/MCP/CLI/UI should delegate to owners.
- Source-generated schemas and drift tests are preferred over hand-maintained
  duplicate schemas.
- Verifier artifacts belong under `.codex-auto/quality/` and are not committed.

## Hard Blocks

Do not proceed if the design requires:

- a second MCP dispatcher,
- a second Proofbook runner,
- frontend-owned execution state,
- remote write access without scoped principal and lease,
- visible agent launch with `-p` / `--print`,
- release-ready copy while current gates are blocked.