# Aether Terminal Release Build Playbook

This playbook is the human smoke path paired with `pnpm.cmd verify:release:doctor`.
It deliberately separates local unsigned artifact checks from signed updater releases.

Current P2-08 release evidence is `p2-08-manual-signed-updater-installer-smoke-1778032175470`.
Do not rerun P2-08 release validation unless source or distribution artifacts have changed.

## Local Unsigned Artifact Gate

Use this path before handing a build to a tester on the same Windows machine.

1. Run `pnpm.cmd verify:release:preflight`.
2. Run `pnpm.cmd tauri:build:dist` when source changes need a fresh bundle.
3. Run `pnpm.cmd verify:dist`.
4. Run `pnpm.cmd verify:release:doctor`.
5. Record the generated report from `.codex-auto/release-doctor/p2-08-release-doctor.json`.

Expected local artifacts for the current version:

- `src-tauri/target/release/aether-terminal.exe`
- `src-tauri/target/release/bundle/nsis/Aether Terminal_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Aether Terminal_<version>_x64_en-US.msi`

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

## Install Smoke

The install smoke is intentionally manual because it modifies the local Windows install state.
Run it only on a test machine or after explicit approval.

1. Install the NSIS setup exe for the current version.
2. Confirm Start menu and application shortcut creation when the installer offers it.
3. Launch Aether Terminal from the installed location.
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
2. Launch Aether Terminal from the installed application entry.
3. Repeat the First Launch Smoke.
4. Confirm the MSI appears in Windows installed apps inventory.

P2-08 local evidence used Windows Installer COM metadata for MSI ProductName/ProductVersion/ProductCode/UpgradeCode after administrative extraction timed out. Run a full MSI install on a clean VM before enterprise distribution.

## Uninstall Smoke

The uninstall smoke is also manual because it removes installed software.

1. Uninstall Aether Terminal through Windows installed apps or the installer uninstall path.
2. Confirm the installed executable and shortcuts are removed.
3. Confirm user workspace files are not removed.
4. Reinstall the current artifact if continuing release validation.

## Rollback

Keep at least one previous NSIS or MSI artifact in `src-tauri/target/release/bundle` until the new release is accepted.

Rollback path:

1. Uninstall the current version.
2. Install the previous known-good installer artifact.
3. Launch Aether Terminal and repeat First Launch Smoke.
4. Keep the current failed artifact and Release Doctor report for investigation.

## Crash Log Review

Before declaring a release candidate, check the Release Doctor crash-log section.
Review any `.dmp` or `.crash` files and inspect recent non-empty `.err.log` files under `.codex-auto/logs`.

## Release Notes

Release notes must include:

- version
- date
- artifact names
- validation commands run
- known risks that remain open
- rollback target version
