//! Application config and watchdog rule command handlers.
//!
//! Thin wrappers over `crate::config` and `crate::watchdog` persistence.
//! Extracted verbatim from `commands.rs` during the IPC god-file split.

use std::path::{Path, PathBuf};

/// Load app config
#[tauri::command]
pub fn load_app_config() -> crate::config::AppConfig {
    crate::config::load_config()
}

/// Directory under `$HOME/.aelyris` where picked wallpaper images are copied so
/// they fall inside the Tauri `assetProtocol.scope` (`$HOME/**`). Mirrors the
/// `config_path()` home resolution in `config/settings.rs`.
fn wallpapers_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".aelyris").join("wallpapers")
}

/// Content-addressed destination name for a wallpaper copy: `<sha256>.<ext>`.
/// Re-selecting the same image yields the same name (idempotent), and the
/// original filename never leaks into app data. Only known image extensions
/// are honored; anything else falls back to `png`.
fn wallpaper_dest_name(bytes: &[u8], src: &Path) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let hash_hex = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif"))
        .unwrap_or_else(|| "png".to_string());
    format!("{hash_hex}.{ext}")
}

/// Copy a picked image into `dir`, returning the destination path. Pure with
/// respect to the target directory so it is testable without env mutation.
fn copy_wallpaper_into(src: &Path, dir: &Path) -> Result<String, String> {
    if !src.is_file() {
        return Err(format!("not a file: {}", src.display()));
    }
    let bytes = std::fs::read(src).map_err(|e| format!("read source image: {e}"))?;
    // Cap at 25 MiB so a stray huge file can't be copied into app data.
    if bytes.len() > 25 * 1024 * 1024 {
        return Err("image too large (>25MB)".to_string());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("create wallpapers dir: {e}"))?;
    let dest = dir.join(wallpaper_dest_name(&bytes, src));
    if !dest.exists() {
        std::fs::write(&dest, &bytes).map_err(|e| format!("write wallpaper copy: {e}"))?;
    }
    Ok(dest.to_string_lossy().to_string())
}

/// Copy a user-picked wallpaper image into the app-data wallpapers dir under
/// `$HOME` and return the in-scope destination path. The picker can point at
/// any drive, but `assetProtocol.scope` only allows `$HOME/**`; copying keeps
/// the scope tight while letting the stored `imagePath` resolve via the asset
/// protocol. Idempotent: identical bytes hash to the same destination name.
#[tauri::command]
pub fn persist_wallpaper_image(src: String) -> Result<String, String> {
    copy_wallpaper_into(Path::new(&src), &wallpapers_dir())
}

#[cfg(test)]
mod wallpaper_tests {
    use super::*;

    #[test]
    fn dest_name_is_content_addressed_and_ext_safe() {
        let bytes = b"hello-pixels";
        let png = wallpaper_dest_name(bytes, Path::new("C:/x/photo.PNG"));
        assert!(png.ends_with(".png"));
        // Same bytes => same name regardless of source path.
        let png2 = wallpaper_dest_name(bytes, Path::new("D:/elsewhere/other.png"));
        assert_eq!(png, png2);
        // Unknown extension falls back to png.
        let exe = wallpaper_dest_name(bytes, Path::new("C:/x/payload.exe"));
        assert!(exe.ends_with(".png"));
        // Allowed non-png extension is preserved.
        let jpg = wallpaper_dest_name(bytes, Path::new("C:/x/shot.jpg"));
        assert!(jpg.ends_with(".jpg"));
    }

    #[test]
    fn copy_lands_in_scope_dir_and_is_idempotent() {
        let tmp = std::env::temp_dir().join(format!("aelyris-wp-test-{}", std::process::id()));
        let src = tmp.join("source.png");
        let dest_dir = tmp.join("wallpapers");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(&src, b"some-image-bytes").unwrap();

        let first = copy_wallpaper_into(&src, &dest_dir).unwrap();
        assert!(Path::new(&first).is_file());
        assert!(first.starts_with(&dest_dir.to_string_lossy().to_string()));
        // Idempotent: second call returns the same path without erroring.
        let second = copy_wallpaper_into(&src, &dest_dir).unwrap();
        assert_eq!(first, second);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn copy_rejects_missing_source() {
        let dir = std::env::temp_dir().join("aelyris-wp-missing");
        let err = copy_wallpaper_into(Path::new("C:/definitely/not/here.png"), &dir).unwrap_err();
        assert!(err.contains("not a file"));
    }
}

/// Save app config
#[tauri::command]
pub fn save_app_config(config: crate::config::AppConfig) -> Result<(), String> {
    crate::config::save_config(&config)
}

/// Apply the window backdrop (Acrylic/Mica) to the main window live, without a
/// restart. The frontend calls this right after `save_app_config` so toggling
/// Settings → Window Effect takes effect immediately instead of only at the next
/// launch. The same `apply_window_backdrop` helper runs at startup, so behavior
/// is identical. On non-Windows platforms this is a no-op that succeeds.
#[tauri::command]
pub fn set_window_effect(app: tauri::AppHandle, effect: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        // Respect the same opt-out the startup path honors (lib.rs setup
        // closure). Without this, saving settings would re-enable direct DWM
        // HWND mutation even for an operator who explicitly disabled it.
        if std::env::var("AELYRIS_DISABLE_DWM_CHROME").as_deref() == Ok("1") {
            log::info!("set_window_effect: skipped (AELYRIS_DISABLE_DWM_CHROME=1)");
            return Ok(());
        }
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        let hwnd_raw = window
            .hwnd()
            .map_err(|e| format!("hwnd unavailable for window effect: {e}"))?;
        let hwnd = windows::Win32::Foundation::HWND(hwnd_raw.0 as *mut _);
        crate::apply_window_backdrop(hwnd, &effect)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, effect);
        Ok(())
    }
}

/// Get watchdog rules
#[tauri::command]
pub fn get_watchdog_rules() -> crate::watchdog::WatchdogRules {
    crate::watchdog::load_watchdog_rules()
}

/// Save watchdog rules
#[tauri::command]
pub fn save_watchdog_rules(rules: crate::watchdog::WatchdogRules) -> Result<(), String> {
    crate::watchdog::save_watchdog_rules(&rules)
}

/// Create a named watchdog
#[tauri::command]
pub fn create_watchdog(name: String, instructions: String) -> Result<(), String> {
    crate::watchdog::create_watchdog(&name, &instructions)
}
