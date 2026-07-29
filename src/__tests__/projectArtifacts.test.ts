import { describe, expect, it } from "vitest";

import { parseJsonArtifact, resolveProjectFilePath } from "../shared/lib/projectArtifacts";

describe("project artifact utilities", () => {
  it("preserves absolute Windows, UNC, and POSIX paths", () => {
    expect(resolveProjectFilePath("C:\\repo", " D:\\artifacts\\report.json ")).toBe("D:\\artifacts\\report.json");
    expect(resolveProjectFilePath("C:\\repo", " \\\\server\\share\\report.json ")).toBe(
      "\\\\server\\share\\report.json",
    );
    expect(resolveProjectFilePath("C:\\repo", " /var/tmp/report.json ")).toBe("/var/tmp/report.json");
  });

  it("normalizes relative artifact paths below the project root", () => {
    expect(resolveProjectFilePath("C:\\repo\\\\", ".codex-auto/quality/report.json")).toBe(
      "C:\\repo\\.codex-auto\\quality\\report.json",
    );
  });

  it("returns null for whitespace and invalid JSON", () => {
    expect(parseJsonArtifact(" \r\n\t ")).toBeNull();
    expect(parseJsonArtifact("{invalid")).toBeNull();
  });

  it("parses valid JSON without changing its shape", () => {
    expect(parseJsonArtifact<{ ok: boolean; count: number }>(' { "ok": true, "count": 2 } ')).toEqual({
      ok: true,
      count: 2,
    });
  });
});
