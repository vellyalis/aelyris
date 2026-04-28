# Aether Terminal — 引き継ぎ文書

このフォルダにはプロジェクトの全体像、移行計画、設計方針を格納する。
次セッションの担当者がコードを読まずに現状と方針を把握できることを目的とする。

## 現役の引継ぎ (2026-04-28〜)

| ファイル | 内容 |
|----------|------|
| **[CODEX_HANDOFF.md](CODEX_HANDOFF.md)** | **codex 向け self-contained 引継ぎ書 (round 9 時点)。 残作業 / 検証手順 / 制約 / 作業手順テンプレート** |

## 旧計画 (履歴のみ。 採用しない)

`01_*` 〜 `05_*` は 「Tauri → フル Rust 移行」 用の旧計画。 2026-04-17 に「Tauri+React 維持」 方針が確定 (`project_strategic_direction`) したため**現在は採用していない**。 履歴として残す。

| ファイル | 内容 |
|----------|------|
| [01_CURRENT_STATE.md](01_CURRENT_STATE.md) | 現在のアーキテクチャと完成度 (旧) |
| [02_REQUIREMENTS.md](02_REQUIREMENTS.md) | ネイティブ移行の要件定義 (旧) |
| [03_MIGRATION_PLAN.md](03_MIGRATION_PLAN.md) | Tauri→フル Rust の移行計画 (旧、 不採用) |
| [04_ARCHITECTURE.md](04_ARCHITECTURE.md) | 新アーキテクチャ設計 (旧) |
| [05_KNOWN_ISSUES.md](05_KNOWN_ISSUES.md) | 既知の問題とバグ (旧) |
