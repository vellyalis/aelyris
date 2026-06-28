# Security Policy

## Supported Versions

Aether Terminal is currently in alpha development. No stable public release is
supported yet.

Security fixes are handled on the default development line until a supported
release channel exists.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability before it has
been triaged.

Use a private GitHub security advisory when available. If that is not available
for the repository, contact the maintainers through a private channel and
include:

- affected commit or version,
- operating system and environment,
- steps to reproduce,
- expected and actual behavior,
- impact assessment,
- whether credentials, tokens, local files, or command execution are involved.

## Security Boundaries

Aether works near several sensitive boundaries:

- local shell and PTY execution,
- project file access,
- Git and worktree operations,
- AI CLI process launches,
- token-spending authenticated AI prompts,
- MCP/control-plane commands,
- release signing/updater material.

Authenticated AI prompt smoke tests must remain opt-in and must not run unless
the operator explicitly sets the documented consent environment variables.

Never commit secrets, `.env` files, generated updater private keys, local API
tokens, terminal transcripts containing credentials, or machine-specific signing
material.

## Current Public-Readiness Status

The project is not release-ready. Release and world-class product claims remain
gated by machine-readable verifier artifacts under `.codex-auto/quality/` and
the scripts in `package.json`.
