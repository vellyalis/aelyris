/** Supported LSP languages (must match Rust LspLanguage enum) */
export type LspLanguage = "rust" | "python" | "typescript" | "go";

/** Map Monaco language IDs to LSP language identifiers */
export function monacoToLspLanguage(monacoLang: string): LspLanguage | null {
  switch (monacoLang) {
    case "rust": return "rust";
    case "python": return "python";
    case "typescript":
    case "javascript": return "typescript";
    case "go": return "go";
    default: return null;
  }
}

/** JSON-RPC request structure */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

/** JSON-RPC response structure */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

let nextRequestId = 1;

/** Create a JSON-RPC request */
export function createRequest(method: string, params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: nextRequestId++, method, params };
}
