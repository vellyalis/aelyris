import type * as Monaco from "monaco-editor";
import type { JsonRpcResponse } from "./types";

interface LspBridge {
  sendRequest: (method: string, params: unknown) => Promise<JsonRpcResponse | null>;
}

/**
 * Register Monaco completion and hover providers that delegate to an LSP server.
 * Returns a dispose function to unregister the providers.
 */
export function registerLspProviders(
  monaco: typeof Monaco,
  languageId: string,
  bridge: LspBridge,
): () => void {
  const disposables: Monaco.IDisposable[] = [];

  // Completion provider
  disposables.push(
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: [".", ":", "<", '"', "'", "/", "@", "#"],
      provideCompletionItems: async (model, position) => {
        const uri = `file:///${model.uri.path.replace(/^\//, "")}`;
        const resp = await bridge.sendRequest("textDocument/completion", {
          textDocument: { uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        });
        if (!resp?.result) return { suggestions: [] };

        const items = Array.isArray(resp.result)
          ? resp.result
          : (resp.result as { items?: unknown[] }).items ?? [];

        const suggestions = items.map((item: Record<string, unknown>) => ({
          label: (item.label as string) ?? "",
          kind: mapCompletionKind(monaco, item.kind as number),
          insertText: (item.insertText as string) ?? (item.label as string) ?? "",
          detail: (item.detail as string) ?? undefined,
          documentation: (item.documentation as string) ?? undefined,
          range: undefined as unknown as Monaco.IRange,
        }));

        return { suggestions };
      },
    }),
  );

  // Hover provider
  disposables.push(
    monaco.languages.registerHoverProvider(languageId, {
      provideHover: async (model, position) => {
        const uri = `file:///${model.uri.path.replace(/^\//, "")}`;
        const resp = await bridge.sendRequest("textDocument/hover", {
          textDocument: { uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        });
        if (!resp?.result) return null;

        const result = resp.result as { contents?: unknown; range?: { start: { line: number; character: number }; end: { line: number; character: number } } };
        const contents = formatHoverContents(result.contents);
        if (!contents) return null;

        return {
          contents: [{ value: contents }],
          range: result.range
            ? new monaco.Range(
                result.range.start.line + 1,
                result.range.start.character + 1,
                result.range.end.line + 1,
                result.range.end.character + 1,
              )
            : undefined,
        };
      },
    }),
  );

  return () => {
    for (const d of disposables) d.dispose();
  };
}

function mapCompletionKind(monaco: typeof Monaco, kind?: number): Monaco.languages.CompletionItemKind {
  if (!kind) return monaco.languages.CompletionItemKind.Text;
  // LSP CompletionItemKind → Monaco CompletionItemKind (mostly 1:1)
  const map: Record<number, Monaco.languages.CompletionItemKind> = {
    1: monaco.languages.CompletionItemKind.Text,
    2: monaco.languages.CompletionItemKind.Method,
    3: monaco.languages.CompletionItemKind.Function,
    4: monaco.languages.CompletionItemKind.Constructor,
    5: monaco.languages.CompletionItemKind.Field,
    6: monaco.languages.CompletionItemKind.Variable,
    7: monaco.languages.CompletionItemKind.Class,
    8: monaco.languages.CompletionItemKind.Interface,
    9: monaco.languages.CompletionItemKind.Module,
    10: monaco.languages.CompletionItemKind.Property,
    13: monaco.languages.CompletionItemKind.Enum,
    14: monaco.languages.CompletionItemKind.Keyword,
    15: monaco.languages.CompletionItemKind.Snippet,
    21: monaco.languages.CompletionItemKind.Constant,
    22: monaco.languages.CompletionItemKind.Struct,
  };
  return map[kind] ?? monaco.languages.CompletionItemKind.Text;
}

function formatHoverContents(contents: unknown): string | null {
  if (!contents) return null;
  if (typeof contents === "string") return contents;
  if (typeof contents === "object" && "value" in (contents as Record<string, unknown>)) {
    return (contents as { value: string }).value;
  }
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === "string" ? c : (c as { value?: string }).value ?? "")).join("\n\n");
  }
  return null;
}
