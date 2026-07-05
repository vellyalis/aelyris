use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=app.manifest");

    if !cfg!(windows) {
        return;
    }

    let manifest = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo"),
    )
    .join("app.manifest");

    println!("cargo:rustc-link-arg-bins=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-bins=/MANIFESTINPUT:{}",
        manifest.display()
    );
}
