# Native-First Hybrid Product Goal

Date: 2026-05-26

## Final Goal

Aether does not need to become a 100% full-native Rust application to be product-grade.

The release target is a native-first hybrid architecture:

- Rust owns terminal truth, PTY/mux/session durability, scrollback, command history, recovery/provenance, AI CLI orchestration, settings data, Command Center data, and all terminal hot paths.
- Native/Rust owns input-sensitive and latency-sensitive terminal behavior: rendering contract, IME, clipboard, paste guard, focus, pane lifecycle, process launch, scrollback, and recovery after suspend/resume.
- Tauri/React/WebView may remain for non-hot-path product UI where it is faster to iterate and does not own terminal truth: settings presentation, inspectors, configuration forms, project panels, review surfaces, and compatibility views.
- Any React/WebView surface that remains must be backed by Rust-owned data contracts, must not be a silent fallback, and must be covered by performance, contrast, and interaction proofs.

Full-native Rust remains a useful stretch direction, but it is no longer the required release definition.

## Why This Replaces The Old Goal

The previous strict full-native goal was valuable because it forced the weak boundaries into the open: xterm/WebView IME, clipboard, PTY, pane split, process launch, visual QA, and recovery.

The current evidence shows that the right product target is narrower:

- The terminal core and terminal hot path need native-first ownership.
- The broad shell does not need to be rewritten in Rust if React/Tauri remains responsive, bounded, and contract-driven.
- Clauge-style information architecture can be adopted without copying its full super-app scope.
- The product should optimize for user experience and reliability, not an ideological "no React anywhere" rule.

## Release-Blocking Native-First Requirements

These are required before claiming release-grade quality:

1. Terminal hot path is native-first.
   - IME composition and Japanese candidate positioning do not depend on WebView textarea semantics.
   - Clipboard and paste guard are enforced before PTY writes.
   - Pane split/close/focus does not flash command windows or freeze the UI.
   - Shell launch and AI CLI launch are authenticated, measured, and recoverable.

2. Rust is the product truth boundary.
   - Mux/session graph, scrollback, command history, recovery evidence, settings data, and Command Center data are Rust-owned.
   - React views read and operate through Rust contracts instead of maintaining separate hidden truth.

3. React/Tauri surfaces are allowed only when bounded.
   - Remaining React surfaces must have explicit compatibility/product roles.
   - No silent fallback to WebView/xterm for terminal input or paste behavior.
   - Fallbacks are telemetry-visible and release-scored.

4. Clauge-inspired mode shell is retained as the product information architecture.
   - Left mode rail: Terminal, Agents, Workspace, Review, Git, Context, History, Settings.
   - Center work surface owns the active work.
   - Right inspector explains and acts on the selected pane, agent, task, file, risk, or evidence item.
   - The app should not expand into broad REST/SQL/NoSQL/S3 scope until the terminal/agent/review loop is excellent.

5. Performance is measured as a release gate.
   - Cold start, pane split, pane close, new shell, AI CLI attach, input latency, paste latency, and scrollback operations have budgeted smoke tests.
   - Visual QA includes contrast, resize, nonblank pixel checks, and no-flash/no-popup checks.

6. Sleep/resume becomes a high-priority reliability gate, not a full-native ideology gate.
   - Real Windows sleep/resume dogfood remains important.
   - It proves recovery and visual/focus stability of the native-first terminal path.
   - It should not be interpreted as "React must be deleted everywhere."

## Current Status

As of the latest full-native audit artifact:

- Native/Rust core product boundary: proven.
- Native terminal input, IME, paste guard, renderer proofs, settings data, Command Center data, mode shell, mode rail, inspector, right-rail demotion readiness, and UIA/accessibility proofs: complete in the strict audit.
- Strict full-native score: `98%`, `118/120`, `S`, `in-progress`.
- Remaining strict full-native blocker: real Windows sleep/resume native visual dogfood.

For the revised native-first hybrid goal, the remaining work is not "delete React." The remaining work is:

- run the real Windows sleep/resume dogfood when explicitly opted in;
- keep `pnpm verify:native-first:audit` green as the release-goal audit;
- add or refresh performance budgets for pane split/close, shell launch, AI CLI launch, input, paste, and no-flash behavior;
- keep React/Tauri UI only where it is contract-backed and does not harm terminal UX.

## Release Audit

The native-first release gate is:

```powershell
pnpm verify:native-first:audit
```

This audit is intentionally different from `pnpm verify:full-native:audit`:

- `verify:native-first:audit` answers whether the revised release goal is met.
- `verify:full-native:audit` answers whether the optional strict full-native stretch goal is met.
- A native-first release can pass while strict full-native remains `in-progress`, as long as React/Tauri/WebView does not own terminal truth and all remaining compatibility surfaces are contract-backed.

Real Windows sleep/resume remains an important host dogfood, but it is explicitly opt-in because it disrupts the machine. The native-first implementation audit accepts the fail-closed sleep guard and postcheck write smoke as implementation confidence; strict full-native still requires the real machine sleep/resume cycle.

When the host rejects automated sleep entry, use the user-initiated gate instead:

```powershell
pnpm verify:production:suspend:native-user-cycle
```

This command does not force Windows to sleep. It arms native evidence, waits while the operator manually sleeps and wakes the machine, then runs native post-resume probes and System power-event validation before the release score can move past the external sleep gate.

## 2026-05-26 Native-First Audit Baseline

- Added `scripts/verify-native-first-hybrid-audit.mjs`.
- Added package script `pnpm verify:native-first:audit`.
- Current result: `100/100`, grade `S`, `nativeFirstHybridReady=true`, `implementationConfidence=high`.
- This result does not claim strict full-native completion. It records `fullNativeRequiredForRelease=false`, `strictFullNativeStretchReady=false`, and `realMachineSleepExecuted=false`.
- The remaining strict stretch item is still real Windows sleep/resume dogfood with `AETHER_ALLOW_OS_SLEEP=1`.
- The native-first release confidence is based on Rust product truth, native terminal hot path, mux/session performance, Clauge-inspired mode architecture, native visual/accessibility proof, host-power safety guard, and current hybrid release score.

## 2026-05-27 Final Implementation Goal

The detailed final implementation plan is now fixed in:

- `docs/history/NATIVE_FIRST_HYBRID_FINAL_IMPLEMENTATION_PLAN_2026-05-27.md`

The authoritative implementation completion command is:

```powershell
pnpm verify:native-first:audit
```

Current native-first implementation target:

- `pnpm verify:native-first:audit`
- required result: `100/100`, grade `S`, `nativeFirstHybridReady=true`

This is an implementation-confidence claim, not a public release/distribution claim. The broader release-quality score currently also tracks release-operation gates, and those must stay visible instead of being confused with the implementation target. The remaining release-operation gates are still tracked separately:

- signed distribution artifacts and installer;
- actual Windows sleep/resume dogfood with explicit opt-in;
- clean-shutdown runtime hygiene after dev/CDP processes are closed;
- npm registry-backed supply-chain audit when network access is available;
- live Tauri/CDP chaos proof when CDP is running;
- optional authenticated AI CLI prompt execution with explicit token-spend consent;
- final release self-reference loop for the broader release score.

## Terminology Going Forward

Use these terms:

- `native-first hybrid`: the release target.
- `Rust product truth`: Rust owns durable state and terminal/agent contracts.
- `terminal hot path`: rendering, input, IME, clipboard, paste, PTY, pane lifecycle, scrollback, process launch.
- `compatibility surface`: React/Tauri/WebView UI that is allowed because it is bounded and contract-backed.
- `full-native Rust`: optional stretch goal, not the release requirement.
