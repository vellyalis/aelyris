# Aelyris Full-Native Rust Migration Design Package

Source package label: **implementation-ready design package**
Repository status: **proposal / queued / not activated**
Target: `vellyalis/aelyris`
Purpose: Tauri + React + WebView2 を段階的に互換レイヤーへ降格し、Aelyris の主要製品面を Rust ネイティブ UI へ移行する。

Repository integration: **high-priority queued program**。The active
`audit-remediation` phase remains `A4.10`; this package does not authorize a
concurrent implementation lane or a native/full-release claim. The ZIP source
tree is preserved byte-for-byte under [`source/`](./source/), with the original
manifest mirrored as [`source-manifest.json`](./source-manifest.json).
The adapted canonical package is recorded in
[`manifest.json`](./manifest.json). Canonical repository
placement renumbers the draft ADR from the package's conflicting `ADR-013` to
`ADR-014`; `DECISIONS.md` owns both the existing ADR-013 and the canonical
proposed ADR-014 pointer. Default activation is priority 1 after A9; A8.0 may
recommend a pre-A9 rebaseline only through an explicit owner decision. See
[`INTEGRATION.md`](./INTEGRATION.md) for the source hash, canonical placement,
dependency insertion, and complexity receipt.

## 結論

Aelyris は「ゼロからネイティブ版を作り直す」段階ではない。現在のリポジトリにはすでに次の土台がある。

- `aelyris-native` バイナリ
- `winit + wgpu(DX12)` の proof path
- renderer-neutral な `NativeRenderFrame` / `NativeRenderPipeline`
- DirectWrite の text shaping 境界
- Rust-owned terminal input host
- IME、clipboard/paste guard、UI Automation、accessibility、visual QA、sleep/resume の proof 群
- Tauri/WebView と独立した mux daemon / control layer / persistence

したがって正しい戦略は、既存の proof を捨てず、**実験用巨大バイナリを正式な Rust UI ランタイムへ分解・昇格する Strangler Migration** である。

## 推奨読順

1. [`AELYRIS_FULL_NATIVE_RUST_MIGRATION_MASTER_PLAN.md`](../../specs/AELYRIS_FULL_NATIVE_RUST_MIGRATION_MASTER_PLAN.md)
2. [`ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md`](./ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md)
3. [`docs/requirements/AELYRIS_NATIVE_UI_REQUIREMENTS.md`](../../requirements/AELYRIS_NATIVE_UI_REQUIREMENTS.md)
4. [`docs/specs/AELYRIS_NATIVE_UI_ARCHITECTURE.md`](../../specs/AELYRIS_NATIVE_UI_ARCHITECTURE.md)
5. [`docs/specs/AELYRIS_NATIVE_UI_FRAMEWORK_SPEC.md`](../../specs/AELYRIS_NATIVE_UI_FRAMEWORK_SPEC.md)
6. [`docs/specs/AELYRIS_NATIVE_EDITOR_SPEC.md`](../../specs/AELYRIS_NATIVE_EDITOR_SPEC.md)
7. [`docs/specs/AELYRIS_NATIVE_UI_MIGRATION_ROADMAP.md`](../../specs/AELYRIS_NATIVE_UI_MIGRATION_ROADMAP.md)
8. [`docs/specs/AELYRIS_NATIVE_UI_VERIFICATION_PLAN.md`](../../specs/AELYRIS_NATIVE_UI_VERIFICATION_PLAN.md)
9. [`docs/specs/AELYRIS_NATIVE_UI_TRACEABILITY.md`](../../specs/AELYRIS_NATIVE_UI_TRACEABILITY.md)
10. [`native-ui-migration-instructions.md`](./native-ui-migration-instructions.md)

## 設計パッケージの役割

| 文書 | 権威 |
|---|---|
| Requirements | 何が満たされなければならないか |
| Architecture | 責任境界、データフロー、crate ownership |
| Framework Spec | 独自 UI ランタイムの内部契約 |
| Editor Spec | Monaco 撤去を成立させる段階的な native editor |
| Roadmap | Work Unit と依存順、昇格・撤退条件 |
| Verification | verifier、artifact、manual gate、性能基準 |
| Traceability | 要件 → 設計 → 実装 owner → verifier |
| ADR draft | 既存の Tauri/React 方針を履歴を壊さず supersede |
| Queued work-order draft | activation 後に Codex `/goal` 等へ渡す実行入口 |

## 重要な非目標

- Windows API、Flexbox/Grid、accessibility bridge、font shaping を全部自作しない。
- 汎用公開 GUI フレームワークを先に作らない。
- Tauri を最初に削除しない。
- Mission、Control API、mux、PTY、proof、governance の第二実装を作らない。
- Monaco の全機能を一括で再現しない。
- 一つの native proof が通っただけで「フルネイティブ完成」と主張しない。

## 推奨技術基盤

- Window / event loop: `winit`（現行 pin を維持し、更新は独立 gate）
- Windows integration: `windows-rs`
- GPU: `wgpu` + DX12
- Layout: `taffy`
- Accessibility semantic tree: `accesskit` + Windows/UIA bridge
- Windows text authority: DirectWrite
- Terminal model: 既存 `alacritty_terminal` + `GridSnapshot`
- General UI rendering: Aelyris 専用の小さな wgpu primitive renderer
- Terminal/editor rendering: 汎用 widget renderer を迂回できる専用 high-throughput surface
- Tauri/React: N4 までは compatibility face

## Source anchors

- `README.md`
- `DECISIONS.md`
- `docs/requirements.md`
- `docs/specs/README.md`
- `docs/specs/TERMINAL_CORE_DESIGN.md`
- `docs/specs/PHASE_0_1_ARCHITECTURE_SPEC.md`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src-tauri/src/bin/aelyris_native.rs`
- `src-tauri/src/term/render_frame.rs`
- `src-tauri/src/term/render_pipeline.rs`
- `src-tauri/src/term/native_input.rs`
- `scripts/verify-full-native-rust-gap-audit.mjs`
- `package.json`

外部部品の一次資料:

- winit: https://rust-windowing.github.io/winit/winit/
- wgpu: https://github.com/gfx-rs/wgpu
- windows-rs: https://github.com/microsoft/windows-rs
- Taffy: https://docs.rs/taffy/
- AccessKit: https://accesskit.dev/
