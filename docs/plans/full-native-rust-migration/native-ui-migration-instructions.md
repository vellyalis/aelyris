# Aelyris Native UI Migration — Root Work Order

STATUS: QUEUED_HIGH_PRIORITY
PROGRAM: `native-ui-migration`
PORTFOLIO PRIORITY: priority 1 after A9 by default. A pre-A9 takeover requires
an explicit owner decision at A8.0 and a rebaselined tracked program.
CURRENT EXECUTION OWNER: root `audit-remediation-instructions.md`; read its exact
active slice at execution time. No native migration implementation is active.

Mode: Critical + Exploration
Goal: migrate Aelyris from Tauri/React/WebView2 primary UI to a full-native Rust Windows product surface without creating a second runtime/control truth and without losing a usable rollback path.

This file is the future execution entrypoint for Codex `/goal` or equivalent
agent orchestration. Until its activation gate passes, it is a queued tracked
contract and must not displace the active audit-remediation slice.

---

## 1. Repository integration and activation

The package is integrated in this default dependency order:

```text
active audit-remediation A4 slice -> A4.12 closeout
  -> A6.2e1 and the remaining A6 owner/modularity work
  -> A7 canonical Core Mission vertical
  -> A8.0 native product-goal/architecture decision
  -> existing measured A8 terminal decision
  -> A9 release and external-proof closeout
  -> NUI-F0..F7 as the priority-1 next program
```

Rules:

- the root audit-remediation work order remains the only active implementation
  frontier owner now.
- After A4.12 completes, execution resumes directly at the frozen A6.2e1
  frontier. This imported plan does not change that accepted dependency.
- A6.6 already owns decomposition of `aelyris_native.rs`; NUI-F0 must consume
  that result instead of creating a competing decomposition owner.
- A8.0 evaluates the product Goal, ADR-014, current baseline, total ownership
  cost, rollback, and whether a pre-A9 rebaseline is justified. Proposal import
  is not that decision.
- The existing measured A8 terminal decision remains unchanged and provides
  baseline/promotion evidence for later NUI-0.3/NUI-F3.
- Default activation is after A9 as the priority-1 next program. A pre-A9
  activation requires explicit owner approval plus a new/rebaselined execution
  plan; it cannot be inferred from "high priority."
- A9 signing, updater, clean-machine, real sleep/resume, and operator evidence
  remain current release gates. NUI focused PASS cannot satisfy them.
- ADR-014 remains proposed until A8.0 records accepted-as-written or
  accepted-with-amendments; both results enter one activation branch. NUI-0.1
  only ratifies that accepted decision for activation. Importing this package
  does not supersede current architecture or authorize an N1-N4 claim.

## 2. Mandatory read order

1. `AGENTS.md`
2. `docs/requirements.md`
3. `DECISIONS.md`
4. `docs/specs/README.md`
5. `docs/specs/TERMINAL_CORE_DESIGN.md`
6. `docs/specs/PHASE_0_1_ARCHITECTURE_SPEC.md`
7. `docs/specs/AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md`
8. `docs/requirements/AELYRIS_NATIVE_UI_REQUIREMENTS.md`
9. `docs/specs/AELYRIS_NATIVE_UI_ARCHITECTURE.md`
10. `docs/specs/AELYRIS_NATIVE_UI_FRAMEWORK_SPEC.md`
11. `docs/specs/AELYRIS_NATIVE_EDITOR_SPEC.md`
12. `docs/specs/AELYRIS_NATIVE_UI_MIGRATION_ROADMAP.md`
13. `docs/specs/AELYRIS_NATIVE_UI_VERIFICATION_PLAN.md`
14. `docs/specs/AELYRIS_NATIVE_UI_TRACEABILITY.md`
15. `docs/specs/AELYRIS_FULL_NATIVE_RUST_MIGRATION_MASTER_PLAN.md`
16. this work order

Read current generated evidence before making capability claims。Do not regenerate expensive/token/manual evidence unless active WU authorizes it。

---

## 3. Goal invariants

- final target is N4 WebView-free distribution
- current usable product remains recoverable
- Rust/backend truth remains authoritative
- no second Control Kernel、Mission、TaskGraph、mux、PTY、proof、review、merge、governance、journal
- native UI calls canonical control capabilities
- Tauri is compatibility until promotion gates
- terminal/editor hot paths are specialized surfaces
- Taffy/AccessKit/winit/wgpu/windows-rs/DirectWrite are reused
- no public general-purpose GUI framework
- no completion claim from source presence or focused proof
- docs/spec/design/gate updated in same WU

---

## 4. Current Best

Current repo already contains:

