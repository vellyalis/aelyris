# Quorum Plan

Date: 2026-06-28 JST
Status: active roadmap; not a release claim
Primary spec: `docs/specs/ASTRA_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`

This plan keeps the product direction concrete after the `agmsg` comparative
audit. The aim is to make Quorum more than a terminal and more than a message
CLI: a local-first workspace where agents, panes, tasks, reviews, worktrees, and
evidence stay connected.

## Current Truth

Quorum is still alpha and not release-ready. Current local evidence shows
`releaseCandidateReady=false`; the latest `release-quality-score` artifact is
`43/100`, `150/351`, grade `D`. Public claims must remain guarded until current
verifier artifacts are green.

The agmsg comparison adds one new claim boundary:

> Do not claim strict agmsg superset or completed swarm-style coordination until
> the agent message bus, delivery policy, role leases, directive protocol, driver
> trust model, and replay/no-loss gates pass.

## Product North Star

Quorum should become a calm cockpit for multi-agent development.

- Humans keep the final judgment.
- Agents work in visible lanes and isolated worktrees.
- Messages are durable and addressed, not scattered chat snippets.
- Role ownership, file/symbol ownership, and review state are connected.
- Every important claim has verifier evidence.

## Phase 0 - Documentation And Claim Control

Status: in progress.

Deliverables:

- Add the agent-message superset spec.
- Update requirements, spec index, traceability, and docs map.
- Keep GitHub introduction wording warm but claim-safe.
- Mark strict agmsg superset as blocked until implementation gates pass.

Acceptance:

- `docs/specs/ASTRA_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md` exists.
- `docs/requirements.md` points to it.
- `docs/specs/README.md` and traceability mention it.
- A reviewer can see exactly what is missing before public claims.

## Phase 1 - Local Agent Message Bus

Goal: implement durable addressed messaging.

Work:

- Add SQLite/WAL-backed message schema and repositories.
- Add message IDs, sequence cursors, thread IDs, sender/recipient metadata.
- Add inbox/history/ack projections.
- Add no-loss behavior: fail or backpressure instead of silent drops.
- Add MCP and Tauri APIs: send, inbox, history, ack, watch.

Acceptance gates:

- `pnpm verify:agent-message:schema`
- `pnpm verify:agent-message:contract`
- Unit tests for send/inbox/history/ack and projection rebuild.

## Phase 2 - Delivery Policy

Goal: match and exceed agmsg delivery behavior.

Work:

- Implement `monitor`, `turn`, `both`, and `off`.
- Add Quorum-specific policies: `review_gate`, `task_scope`, `human_only`.
- Prove idempotency for `both`.
- Prove no worker/session starts for empty inbox or `off` mode.

Acceptance gates:

- `pnpm verify:agent-message:delivery`
- Watch-once no-empty-worker smoke.

## Phase 3 - Role Leases And Team Identity

Goal: make agent roles explicit and exclusive when needed.

Work:

- Add team/agent identity APIs.
- Add role lease acquire/renew/release/steal.
- Bind role leases to visible panes and orchestrator dispatch.
- Add audit events for role changes and steal reasons.

Acceptance gates:

- `pnpm verify:agent-role-lease`
- Tests that two agents cannot hold the same exclusive role at once.

## Phase 4 - Directive Protocol

Goal: let agents request host actions safely.

Work:

- Define `aether.directive.v1` schema (the `aether.*` namespace is an internal code identifier and is unaffected by the Quorum product name).
- Parse directives from agent output.
- Preview risk and required authority.
- Execute only through existing command-risk/tool-approval gates.
- Record idempotent outcomes and audit links.

Acceptance gates:

- `pnpm verify:agent-directive-gate`
- Negative tests for malformed, unknown, untrusted, and unauthorized actions.

## Phase 5 - Driver And Plugin Trust

Goal: make storage, agent runtime, delivery, and plugin trust explicit.

Work:

- Define driver manifests and capability declarations.
- Add path-pinned allowlist for local drivers/plugins.
- Separate trusted, review-required, and blocked driver states.
- Bind driver access to message/directive permissions.

Acceptance gates:

- `pnpm verify:agent-driver-trust`
- Tests proving untrusted drivers cannot access history or run directives.

## Phase 6 - Cockpit UI Integration

Goal: make coordination visible and usable.

Work:

- Add agent inbox surface.
- Add message thread view with task/pane/evidence refs.
- Show current role leases on agent/pane cards.
- Add directive review queue.
- Link messages to review and merge evidence.

Acceptance gates:

- Browser/Tauri visual smoke for inbox, thread, role lease, directive review.
- Accessibility pass for keyboard navigation and focus order.

## Phase 7 - Orchestrator Integration

Goal: connect message state to actual multi-agent work.

Work:

- TaskGraph can create/consume message threads.
- Orchestrator dispatch respects role leases and delivery policy.
- Review outcomes produce addressed messages.
- Merge intent includes message/evidence thread refs.
- Restart replay restores message, task, pane, and role state together.

Acceptance gates:

- Extended `pnpm verify:goal:orchestration`.
- Restart/replay proof on a host that can spawn the required sidecars.

## Phase 8 - Superset Gate

Goal: make the public claim machine-checkable.

Work:

- Add `pnpm verify:agent-message:watch-once`.
- Add `pnpm verify:agmsg-superset`.
- Include message contract, delivery policy, role leases, directives, driver
  trust, watch-once, no-loss, replay, and UI integration artifacts.
- Feed the result into `score-release-quality` and docs freshness checks.

Acceptance:

- `agmsg-superset.json` is current and green.
- Public docs may then say Quorum is an agmsg-class local messaging superset.
- Still do not claim release-ready unless the release and world-class gates pass.

## Risks

- Overbuilding a chat UI instead of a backend coordination layer.
- Letting frontend state become the source of truth.
- Silent message loss during DB or event-stream failure.
- Allowing directives to bypass command-risk approval.
- Trusting third-party drivers too broadly.
- Confusing agmsg-superset with release-ready.

## Immediate Next Work Units

1. Implement AMB-1 schema/repository and tests.
2. Implement AMB-2 message send/inbox/history/ack APIs.
3. Implement AMB-3 delivery policy with negative tests.
4. Implement AMB-4 role leases and orchestrator read-only integration.
5. Implement AMB-5 directive parser/preview with fail-closed tests.

Each work unit must update the matching verifier and traceability row before it
is considered done.


