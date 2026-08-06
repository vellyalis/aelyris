# Verification Economy — Learned Failures

恒久ruleへ昇格するのは、再現したprocess defectが将来の実行判断を変える場合だけ。機種固有の一時エラーや生ログは`.codex-auto/learning/verification-decisions.jsonl`に留める。

| Date | Observed defect | Adopted rule | Enforced by |
| --- | --- | --- | --- |
| 2026-08-06 | Feature差分が安定する前に`verify:rust:full` / `cargo test --all-targets`を繰り返し、無関係なWindows manifest・PATH・Clippy failureまで同じWork Unitで修理した | focused proofを先に閉じ、full gateはfinal stageで一度だけ。同一fingerprintのexpensive PASSは再実行せず、無関係failureは別Work Unitへ記録する | `verification-economy` skill、`scripts/verification-budget.mjs` |