- `aelyris-native`
- winit/wgpu proof paths
- DirectWrite shaping boundary
- renderer-neutral terminal frame/pipeline
- native input/IME/paste ownership
- native command center/mode shell/inspector/settings/UIA/visual proofs
- full-native gap audit

Treat these as reusable current best, not disposable prototypes。Do not keep adding unrelated functions to `aelyris_native.rs`。

---

## 5. First executable phase when activated: F0 only

Do not jump to renderer/editor implementation before F0 is complete。

### Required F0 outputs

1. ADR-014 added per owner policy。
2. Contradictory decisions marked superseded, not deleted。
3. Native UI requirement/spec/design/verification indexed。
4. Machine-readable surface ownership inventory。
5. Current baseline evidence observed/captured under policy。
6. Consume the A6.6-owned decomposition map for proof commands in
   `aelyris_native.rs`; fill only verified gaps without creating a second owner。
7. Traceability verifier skeleton。
8. No behavior/default change。

### F0 forbidden

- deleting Tauri
- moving all modules
- choosing a public UI framework
- adding editor implementation
- changing product claim
- flipping native default
- creating second command registry
- adding proof branches to monolith without extraction

---

## 6. Work Unit discipline

For each WU:

1. state Current Best and Goal Gap
2. identify owner boundary
3. compare alternatives only when uncertainty is material
4. define falsification/rollback
5. implement smallest vertical slice
6. run focused verifier
7. compare against Current Best
8. independent review for Critical contracts
9. update docs/artifact
10. close only if acceptance and rollback pass

A WU may be small; the Goal must not be reduced to a convenient MVP。

---

## 7. Architecture hard rules

### Runtime

- extract `AelyrisRuntimeBuilder`; do not clone service initialization
- no `tauri::*` in runtime/core crates
- native UI gets projections, not raw manager locks
- no loopback HTTP as primary in-process path
- mutating actions carry principal/correlation/idempotency/revision as required

### UI framework

- retained keyed tree
- Taffy layout
- typed styles/tokens
- Rust shortcut registry
- AccessKit semantics
- wgpu scene renderer
- DirectWrite text
- dedicated terminal/editor surfaces
- no CSS selector/DOM/HTML

### Windows

- UI thread owns window/focus/IME/present
- per-monitor DPI
- SeeThrough != Mica/Acrylic
- transparency proven by OS capture
- blank window is hard failure
- actual Japanese candidate and actual sleep are manual claims

### Editor

- E1 read-only viewer first
- document positions strongly typed
- transactions own every mutation
- save through canonical owner with CAS/atomicity
- no Monaco deletion before E2/user-job gate

---

## 8. Parallel agent lanes

After contracts freeze, safe lanes:

- runtime extraction
- UI core/layout
- renderer/text
- Windows input/platform
- accessibility
- verifier/harness

Do not parallel-edit the same authority contract without explicit serialization:

- runtime composition
- Control command registry
- projection schema
- terminal frame schema
- editor position/transaction types
- decision/claim docs

Use Aelyris symbol ownership and worktrees。

---

## 9. Review rejection checklist

Reject a change when it:

- adds a second source of truth
- puts domain logic in widget/adapter
- grows `aelyris_native.rs` instead of extracting
- reimplements Flex/Grid/accessibility/font shaping without evidence
- changes defaults before promotion gate
- uses source grep as runtime proof
- claims full native before N4
- silently degrades glyph/IME/device loss
- stores raw COM/HWND pointers in general UI nodes
- blocks UI thread on I/O
- instantiates a node per terminal cell/editor glyph
- ports React state line-by-line without checking backend ownership
- adds generic abstraction before repeated use
- modifies public claim from stale evidence

Do not reject for trivial stylistic preferences unrelated to correctness、Goal、maintainability、or established conventions。

---

## 10. Expected first implementation sequence

```text
NUI-0.1 accepted-ADR activation ratification
→ NUI-0.2 surface inventory
→ NUI-0.3 baseline
→ NUI-0.4 proof decomposition
→ NUI-0.5 traceability/verifier skeleton
→ NUI-1.1 workspace
→ NUI-1.2 RuntimeServices
→ NUI-1.3 RuntimeBuilder
→ NUI-1.4 ProjectionHub
→ NUI-1.5 NativeControlAdapter
→ NUI-1.6 Tauri adapter
→ NUI-1.7 parity
```

Do not skip directly to visual rewrite。

---

## 11. Completion

This root work order is complete only at N4 aggregate。Session/WU completion must record:

- verified level
- current blockers
- active surface owners
- rollback path
- next exact WU
- stale/manual/external gates

Never report the whole migration complete because N0/N1/N2 focused gates pass。
