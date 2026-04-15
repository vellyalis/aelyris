//! Tauri IPC commands for the GPU terminal renderer.

use std::sync::Arc;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::{Grid, GridPerformer};
use crate::gpu::renderer::TerminalRenderer;
use crate::gpu::surface::TerminalSurface;
use crate::gpu::{GpuTerminal, GpuTerminalManager};
use crate::ipc::OutputBufferRegistry;
use crate::pty::{PtyManager, ShellType};

/// Spawn a GPU-rendered terminal session.
/// Creates PTY + Grid + wgpu Surface + Renderer, connects PTY→Grid directly.
#[tauri::command]
pub async fn gpu_spawn_terminal(
    app: AppHandle,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    // 1. Initialize wgpu if needed
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.ensure_wgpu().await?;

    // 2. Spawn PTY
    let pty_manager = app.state::<PtyManager>();
    let id = pty_manager.spawn(&shell, cols, rows, cwd.as_deref())?;
    let reader = pty_manager.take_reader(&id)?;
    let terminal_id = id.clone();
    let app_handle = app.clone();

    // 3. Create grid + font + atlas
    let font = FontManager::new(14.0, 1.4);
    let pixel_w = (cols as f32 * font.cell_width) as i32;
    let pixel_h = (rows as f32 * font.cell_height) as i32;
    let grid = Arc::new(Mutex::new(Grid::new(cols, rows, 10_000)));
    let atlas = Mutex::new(GlyphAtlas::new(2048, 2048));

    // 4. Create real Surface + Renderer using wgpu context
    let (surface, renderer) = {
        let (device, queue) = gpu_manager.device_and_queue()?;

        // Create Child HWND surface
        let surface = gpu_manager.with_wgpu(|instance, adapter, dev| {
            // Get parent window for Child HWND
            let parent = app.get_webview_window("main")
                .ok_or_else(|| "No main window".to_string());
            match parent {
                Ok(win) => TerminalSurface::new(&win, instance, adapter, dev, 0, 0, pixel_w.max(1), pixel_h.max(1)),
                Err(e) => Err(e),
            }
        })??;

        // Create GPU renderer pipeline
        let renderer = TerminalRenderer::new(
            device.clone(), queue.clone(),
            pixel_w.max(1) as u32, pixel_h.max(1) as u32,
        );

        (surface, renderer)
    };

    // 5. Register buffers
    let buffer_registry = app.state::<OutputBufferRegistry>().inner().clone();
    buffer_registry.create(&id);
    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let shell_name = format!("{:?}", shell).to_lowercase();
    pane_registry.register(&id, &shell_name, cwd.as_deref().unwrap_or("."));

    // 6. Store GPU terminal with real surface + renderer
    let gpu_terminal = GpuTerminal {
        grid: grid.clone(),
        atlas,
        font,
        surface: Arc::new(Mutex::new(surface)),
        cursor_render: Mutex::new(crate::gpu::cursor::CursorRender::new()),
        renderer: Arc::new(Mutex::new(Some(renderer))),
    };
    gpu_manager.insert(id.clone(), gpu_terminal);

    // 7. Start render loop if not already running
    GpuTerminalManager::start_render_loop(gpu_manager.inner().clone());

    // 8. PTY reader thread — feeds directly into Grid
    let grid_for_thread = grid.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut parser = vte::Parser::new();
        let mut buf = [0u8; 4096];
        let mut detected_ports = std::collections::HashSet::new();

        loop {
            match std::io::Read::read(&mut reader, &mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = &buf[..n];
                    {
                        let mut grid = grid_for_thread.lock().unwrap();
                        let mut performer = GridPerformer { grid: &mut grid };
                        for byte in data {
                            parser.advance(&mut performer, *byte);
                        }
                        grid.needs_redraw = true;
                    }
                    let text = String::from_utf8_lossy(data);
                    buffer_registry.feed(&terminal_id, &text);

                    for segment in text.split_whitespace() {
                        let segment = segment.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != ':' && c != '.');
                        if let Some(port_str) = segment
                            .strip_prefix("localhost:")
                            .or_else(|| segment.strip_prefix("127.0.0.1:"))
                            .or_else(|| segment.strip_prefix("http://localhost:"))
                            .or_else(|| segment.strip_prefix("http://127.0.0.1:"))
                            .or_else(|| segment.strip_prefix("https://localhost:"))
                        {
                            let port_digits: String = port_str.chars().take_while(|c| c.is_ascii_digit()).collect();
                            if let Ok(port) = port_digits.parse::<u16>() {
                                if port >= 1024 && !detected_ports.contains(&port) {
                                    detected_ports.insert(port);
                                    let _ = app_handle.emit("port-detected", serde_json::json!({
                                        "terminal_id": terminal_id, "port": port,
                                    }));
                                }
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(&format!("pty-exit-{}", terminal_id), ());
    });

    Ok(id)
}

/// Write input to a GPU terminal (keyboard → PTY).
#[tauri::command]
pub fn gpu_write_terminal(app: AppHandle, id: String, data: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();

    // Convert key name to PTY bytes if it's a special key
    let bytes = if data.len() == 1 {
        data.into_bytes()
    } else {
        // Special key names: "Enter", "Backspace", "ArrowUp", etc.
        let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
        let mode = gpu_manager.with_terminal(&id, |t| {
            t.grid.lock().unwrap().mode.clone()
        })?;
        crate::gpu::input::key_to_pty_bytes(&data, false, false, false, &mode)
            .unwrap_or_else(|| data.into_bytes())
    };

    pty_manager.write(&id, &bytes)
}

/// Resize a GPU terminal (updates both PTY and Grid).
#[tauri::command]
pub fn gpu_resize_terminal(app: AppHandle, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.resize(&id, cols, rows)?;
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |terminal| {
        let mut grid = terminal.grid.lock().unwrap();
        grid.resize(cols, rows);
    })
}

/// Reposition the GPU terminal Child HWND.
#[tauri::command]
pub fn gpu_reposition_terminal(app: AppHandle, id: String, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |terminal| {
        if let Ok(mut surface) = terminal.surface.lock() {
            surface.reposition(x, y, w, h);
        }
        if let Ok(mut renderer_guard) = terminal.renderer.lock() {
            if let Some(ref mut renderer) = *renderer_guard {
                renderer.resize(w.max(1) as u32, h.max(1) as u32);
            }
        }
    })
}

