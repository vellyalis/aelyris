// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Force grayscale AA instead of ClearType — ClearType breaks on transparent windows
    // because it needs a known background color for subpixel blending.
    // Must be set BEFORE WebView2 initializes.
    let mut browser_args =
        std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    for arg in ["--disable-lcd-text", "--force-color-profile=srgb"] {
        if !browser_args.contains(arg) {
            if !browser_args.is_empty() {
                browser_args.push(' ');
            }
            browser_args.push_str(arg);
        }
    }
    // Remote debugging (CDP) is OPT-IN. Enabling --remote-debugging-port forces WebView2 into a
    // compositing path that SUPPRESSES the transparent/acrylic backdrop, so the dev window
    // renders OPAQUE gray (the desktop no longer shows through). Default dev therefore keeps
    // its Win11 acrylic translucency; set AETHER_ENABLE_WEBVIEW2_CDP=1 only when you need a CDP
    // endpoint for E2E/inspection (and accept the opaque window for that run).
    if cfg!(debug_assertions) && std::env::var("AETHER_ENABLE_WEBVIEW2_CDP").as_deref() == Ok("1") {
        for arg in ["--remote-debugging-port=9222", "--remote-allow-origins=*"] {
            if !browser_args.contains(arg) {
                if !browser_args.is_empty() {
                    browser_args.push(' ');
                }
                browser_args.push_str(arg);
            }
        }
    }
    unsafe {
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", browser_args);
    }
    aether_terminal_lib::run()
}
