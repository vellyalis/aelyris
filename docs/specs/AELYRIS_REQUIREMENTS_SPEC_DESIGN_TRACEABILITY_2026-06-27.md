# Aelyris Requirements / Spec / Design Traceability

Date: 2026-06-27 JST
Last reviewed: 2026-07-03 JST
Status: active traceability map

This document answers the process question:

> Are requirements, specifications, and design documents being created and
> updated while implementation proceeds?

Answer: yes, but this traceability map is now the required index so that future
work cannot rely on scattered narrative docs.

## Source Hierarchy

| Layer | Authority | Purpose |
| --- | --- | --- |
| Requirements entrypoint | `docs/requirements.md` | Stable path referenced by `AGENTS.md`; points to the current active requirement sources. |
| Specs index | `docs/specs/README.md` | Reading order and status index for spec documents. |
| Agent-message superset spec | `docs/specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md` | Requirements/spec/design for strict `agmsg`-class local messaging superset behavior. |
| Machine truth | `.codex-auto/quality/*.json`, `.codex-auto/performance/*.json` | Current pass/review/block evidence. |

## Requirement Trace Matrix

| Requirement | Specification | Implementation design | Verifier / artifact | Current status |
| --- | --- | --- | --- | --- |
| Current truth must override stale green evidence. | `docs/specs/README.md` do-not-break docs, `docs/requirements.md` "Current Machine Truth" section | G1 current-readiness hierarchy, G6 aggregate gate | `pnpm verify:current-readiness-source`, `.codex-auto/quality/current-readiness-source.json`; `pnpm verify:release-readiness-aggregate`, `.codex-auto/quality/release-readiness-aggregate.json` | BLOCK by design; stale promotion gate demoted. |
| Fallbacks must not unlock product claims. | `docs/requirements.md` "Current Claim Policy" section | G1 anti-debt and G4/G5 fallback blockers | `pnpm verify:anti-debt-claim-contract`, `pnpm verify:mux-fallback-blocker`, `pnpm verify:native-text-shaping-fallback` | PASS/REVIEW; fallback paths remain claim-blocking. |
| tmux-grade mux must prove durable sessions, window/client lifecycle, multi-client attach, replay, control, restore, process preservation, and no fallback claim. | Gap audit tmux section, mux source contracts | G4 tmux-grade mux closure | `pnpm verify:mux-window-session-model`, `pnpm verify:mux-durability-contract`, `pnpm verify:mux-multiclient-attach`, `pnpm verify:mux-fallback-blocker`, `pnpm verify:mux-live`, `pnpm verify:mux-live-process-preservation` | BLOCK in aggregate because live restore proof is `environment-blocked` by Node child-process `spawn EPERM` on this machine. Backend session/window/client model, read-only attach, controller lease, replay, daemon-live same-process detach/reattach, and fallback blocking are now machine-checked. |
| The shared AI team OS must share backend truth across MCP, UI, merge, ownership, shared brain, restart replay, and agent orchestration. | `MCP_TOOL_SURFACE_SPEC.md`, `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`, `docs/specs/README.md` | G2/G3 shared brain, durable merge, ownership persistence | `pnpm verify:durable-merge-unification`, `pnpm verify:security-merge-intent-binding`, `pnpm verify:shared-brain-ownership-persistence`, `pnpm verify:shared-brain-restart-replay`, `pnpm verify:goal:orchestration`, `pnpm verify:upper-compat` | BLOCK in aggregate: restart replay is `environment-blocked` without an authenticated live Aelyris API token/two-phase app restart proof, and agent-team readiness remains blocked by mux live restore plus upper-compat host proof gates. |
| Native-terminal quality requires current native daily-driver proof, system text shaping/fallback, visual regression, IME/paste/resize/sleep/reconnect evidence. | No dedicated spec (gap): the native-terminal final goal is currently defined only by its verifiers and terminal/native modules, not by a spec document in `docs/specs/` | G5 native terminal closure | `pnpm verify:native-text-shaping-fallback`, `pnpm verify:native-operator-primary-terminal`, `pnpm verify:native-visual-regression`, `pnpm verify:terminal:native-boundary` | BLOCK. The native text-shaping, native-client, native-input, HWND paste, and native visual QA subclaims are current, but full native-terminal quality remains blocked by native boundary, primary-shell full-native readiness, process reconnect/OSC, and real sleep/resume visual proof. |
| Release readiness must include the aggregate readiness gate and cannot pass while tmux/shared-workspace/native-terminal claims are blocked. | Release hardening audit and score model | G6 aggregate gate plus release-score integration | `pnpm verify:quality-score`, `.codex-auto/quality/release-quality-score.json` | BLOCK. Current generated artifact is `81/100`, `283/351`, grade `C`, `releaseCandidateReady=false`; regenerate with `pnpm verify:quality-score`; never trust stale prose numbers. |
| Aelyris must not claim strict `agmsg` superset behavior until durable addressed messaging, delivery policy, role leases, directives, driver trust, and replay/no-loss gates pass. | `AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md` | AMB-1 through AMB-10 agent-message work units | Planned: `pnpm verify:agent-message:contract`, `pnpm verify:agent-message:delivery`, `pnpm verify:agent-role-lease`, `pnpm verify:agent-directive-gate`, `pnpm verify:agent-driver-trust`, `pnpm verify:agent-message:watch-once`, `pnpm verify:agent-message:ui-smoke`, `pnpm verify:agent-message:replay`, `pnpm verify:agmsg-superset` | BLOCK. Spec and plan exist; implementation and gates are not complete. |
| Modularity and implementation grain must remain visible. | `docs/specs/README.md` shared contract and god-file decomposition, release design anti-debt rules | Modularity boundary contract | `pnpm verify:modularity-boundary`, `.codex-auto/quality/modularity-boundary-contract.json` | REVIEW. Gate is green as advisory baseline; known large files remain tracked debt. |
| Requirements, specs, design docs, and gate artifacts must stay synchronized. | `docs/requirements.md`, `docs/specs/README.md`, this traceability map | G6 documentation traceability guard | `pnpm verify:requirements-spec-design-traceability`, `.codex-auto/quality/requirements-spec-design-traceability.json` | PASS when docs are connected to current blockers; does not unlock product claims. |

