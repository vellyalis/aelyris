import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import styles from "./WebGpuTerminal.module.css";

interface WebGpuTerminalProps {
  shell: string;
  cwd?: string;
  onTerminalReady?: (terminalId: string) => void;
}

interface GridState {
  cols: number;
  rows: number;
  cursor: { row: number; col: number; visible: boolean };
  cells: [number, number, number, number, number, number, number, number][]; // [char, fr, fg, fb, br, bg, bb, flags]
  needs_redraw: boolean;
}

const CELL_WIDTH = 8.4;  // px per char (monospace)
const CELL_HEIGHT = 18;  // px per line
const FONT = "14px 'IBM Plex Mono', 'Cascadia Code', monospace";

/**
 * GPU-accelerated terminal renderer using Canvas 2D + requestAnimationFrame.
 *
 * Data flow:
 * 1. gpu_spawn_terminal() spawns PTY + Grid in Rust
 * 2. PTY output → VTE parser → Grid state (Rust, no JS overhead)
 * 3. requestAnimationFrame polls gpu_get_grid_state() for dirty frames
 * 4. Canvas 2D renders the grid (faster than xterm.js DOM manipulation)
 *
 * Future: replace Canvas 2D with WebGPU compute shader for even faster rendering.
 */
export function WebGpuTerminal({ shell, cwd, onTerminalReady }: WebGpuTerminalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const animFrameRef = useRef<number>(0);
  const gridRef = useRef<GridState | null>(null);

  // Calculate terminal dimensions from container size
  const getDimensions = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { cols: 80, rows: 24 };
    const cols = Math.floor(el.clientWidth / CELL_WIDTH);
    const rows = Math.floor(el.clientHeight / CELL_HEIGHT);
    return { cols: Math.max(20, cols), rows: Math.max(5, rows) };
  }, []);

  // Spawn GPU terminal
  useEffect(() => {
    let cancelled = false;
    const { cols, rows } = getDimensions();

    (async () => {
      try {
        const id = await invoke<string>("gpu_spawn_terminal", {
          shell, cols, rows, cwd: cwd ?? null,
        });
        if (cancelled) return;
        setTerminalId(id);
        onTerminalReady?.(id);
      } catch (err) {
        console.error("GPU terminal spawn failed:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [shell, cwd]);

  // Render loop: poll grid state and draw
  useEffect(() => {
    if (!terminalId || !canvasRef.current) return;
    let active = true;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderFrame = async () => {
      if (!active) return;
      try {
        const state = await invoke<GridState>("gpu_get_grid_state", { id: terminalId });
        if (!active) return;

        if (state.needs_redraw || !gridRef.current) {
          gridRef.current = state;
          drawGrid(ctx, canvas, state);
        }
      } catch { /* terminal closed */ }

      if (active) {
        animFrameRef.current = requestAnimationFrame(() => {
          // Throttle to ~30fps to avoid hammering IPC
          setTimeout(renderFrame, 33);
        });
      }
    };

    // Set canvas size
    const { cols, rows } = getDimensions();
    canvas.width = cols * CELL_WIDTH;
    canvas.height = rows * CELL_HEIGHT;

    renderFrame();

    return () => {
      active = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [terminalId, getDimensions]);

  // Keyboard input
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!terminalId) return;
    e.preventDefault();

    let data = "";
    if (e.key.length === 1) {
      data = e.ctrlKey ? String.fromCharCode(e.key.charCodeAt(0) - 64) : e.key;
    } else {
      switch (e.key) {
        case "Enter": data = "\r"; break;
        case "Backspace": data = "\x7f"; break;
        case "Tab": data = "\t"; break;
        case "Escape": data = "\x1b"; break;
        case "ArrowUp": data = "\x1b[A"; break;
        case "ArrowDown": data = "\x1b[B"; break;
        case "ArrowRight": data = "\x1b[C"; break;
        case "ArrowLeft": data = "\x1b[D"; break;
        case "Home": data = "\x1b[H"; break;
        case "End": data = "\x1b[F"; break;
        case "Delete": data = "\x1b[3~"; break;
        case "PageUp": data = "\x1b[5~"; break;
        case "PageDown": data = "\x1b[6~"; break;
      }
    }

    if (data) {
      invoke("gpu_write_terminal", { id: terminalId, data }).catch(() => {});
    }
  }, [terminalId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (terminalId) {
        invoke("gpu_close_terminal", { id: terminalId }).catch(() => {});
      }
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}

/** Draw the terminal grid onto a canvas. */
function drawGrid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, state: GridState) {
  const { cols, rows, cursor, cells } = state;
  const cw = CELL_WIDTH;
  const ch = CELL_HEIGHT;

  // Clear
  ctx.fillStyle = "rgba(30, 30, 46, 1)"; // Catppuccin base
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = FONT;
  ctx.textBaseline = "top";

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (idx >= cells.length) continue;

      const [charCode, fr, fg, fb, br, bg, bb, flags] = cells[idx];
      const x = col * cw;
      const y = row * ch;

      // Background (skip default/transparent)
      if (br !== 30 || bg !== 30 || bb !== 46) {
        ctx.fillStyle = `rgb(${br},${bg},${bb})`;
        ctx.fillRect(x, y, cw, ch);
      }

      // Foreground character
      if (charCode > 32) {
        const bold = flags & 1;
        const italic = (flags >> 1) & 1;
        ctx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}14px 'IBM Plex Mono', 'Cascadia Code', monospace`;
        ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
        ctx.fillText(String.fromCodePoint(charCode), x, y + 2);
      }
    }
  }

  // Cursor
  if (cursor.visible) {
    ctx.fillStyle = "rgba(205, 214, 244, 0.7)";
    ctx.fillRect(cursor.col * cw, cursor.row * ch, 2, ch);
  }
}
