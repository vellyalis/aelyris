// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force grayscale AA instead of ClearType — ClearType breaks on transparent windows
    // because it needs a known background color for subpixel blending.
    // Must be set BEFORE WebView2 initializes.
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-lcd-text --force-color-profile=srgb",
        );
    }
    aether_terminal_lib::run()
}
