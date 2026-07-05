# Proofbook PB-1 Closeout / PB-2D Continuation Packet

Last updated: 2026-07-04 JST.

Use this when the user says `続き` after PB-1 has landed. PB-1 is the static
schema/parser/validator + read-only list/validate IPC slice only. Proofbooks are
still not runnable.

## Current Machine Truth

- Proofbooks are still not an implemented automation product capability.
- PB-1 static validation is implemented in `src-tauri/src/proofbook/*` and
  `src-tauri/src/ipc/proofbook_commands.rs`.
- Registered IPC is limited to `list_proofbooks` and `validate_proofbook`.
- No runner, run ledger, MCP Proofbook verbs, frontend UI, DB migration,
  `.manage(...)`, or executable Proofbook behavior exists in PB-1.
- `cargo test --manifest-path src-tauri\Cargo.toml proofbook --lib` passed with
  21 proofbook-focused tests.
- `pnpm verify:proofbook:spec` passed with
  `status=pass-proofbook-spec-contract`.

## Read Order

1. `AGENTS.md`
2. `docs/specs/README.md`
3. `docs/specs/PROOFBOOK_AUTOMATION_SPEC.md`
4. `docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md`
5. `src-tauri/src/proofbook/mod.rs`
6. `src-tauri/src/proofbook/types.rs`
7. `src-tauri/src/proofbook/errors.rs`
8. `src-tauri/src/proofbook/parser.rs`
9. `src-tauri/src/proofbook/validator.rs`
10. `src-tauri/src/ipc/proofbook_commands.rs`
11. `src-tauri/src/lib.rs`

## What PB-1 Implemented

- `aelyris.proofbook.v1` schema parsing.
- Static validator with typed `ProofbookError` / `ProofbookErrorCode`.
- camelCase schema DTOs.
- `step.kind` stored as `String`, resolved in validator to preserve
  `unknown_step_type`.
- path containment via canonicalize plus root containment checks.
- read-only `list_proofbooks` / `validate_proofbook` IPC.
- focused Rust tests from the PB-1 detailed design matrix.

## Still Not Implemented

- runner
- run ledger
- MCP Proofbook verbs
- frontend UI/canvas
- DB migrations
- `.manage(...)`
- shell/verifier/MCP/HTTP/agent execution
- distill or evidence store writes

## Next Correct Work

Start with **PB-2D detailed design gate**, not PB-2 runtime code. PB-2D must
write the runner/ledger/manualGate/waitFor/static-step design and verifier
expectations before any runner files are created.

Do not create `runner.rs`, `ledger.rs`, UI, or MCP verbs until PB-2D is green.

## Required Verification For PB-1 Recheck

```powershell
git status --short --branch
pnpm verify:proofbook:spec
cargo test --manifest-path src-tauri\Cargo.toml proofbook --lib
```

If docs changed, also run:

```powershell
pnpm verify:goal:docs
```

## Claim Boundary

The safe PB-1 claim is only that Aelyris can parse and statically validate
project Proofbook definitions and expose read-only list/validate IPC. Proofbooks
still cannot run until PB-2+ gates land.

## Pasteable Next Goal

```text
/goal C:\Users\owner\Aether_Terminal で Proofbook PB-2D detailed design gate を実装する。読み順は AGENTS.md -> docs/specs/README.md -> docs/specs/PROOFBOOK_AUTOMATION_SPEC.md -> docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md -> docs/specs/PROOFBOOK_PB1_CONTINUATION.md -> src-tauri/src/proofbook/{types,errors,parser,validator}.rs -> src-tauri/src/ipc/proofbook_commands.rs。PB-1 static parse/validate は実装済みだが、Proofbooks はまだ実行不可。PB-2D では runner/ledger state machine, shell/verifier/waitFor/manualGate の最小実行範囲, unsupported MCP/HTTP/agent/fanOut/subProofbook/distill fail-closed behavior, artifact hashing/redaction, verifier/test matrix, claim boundary を docs/specs/PROOFBOOK_AUTOMATION_SPEC.md と必要な verifier に明示する。PB-2D が green になるまで runner.rs, ledger.rs, UI, MCP verbs, DB migration は作らない。pnpm verify:proofbook:spec と pnpm verify:goal:docs を通す。明示stage、one phase = one commit、push/PR/force push禁止。
```
