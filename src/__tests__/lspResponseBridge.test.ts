import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../src-tauri/src/lib.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("LSP response bridge wiring", () => {
  it("keeps the LspManager receiver and emits lsp:response events", () => {
    const src = Object.values(sources)[0];

    expect(src).toMatch(/let\s*\(\s*lsp_tx\s*,\s*lsp_rx\s*\)\s*=/);
    expect(src).toMatch(/LspManager::new\(lsp_tx\)/);
    expect(src).toMatch(/"lsp-response-bridge"/);
    expect(src).toMatch(/while\s+let\s+Ok\(msg\)\s*=\s*lsp_rx\.recv\(\)/);
    expect(src).toMatch(/emit\(\s*"lsp:response"/);
    expect(src).not.toMatch(/let\s*\(\s*tx\s*,\s*_rx\s*\)\s*=/);
  });
});