## Current Gate Residuals

The final audit status is `blocked-by-external-gates` in
`.codex-auto/quality/final-goal-audit.json`, with
`implementationFixableCount=0`, `policyBlockedCount=0`, and
`externalBlockedCount=20`. Safe proof registry coverage is `28/28`. Regenerate
with `pnpm verify:final-goal-audit`; never trust stale prose numbers. The
token-spending gate is `authenticated-ai-cli-prompt-smoke`; the consent packet
is `authenticated-ai-cli-consent-packet`; prompt execution requires
`AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini` plus explicit consent.
`pnpm verify:goal:finalize` excludes git finalization by default. Optional git
finalization requires `AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` and is not required
for product/safe/finalize evidence.

## Active Design Status

The implementation is not only docs. Source and verifier work has landed for:

- Shared brain and durable ownership proof.
- Durable merge unification and security-bound merge intent.
- tmux-grade mux session/window/client contract, multi-client attach, replay, and fallback blocker.
- Native text-shaping honesty boundary plus DirectWrite shaped-run renderer
  consumption and `IDWriteFontFallback::MapCharacters` mapping.
- Native daily-driver and visual-regression blocker gates.
- Aggregate terminal AI OS readiness gate.
- Release score integration for the aggregate gate.

## Current Blockers To Drive Next Work

1. Native terminal:
   DirectWrite shaped runs are now consumed by the native renderer, real
   DirectWrite fallback mapping is represented in that path, and
   DirectWrite-resolved fallback atlas rasterization is proven by the current
   native text-shaping PNG fixture. Native-client and native-input/HWND-paste
   proofs are current. Full native-terminal claims still require native boundary,
   primary-shell full-native readiness, process reconnect/OSC, and sleep/resume
   proof.

2. Visual proof:
   Native visual regression now includes current native visual QA and the
   fallback glyph fixture image, but still needs real post-resume visual proof.

3. tmux live restore:
   Backend mux contracts are stronger now, including live client records while
   connected, but the full live restore proof remains blocked on this host
   because Node child-process launch is denied before the sidecar can start.

4. Shared-workspace persistence:
   Shared brain restart replay must be run as a two-phase live proof against an
   authenticated Aelyris API across an app restart, and agent-team readiness must
   become green current evidence after mux live restore and upper-compat proof
   run on a host where Node/Cargo child process launch is allowed.

5. Release:
   current generated score is `81/100` (`283/351`), grade `C`,
   `releaseCandidateReady=false`; read the current score and grade from
   `.codex-auto/quality/release-quality-score.json` (regenerate with
   `pnpm verify:quality-score`); the aggregate readiness gate is now a
   release-score blocker and must stay that way until all claims pass.

## Maintenance Rules

- Do not create a new implementation workstream without adding its verifier
  artifact to this trace or to the release design doc.
- Do not mark a claim green from static source inspection when the claim requires
  live behavior.
- Do not describe fallback as completion. Fallbacks must be typed, visible, and
  claim-blocking until the removal gate passes.
- Update `docs/requirements.md`, `docs/specs/README.md`, and this file when the
  authoritative requirement path changes.




