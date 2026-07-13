# Aelyris Requirements Index

Status: active implementation index
Last updated: 2026-07-13 JST
Last reviewed: 2026-07-13 JST

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

1. Verifiable Agent Work OS product contract:
   `docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md`

   Owns the target product requirements for the backend-owned Mission,
   Now/Next/Unlocks, Universal Agent Fabric, capability kernel, Chronicle,
   immutable work-unit packets and `MissionCompletionPacket`, reversible autonomy, governed learning,
   Attention Compiler, and post-release Apex direction. Its detailed design and
   roadmap are adjacent. These are target authorities, not shipped-capability or
   release-readiness claims; the active R0-A9 plan still owns execution order.

   Cross-face API/MCP security, identity, versioning, idempotency, cancellation,
   backpressure, evidence, migration, and adversarial acceptance are owned by
   `docs/specs/AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md`. The current
   `MCP_TOOL_SURFACE_SPEC.md` is a subordinate implemented/historical catalog, not
   permission or product ontology authority.

   Contract gate: `pnpm verify:verifiable-agent-work-os-spec`.

2. Agent-message superset requirements:
   `docs/specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`

   Owns the `agmsg` comparative audit result, local agent message bus
   requirements, delivery policy, role leases, directive protocol, driver trust,
   and the strict-superset claim boundary.

3. Visible agent pane runtime boundary:
   `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`

   Owns the visible PTY / interactive TUI rule for human-visible agents and the
   pane-tree orchestration design.

4. Supporting specs (planner, MCP tool surface, type bridge, cockpit UX,
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

The product-direction category is **Verifiable Agent Work OS**, with `Mission` as
the durable top-level work contract. That phrase is a target design category. It
must not be projected as implemented, shipped, production-ready, or
release-candidate-ready until the matching A7 runtime gates, A8 decision evidence,
A9 release/external evidence, and current aggregate claim policy all pass.

## Current Machine Truth

Run these before claiming readiness and read the freshly generated artifacts
rather than any score quoted in prose:

```powershell
pnpm verify:quality-score
pnpm verify:goal:safe:no-token
pnpm verify:current-readiness-source
```

`verify:goal:safe:no-token` validates its complete descriptor graph before the
first child process and scrubs prompt consent/provider/execution-packet env from
every step. Token-spending proof is separate: set an explicit
`AELYRIS_AUTH_PROMPT_PROVIDER` and run `pnpm verify:goal:operator:token-smoke`;
the wrapper issues a HEAD- and verifier-bound, short-lived one-use packet under
the repository's standing authorization. The broader legacy
`pnpm verify:goal:safe` remains an ordered aggregate and is not a no-token claim.

The locally generated `.codex-auto/quality/*.json` artifacts are the current
machine truth. They override stale prose, older promotion gates, and historical
green snapshots.

Current machine truth refreshed 2026-07-10 JST: `pnpm verify:quality-score`
reports `23/100` (`76/327`), grade `D`, `releaseCandidateReady=false`.
The final-goal audit is downstream and never feeds points back into the score;
it is `blocked` with `implementationFixableCount=194`,
`policyBlockedCount=12`, and `externalBlockedCount=17`. The safe proof registry
target is `28/28`. `authenticated-ai-cli-prompt-smoke` requires
`authenticated-ai-cli-consent-packet` and
`AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.
`pnpm verify:goal:finalize` excludes git finalization by default;
`AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` is
optional, and git is not required for product/safe/finalize evidence. Aelyris
remains alpha and not release-ready.

## Documentation Maintenance Rule

Every implementation workstream must keep these four layers synchronized:

1. Requirements: what must be true.
2. Specification: the contract and invariants.
3. Design: the implementation plan and module ownership.
4. Gate: the verifier command and artifact proving the current state.

If code changes create or remove a blocker, update the relevant design/status
section and verifier artifact in the same work unit.
