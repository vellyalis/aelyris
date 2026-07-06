# Aelyris Requirements Index

Status: active implementation index
Last updated: 2026-06-27 JST
Last reviewed: 2026-07-06 JST

This file is the stable requirements entrypoint referenced by `AGENTS.md`.
It does not replace the detailed specs. It points implementers to the current
authoritative requirement, specification, design, and proof sources.

## Naming Authority

- Product: **Aelyris** (`Aelys` / `エイリス`).
- CLI / short name: `aelys`.
- Product surfaces: **Aelyris Core**, **Aelyris Grid**, **Aelyris Pane**.
- Coordination engine: **Qralis**.

## Current Requirements Authority

The active spec index is `docs/specs/README.md`. Start there for the current read
order and the authoritative specs. Key still-active specs include:

1. Agent-message superset requirements:
   `docs/specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`

   Owns the `agmsg` comparative audit result, local agent message bus
   requirements, delivery policy, role leases, directive protocol, driver trust,
   and the strict-superset claim boundary.

2. Visible agent pane runtime boundary:
   `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`

   Owns the visible PTY / interactive TUI rule for human-visible agents and the
   pane-tree orchestration design.

3. Supporting specs (planner, MCP tool surface, type bridge, cockpit UX,
   architecture) are indexed in `docs/specs/README.md`.

## Current Claim Policy

This section is the claim policy authority. `GOAL.md`, `README.md`, and
`docs/PUBLICATION_READINESS.md` project this policy and must not fork it.

Aelyris is alpha and does not claim production readiness; capability claims are
gated by verifiers. The product must not claim readiness or completed
capabilities until the matching gate is green.

The current defensible claim is narrower:

> Aelyris has a real Rust/Tauri terminal, mux, sidecar, visible-agent, MCP,
> worktree, ownership, review, and merge substrate, but larger product claims are
> still blocked by durability, persistence, native-quality, and current-proof
> gates.

## Current Machine Truth

Run these before claiming readiness and read the freshly generated artifacts
rather than any score quoted in prose:

```powershell
pnpm verify:quality-score
pnpm verify:goal:safe
pnpm verify:current-readiness-source
```

The locally generated `.codex-auto/quality/*.json` artifacts are the current
machine truth. They override stale prose, older promotion gates, and historical
green snapshots.

Current machine truth refreshed 2026-07-06 JST: `pnpm verify:quality-score`
reports `60/100` (`212/351`), grade `D`, `releaseCandidateReady=false`;
after the final-goal evidence-map refresh the projected score is `60/100`
(`212/351`), still `releaseCandidateReady=false`.
The final-goal audit is `blocked` with `implementationFixableCount=20`,
`policyBlockedCount=3`, and `externalBlockedCount=18`; Aelyris remains alpha
and not release-ready.

## Documentation Maintenance Rule

Every implementation workstream must keep these four layers synchronized:

1. Requirements: what must be true.
2. Specification: the contract and invariants.
3. Design: the implementation plan and module ownership.
4. Gate: the verifier command and artifact proving the current state.

If code changes create or remove a blocker, update the relevant design/status
section and verifier artifact in the same work unit.
