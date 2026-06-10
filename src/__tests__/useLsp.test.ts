import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLsp } from "../features/editor/lsp/useLsp";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";

type InvokeArgs = { language?: string; rootPath?: string; jsonRpc?: string };
type Listener = (event: { payload: { server: string; message: string } }) => void;

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
const listeners: Record<string, Listener> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: InvokeArgs) => invokeMock(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: Listener) => listenMock(event, handler),
}));

function emitLsp(server: string, message: unknown) {
  listeners["lsp:response"]?.({
    payload: {
      server,
      message: JSON.stringify(message),
    },
  });
}

function collectFallbackEvents() {
  const events: FallbackTelemetryDetail[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
  };
  window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
  return {
    events,
    cleanup: () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener),
  };
}

describe("useLsp", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    for (const key of Object.keys(listeners)) delete listeners[key];
    listenMock.mockImplementation((event: string, handler: Listener) => {
      listeners[event] = handler;
      return Promise.resolve(unlistenMock);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("arms the response listener before sending initialize", async () => {
    const projectPath = "C:\\repo";
    invokeMock.mockImplementation((cmd: string, args?: InvokeArgs) => {
      if (cmd === "lsp_start") return Promise.resolve({ pid: 1 });
      if (cmd === "lsp_stop") return Promise.resolve();
      if (cmd === "lsp_request") {
        const payload = JSON.parse(args?.jsonRpc ?? "{}") as { id?: number; method?: string };
        if (payload.method === "initialize") {
          emitLsp("TypeScript:C:\\repo", {
            jsonrpc: "2.0",
            id: payload.id,
            result: { capabilities: {} },
          });
        }
        return Promise.resolve();
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useLsp({ projectPath, monacoLanguage: "typescript" }));

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(listenMock).toHaveBeenCalledWith("lsp:response", expect.any(Function));
    const requests = invokeMock.mock.calls.filter((call) => call[0] === "lsp_request");
    expect(JSON.parse(requests[0][1].jsonRpc).method).toBe("initialize");
    expect(JSON.parse(requests[1][1].jsonRpc).method).toBe("initialized");
  });

  it("routes responses only for the matching language server", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lsp_start" || cmd === "lsp_request" || cmd === "lsp_stop") return Promise.resolve();
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useLsp({ projectPath: "C:\\repo", monacoLanguage: "typescript" }));
    await waitFor(() => expect(listeners["lsp:response"]).toBeDefined());

    await act(async () => {
      emitLsp("Rust:C:\\repo", {
        jsonrpc: "2.0",
        id: 1,
        result: { capabilities: {} },
      });
    });
    expect(result.current.isInitialized).toBe(false);

    await act(async () => {
      emitLsp("TypeScript:C:\\repo", {
        jsonrpc: "2.0",
        id: 1,
        result: { capabilities: {} },
      });
    });
    expect(result.current.isInitialized).toBe(true);
  });

  it("reports LSP startup failures instead of silently degrading", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lsp_start") return Promise.reject(new Error("typescript server missing"));
      return Promise.resolve();
    });
    const telemetry = collectFallbackEvents();
    try {
      renderHook(() => useLsp({ projectPath: "C:\\repo", monacoLanguage: "typescript" }));

      await waitFor(() => {
        expect(telemetry.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "lsp",
              operation: "lsp_start_or_initialize",
              userVisible: true,
            }),
          ]),
        );
      });
    } finally {
      telemetry.cleanup();
    }
  });

  it("reports failed LSP notifications so editor integration loss is visible", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lsp_start" || cmd === "lsp_stop") return Promise.resolve();
      if (cmd === "lsp_request") return Promise.resolve();
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useLsp({ projectPath: "C:\\repo", monacoLanguage: "typescript" }));
    await waitFor(() => expect(listeners["lsp:response"]).toBeDefined());

    await act(async () => {
      emitLsp("TypeScript:C:\\repo", {
        jsonrpc: "2.0",
        id: 1,
        result: { capabilities: {} },
      });
    });
    expect(result.current.isInitialized).toBe(true);

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lsp_request") return Promise.reject(new Error("request pipe closed"));
      if (cmd === "lsp_stop") return Promise.resolve();
      return Promise.resolve();
    });
    const telemetry = collectFallbackEvents();
    try {
      await act(async () => {
        result.current.notifyOpen("file:///C:/repo/a.ts", "typescript", "const a = 1;");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(telemetry.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "lsp",
              operation: "lsp_notify_open",
              userVisible: true,
            }),
          ]),
        );
      });
    } finally {
      telemetry.cleanup();
    }
  });
});
