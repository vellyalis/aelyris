fn main() {
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
