# Full-Native Rust Migration Package Integration

Status: integrated as a high-priority queued proposal.
Integrated: 2026-07-28 JST.
Active implementation remains: `audit-remediation/A4.10`.

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
`shippingShellReady=false`. This snapshot is explicitly stale and cannot
authorize promotion; A8.0/NUI-0.3 must regenerate the owner command.

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
A4.10 -> A4.11 -> A4.12
  -> A6.2e1/A6 -> A7 Core
  -> A8.0 product-goal/architecture decision
  -> existing measured A8 terminal decision
  -> A9 release and operator-proof closeout
  -> NUI-F0..F7 as the priority-1 next program
```

F0 remains bounded: decision authority, surface inventory, current baseline,
proof decomposition, and traceability/verifier scaffolding. It cannot change
defaults or implement the runtime, renderer, editor, or native distribution.
A6.6 already owns native proof decomposition, so F0 consumes that output rather
than becoming a competing owner.

The existing A8 measured terminal decision is preserved unchanged. Its fresh
same-condition evidence feeds NUI-0.3 baseline and NUI-F3 promotion later.
A measured `do_not_promote` remains a valid reversible result.

A8.0 may recommend a pre-A9 migration only through an explicit owner decision
and a newly rebaselined tracked program. Importing this high-priority proposal
does not silently expand the current release program.

## Conflict adaptations

1. The package's `ADR-013` conflicted with the repository's existing ADR-013,
   `External Team Patterns Extend Existing Owners`; the imported draft is
   renumbered ADR-014 everywhere in the adapted copies, and `DECISIONS.md`
   remains the canonical decision owner.
2. ADR-014 remains proposed until A8.0 records accepted-as-written or
   accepted-with-amendments; both results enter one activation branch. NUI-0.1
   only ratifies that accepted decision for activation; importing the package
   does not supersede the current Tauri/React architecture by prose alone.
3. N1-N4 and full-native/WebView-free claims remain forbidden until the
   matching aggregate verifier is current and green.
4. A9 retains signing, updater, clean-machine, real sleep/resume, and operator
   evidence authority.

## Complexity receipt

Proposed complexity includes a retained Rust UI tree, Taffy layout, AccessKit,
DirectWrite, winit/wgpu/windows-rs integration, specialized terminal/editor
surfaces, and staged native distribution ownership.

This complexity is accepted for evaluation, not yet for implementation.
NUI-F0 must compare it against the current Tauri/React face and record owner,
failure mode, rollback, maintenance cost, and removal/reconsideration
conditions. Tauri remains the rollback face until N4.

## Import acceptance

This planning slice is accepted only when:

- every canonical document exists and is indexed;
- `audit-remediation/A4.10` remains the only active implementation slice;
- ADR numbering is unambiguous;
- the active work order remains unchanged and all roadmaps agree on the queued
  insertion order;
- claim text remains proposal-only;
- `pnpm verify:native-ui:design-package` validates canonical hashes, links,
  routing, and claim guards;
- requirements/spec/design traceability and continuation gates pass.
