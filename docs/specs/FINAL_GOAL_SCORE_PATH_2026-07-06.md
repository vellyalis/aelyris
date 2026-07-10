# Final-Goal Score Path — Triage Ledger (2026-07-06)

> **STATUS: EXECUTION LEDGER for the release-score backlog.** This is the
> missing "route to releaseCandidateReady" that previously existed only as raw
> entries inside `.codex-auto/quality/final-goal-audit.json`. It classifies
> every scoring blocker by *what kind of action actually fixes it*, so an
> executing agent never has to infer.
>
> **No numeric truth lives in this file.** Score, counts, and the current
> blocker list are machine-generated; regenerate and read them, never quote
> prose:
>
> ```powershell
> pnpm verify:goal:safe:no-token # descriptor-first no-token artifacts + audit + score
> pnpm verify:quality-score      # .codex-auto/quality/release-quality-score.json
> pnpm verify:final-goal-audit   # .codex-auto/quality/final-goal-audit.json
> ```

## 0. How to read a blocker (decoding "missing, stale, or failing")

The score model treats an evidence artifact as dead when **any** of these
holds — and the required action differs per case:

| Artifact state | How it happens | Correct action |
| --- | --- | --- |
| **missing** | verifier never ran on this machine | run the verifier command |
| **stale** | artifact `mtime` is older than any watched source file (the scorer compares against a per-area source list in `scripts/score-release-quality.mjs`) | **re-run the verifier command — do NOT write code** |
| **failing** | verifier ran and reported `ok:false` / blockers | read the artifact's own `blockers[]`, then classify per §1 |

Because staleness is mtime-based, **any commit that touches watched sources
invalidates evidence**, and the score drops without anything being broken.
A low score therefore does not mean regression until a fresh re-run confirms
it.

Note one modeling quirk: `release-readiness-aggregate` entries appear in
**both** the implementation-fixable and external-blocked lists of the audit
(double-counted), and the audit also emits umbrella `missing-requirement`
entries (e.g. `rust-native-terminal-core`, `release-operations-proof`) that
are **derived roll-ups** of the per-area blockers. Never work on umbrella or
aggregate entries directly — fix the per-area leaves and the roll-ups
recompute.

## 1. Triage classes

Every blocker area belongs to exactly one class:

- **RERUN** — evidence is stale/missing; a non-token local command refreshes
  it. No code. No live app.
- **LIVE-HOST** — the verifier needs the running app
  (`AELYRIS_API_TOKEN=dev pnpm tauri:dev`, WebView2 CDP on `127.0.0.1:9222`)
  or a real user-initiated Windows sleep/resume cycle. No code, but needs an
  operator-attended host session.
- **TOKEN-CONSENT** — verifier spends AI-provider tokens; runs only through
  `pnpm verify:goal:operator:token-smoke` with an explicit provider. Standing
  owner authorization lets the wrapper mint a short-lived one-use packet for
  that invocation, but execution remains operator-triggered and is never part
  of the no-token graph.
- **UPSTREAM** — blocked on a third-party fix (e.g. a vulnerable transitive
  dependency); re-run periodically after dependency updates.
- **DERIVED** — aggregate/umbrella rows; never actionable directly.
- **CODE** — only after a *fresh* re-run still fails for a non-environment
  reason. These are the only rows that become work units, and they get the
  standard owner-side deepening pass first (see §4).

## 2. Area → class → exact command

| Area (as named in audit/score) | Class | Refresh command | Artifact |
| --- | --- | --- | --- |
| `terminal-render-fidelity` | RERUN | `pnpm verify:terminal:font-render` | `.codex-auto/quality/terminal-font-render-contract.json` |
| `native-boundary-contract` | RERUN | `pnpm verify:terminal:native-boundary` | `.codex-auto/quality/native-boundary-contract.json` |
| `interactive-ai-cli-sidecar-boundary` | RERUN | `pnpm verify:terminal:ai-cli-boundary` | `.codex-auto/production-smoke/interactive-ai-cli-boundary.json` |
| `real-ai-cli-binary-probe` | RERUN (needs installed CLIs, no tokens) | `pnpm verify:terminal:real-ai-cli` | `.codex-auto/production-smoke/real-ai-cli-binary-probe.json` |
| `ai-cli-launch-planner` | RERUN (after binary probe is green) | `pnpm verify:terminal:ai-cli-launch-planner` | `.codex-auto/production-smoke/ai-cli-launch-planner.json` |
| `tauri-runtime-hygiene` | RERUN | `pnpm verify:tauri-runtime-hygiene` | `.codex-auto/quality/tauri-runtime-hygiene.json` |
| `right-rail-edge` | RERUN first; CODE only if fresh run fails | `pnpm verify:right-rail-edge` + `pnpm verify:right-rail-density` | right-rail artifacts under `.codex-auto/quality/` |
| `command-center-scenario` / `provenance-recovery-context-packs` | RERUN first | `pnpm verify:command-center-scenario` | `.codex-auto/quality/` |
| `authenticated-ai-cli-preflight-matrix` | RERUN (no-token preflight; needs all three CLIs installed) | `pnpm verify:terminal:authenticated-ai-cli-preflight-matrix` | `.codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json` |
| `terminal-core-edge` (native HWND paste live proof) | LIVE-HOST | `pnpm verify:terminal:native-hwnd-paste` | live input-host proof |
| `right-rail-goal-track` | LIVE-HOST (Tauri runtime) | `pnpm verify:right-rail-goal-track-tauri` | Tauri goal-track smoke |
| `multipane-command-evidence` | LIVE-HOST (CDP 9222) | `pnpm verify:terminal:multipane-command-evidence` | `.codex-auto/production-smoke/multipane-command-evidence.json` |
| `recovered-command-evidence` | LIVE-HOST (CDP 9222) | `pnpm verify:terminal:recovered-command-evidence` | `.codex-auto/production-smoke/recovered-command-evidence.json` |
| `process-reconnect-command-evidence` | LIVE-HOST (CDP 9222) | `pnpm verify:terminal:process-reconnect-command-evidence` | `.codex-auto/production-smoke/` |
| `live-ai-cli-post-launch-chaos` | LIVE-HOST (CDP 9222) | `pnpm verify:terminal:ai-cli-post-launch-chaos` + `pnpm verify:terminal:native-ai-cli-post-launch-chaos` | chaos artifacts |
| `real-os-soak` | LIVE-HOST (user-initiated Windows sleep; programmatic suspend returns `GetLastError=50` on this host) | `pnpm verify:production:suspend:user-cycle` | `.codex-auto/production-smoke/real-os-suspend-resume.json` |
| `authenticated-ai-cli-prompt-smoke` / `authenticated-ai-cli-preflight-gate` | TOKEN-CONSENT | `pnpm verify:goal:operator:token-smoke` with explicit provider; packet contract: `pnpm verify:terminal:authenticated-ai-cli-consent-packet` | `.codex-auto/production-smoke/` |
| `supply-chain-audit` | UPSTREAM (current status `classified-upstream-bound`) | `pnpm verify:supply-chain` after dependency bumps | `.codex-auto/release-doctor/supply-chain-audit.json` |
| `release-readiness-aggregate` (all rows) | DERIVED | `pnpm verify:release-readiness-aggregate` recomputes after leaves are fixed | `.codex-auto/quality/release-readiness-aggregate.json` |
| `rust-native-terminal-core`, `rust-mux-daemon-boundary`, `right-rail-command-center`, `release-operations-proof` (umbrella `missing-requirement` rows) | DERIVED | fix the leaves above, rerun `pnpm verify:final-goal-audit` | — |
| `final-goal-evidence-map` (score category) | DERIVED | `pnpm verify:final-goal-audit` after leaves | `.codex-auto/quality/final-goal-audit.json` |

