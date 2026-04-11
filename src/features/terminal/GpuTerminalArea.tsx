import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ShellType } from "../../App";
import styles from "./TerminalArea.module.css";

interface GpuTerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  syncMode?: boolean;
  onTerminalReady?: (terminalId: string) => void;
}

/**
 * GPU-rendered terminal area using wgpu.
 *
 * Instead of xterm.js, this component renders a transparent placeholder div.
 * The Rust backend creates a Child HWND at the same position and renders
 * the terminal directly via wgpu. PTY output goes directly to the Grid
 * without base64/IPC/JS overhead.
 */
export function GpuTerminalArea({
  shell = "powershell",
  cwd,
  syncMode,
  onTerminalReady,
}: GpuTerminalAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const syncModeRef = useRef(syncMode);
  useEffect(() => { syncModeRef.current = syncMode; }, [syncMode]);

  // Spawn GPU terminal on mount
  useEffect(() => {
    let id: string | null = null;
    let exitUnlisten: (() => void) | null = null;

    async function spawn() {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cols = Math.max(1, Math.floor(rect.width / 8.4)); // approximate cell width
      const rows = Math.max(1, Math.floor(rect.height / 19.6)); // font_size * line_height

      id = await invoke<string>("gpu_spawn_terminal", {
        shell,
        cols,
        rows,
        cwd: cwd ?? null,
      });

      setTerminalId(id);
      onTerminalReady?.(id);

      // Position the Child HWND to match this div
      await invoke("gpu_reposition_terminal", {
        id,
        x: Math.round(rect.left * dpr),
        y: Math.round(rect.top * dpr),
        w: Math.round(rect.width * dpr),
        h: Math.round(rect.height * dpr),
      });

      // Listen for terminal exit
      exitUnlisten = await listen(`pty-exit-${id}`, () => {
        // Terminal process exited — could show a message or auto-close
      });
    }

    spawn();

    return () => {
      if (id) {
        invoke("gpu_close_terminal", { id }).catch(() => {});
      }
      exitUnlisten?.();
    };
  }, [shell, cwd]);

  // ResizeObserver: update Child HWND position when container resizes
  useEffect(() => {
    if (!terminalId || !containerRef.current) return;

    const ro = new ResizeObserver(async () => {
      const container = containerRef.current;
      if (!container || !terminalId) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cols = Math.max(1, Math.floor(rect.width / 8.4));
      const rows = Math.max(1, Math.floor(rect.height / 19.6));

      await invoke("gpu_reposition_terminal", {
        id: terminalId,
        x: Math.round(rect.left * dpr),
        y: Math.round(rect.top * dpr),
        w: Math.round(rect.width * dpr),
        h: Math.round(rect.height * dpr),
      });

      await invoke("gpu_resize_terminal", {
        id: terminalId,
        cols,
        rows,
      });
    });

    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [terminalId]);

  // Keyboard handler — forward to PTY via GPU command
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      if (!terminalId) return;

      // Don't forward if a modifier-only key
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      // Build the key string for Rust input handler
      const data = e.key.length === 1 ? e.key : e.key;

      if (syncModeRef.current) {
        await invoke("broadcast_keys", { data });
      } else {
        await invoke("gpu_write_terminal", { id: terminalId, data });
      }

      e.preventDefault();
    },
    [terminalId]
  );

  return (
    <div className={styles.terminalArea}>
      <div
        ref={containerRef}
        className={styles.terminalContainer}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{ outline: "none" }}
        data-gpu-terminal={terminalId ?? undefined}
      />
    </div>
  );
}
