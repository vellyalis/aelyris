# Aelyris Native UI Traceability Map

Status: accepted program traceability contract; queued post-A9
Purpose: requirement → design owner → Work Unit → verifier → evidence を一意にする。

Activation blocker: the imported map below is group-level proposal coverage.
NUI-F0 cannot complete until every concrete `NUI-*` requirement ID has one
machine-readable owner, Work Unit, verifier, artifact, rollback, and status
entry, with no wildcard-only coverage.

---

## 1. Registry schema

```json
{
  "requirementId": "NUI-TERM-004",
  "architectureOwner": "aelyris-platform-windows/native-input",
  "implementationOwners": [
    "crates/aelyris-platform-windows",
    "crates/aelyris-terminal-view"
  ],
  "workUnits": ["NUI-3.6", "NUI-3.7", "NUI-3.8"],
  "verifiers": ["NUI-VER-009", "NUI-VER-010", "NUI-VER-011"],
  "artifact": ".codex-auto/quality/native-ui/terminal-interactive.json",
  "status": "proposed"
}
```

---

## 2. Core traceability

| Requirement group | Architecture owner | Work Units | Verifier |
|---|---|---|---|
| NUI-PROD-* | ADR/Control Kernel | 0.1, 1.5, 7.5-7.8 | 001, 002, 016, 017 |
| NUI-RUN-* | runtime/projection | 1.1-1.7 | 001, 002, 014 |
| NUI-WIN-* | platform-windows | 2.1-2.3, 2.10, 3.11 | 005, 006, 014 |
| NUI-UI-* | ui-core/layout | 2.4-2.7, 5.1 | 003, 004, 005 |
| NUI-REN-* | ui-render | 2.3, 2.10, 3.2-3.5 | 005, 006, 013, 014 |
| NUI-TXT-* | ui-text | 2.8, 3.3 | 007, 008 |
| NUI-TERM-* | terminal-view | 3.1-3.12 | 008-011, 013, 014 |
| NUI-COCK-* | native-components | 4.1-4.10 | 003-005, 012, 016 |
| NUI-WORK-* | workspace/review | 5.1-5.9 | 012, 016 |
| NUI-EDIT-* | editor core/view | 5.5-5.6, 6.1-6.11 | 015, 016 |
| NUI-INP-* | platform input/surfaces | 2.7, 3.6-3.8, 6.5 | 009-011, 015 |
| NUI-A11Y-* | ui-accessibility | 2.9, 4.9, 6.9 | 012, 015 |
| NUI-PERF-* | render/runtime/verifier | baseline + promotions | 013 |
| NUI-REL-* | runtime/render/platform | 1.2, 2.3, 3.11, 6.6 | 014, 015 |
| NUI-SEC-* | control/governance/updater | 1.5, 3.8, 5.8, 7.2-7.3 | 001, 002, 011, 016, 017 |
| NUI-COMP-* | migration program | 0.2, 4.10, 6.11, 7.4-7.8 | 002, 016, 017 |
| NUI-DOC-* | docs/claim owner | every WU | freshness/aggregate |

---

## 3. Existing source reuse

| Existing source | Target owner | Migration action |
|---|---|---|
| `src-tauri/src/bin/aelyris_native.rs` | tests/verifier/app shell | decompose; stop god-file growth |
| `src-tauri/src/term/render_frame.rs` | terminal model/view | preserve schema; extract |
| `src-tauri/src/term/render_pipeline.rs` | terminal render pipeline | productionize |
| `src-tauri/src/term/native_input.rs` | platform input | reuse/complete IME/paste |
| `src-tauri/src/control/*` | Control Kernel | retain authority |
| `src-tauri/src/lib.rs` startup | runtime + Tauri adapter | extract composition root |
| `src-tauri/pty-server` | daemon | retain |
| React mode/inspector/settings | native components | user-job/projection port |
| Monaco/editor hooks | native editor | staged E0-E3 |
| full-native gap audit script | aggregate transition wrapper | migrate truth to Rust verifier |

---

## 4. Decision conflicts

| Existing decision | New resolution |
|---|---|
| ADR-001 Tauri + React primary | accepted ADR-014 may supersede the primary surface only after post-A9 NUI-0.1 activation and later promotion; Tauri remains current until then |
| Terminal Core §3 rejects full native | remains current implementation placement until activation; strategic destination is superseded by accepted ADR-014 |
| ADR-010 TS shortcut registry | Rust registry becomes authority after native promotion |
| Cockpit specs say Tauri IPC face | add Native Cockpit direct adapter as primary |
| README Rust/Tauri current claim | keep until aggregate N-level permits update |

---

## 5. Claim mapping

| Claim | Minimum evidence |
|---|---|
| Native proof exists | N0 aggregate |
| Native terminal is primary | N1 aggregate |
| Native cockpit is primary | N2 aggregate |
| Core workflow is WebView-free | N3 aggregate |
| Full-native Rust UI | N4 aggregate |

Individual proof artifacts never authorize a higher claim。
