---
name: aelyris-evidence-review
description: Verify Aelyris readiness, implementation claims, GO-line status, or completion percentage from local machine evidence. Use when the user asks whether something is truly done, current, safe to claim, or blocked; when release or world-class status is discussed; or when a change needs PASS/REVIEW/BLOCK classification from verifier commands and artifacts.
---

# Aelyris Evidence Review

Use this skill to turn claims into current evidence. Do not treat older prose,
reviewer opinions, or historical score snapshots as controlling truth.

## Preflight

1. Read `AGENTS.md`, `docs/requirements.md`, `docs/README.md`, and `docs/AGENT_WORKFLOWS.md`.
2. Identify the exact claim being checked.
3. Classify the proof path:
   - local deterministic verifier,
   - live app / WebView2 / CDP verifier,
   - real Windows sleep/resume or signing operator gate,
   - token-spending AI prompt gate.

Do not run token-spending prompt smoke without explicit consent.

## Evidence Commands

Run only the checks relevant to the claim:

```powershell
pnpm verify:release:hygiene
pnpm verify:quality-score
pnpm verify:goal:safe
pnpm verify:requirements-spec-design-traceability
pnpm verify:world-class-terminal-ai-os
```

For terminal/runtime claims, add the matching narrow verifier from `package.json`,
such as visible-agent, mux, native-boundary, AI CLI boundary, or right-rail checks.

## Output Contract

Start with exactly one verdict:

- `PASS`: current verifier evidence supports the narrow claim.
- `REVIEW`: evidence is mixed, stale, partial, or needs human judgment.
- `BLOCK`: the claim is false, overbroad, or blocked by missing proof.

Then include:

- commands run and exit status,
- artifact paths generated or read,
- stale/unknown/external-blocked items,
- current claim boundary,
- shortest next action.

If evidence was not checked, say `unknown`. Do not infer release readiness from
feature presence.