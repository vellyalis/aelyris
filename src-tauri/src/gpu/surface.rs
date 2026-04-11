//! Child HWND creation and wgpu Surface management.
//!
//! Creates a Win32 child window inside the Tauri parent window,
//! attaches a wgpu Surface for GPU-accelerated terminal rendering,
//! and handles repositioning/resizing.

#[cfg(windows)]
use windows::Win32::Foundation::HWND;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::*;
#[cfg(windows)]
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(windows)]
use windows::core::w;

/// Manages a native child window + wgpu surface for one terminal pane.
pub struct TerminalSurface {
    #[cfg(windows)]
    hwnd: HWND,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    surface: Option<wgpu::Surface<'static>>,
    surface_config: Option<wgpu::SurfaceConfiguration>,
}

impl TerminalSurface {
    /// Create a child HWND inside the given parent Tauri window and attach a wgpu surface.
    #[cfg(windows)]
    pub fn new(
        parent_window: &tauri::Window,
        instance: &wgpu::Instance,
        adapter: &wgpu::Adapter,
        device: &wgpu::Device,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<Self, String> {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        // Get parent HWND from Tauri window
        let parent_handle = parent_window.window_handle()
            .map_err(|e| format!("Failed to get window handle: {}", e))?;
        let parent_hwnd = match parent_handle.as_raw() {
            RawWindowHandle::Win32(h) => HWND(h.hwnd.get() as *mut _),
            _ => return Err("Not a Win32 window".to_string()),
        };

        // Register a window class for the terminal surface
        let hinstance = unsafe { GetModuleHandleW(None).map_err(|e| format!("GetModuleHandle: {}", e))? };

        let class_name = w!("AetherTerminalSurface");
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_OWNDC,
            lpfnWndProc: Some(Self::wnd_proc),
            hInstance: hinstance.into(),
            lpszClassName: class_name,
            ..Default::default()
        };

        // RegisterClass may fail if already registered — that's fine
        unsafe { RegisterClassExW(&wc) };

        // Create child window
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                class_name,
                w!(""),
                WS_CHILD | WS_VISIBLE,
                x, y, width, height,
                Some(parent_hwnd),
                None,
                Some(hinstance.into()),
                None,
            ).map_err(|e| format!("CreateWindowExW: {}", e))?
        };

        // Create wgpu surface from the child HWND
        let surface = unsafe {
            let target = wgpu::SurfaceTargetUnsafe::RawHandle {
                raw_display_handle: raw_window_handle::RawDisplayHandle::Windows(
                    raw_window_handle::WindowsDisplayHandle::new()
                ),
                raw_window_handle: raw_window_handle::RawWindowHandle::Win32({
                    let mut h = raw_window_handle::Win32WindowHandle::new(
                        std::num::NonZero::new(hwnd.0 as isize).unwrap()
                    );
                    h.hinstance = std::num::NonZero::new(hinstance.0 as isize);
                    h
                }),
            };
            instance.create_surface_unsafe(target)
                .map_err(|e| format!("create_surface: {}", e))?
        };

        // Configure surface
        let caps = surface.get_capabilities(adapter);
        let format = caps.formats.iter()
            .find(|f| **f == wgpu::TextureFormat::Bgra8Unorm)
            .or_else(|| caps.formats.first())
            .copied()
            .unwrap_or(wgpu::TextureFormat::Bgra8Unorm);

        let alpha_mode = if caps.alpha_modes.contains(&wgpu::CompositeAlphaMode::PreMultiplied) {
            wgpu::CompositeAlphaMode::PreMultiplied
        } else {
            caps.alpha_modes.first().copied().unwrap_or(wgpu::CompositeAlphaMode::Auto)
        };

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: width.max(1) as u32,
            height: height.max(1) as u32,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(device, &config);

        log::info!("TerminalSurface created: {}x{} format={:?} alpha={:?}", width, height, format, alpha_mode);

        Ok(Self {
            hwnd,
            x, y, width, height,
            surface: Some(surface),
            surface_config: Some(config),
        })
    }

    /// Reposition and resize the child window + reconfigure surface.
    #[cfg(windows)]
    pub fn reposition(&mut self, device: &wgpu::Device, x: i32, y: i32, width: i32, height: i32) {
        self.x = x;
        self.y = y;
        self.width = width;
        self.height = height;

        unsafe {
            let _ = MoveWindow(self.hwnd, x, y, width, height, true);
        }

        // Reconfigure surface with new size
        if let (Some(surface), Some(config)) = (&self.surface, &mut self.surface_config) {
            config.width = width.max(1) as u32;
            config.height = height.max(1) as u32;
            surface.configure(device, config);
        }
    }

    /// Get the current surface texture for rendering.
    pub fn get_current_texture(&self) -> Result<wgpu::SurfaceTexture, wgpu::SurfaceError> {
        self.surface.as_ref()
            .ok_or(wgpu::SurfaceError::Lost)?
            .get_current_texture()
    }

    /// Show or hide the child window.
    #[cfg(windows)]
    pub fn set_visible(&self, visible: bool) {
        unsafe {
            let _ = ShowWindow(self.hwnd, if visible { SW_SHOW } else { SW_HIDE });
        }
    }

    /// Win32 window procedure for the child window.
    #[cfg(windows)]
    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: windows::Win32::Foundation::WPARAM,
        lparam: windows::Win32::Foundation::LPARAM,
    ) -> windows::Win32::Foundation::LRESULT {
        // Default handling — input events will be intercepted in Phase 5
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    /// Placeholder for non-Windows (won't compile on other platforms anyway for now).
    #[cfg(not(windows))]
    pub fn new_placeholder(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self { x, y, width, height, surface: None, surface_config: None }
    }

    #[cfg(not(windows))]
    pub fn reposition(&mut self, _device: &wgpu::Device, x: i32, y: i32, width: i32, height: i32) {
        self.x = x; self.y = y; self.width = width; self.height = height;
    }
}

#[cfg(windows)]
impl Drop for TerminalSurface {
    fn drop(&mut self) {
        // Drop surface before destroying window
        self.surface = None;
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }
}
