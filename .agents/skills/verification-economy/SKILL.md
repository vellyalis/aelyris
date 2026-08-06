---
name: verification-economy
description: "変更のProof Obligationに必要な最小laneを選び、同一差分への重複full gateと無関係な失敗追跡を止める。"
---

# Verification Economy

## Trigger

- 実装後にテスト・build・verifierを選ぶとき
- full suite、benchmark、historical/release aggregateを実行しようとするとき
- verifier failureが現在の変更と無関係か判断するとき
- 同じ検証を再実行したくなったとき

## Objective

変更したownerと具体的なfailure hypothesisだけを検証し、追加検証が採否を変えない時点で停止する。速度短縮は品質を落とさず、無関係な作業拡張を防いだ結果として得る。

## Required preflight

1. Claim、変更owner、主要failure mode、focused command、fullへ昇格する条件を一文ずつ決める。
2. `pnpm verification:plan -- --claim "..." --focused "..." --stage implementation`を実行する。
3. 検証commandは原則`pnpm verification:run -- --command "..."`経由で記録する。

## Loop

1. 変更ownerのfocused testを実行する。
2. 関連failureだけを修正する。無関係なfailureは現在のWork Unitを拡張せず`verification:note`へ記録する。
3. product/runtime sourceを変更した場合は、必要な時点で`pnpm verify:fast`を一度実行する。
4. focused proofが閉じて差分が安定した後だけ、planを`--stage final`で更新する。
5. shared contract、security/auth、persistence/schema、concurrency、dependency、release pathの具体的riskがある場合だけ、対応するowner-fullまたはrepository-full gateを一度実行する。
6. 同一diff fingerprintで既にPASSしたexpensive gateは再実行しない。再実行には新しいfailure hypothesisを`--rerun-reason`で明示する。
7. 必須Proofが閉じたら停止し、残りはResidual Riskまたは別Work Unitへ送る。

## Commands

```powershell
pnpm verification:plan -- --claim "RC-1 authenticated snapshot" --focused "cargo test ...continuity..." --stage implementation
pnpm verification:run -- --command "cargo test ...continuity..."
pnpm verification:note -- --kind unrelated_failure --command "pnpm verify:rust:full" --summary "unrelated Windows manifest/PATH failure"
pnpm verification:summary
```

Expensive gateは`--stage final`のplanと理由を要求する。

```powershell
pnpm verification:plan -- --claim "shared API contract" --focused "cargo test ..." --risk public_contract,auth --stage final
pnpm verification:run -- --command "pnpm verify:rust:full" --reason "public API and auth boundary changed"
```

## Learning contract

- `.codex-auto/learning/verification-decisions.jsonl`へplan、実行結果、重複抑止、無関係failureを追記する。Secret、環境値、test output本文は保存しない。
- 次回planは過去の無関係failureを警告として表示する。
- 同一command・同一fingerprintのexpensive PASSは自動抑止する。
- 同じprocess defectが二回以上再発し、将来の判断を変える場合だけ、`references/learned-failures.md`へ短い恒久ruleとして昇格する。chat transcriptや一時的machine truthは昇格しない。

## Hard guardrails

- 実装中に`cargo test --all-targets`、`pnpm verify:rust:full`、full Vitest、全Playwright、benchmark、historical/release aggregateを「念のため」で実行しない。
- full gateのfailureが現在の変更owner・claim・failure boundaryと因果的に結びつかない場合、その場で修理しない。
- full gateを通すためだけの無関係なformat、lint、PATH、fixture、CI修理をfeature commitへ混ぜない。
- full gateの実行回数、テスト件数、待ち時間を品質証拠として扱わない。
- focused testがPASSしてもrelease/public claimへ昇格しない。逆にrelease laneが不要なRoutine変更へrelease gateを追加しない。

## Output contract

- selected lane
- commands run and PASS/FAIL/SKIP
- unrelated failures deferred
- full gate reason or explicit NotRun
- stop decision

## Stop conditions

Claim、変更挙動、高影響境界のProofが閉じ、追加検証がimplementation decisionを変えず、無関係failureが別laneへ分離された時点。
