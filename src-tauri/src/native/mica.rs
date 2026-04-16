//! Mica backdrop + dark mode for Windows 11.

use winit::window::Window;

/// Enable Mica backdrop + extend frame for transparency on Windows 11.
#[cfg(windows)]
pub fn enable_mica_effect(window: &Window) {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE,
        DWMWA_USE_IMMERSIVE_DARK_MODE, DWM_SYSTEMBACKDROP_TYPE,
    };
    use windows::Win32::UI::Controls::MARGINS;

    let handle = match window.window_handle() {
        Ok(h) => h,
        Err(_) => return,
    };
    let raw = handle.as_raw();
    let hwnd = match raw {
        raw_window_handle::RawWindowHandle::Win32(h) => HWND(h.hwnd.get() as *mut _),
        _ => return,
    };

    // SAFETY: hwnd is a valid Win32 window handle obtained from winit's
    // HasWindowHandle. DWM APIs are thread-safe. Pointer arguments point
    // to stack variables that outlive the call, with correct size parameters.
    unsafe {
        let dark_mode: i32 = 1;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const _ as *const _,
            4,
        );

        let margins = MARGINS {
            cxLeftWidth: -1,
            cxRightWidth: -1,
            cyTopHeight: -1,
            cyBottomHeight: -1,
        };
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);

        let backdrop_type = DWM_SYSTEMBACKDROP_TYPE(2);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop_type as *const _ as *const _,
            std::mem::size_of::<DWM_SYSTEMBACKDROP_TYPE>() as u32,
        );
    }
    log::info!("Mica backdrop + dark mode enabled");
}

#[cfg(not(windows))]
pub fn enable_mica_effect(_window: &Window) {}
