# Aelyris Style

Status: active coding and documentation style guide.

## General Style

- Prefer explicit code over clever code.
- Prefer existing patterns over new abstractions.
- Keep edits scoped to the owner module.
- Do not add comments that restate obvious code.
- Add short comments only when they prevent misreading of complex logic.
- Keep public claim language conservative and verifier-backed.

## Naming

- Product: Aelyris.
- Read as: Aelys / エイリス.
- CLI: `aelys`.
- Coordination engine: Qralis.
- Visible agent run mode: `visible_pty`.
- Headless batch/planner/reviewer mode: `headless_print`.
- Remote feature family: Remote Continuity.

## Type And Contract Style

- Use typed structs/interfaces for public contracts.
- Avoid unvalidated `as` casts in TypeScript public paths.
- Use explicit typed errors for fail-closed states.
- Keep schema names versioned when persisted or exposed.
- Do not duplicate schemas across frontend/backend without a drift test.

## React / Frontend Style

- Feature UI belongs in `src/features/<domain>/`.
- Shared primitives belong in `src/shared/`.
- `src/App.tsx` is composition glue and must not grow for new feature logic.
- UI renders backend truth; it does not invent execution state.
- Use existing design primitives and CSS module patterns.

## Rust / Backend Style

- Domain logic belongs in focused modules.
- IPC/MCP/CLI handlers delegate to domain owners.
- Persistence goes through repositories or explicit state owners.
- Long-running process/session behavior must be auditable and recoverable.
- Fail closed for unsupported modes.

## Verifier Style

- Verifiers should write JSON artifacts under `.codex-auto/quality/`.
- Verifiers should fail loudly on missing source clauses, drift, or overclaim.
- Do not weaken a verifier to pass a change.
- Source-scan gates are acceptable for design/contract presence; runtime claims
  need runtime or focused unit proof.

## Documentation Style

- Separate principles, goals, architecture, contracts, tasks, and decisions.
- Do not turn every doc into a step-by-step prompt.
- Write decision material that lets an AI choose placement, priority, and owner.
- Keep claim boundaries visible in product-facing docs.

## Dependency Style

- Prefer standard library and existing dependencies.
- New dependencies are a last resort.
- A new dependency needs a reason, owner, risk, and verifier impact.
- Do not add a dependency for simple parsing or formatting that the platform can
  already handle safely.

## Performance Style

- Do not optimize from guesswork.
- Measure before optimizing.
- Do not sacrifice correctness or readability for hypothetical speed.
- Performance claims need artifacts.