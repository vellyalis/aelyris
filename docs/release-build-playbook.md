# Aelyris Release Build Playbook

This playbook is the human smoke path paired with `pnpm.cmd verify:release:doctor`.
It deliberately separates local unsigned artifact checks from signed updater releases.

Current P2-08 release evidence is `p2-08-manual-signed-updater-installer-smoke-1778032175470`.
Do not rerun P2-08 release validation unless source or distribution artifacts have changed.

## Local Unsigned Artifact Gate

Use this path before handing a build to a tester on the same Windows machine.

`pnpm.cmd build` is intentionally Windows spawn-safe: the script sets
`AELYRIS_VITE_NO_ESBUILD_SPAWN=1`, loads `scripts/vite-windows-net-use-shim.cjs`,
and runs Vite with `--configLoader native` so endpoint-protected hosts do not
stall on esbuild or `net use` process creation before the bundle is produced.

1. Run `pnpm.cmd verify:release:preflight`.
2. Run `pnpm.cmd tauri:build:dist` when source changes need a fresh bundle.
3. Run `pnpm.cmd verify:dist`.
4. Run `pnpm.cmd verify:release:doctor`.
5. Record the generated report from `.codex-auto/release-doctor/p2-08-release-doctor.json`.

Expected local artifacts for the current version (bundle and binary names follow
the app `productName` / binary config in `tauri.conf.json`; they update when the
app-config rename lands):

- `src-tauri/target/release/Aelyris.exe`
- `src-tauri/target/release/bundle/nsis/Aelyris_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Aelyris_<version>_x64_en-US.msi`

## Signed Updater Release Gate

Use this path only when publishing an update channel.