If an area appears in a future audit that is not in this table, classify it
with §0/§1 before touching anything, and add the row here in the same change.

## 3. The route (execution order)

> Resume rule: the current step is the lowest-numbered step whose exit
> condition is not yet met. Regenerate machine truth before resuming.

1. **RERUN sweep (any session, cheap, no tokens, no app).** Run every RERUN
   command in §2, then `pnpm verify:quality-score && pnpm verify:final-goal-audit`.
   Exit: no RERUN-class rows remain in the audit's fixable list.
2. **LIVE-HOST sweep (operator-attended).** Start the app
   (`AELYRIS_API_TOKEN=dev pnpm tauri:dev`, CDP on 9222), run the LIVE-HOST
   commands; perform one user-initiated sleep/resume cycle for `real-os-soak`.
   Exit: CDP- and sleep-gated rows move to green or are re-classified.
3. **TOKEN-CONSENT sweep (operator-triggered).** Run the authenticated prompt
   smoke through the operator wrapper; it issues and consumes the execution
   packet before CDP. Record provider/model/
   command/artifact evidence; never persist secrets or transcripts with
   tokens.
4. **CODE residue.** Whatever still fails after 1–3 with a fresh artifact is a
   genuine implementation item. For each: owner-side session runs one
   deepening pass (re-verify anchors on current main, pin exact wiring,
   produce a zero-inference packet), then hand off. Same discipline as
   `PRODUCT_DIRECTION_PROPOSALS_2026-07-03.md` §5 granularity rule.
5. **UPSTREAM watch.** Re-run `pnpm verify:supply-chain` after dependency
   updates; do not fork or patch vendored dependencies to force a pass.
6. **Docs re-sync (always last in any batch).** If score/audit numbers
   changed, the freshness gate (`pnpm verify:goal:docs`) fails until the nine
   governed docs carry the current tokens (`NN/100`, `NNN/351`,
   `releaseCandidateReady=…`, `implementationFixableCount=…`,
   `policyBlockedCount=…`, `externalBlockedCount=…`, today's JST date).
   Update the numbers in place — **never delete the numeric lines to dodge
   the gate (de-pinning is forbidden)** and never edit
   `verify-goal-documentation-freshness.mjs` to relax it.

Reaching `releaseCandidateReady=true` requires score ≥ 92% **and** zero
blockers. After that, roadmap items (Remote Continuity, Proofbook execution,
LSP tier) add new verifier categories and grow the denominator — the target
is *staying* ≥ 92 as capabilities land, not touching it once.

## 4. Rules for executing agents (codex / opus)

- **Stale ≠ broken. The fix for a stale artifact is re-running its command.**
  Writing code to "fix" a staleness blocker is forbidden.
- Never edit a verifier script, watched-source list, freshness window, or
  threshold to make a gate pass. Gate weakening is a blocked change class.
- Never fabricate, hand-edit, or backdate an artifact JSON under
  `.codex-auto/`.
- LIVE-HOST and TOKEN-CONSENT rows are operator gates: if the environment is
  not available (no CDP or no explicit provider), **report the row as
  environment-blocked and move on** — do not emulate, mock, or substitute a
  fixture run for live evidence.
- If a §2 command no longer exists in `package.json`, or an artifact path
  moved, STOP and report — do not guess a replacement.
- CODE-class items are executed only from an owner-prepared zero-inference
  packet. If the pinned design does not match the code, STOP and report;
  redesigning on the fly is forbidden.