/// Close a GPU terminal.
#[tauri::command]
pub fn gpu_close_terminal(app: AppHandle, id: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.close(&id)?;
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.remove(&id);
    let buffer_registry = app.state::<OutputBufferRegistry>();
    buffer_registry.remove(&id);
    Ok(())
}

/// Search text in a GPU terminal.
#[tauri::command]
pub fn gpu_search_terminal(app: AppHandle, id: String, query: String) -> Result<usize, String> {
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |terminal| {
        let grid = terminal.grid.lock().unwrap();
        let mut search = crate::gpu::search::SearchState::new();
        search.search(&grid, &query);
        search.count()
    })
}

/// Get selected text from a GPU terminal.
#[tauri::command]
pub fn gpu_get_selection(app: AppHandle, id: String, start_row: u16, start_col: u16, end_row: u16, end_col: u16) -> Result<String, String> {
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |terminal| {
        let grid = terminal.grid.lock().unwrap();
        let mut selection = crate::gpu::selection::Selection::new();
        selection.start(start_row, start_col);
        selection.update(end_row, end_col);
        let mut text = String::new();
        if let Some((start, end)) = selection.normalized() {
            for row in start.row..=end.row {
                let r = row as usize;
                if r >= grid.cells.len() { break; }
                let col_start = if row == start.row { start.col as usize } else { 0 };
                let col_end = if row == end.row { end.col as usize } else { grid.cols as usize - 1 };
                for col in col_start..=col_end.min(grid.cells[r].len().saturating_sub(1)) {
                    if grid.cells[r][col].width > 0 { text.push(grid.cells[r][col].c); }
                }
                if row < end.row { text.push('\n'); }
            }
        }
        text.lines().map(|l| l.trim_end()).collect::<Vec<_>>().join("\n")
    })
}

