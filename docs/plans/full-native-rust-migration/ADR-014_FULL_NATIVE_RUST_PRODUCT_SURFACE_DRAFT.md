# ADR-014 — Full-Native Rust Product Surface

Status: high-priority queued draft / proposed; canonical decision owner is
`DECISIONS.md` ADR-014; A8.0 owns
accept-as-written/accept-with-amendments/defer/reject, both accepted results
enter one branch, and NUI-0.1 only ratifies an accepted decision for activation
Date: 2026-07-28 JST
Would supersede if accepted: ADR-001 **for the primary product surface only**
Would also supersede if accepted: `TERMINAL_CORE_DESIGN.md §3`
hybrid-primary decision
Preserves: ADR-002 through ADR-013 unless explicitly amended

## Context

ADR-001 selected Tauri v2 + Rust backend + React frontend。At that time React provided feature velocity、Monaco was a structural WebView anchor、full-native UI was considered a multi-year framework investment、native rendering was limited to terminal hot path。

Since then Aelyris has accumulated:

- native Rust client/proof binary
- winit/wgpu surface and font-atlas proofs
- renderer-neutral terminal frame/pipeline
- native terminal input/IME/paste ownership
- native settings/command center/mode shell/inspector
- accessibility/UIA and visual QA proofs
- explicit full-native gap/audit machinery

The product requirement has also changed: the desired product is a Rust-native Windows operator surface with native transparency、low latency、and no WebView dependency in final distribution。

The premise “a WebView remains regardless” is no longer accepted as permanent。Monaco replacement becomes a staged product workstream。

## Decision

Aelyris will migrate its primary operator surface to a Rust-native UI。

Target stack:

- `winit` for window/event loop
- `windows-rs` for Windows integration
- `wgpu`/DX12 for GPU rendering
- DirectWrite for shaping/fallback
- Taffy for layout
- AccessKit/UIA for accessibility
- Aelyris-specific retained UI runtime and specialized terminal/editor surfaces

Tauri/React remains a compatibility face until N4 promotion gates pass。It is not removed at migration start。

Native UI delegates all capabilities to the same canonical Aelyris Control Kernel and backend-owned projections。It does not create a second runtime、Mission owner、mux、PTY、review、merge、proof、or governance path。

## Why

1. Aelyris is a long-running, high-frequency terminal/fleet application where WebView lifecycle and hot-path costs are product constraints。
2. Windows-native transparency、input、IME、DPI、accessibility、power and process integration are first-class requirements。
3. Existing native proofs materially reduce the uncertainty behind the earlier rejection。
4. The product wants a unified Rust type/ownership boundary from runtime through UI。
5. Provider-independent、verifier-backed fleet operation benefits from restartable native UI。
6. Migration remains reversible by retaining Tauri compatibility until parity is proven。

## Consequences

Positive:

- no WebView hot-path/lifecycle dependency at N4
- direct native input/material control
- lower bridge/serialization overhead
- one Rust shortcut/style/state type system
- terminal/editor rendering control
- stronger recovery/diagnostics

Costs:

- internal UI runtime ownership
- native editor implementation
- IME/accessibility complexity
- GPU/device recovery
- Windows-specific code
- visual/tooling velocity initially lower than React

## Scope control

Aelyris will not build a public general-purpose GUI toolkit before N4。Use existing libraries for layout/accessibility/window/GPU/text authority。Custom code is limited to Aelyris-specific runtime、primitives、components、specialized surfaces。

## Migration levels

- N0 Native Proof
- N1 Native Terminal Primary
- N2 Native Cockpit Primary
- N3 Native Core Workflow Complete
- N4 WebView-Free Distribution

Only N4 permits the public claim “full-native Rust UI.”

## Falsification/reopening

Reopen technology choice when:

- target GPU matrix cannot support required alpha/recovery through wgpu
- DirectWrite integration cannot meet text/terminal requirements
- AccessKit/UIA cannot support required terminal/editor semantics
- custom UI runtime maintenance persistently blocks product progress
- a mature Rust framework demonstrably satisfies requirements with lower ownership cost

A failed subcomponent does not automatically restore Tauri as permanent architecture; alternatives are compared under the same Goal and evidence。

## Required follow-up

- add native UI requirement/spec/design/gate authorities
- extract Tauri-neutral `AelyrisRuntime`
- decompose `aelyris_native.rs`
- add surface ownership/parity registry
- implement N0–N4 aggregate verifier
- update `DECISIONS.md` and `TERMINAL_CORE_DESIGN.md` without deleting history
