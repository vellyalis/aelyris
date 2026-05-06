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
    #[cfg(debug_assertions)]
    for arg in ["--remote-debugging-port=9222", "--remote-allow-origins=*"] {
        if !browser_args.contains(arg) {
            if !browser_args.is_empty() {
                browser_args.push(' ');
            }
            browser_args.push_str(arg);
        }
    }
    unsafe {
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", browser_args);
    }
    aether_terminal_lib::run()
}
