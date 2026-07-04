# Proofbook PB-1 Continuation Packet

Last updated: 2026-07-04 JST.

Use this when the user says `続き` after a session clear and the intended next
work is Proofbook PB-1 implementation.

## Current Machine Truth

- Proofbooks are still a design target, not an implemented product capability.
- `docs/specs/PROOFBOOK_AUTOMATION_SPEC.md` is the parent authority for product
  requirements, phase roadmap, claim boundary, and PB-2+ behavior.
- `docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md` is now explicitly integrated as
  the PB-1 implementation blueprint.
- `pnpm verify:proofbook:spec` passed after adding the blueprint integration
  gate. The artifact includes `spec-pb1d-blueprint-integrated: passed` and lists
  `docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md` in `sourcePaths`.
- `pnpm verify:goal:docs` passed after the docs/index update.
- The next repo-owned work is PB-1 schema/parser/validator + list/validate IPC.

## Read Order

1. `AGENTS.md`
2. `docs/specs/README.md`
3. `docs/specs/PROOFBOOK_AUTOMATION_SPEC.md`
4. `docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md`
5. `src-tauri/src/workflow/types.rs`
6. `src-tauri/src/workflow/parser.rs`
7. `src-tauri/src/ipc/workflow_commands.rs`
8. `src-tauri/src/lib.rs`

## Next Implementation Scope

Create only:

- `src-tauri/src/proofbook/mod.rs`
- `src-tauri/src/proofbook/types.rs`
- `src-tauri/src/proofbook/errors.rs`
- `src-tauri/src/proofbook/parser.rs`
- `src-tauri/src/proofbook/validator.rs`
- `src-tauri/src/ipc/proofbook_commands.rs`

Edit only for wiring:

- `src-tauri/src/ipc/mod.rs`
- `src-tauri/src/lib.rs`

Implement:

- `aelyris.proofbook.v1` schema parsing.
- Static validator with typed `ProofbookError` / `ProofbookErrorCode`.
- camelCase schema DTOs.
- `step.kind` stored as `String`, resolved in validator to preserve
  `unknown_step_type`.
- path containment via canonicalize + starts_with.
- read-only list/validate IPC.
- focused Rust tests from the detailed design test matrix.

Do not implement in PB-1:

- runner
- run ledger
- MCP Proofbook verbs
- frontend UI/canvas
- DB migrations
- `.manage`
- shell/verifier/MCP/HTTP/agent execution
- distill or evidence store writes

## Required Verification

Run at minimum:

```powershell
git status --short --branch
pnpm verify:proofbook:spec
cargo test --manifest-path src-tauri\Cargo.toml proofbook --lib
```

If docs change during implementation, also run:

```powershell
pnpm verify:goal:docs
```

## Claim Boundary

After PB-1, the safe claim is only that Aelyris can parse and statically validate
project Proofbook definitions and expose read-only list/validate IPC. Proofbooks
still cannot run until PB-2+ gates land.

## Pasteable Next Goal

```text
/goal C:\Users\owner\Aether_Terminal で Proofbook PB-1 (schema/parser/validator + list/validate IPC, ランナー無し) を実装する。読み順は AGENTS.md -> docs/specs/README.md -> docs/specs/PROOFBOOK_AUTOMATION_SPEC.md -> docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md -> docs/specs/PROOFBOOK_PB1_CONTINUATION.md -> src-tauri/src/workflow/{types,parser}.rs -> src-tauri/src/ipc/workflow_commands.rs -> src-tauri/src/lib.rs。対象は src-tauri/src/proofbook/{mod,types,errors,parser,validator}.rs, src-tauri/src/ipc/proofbook_commands.rs, src-tauri/src/ipc/mod.rs, src-tauri/src/lib.rs のみ。runner/ledger/MCP/UI/.manage/DB migration は作らない。cargo test --manifest-path src-tauri\Cargo.toml proofbook --lib と pnpm verify:proofbook:spec を通す。Proofbooks を実装済みと主張しない。明示stage、one phase = one commit、push/PR/force push禁止。
```