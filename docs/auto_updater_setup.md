# Auto-updater setup

> Status: wired in v0.2.3 (Tier 🔴 #3 from `ROADMAP_POST_0_2_2.md`).
> Out-of-the-box behaviour is **disabled** because Aether is local-only —
> the placeholder pubkey + endpoint shipped in `tauri.conf.json` cannot
> verify or fetch a real release. This file is the one-time setup
> playbook for switching the placeholder for a real key + endpoint when
> Aether is ready to ship signed updates.

## What's wired today

- `tauri-plugin-updater = "2"` is registered in `src-tauri/src/lib.rs`.
- `tauri.conf.json` has a `plugins.updater` block with placeholder pubkey
  and endpoint (`https://updates.aether.invalid/...`). The `.invalid`
  TLD is RFC 2606 — guaranteed not to resolve.
- `bundle.createUpdaterArtifacts = true`, so a signed `.sig` file is
  emitted next to each MSI / NSIS installer if the Tauri build sees a
  signing key in the environment.
- The frontend renders an `UpdateBanner` at the top of the app shell
  (auto-checks once on mount, silent on errors) and exposes a manual
  "Check for updates" button in Settings → Updates.

Until you complete the steps below, both surfaces stay quiet — there is
nothing reachable to advertise updates.

## Step 1: generate a signing keypair

```bash
node scripts/setup-updater-keys.mjs
```

The script:

1. Generates an Ed25519 keypair via `pnpm exec tauri signer generate`.
2. Writes `aether-updater.key` (private) + `aether-updater.key.pub`
   under `<repo>/.aether-updater/`. That directory is in `.gitignore`.
3. Prints the public key and the exact JSON edit needed in
   `src-tauri/tauri.conf.json`.

After running it, edit `src-tauri/tauri.conf.json`:

```diff
   "plugins": {
     "updater": {
       "endpoints": [...],
-      "pubkey": "REPLACE_VIA_SCRIPTS_SETUP_UPDATER_KEYS",
+      "pubkey": "<value the script printed>",
       "windows": { "installMode": "passive" }
     }
   }
```

Commit the pubkey change. **Do not** commit the contents of
`.aether-updater/` — the script enforces this by writing under a
gitignored path.

## Step 2: configure the endpoint

The placeholder URL is `https://updates.aether.invalid/...`. Replace it
with whichever scheme matches how you ship Aether:

| Scenario | Endpoint URL |
|----------|--------------|
| Local-only smoke test | `file://C:/path/to/latest.json` |
| GitHub Releases | `https://github.com/<org>/<repo>/releases/latest/download/latest.json` |
| Custom static host | `https://your.cdn/{{target}}/{{current_version}}` |

Tauri substitutes `{{target}}` (e.g. `windows-x86_64`) and
`{{current_version}}` at request time, so the URL can fan out to
per-target endpoints if your release pipeline produces them.

## Step 3: signed release build

```bash
# PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content '.aether-updater/aether-updater.key' -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<your-password>'
pnpm tauri build
```

```bash
# Bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat .aether-updater/aether-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='<your-password>'
pnpm tauri build
```

This produces:

- `src-tauri/target/release/bundle/nsis/Aether Terminal_<v>_x64-setup.exe`
- `src-tauri/target/release/bundle/nsis/Aether Terminal_<v>_x64-setup.exe.sig`
- `src-tauri/target/release/bundle/msi/Aether Terminal_<v>_x64_en-US.msi`
- `src-tauri/target/release/bundle/msi/Aether Terminal_<v>_x64_en-US.msi.sig`

If the `.sig` files are missing, the env vars were not seen — Tauri
silently falls back to unsigned bundles. Re-run the build with the
env vars set in the same shell.

## Step 4: emit the manifest

```bash
node scripts/generate-update-manifest.mjs \
  --version 0.2.3 \
  --notes-file docs/release-notes/0.2.3.md \
  --download-base https://your.cdn/aether/0.2.3
```

The script reads the NSIS installer + its `.sig`, then writes
`src-tauri/target/release/bundle/latest.json` matching the format the
plugin expects:

```json
{
  "version": "0.2.3",
  "notes": "...",
  "pub_date": "2026-04-26T...",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of .sig>",
      "url": "https://your.cdn/aether/0.2.3/Aether Terminal_0.2.3_x64-setup.exe"
    }
  }
}
```

Upload `latest.json` + the installer + the `.sig` to the configured
endpoint host. Order matters only insofar as the manifest must be
fetchable before the next user starts the app.

## Smoke-testing locally (file:// endpoint)

1. Set `endpoints[0]` to a `file:///C:/.../latest.json` URL pointing at
   the manifest produced above.
2. In `src-tauri/tauri.conf.json`, bump `version` to a value lower than
   the manifest's `version` (so the running build is "behind").
3. `pnpm tauri build`, install the result, and launch.
4. The banner should appear within seconds; clicking
   "Install & restart" should download the bundle, run the NSIS
   passive installer, and bring the new version up.

## Risks + non-goals

- **Local-only by default.** The roadmap's risk note still applies:
  there is no public update host. The wiring exists so a future release
  can ship without re-architecting; until an endpoint is picked, the
  banner stays silent.
- **No telemetry on update outcomes.** Aether avoids on-by-default
  telemetry per the strategic direction memo. If we ever need to know
  whether an update install succeeded, that's an opt-in addition.
- **Key rotation is destructive.** Once a release goes out signed by
  key A, every subsequent release must be signed by key A — installed
  builds will reject manifests signed by anything else. Plan accordingly.
