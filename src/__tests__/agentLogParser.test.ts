import { describe, expect, it } from "vitest";
import { containsDiff, extractFilePath, parseToolUse } from "../shared/lib/agentLogParser";

describe("parseToolUse", () => {
  it("parses Edit tool with file_path", () => {
    const result = parseToolUse('Edit({"file_path":"/src/App.tsx","old_string":"foo","new_string":"bar"})');
    expect(result.tool).toBe("Edit");
    expect(result.filePath).toBe("/src/App.tsx");
    expect(result.isFileChange).toBe(true);
    expect(result.summary).toContain("App.tsx");
  });

  it("parses Write tool", () => {
    const result = parseToolUse('Write({"file_path":"/src/new-file.ts","content":"export {}"})');
    expect(result.tool).toBe("Write");
    expect(result.filePath).toBe("/src/new-file.ts");
    expect(result.isFileChange).toBe(true);
  });

  it("parses Read tool (not a file change)", () => {
    const result = parseToolUse('Read({"file_path":"/src/App.tsx"})');
    expect(result.tool).toBe("Read");
    expect(result.filePath).toBe("/src/App.tsx");
    expect(result.isFileChange).toBe(false);
  });

  it("parses Grep tool", () => {
    const result = parseToolUse('Grep({"pattern":"import","path":"/src"})');
    expect(result.tool).toBe("Grep");
    expect(result.filePath).toBe("/src");
    expect(result.isFileChange).toBe(false);
  });

  it("handles truncated JSON gracefully", () => {
    const result = parseToolUse('Edit({"file_path":"/src/long-file.tsx","old_strin...)');
    expect(result.tool).toBe("Edit");
    expect(result.filePath).toBe("/src/long-file.tsx");
  });

  it("handles unknown tool format", () => {
    const result = parseToolUse("some random text");
    expect(result.tool).toBe("unknown");
    expect(result.isFileChange).toBe(false);
  });
});

describe("containsDiff", () => {
  it("detects unified diff format", () => {
    expect(containsDiff("--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@")).toBe(true);
  });

  it("rejects non-diff content", () => {
    expect(containsDiff("just some text")).toBe(false);
  });
});

describe("extractFilePath", () => {
  it("extracts path from diff header", () => {
    expect(extractFilePath("--- a/src/App.tsx")).toBe("src/App.tsx");
  });

  it("returns null for non-diff content", () => {
    expect(extractFilePath("no diff here")).toBeNull();
  });
});
