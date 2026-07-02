# Vendored Rust Crates

## portable-pty 0.8.1

Status: patched vendor fork, not pristine.

Source: crates.io `portable-pty 0.8.1`, repository
`https://github.com/wez/wezterm`.

Verification command used on 2026-07-02:

```powershell
$up=(Get-ChildItem -Recurse -Directory "$env:USERPROFILE\.cargo\registry\src" -Filter 'portable-pty-0.8.1' | Select-Object -First 1).FullName
git diff --no-index -- "$up" "src-tauri\vendor\portable-pty-0.8.1"
```

Intentional patch summary:

- `Cargo.toml`: makes `serial` optional and adds `serial_support`.
- `src/lib.rs`: gates `pub mod serial` behind `serial_support`.
- `src/win/psuedocon.rs`: adds `STARTF_USESHOWWINDOW` and `SW_HIDE` so
  ConPTY child process windows stay hidden.

Reason for vendoring:

Aelyris is Windows-first and embeds PTY behavior in visible panes. The fork keeps
the Windows ConPTY child-window behavior stable while avoiding an unconditional
`serial` runtime dependency from the PTY path.

Update decision:

`cargo info portable-pty@0.8.1` reports latest `0.9.0`. Before release, evaluate
`portable-pty 0.9.0` against the same ConPTY child-window hiding behavior and the
serial dependency shape. If 0.9.0 preserves both contracts, prefer upstream. If
the fork remains necessary, rebase this vendor directory and refresh this README
with the new diff summary.