1. Generate or retrieve updater signing material with `scripts/setup-updater-keys.mjs`.
2. Replace the placeholder `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
3. Build with updater signing enabled and `TAURI_SIGNING_PRIVATE_KEY` available.
4. Confirm `.sig` files exist beside the Windows installer artifacts.
5. Generate `latest.json` with `node scripts/generate-update-manifest.mjs --version <version>`.
6. Run `pnpm.cmd verify:release:doctor -- --strict-signing`.

Do not publish a signed release when the doctor reports placeholder pubkey, missing signatures, or a stale `latest.json`.

For the current local signed-updater smoke, Codex generated a local updater key, configured a non-placeholder pubkey, signed the NSIS/MSI artifacts, generated `latest.json`, and passed strict signing validation. Before public release, preserve the local key/password securely or rotate the updater pubkey and regenerate signatures.

## Production Confidence Gate

Use this path before calling a build public-release ready.

1. Start the live Tauri/WebView2 validation environment with CDP enabled when fresh live proof is required.
2. Run `pnpm.cmd verify:release:production -- --fresh-live` to require fresh live workstation and IME proof.
3. If the host cannot safely perform a fresh live smoke, run `pnpm.cmd verify:release:production` and attach the latest passing `.codex-auto/production-smoke/*.json` evidence to the release record.
4. Confirm `.codex-auto/release-doctor/supply-chain-audit.json` reports zero known npm and Rust vulnerabilities.
5. Review any accepted low-risk controls in the Release Doctor `Known Risks` section before publishing.

### Real Windows Sleep/Resume Gate

Use the user-initiated sleep cycle when `SetSuspendState` is rejected by the host, such as on S0 Modern Standby machines that report `GetLastError=50`.

1. Run `pnpm verify:production:suspend:native-preflight` (`pnpm.cmd` is fine from direct Windows shells).
2. Run `pnpm verify:production:suspend:native-user-cycle`.
3. While the verifier is waiting, put Windows to sleep manually from Start menu, lid close, or the power button.
4. Wake the machine and let the verifier continue through native resume, post-resume probes, and Windows System power-event validation.
5. Close the evidence loop with `pnpm verify:goal:operator-finish`, `pnpm verify:goal:finalize`, `pnpm verify:goal:safe`, and `pnpm verify:goal:closeout`.

The user-initiated cycle never calls the Windows sleep API itself. It only arms evidence, waits for real suspend/resume power events, runs native postcheck probes, and refuses to mark the gate passed if the event pair is missing.

## Install Smoke

The install smoke is intentionally manual because it modifies the local Windows install state.
Run it only on a test machine or after explicit approval.

1. Install the NSIS setup exe for the current version.
2. Confirm Start menu and application shortcut creation when the installer offers it.
3. Launch Aelyris from the installed location.
4. Confirm no crash dialog, blank WebView, or missing icon appears.

## First Launch Smoke

On first launch after install:

1. Open the project workspace picker or the current workspace.
2. Confirm the terminal area renders and accepts a PowerShell command.
3. Type Japanese text through IME in the terminal and confirm no stuck preedit text remains.
4. Open Settings and close it.
5. Confirm the dashboard URL in `.codex-auto/current-dashboard.json` opens and reports this workspace.
6. Confirm the terminal, dashboard, and status bar do not report contradictory blocker or completion state.

## MSI Smoke

Use the MSI when enterprise packaging behavior matters.

1. Install the MSI for the current version.
2. Launch Aelyris from the installed application entry.
3. Repeat the First Launch Smoke.
4. Confirm the MSI appears in Windows installed apps inventory.

P2-08 local evidence used Windows Installer COM metadata for MSI ProductName/ProductVersion/ProductCode/UpgradeCode after administrative extraction timed out. Run a full MSI install on a clean VM before enterprise distribution.

## Uninstall Smoke

The uninstall smoke is also manual because it removes installed software.

1. Uninstall Aelyris through Windows installed apps or the installer uninstall path.
2. Confirm the installed executable and shortcuts are removed.
3. Confirm user workspace files are not removed.
4. Reinstall the current artifact if continuing release validation.

## Rollback

Keep at least one previous NSIS or MSI artifact in `src-tauri/target/release/bundle` until the new release is accepted.

First-release rollback escrow:

When there is no previous public installer, do not fabricate a fake previous artifact. Keep the current signed installer, MSI, `.sig` files, `latest.json`, Release Doctor report, and quality score artifact together as the rollback escrow. If the first public build fails before acceptance, disable the updater endpoint, uninstall the current version, and reinstall only from the current signed installer after the failed artifact is quarantined for investigation.

Rollback path:

1. Uninstall the current version.
2. Install the previous known-good installer artifact.
3. Launch Aelyris and repeat First Launch Smoke.
4. Keep the current failed artifact and Release Doctor report for investigation.

## Crash Log Review

Before declaring a release candidate, check the Release Doctor crash-log section.
Review any `.dmp` or `.crash` files and inspect recent non-empty `.err.log` files under `.codex-auto/logs`.

## Final Goal Handoff

Before commit/merge handoff, run `pnpm verify:goal:git-finalization`. It checks `.git/index.lock`, `.git/objects`, and `git add -A --dry-run` readiness without staging, committing, merging, pushing, mutating ACLs, or deleting lock files. The readiness artifact also records a non-destructive handoff block with the current source branch, target branch, commit message, worktree status summary, and exact post-repair commands. Use that handoff only after ACL repair and after rerunning `pnpm verify:goal:git-finalization`.

When the Node verifier can only report `spawn EPERM`, run the direct shell companion:

```powershell
pnpm.cmd verify:goal:git-finalization:shell
```

It writes `.codex-auto/quality/git-finalization-shell-diagnostics.json` with the current user, group, ACL, `icacls`, index-lock, and direct `git add -A --dry-run` evidence. The shell diagnostic is also non-destructive: it does not stage, commit, merge, push, mutate ACLs, delete lock files, or persist Git metadata changes; Git may attempt a transient index lock during dry-run.

If that verifier reports `.git/index.lock` or `.git/objects` `EPERM`, inspect the metadata ACL before retrying Git. On Windows, Deny ACEs override owner/Admin allow entries and can block staging even when the worktree files are writable:

```powershell
whoami /user
whoami /groups
Get-Acl .git, .git\index, .git\objects | Format-List Path, Owner, AccessToString
icacls .git
icacls .git\index
icacls .git\objects
git add -A --dry-run
```

Compare the `whoami` SID/group output against the Deny SIDs before deciding what to remove. If `git add -A --dry-run` still reports `index.lock` `Permission denied` after SID review, run finalization from a non-sandbox owner/admin shell or repair the repository metadata ACL there. Remove only the reviewed Deny ACEs on `.git` metadata from an owner/admin PowerShell, then rerun `pnpm verify:goal:git-finalization` before `git add -A`. The verifier artifact includes this ACL diagnostic runbook so the handoff does not collapse into a generic permission error.

Run `pnpm verify:goal:operator-finish` first for the final external gates. Without exact opt-in environment variables it only writes a no-token/no-sleep handoff artifact.

After either external gate, close the evidence loop with `pnpm verify:goal:operator-finish`, `pnpm verify:goal:finalize`, `pnpm verify:goal:safe`, and `pnpm verify:goal:closeout`.

## Release Notes

Release notes must include:

- version
- date
- artifact names
- validation commands run
- known risks that remain open
- rollback target version
