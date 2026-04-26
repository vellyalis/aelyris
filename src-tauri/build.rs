fn main() {
    // Embed Windows resource metadata (FileDescription, ProductName,
    // OriginalFilename, etc.) into the dev .exe so Task Manager / right-
    // click → Properties show "Aether Terminal" instead of just the bare
    // `aether-terminal.exe`. tauri-build's own bundle path only emits
    // these for release artefacts. Skipping silently on non-Windows.
    #[cfg(windows)]
    {
        let mut res = tauri_winres::WindowsResource::new();
        res.set("ProductName", "Aether Terminal");
        res.set("FileDescription", "Aether Terminal");
        res.set("OriginalFilename", "aether-terminal.exe");
        res.set("CompanyName", "Aether");
        res.set("LegalCopyright", "Copyright (c) 2026 Aether");
        res.set("InternalName", "aether-terminal");
        res.set_icon("icons/icon.ico");
        if let Err(err) = res.compile() {
            // Non-fatal — the .exe still builds without resources, just
            // less identifiable in Task Manager. Surface so we notice if
            // it ever starts failing in CI.
            println!("cargo:warning=tauri-winres compile failed: {err}");
        }
    }

    tauri_build::build()
}
