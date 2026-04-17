import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { keyEventToBytes } from "../keymap";

/**
 * Phase 2 / Task 8 — Wires keydown events on a focused Canvas to the Rust
 * PTY via `write_terminal`. The element must be focusable (`tabIndex={0}`).
 *
 * `writeBytes` is injectable so tests can assert on the outgoing payload
 * without mocking the Tauri IPC surface.
 */
export type WriteBytesFn = (id: string, data: string) => void;

const defaultWriteBytes: WriteBytesFn = (id, data) => {
  invoke("write_terminal", { id, data }).catch(() => {});
};

export function useTerminalCanvasInput(
  terminalId: string | null,
  element: HTMLElement | null,
  writeBytes: WriteBytesFn = defaultWriteBytes,
) {
  useEffect(() => {
    if (!element || !terminalId) return;
    const handler = (ev: KeyboardEvent) => {
      const bytes = keyEventToBytes(ev);
      if (bytes === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      writeBytes(terminalId, bytes);
    };
    element.addEventListener("keydown", handler);
    return () => element.removeEventListener("keydown", handler);
  }, [terminalId, element, writeBytes]);
}
