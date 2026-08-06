fn main() {
    #[cfg(target_os = "windows")]
    {
        // Integration-test executables link Tauri's Windows dialog path, which
        // imports TaskDialogIndirect from Common Controls v6. Unlike the bundled
        // app binary, Cargo test binaries do not pass through tauri-winres, so
        // without an explicit test-only manifest Windows binds comctl32 v5 and
        // exits before the test harness starts with STATUS_ENTRYPOINT_NOT_FOUND.
        let manifest_path = std::path::PathBuf::from(
            std::env::var_os("OUT_DIR").expect("Cargo must provide OUT_DIR to build.rs"),
        )
        .join("aelyris-test-common-controls.manifest");
        std::fs::write(
            &manifest_path,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#,
        )
        .expect("write Windows integration-test manifest");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest_path.display()
        );
    }

    /* `tauri_build::build()` already invokes `tauri-winres` internally on
     * Windows, deriving FileDescription / ProductName / etc. from the
     * `productName` + `bundle.copyright` + `bundle.publisher` fields in
     * `tauri.conf.json`. The earlier custom `tauri_winres::WindowsResource`
     * step here was a duplicate compile that overwrote and was overwritten
     * by Tauri's path (Codex review 2026-05-03 round 4 caught the
     * conflict — both writers target `OUT_DIR/resource.lib`). The
     * metadata now lives in `tauri.conf.json` exclusively, which is also
     * where the bundler reads it, so release artefacts and `cargo run`
     * stay in sync.
     *
     * If we ever need fields Tauri doesn't surface (e.g. an additional
     * StringFileInfo entry), the right hook is `[bundle.windows]` in
     * `tauri.conf.json` or a Tauri build attribute — NOT a second
     * tauri-winres compile here.
     */
    tauri_build::build()
}
