# Quorum Requirements Index

Status: active implementation index
Last updated: 2026-06-27 JST
Last reviewed: 2026-06-28 JST

This file is the stable requirements entrypoint referenced by `AGENTS.md`.
It does not replace the detailed specs. It points implementers to the current
authoritative requirement, specification, design, and proof sources.

## Current Requirements Authority

1. Product requirements:
   `docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md`

   Owns the AI Agent OS / autonomous cockpit requirements: Quorum Control API,
   Planner / Worker / Reviewer hierarchy, Task Graph, Event Bus, Context Store,
   Cost Manager, worktree isolation, merge authority, and non-blocking automated
   safety controls.

2. World-class claim requirements:
   `docs/specs/QUORUM_COMPETITIVE_GAP_AUDIT_2026-06-25.md`

   Owns the current gap classification for tmux-grade mux behavior,
   BridgeSpace-plus AI team OS behavior, Ghostty / WezTerm-class Windows
   terminal quality, and release readiness.

3. Gap-closure implementation requirements:
   `docs/specs/QUORUM_GAP_CLOSURE_DESIGN_2026-06-25.md`

   Owns the active implementation workstreams, anti-debt rules, fallback policy,
   G5 native terminal closure gates, and G6 aggregate world-class gate.

4. Agent-message superset requirements:
   `docs/specs/QUORUM_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`

   Owns the `agmsg` comparative audit result, local agent message bus
   requirements, delivery policy, role leases, directive protocol, driver trust,
   and the strict-superset claim boundary.

5. Traceability:
   `docs/specs/QUORUM_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md`

   Owns the mapping from requirement -> specification -> implementation design
   -> verifier -> current artifact.

## Current Claim Policy

The product must not claim any of these until the matching gate is green:

- tmux-equivalent / full tmux rewrite
- BridgeSpace-plus complete
- Ghostty-class or WezTerm-class daily-driver terminal
- world-class Windows terminal AI OS
- release-ready
- strict `agmsg` superset / completed agent-message-bus coordination

The current defensible claim is narrower:

> Quorum has a real Rust/Tauri terminal, mux, sidecar, visible-agent, MCP,
> worktree, ownership, review, and merge substrate, but the world-class claim is
> still blocked by durability, persistence, native-quality, and current-proof
> gates.

## Current Machine Truth

Run these before claiming readiness:

```powershell
pnpm verify:world-class-terminal-ai-os
pnpm verify:quality-score
pnpm verify:current-readiness-source
pnpm verify:requirements-spec-design-traceability
```

Current expected classification after the 2026-06-27 doc sync:

- `.codex-auto/quality/world-class-terminal-ai-os.json`: `status=external-blocked`
- `.codex-auto/quality/release-quality-score.json`: score `43/100`,
  `150/351`, grade `D`, `releaseCandidateReady=false`
- `.codex-auto/quality/current-readiness-source.json`: `status=block`

These artifacts override stale prose, older promotion gates, and historical
green snapshots.

## Documentation Maintenance Rule

Every implementation workstream must keep these four layers synchronized:

1. Requirements: what must be true.
2. Specification: the contract and invariants.
3. Design: the implementation plan and module ownership.
4. Gate: the verifier command and artifact proving the current state.

If code changes create or remove a blocker, update the relevant design/status
section and verifier artifact in the same work unit.


