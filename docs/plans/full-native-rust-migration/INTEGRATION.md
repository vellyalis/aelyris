# Full-Native Rust Migration Package Integration

Status: accepted with amendments at A8.0; activation blocked by ADR-015.
Integrated: 2026-07-28 JST.
Active repo mutation remains the exact slice declared by root
`audit-remediation-instructions.md` or, after its repair gate, by
`product-delivery-instructions.md`.

## Source integrity

Source archive: `aelyris-full-native-rust-migration-plan.zip`
SHA-256:
`9024b28dc2cc6c78d6e1d9cd1e244b9b025bb8bd1cb80f406d4c13f4698f73cf`

The source [`source-manifest.json`](./source-manifest.json) was checked before
integration: all 11 declared documents matched both the declared byte count and
SHA-256. The complete original archive tree, including its manifest, is
preserved byte-for-byte under [`source/`](./source/); it is provenance input,
not a competing planning authority. Adapted canonical file hashes are recorded
separately in [`manifest.json`](./manifest.json).

Observed native baseline snapshot at import: schema
`aelyris.native-coverage-gap/v2`, generated 2026-07-10, measured coverage 82%,
`shippingShellReady=false`. This snapshot was explicitly stale and did not
authorize promotion. A8.0 used fresh v2 evidence at `88/120` with
`shippingShellReady=false`; NUI-0.3 must refresh the owner command again.

## Canonical placement

| Package document | Canonical repository path |
| --- | --- |
| Master plan | `docs/specs/AELYRIS_FULL_NATIVE_RUST_MIGRATION_MASTER_PLAN.md` |
| Queued work order | `docs/plans/full-native-rust-migration/native-ui-migration-instructions.md` |
| ADR draft | `docs/plans/full-native-rust-migration/ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md`; canonical status/pointer in `DECISIONS.md` |
| Requirements | `docs/requirements/AELYRIS_NATIVE_UI_REQUIREMENTS.md` |
| Architecture | `docs/specs/AELYRIS_NATIVE_UI_ARCHITECTURE.md` |
| UI framework spec | `docs/specs/AELYRIS_NATIVE_UI_FRAMEWORK_SPEC.md` |
| Editor spec | `docs/specs/AELYRIS_NATIVE_EDITOR_SPEC.md` |
| Migration roadmap | `docs/specs/AELYRIS_NATIVE_UI_MIGRATION_ROADMAP.md` |
| Verification plan | `docs/specs/AELYRIS_NATIVE_UI_VERIFICATION_PLAN.md` |
| Traceability map | `docs/specs/AELYRIS_NATIVE_UI_TRACEABILITY.md` |
| Package README/manifest | this directory |

## Integration decision

The package is not a parallel active work order and is not merged into A4
implementation. It enters the portfolio in this dependency order:

```text
completed A4/A6/A7 remediation
  -> A8.0 product-goal/architecture decision (accepted with amendments)
  -> A8.1 measured native terminal evidence and disposition
  -> A9 repo repair and continuing operator/external certification
  -> general Mission vertical becomes Product-Accessible
  -> ADR-015 measured-necessity gate
  -> NUI-F0..F7 only if that gate passes
```

F0 remains bounded: decision authority, surface inventory, current baseline,
proof decomposition, and traceability/verifier scaffolding. It cannot change
defaults or implement the runtime, renderer, editor, or native distribution.
A6.6 already owns native proof decomposition, so F0 consumes that output rather
than becoming a competing owner.

The existing A8.1 measured terminal decision is preserved unchanged. Its fresh
same-condition evidence feeds NUI-0.3 baseline and NUI-F3 promotion later.
A measured `do_not_promote` remains a valid reversible result.

A8.0 accepted the N4 direction but did not authorize pre-A9 migration or a
framework dependency. ADR-015 additionally makes general Mission product access and
measured necessity activation prerequisites. NUI-F0 must compare Slint and the
retained-runtime candidate on one same vertical before selecting at most one.

## Conflict adaptations

1. The package's `ADR-013` conflicted with the repository's existing ADR-013,
   `External Team Patterns Extend Existing Owners`; the imported draft is
   renumbered ADR-014 everywhere in the adapted copies, and `DECISIONS.md`
   remains the canonical decision owner.
2. ADR-014 is accepted with amendments. NUI-0.1 only ratifies that accepted
   direction after ADR-015 entry conditions pass; acceptance does not supersede the
   current Tauri/React runtime placement or select a framework by prose alone.
3. N1-N4 and full-native/WebView-free claims remain forbidden until the
   matching aggregate verifier is current and green.
4. A9 retains signing, updater, clean-machine, real sleep/resume, and operator
   evidence authority.
5. `product-delivery-instructions.md` owns the general Mission prerequisite; this
   package may not reinterpret certification-only A9 work as native activation.

## Complexity receipt

Candidate complexity includes either Slint shell ownership or a retained Rust
UI tree, plus DirectWrite/winit/wgpu/windows-rs integration, specialized
terminal/editor surfaces, and staged native distribution ownership.

The N4 direction is accepted, but neither framework candidate is accepted for
implementation. NUI-F0 must compare Slint and the retained runtime on the same
representative vertical and record owner,
failure mode, rollback, maintenance cost, and removal/reconsideration
conditions. Tauri remains the rollback face until N4.

## Import acceptance

This planning slice is accepted only when:

- every canonical document exists and is indexed;
- root `audit-remediation-instructions.md` or `product-delivery-instructions.md`
  remains the only repo-mutating frontier owner as routed by `AGENTS.md`;
- ADR numbering is unambiguous;
- all roadmaps agree that ADR-015 entry conditions precede NUI activation;
- claim text remains queued-target-only and grants no current capability;
- `pnpm verify:native-ui:design-package` validates canonical hashes, links,
  routing, and claim guards;
- requirements/spec/design traceability and continuation gates pass.
