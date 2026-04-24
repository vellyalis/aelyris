import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import type { JsonRpcResponse } from "./types";
import { createRequest, monacoToLspLanguage } from "./types";

interface UseLspOptions {
  projectPath: string;
  monacoLanguage: string;
}

/**
 * Hook that manages an LSP connection for a given language/project.
 * Starts the server on mount, sends requests, listens for responses.
 */
export function useLsp({ projectPath, monacoLanguage }: UseLspOptions) {
  const language = monacoToLspLanguage(monacoLanguage);
  const initialized = useRef(false);
  const pendingCallbacks = useRef<Map<number, (resp: JsonRpcResponse) => void>>(new Map());

  // Start server + listen for responses
  useEffect(() => {
    if (!language || !projectPath) return;
    let unlisten: (() => void) | null = null;
    let aborted = false;

    const setup = async () => {
      try {
        await invoke("lsp_start", { language, rootPath: projectPath });
        if (aborted) {
          invoke("lsp_stop", { language, rootPath: projectPath }).catch(() => {});
          return;
        }

        // Send initialize request
        const initReq = createRequest("initialize", {
          processId: null,
          rootUri: `file:///${projectPath.replace(/\\/g, "/")}`,
          capabilities: {
            textDocument: {
              completion: { completionItem: { snippetSupport: false } },
              hover: { contentFormat: ["plaintext"] },
            },
          },
        });
        await invoke("lsp_request", { language, rootPath: projectPath, jsonRpc: JSON.stringify(initReq) });

        // Listen for responses
        const { listen } = await import("@tauri-apps/api/event");
        const unsub = await listen<{ server: string; message: string }>("lsp:response", (event) => {
          try {
            const resp = JSON.parse(event.payload.message) as JsonRpcResponse;
            if (resp.id && pendingCallbacks.current.has(resp.id)) {
              pendingCallbacks.current.get(resp.id)!(resp);
              pendingCallbacks.current.delete(resp.id);
            }
            // Handle initialize response
            if (
              !initialized.current &&
              resp.result &&
              typeof resp.result === "object" &&
              "capabilities" in (resp.result as Record<string, unknown>)
            ) {
              initialized.current = true;
              // Send initialized notification
              const notif = JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} });
              invoke("lsp_request", { language, rootPath: projectPath, jsonRpc: notif }).catch(() => {});
            }
          } catch {
            /* ignore parse errors */
          }
        });
        if (aborted) {
          unsub();
          return;
        }
        unlisten = unsub;
      } catch {
        // Server not installed — silently degrade
      }
    };
    setup();

    return () => {
      aborted = true;
      unlisten?.();
      invoke("lsp_stop", { language, rootPath: projectPath }).catch(() => {});
      initialized.current = false;
      pendingCallbacks.current.clear();
    };
  }, [language, projectPath]);

  /** Send a request and return a promise for the response */
  const sendRequest = useCallback(
    async (method: string, params: unknown): Promise<JsonRpcResponse | null> => {
      if (!language || !initialized.current) return null;
      const req = createRequest(method, params);
      return new Promise((resolve) => {
        // Timeout after 5s
        const timeout = setTimeout(() => {
          pendingCallbacks.current.delete(req.id);
          resolve(null);
        }, 5000);
        pendingCallbacks.current.set(req.id, (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        });
        invoke("lsp_request", { language, rootPath: projectPath, jsonRpc: JSON.stringify(req) }).catch(() => {
          clearTimeout(timeout);
          pendingCallbacks.current.delete(req.id);
          resolve(null);
        });
      });
    },
    [language, projectPath],
  );

  /** Notify the server about a file open */
  const notifyOpen = useCallback(
    (uri: string, languageId: string, content: string) => {
      if (!language) return;
      const notif = JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId, version: 1, text: content } },
      });
      invoke("lsp_request", { language, rootPath: projectPath, jsonRpc: notif }).catch(() => {});
    },
    [language, projectPath],
  );

  /** Notify the server about content changes */
  const notifyChange = useCallback(
    (uri: string, version: number, content: string) => {
      if (!language) return;
      const notif = JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri, version },
          contentChanges: [{ text: content }],
        },
      });
      invoke("lsp_request", { language, rootPath: projectPath, jsonRpc: notif }).catch(() => {});
    },
    [language, projectPath],
  );

  return {
    isAvailable: language !== null,
    isInitialized: initialized.current,
    sendRequest,
    notifyOpen,
    notifyChange,
  };
}
