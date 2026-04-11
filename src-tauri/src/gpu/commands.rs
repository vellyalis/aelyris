//! Tauri IPC commands for the GPU terminal renderer.
//!
//! These commands are the bridge between React UI and the wgpu renderer.
//! They replace the xterm.js-based terminal commands when GPU mode is enabled.

use std::sync::Arc;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::{Grid, GridPerformer};
use crate::gpu::surface::TerminalSurface;
use crate::gpu::{GpuTerminal, GpuTerminalManager};
use crate::ipc::OutputBufferRegistry;
use crate::pty::{PtyManager, ShellType};

/// Spawn a GPU-rendered terminal session.
///
/// Creates a PTY, a Grid, a GlyphAtlas, and connects the PTY reader
/// directly to the Grid via VTE parser (no base64, no JS, no xterm.js).
#[tauri::command]
pub fn gpu_spawn_terminal(
    app: AppHandle,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let pty_manager = app.state::<PtyManager>();
    let id = pty_manager.spawn(&shell, cols, rows, cwd.as_deref())?;

    // Take PTY reader for direct grid feeding
    let reader = pty_manager.take_reader(&id)?;
    let terminal_id = id.clone();
    let app_handle = app.clone();

    // Create grid + font + atlas
    let grid = Arc::new(Mutex::new(Grid::new(cols, rows, 10_000)));
    let font = FontManager::new(14.0, 1.4);
    let atlas = Mutex::new(GlyphAtlas::new(2048, 2048));

    // Register in buffer registry for capture-pane compatibility
    let buffer_registry = app.state::<OutputBufferRegistry>().inner().clone();
    buffer_registry.create(&id);

    // Register in pane registry
    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let shell_name = format!("{:?}", shell).to_lowercase();
    pane_registry.register(&id, &shell_name, cwd.as_deref().unwrap_or("."));

    // Store GPU terminal
    let gpu_terminal = GpuTerminal {
        grid: grid.clone(),
        atlas,
        font,
        surface: TerminalSurface::new_placeholder(0, 0, 0, 0),
    };

    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.insert(id.clone(), gpu_terminal);

    // PTY reader thread — feeds directly into Grid via VTE parser
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

                    // Feed directly into Grid (the core optimization)
                    {
                        let mut grid = grid_for_thread.lock().unwrap();
                        let mut performer = GridPerformer { grid: &mut grid };
                        for byte in data {
                            parser.advance(&mut performer, *byte);
                        }
                        grid.needs_redraw = true;
                    }

                    // Also feed capture buffer for capture-pane compatibility
                    let text = String::from_utf8_lossy(data);
                    buffer_registry.feed(&terminal_id, &text);

                    // Port auto-detection (same as original)
                    for segment in text.split_whitespace() {
                        let segment = segment.trim_matches(|c: char| {
                            !c.is_ascii_alphanumeric() && c != ':' && c != '.'
                        });
                        if let Some(port_str) = segment
                            .strip_prefix("localhost:")
                            .or_else(|| segment.strip_prefix("127.0.0.1:"))
                            .or_else(|| segment.strip_prefix("http://localhost:"))
                            .or_else(|| segment.strip_prefix("http://127.0.0.1:"))
                            .or_else(|| segment.strip_prefix("https://localhost:"))
                        {
                            let port_digits: String =
                                port_str.chars().take_while(|c| c.is_ascii_digit()).collect();
                            if let Ok(port) = port_digits.parse::<u16>() {
                                if port >= 1024 && !detected_ports.contains(&port) {
                                    detected_ports.insert(port);
                                    let _ = app_handle.emit(
                                        "port-detected",
                                        serde_json::json!({
                                            "terminal_id": terminal_id,
                                            "port": port,
                                        }),
                                    );
                                }
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }

        // Terminal exited
        let _ = app_handle.emit(&format!("pty-exit-{}", terminal_id), ());
    });

    Ok(id)
}

