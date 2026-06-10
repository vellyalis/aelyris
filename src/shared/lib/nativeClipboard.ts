import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { formatFallbackError, reportFallback, reportInvokeFailure } from "./fallbackTelemetry";

export interface WriteClipboardTextOptions {
  source?: string;
  nativeOperation?: string;
  browserFallbackOperation?: string;
  browserOperation?: string;
  unavailableOperation?: string;
  fallbackMessage?: string;
  userVisible?: boolean;
}

const DEFAULT_WRITE_OPTIONS: Required<WriteClipboardTextOptions> = {
  source: "terminal-selection",
  nativeOperation: "write_clipboard_text",
  browserFallbackOperation: "write_clipboard_text_browser_fallback",
  browserOperation: "browser_write_clipboard_text",
  unavailableOperation: "write_clipboard_text_unavailable",
  fallbackMessage: "Native clipboard write failed; using browser clipboard fallback.",
  userVisible: true,
};

export async function writeClipboardText(text: string, options: WriteClipboardTextOptions = {}): Promise<void> {
  const config = { ...DEFAULT_WRITE_OPTIONS, ...options };
  let nativeError: unknown = null;

  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    await invoke("write_clipboard_text", { text });
    return;
  } catch (err) {
    nativeError = err;
    reportInvokeFailure({
      source: config.source,
      operation: config.nativeOperation,
      err,
      severity: "warning",
      userVisible: config.userVisible,
      boundary: "native",
    });
  }

  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    reportFallback({
      source: config.source,
      operation: config.browserFallbackOperation,
      severity: "warning",
      message: config.fallbackMessage,
      userVisible: config.userVisible,
      boundary: "webview-fallback",
      nativeBoundaryEscaped: true,
    });
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      reportInvokeFailure({
        source: config.source,
        operation: config.browserOperation,
        err,
        severity: "error",
        userVisible: config.userVisible,
        boundary: "webview-fallback",
        nativeBoundaryEscaped: true,
      });
      throw err;
    }
  }

  const message = nativeError ? formatFallbackError(nativeError) : "No clipboard write path available";
  reportFallback({
    source: config.source,
    operation: config.unavailableOperation,
    severity: "error",
    message,
    userVisible: config.userVisible,
    boundary: "unavailable",
  });
  throw new Error(message);
}
