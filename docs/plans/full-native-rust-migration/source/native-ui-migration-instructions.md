# Aelyris Native UI Migration — Root Work Order

Mode: Critical + Exploration  
Goal: migrate Aelyris from Tauri/React/WebView2 primary UI to a full-native Rust Windows product surface without creating a second runtime/control truth and without losing a usable rollback path.

This file is the execution entrypoint for Codex `/goal` or equivalent agent orchestration.

---

## 1. Mandatory read order

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
15. this work order

Read current generated evidence before making capability claims。Do not regenerate expensive/token/manual evidence unless active WU authorizes it。

---

## 2. Goal invariants

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

## 3. Current Best

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

## 4. First active program: F0 only

Do not jump to renderer/editor implementation before F0 is complete。

### Required F0 outputs

1. ADR-013 added per owner policy。
2. Contradictory decisions marked superseded, not deleted。
3. Native UI requirement/spec/design/verification indexed。
4. Machine-readable surface ownership inventory。
5. Current baseline evidence observed/captured under policy。
6. Decomposition map for proof commands in `aelyris_native.rs`。
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

## 5. Work Unit discipline

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

## 6. Architecture hard rules

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

## 7. Parallel agent lanes

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

## 8. Review rejection checklist

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

## 9. Expected first implementation sequence

```text
NUI-0.1 ADR
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

## 10. Completion

This root work order is complete only at N4 aggregate。Session/WU completion must record:

- verified level
- current blockers
- active surface owners
- rollback path
- next exact WU
- stale/manual/external gates

Never report the whole migration complete because N0/N1/N2 focused gates pass。