/// Write input to a GPU terminal (keyboard → PTY).
#[tauri::command]
pub fn gpu_write_terminal(app: AppHandle, id: String, data: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.write(&id, data.as_bytes())
}

/// Resize a GPU terminal (updates both PTY and Grid).
#[tauri::command]
pub fn gpu_resize_terminal(
    app: AppHandle,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Resize PTY
    let pty_manager = app.state::<PtyManager>();
    pty_manager.resize(&id, cols, rows)?;

    // Resize Grid
    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.with_terminal(&id, |terminal| {
        let mut grid = terminal.grid.lock().unwrap();
        grid.resize(cols, rows);
    })
}

/// Reposition and resize the GPU terminal surface (Child HWND).
#[tauri::command]
pub fn gpu_reposition_terminal(
    app: AppHandle,
    id: String,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<(), String> {
    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.with_terminal_mut(&id, |terminal| {
        terminal.surface.reposition(x, y, w, h);
    })
}

/// Close a GPU terminal.
#[tauri::command]
pub fn gpu_close_terminal(app: AppHandle, id: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.close(&id)?;

    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.remove(&id);

    let buffer_registry = app.state::<OutputBufferRegistry>();
    buffer_registry.remove(&id);

    Ok(())
}

/// Search text in a GPU terminal.
#[tauri::command]
pub fn gpu_search_terminal(
    app: AppHandle,
    id: String,
    query: String,
) -> Result<usize, String> {
    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.with_terminal(&id, |terminal| {
        let grid = terminal.grid.lock().unwrap();
        let mut search = crate::gpu::search::SearchState::new();
        search.search(&grid, &query);
        search.count()
    })
}

/// Get selected text from a GPU terminal.
#[tauri::command]
pub fn gpu_get_selection(
    app: AppHandle,
    id: String,
    start_row: u16,
    start_col: u16,
    end_row: u16,
    end_col: u16,
) -> Result<String, String> {
    let gpu_manager = app.state::<GpuTerminalManager>();
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
                    let c = grid.cells[r][col].c;
                    if grid.cells[r][col].width > 0 {
                        text.push(c);
                    }
                }
                if row < end.row { text.push('\n'); }
            }
        }
        // Trim trailing whitespace per line
        text.lines().map(|l| l.trim_end()).collect::<Vec<_>>().join("\n")
    })
}

/// Detect URLs in a visible row of the GPU terminal.
#[tauri::command]
pub fn gpu_detect_links(
    app: AppHandle,
    id: String,
    row: u16,
) -> Result<Vec<serde_json::Value>, String> {
    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.with_terminal(&id, |terminal| {
        let grid = terminal.grid.lock().unwrap();
        let r = row as usize;
        if r >= grid.cells.len() { return vec![]; }
        let text: String = grid.cells[r].iter().map(|c| c.c).collect();
        crate::gpu::link::detect_links(&text)
            .into_iter()
            .map(|link| serde_json::json!({
                "col_start": link.col_start,
                "col_end": link.col_end,
                "url": link.url,
            }))
            .collect()
    })
}

/// Focus a GPU terminal (set keyboard focus to the Child HWND).
#[tauri::command]
pub fn gpu_focus_terminal(app: AppHandle, id: String) -> Result<(), String> {
    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.with_terminal(&id, |terminal| {
        #[cfg(windows)]
        {
            // Focus is handled by the Child HWND — will be wired in Phase 7
        }
        let _ = terminal;
    })
}

/// Set terminal opacity (background alpha).
#[tauri::command]
pub fn gpu_set_opacity(
    app: AppHandle,
    id: String,
    _opacity: f32,
) -> Result<(), String> {
    let gpu_manager = app.state::<GpuTerminalManager>();
    gpu_manager.with_terminal(&id, |_terminal| {
        // Will be applied during render_frame clear color alpha
        // Stored per-terminal in Phase 7
    })
}

/// Get the current terminal renderer mode.
#[tauri::command]
pub fn get_terminal_renderer() -> String {
    "wgpu".to_string()
}
