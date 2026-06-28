<!--
Quorum keeps requirements, spec, design, and gate in sync.
See CONTRIBUTING.md and docs/requirements.md before opening a PR.
-->

## Summary

What does this change do, and why?

## Owner module & verifier

- Owner module:
- Verifier that proves the behavior (command):

## Checks run

- [ ] `pnpm test`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `pnpm lint`
- [ ] Relevant `pnpm verify:*` gate(s):

State which checks were run and whether any blocker is an external/operator gate.

## Claim policy

- [ ] This PR does not introduce any claim blocked by `docs/requirements.md`
      (tmux-equivalent, world-class, release-ready, etc.) without a green gate.

## Debt check

- [ ] No duplicated logic, dead code, or unwired infrastructure
- [ ] Single owner for new state; contract expressed in types/schema
- [ ] No secrets, tokens, or machine-specific absolute paths added