/// Detect URLs in a visible row.
#[tauri::command]
pub fn gpu_detect_links(app: AppHandle, id: String, row: u16) -> Result<Vec<serde_json::Value>, String> {
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |terminal| {
        let grid = terminal.grid.lock().unwrap();
        let r = row as usize;
        if r >= grid.cells.len() { return vec![]; }
        let text: String = grid.cells[r].iter().map(|c| c.c).collect();
        crate::gpu::link::detect_links(&text).into_iter().map(|link| {
            serde_json::json!({ "col_start": link.col_start, "col_end": link.col_end, "url": link.url })
        }).collect()
    })
}

/// Focus a GPU terminal.
#[tauri::command]
pub fn gpu_focus_terminal(app: AppHandle, id: String) -> Result<(), String> {
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |_terminal| { })
}

/// Set terminal opacity.
#[tauri::command]
pub fn gpu_set_opacity(app: AppHandle, id: String, _opacity: f32) -> Result<(), String> {
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |_terminal| { })
}

/// Get the current terminal renderer mode.
#[tauri::command]
pub fn get_terminal_renderer() -> String {
    "xterm".to_string()
}

/// Export GPU terminal grid state for WebGPU rendering in the browser.
/// Returns a compact representation: { cols, rows, cursor, cells: [[char, fg_r, fg_g, fg_b, bg_r, bg_g, bg_b, flags], ...] }
#[tauri::command]
pub fn gpu_get_grid_state(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let gpu_manager = app.state::<Arc<GpuTerminalManager>>();
    gpu_manager.with_terminal(&id, |terminal| {
        let grid = terminal.grid.lock().unwrap();

        let resolve_color = |c: &crate::gpu::grid::Color| -> (u8, u8, u8) {
            match c {
                crate::gpu::grid::Color::Default => (205, 214, 244), // Catppuccin text
                crate::gpu::grid::Color::Indexed(i) => ansi_to_rgb(*i),
                crate::gpu::grid::Color::Rgb(r, g, b) => (*r, *g, *b),
            }
        };

        let mut cells = Vec::with_capacity((grid.cols as usize) * (grid.rows as usize));
        for row in 0..grid.rows as usize {
            for col in 0..grid.cols as usize {
                let cell = &grid.cells[row][col];
                let (fr, fg, fb) = resolve_color(&cell.fg);
                let (br, bg, bb) = resolve_color(&cell.bg);
                let flags: u8 =
                    (cell.flags.bold as u8)
                    | ((cell.flags.italic as u8) << 1)
                    | ((cell.flags.underline as u8) << 2)
                    | ((cell.flags.inverse as u8) << 3);
                cells.push(serde_json::json!([cell.c as u32, fr, fg, fb, br, bg, bb, flags]));
            }
        }

        serde_json::json!({
            "cols": grid.cols,
            "rows": grid.rows,
            "cursor": { "row": grid.cursor.row, "col": grid.cursor.col, "visible": grid.cursor.visible },
            "cells": cells,
            "needs_redraw": grid.needs_redraw,
        })
    })
}

/// Convert ANSI color index to RGB.
fn ansi_to_rgb(idx: u8) -> (u8, u8, u8) {
    match idx {
        0 => (30, 30, 46),      // black (Catppuccin base)
        1 => (243, 139, 168),   // red
        2 => (166, 227, 161),   // green
        3 => (249, 226, 175),   // yellow
        4 => (137, 180, 250),   // blue
        5 => (203, 166, 247),   // magenta
        6 => (148, 226, 213),   // cyan
        7 => (186, 194, 222),   // white
        8 => (88, 91, 112),     // bright black
        9 => (243, 139, 168),   // bright red
        10 => (166, 227, 161),  // bright green
        11 => (249, 226, 175),  // bright yellow
        12 => (137, 180, 250),  // bright blue
        13 => (203, 166, 247),  // bright magenta
        14 => (148, 226, 213),  // bright cyan
        15 => (205, 214, 244),  // bright white
        16..=231 => {
            // 216 color cube
            let idx = idx - 16;
            let r = (idx / 36) * 51;
            let g = ((idx % 36) / 6) * 51;
            let b = (idx % 6) * 51;
            (r, g, b)
        }
        232..=255 => {
            // Grayscale ramp
            let v = 8 + (idx - 232) * 10;
            (v, v, v)
        }
    }
}
