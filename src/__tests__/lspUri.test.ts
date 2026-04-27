import { describe, expect, it } from "vitest";
import { toMonacoModelUri } from "../features/editor/lsp/lspUri";

/**
 * Runtime tests for the helper that aligns the Monaco model URI with
 * what we send to `textDocument/didOpen`. The previous fix only
 * structurally checked the helper's existence — Codex r1 caught that a
 * naive `file:///${slashed}` over a POSIX `/home/me/a.ts` produces
 * `file:////home/me/a.ts` (four slashes), which does NOT match Monaco's
 * `Uri.parse` round-trip and silently breaks LSP on POSIX.
 */
describe("toMonacoModelUri", () => {
  it("Windows drive path with backslashes round-trips through file:/// prefix", () => {
    expect(toMonacoModelUri("C:\\repo\\foo.ts")).toBe("file:///C:/repo/foo.ts");
  });

  it("Windows drive path already using forward slashes preserves the drive letter", () => {
    expect(toMonacoModelUri("C:/repo/foo.ts")).toBe("file:///C:/repo/foo.ts");
  });

  it("POSIX absolute path keeps exactly three leading slashes (file:///)", () => {
    expect(toMonacoModelUri("/home/me/a.ts")).toBe("file:///home/me/a.ts");
    // Regression: the broken implementation produced four slashes here.
    expect(toMonacoModelUri("/home/me/a.ts")).not.toBe("file:////home/me/a.ts");
  });

  it("nested POSIX path with multiple segments is left intact", () => {
    expect(toMonacoModelUri("/var/log/app/2026/04/27.log")).toBe(
      "file:///var/log/app/2026/04/27.log",
    );
  });
  // UNC paths (`\\\\server\\share\\file`) are intentionally out of scope —
  // Aether Terminal's file tree only ever surfaces drive-letter or POSIX
  // absolute paths, and a canonical UNC URI (`file://server/share/file`)
  // would need different prefix logic. If UNC support is added later,
  // toMonacoModelUri should branch on `\\` before calling .replace.
});
