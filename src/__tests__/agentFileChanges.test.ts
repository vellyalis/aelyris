import { describe, expect, it } from "vitest";
import { FileChangeTracker, parseFileChange } from "../shared/lib/agentFileChanges";

describe("parseFileChange", () => {
  it("detects Write tool use in Claude format", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", input: { file_path: "/src/main.ts", content: "..." } }],
      },
    });
    const result = parseFileChange(line);
    expect(result).not.toBeNull();
    expect(result?.path).toBe("/src/main.ts");
    expect(result?.action).toBe("create");
    expect(result?.toolName).toBe("Write");
  });

  it("detects Edit tool use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Edit", input: { file_path: "/src/utils.ts", old_string: "a", new_string: "b" } },
        ],
      },
    });
    const result = parseFileChange(line);
    expect(result).not.toBeNull();
    expect(result?.action).toBe("edit");
  });

  it("detects direct tool_use format", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "Write",
      input: { file_path: "/new-file.ts" },
    });
    const result = parseFileChange(line);
    expect(result).not.toBeNull();
    expect(result?.path).toBe("/new-file.ts");
    expect(result?.action).toBe("create");
  });

  it("detects delete tool", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "delete_file",
      input: { path: "/old-file.ts" },
    });
    const result = parseFileChange(line);
    expect(result).not.toBeNull();
    expect(result?.action).toBe("delete");
  });

  it("returns null for non-file tool use", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "Bash",
      input: { command: "ls" },
    });
    expect(parseFileChange(line)).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseFileChange("just some text")).toBeNull();
  });

  it("returns null for empty line", () => {
    expect(parseFileChange("")).toBeNull();
  });
});

describe("FileChangeTracker", () => {
  it("tracks changes across multiple lines", () => {
    const tracker = new FileChangeTracker();
    tracker.addLine(
      JSON.stringify({
        type: "tool_use",
        name: "Write",
        input: { file_path: "/a.ts" },
      }),
    );
    tracker.addLine("some text output");
    tracker.addLine(
      JSON.stringify({
        type: "tool_use",
        name: "Edit",
        input: { file_path: "/b.ts" },
      }),
    );

    expect(tracker.changeCount).toBe(2);
    expect(tracker.getChangedFiles()).toEqual(["/a.ts", "/b.ts"]);
  });

  it("deduplicates file paths in getChangedFiles", () => {
    const tracker = new FileChangeTracker();
    tracker.addLine(
      JSON.stringify({
        type: "tool_use",
        name: "Edit",
        input: { file_path: "/a.ts" },
      }),
    );
    tracker.addLine(
      JSON.stringify({
        type: "tool_use",
        name: "Edit",
        input: { file_path: "/a.ts" },
      }),
    );

    expect(tracker.changeCount).toBe(2);
    expect(tracker.getChangedFiles()).toEqual(["/a.ts"]);
  });

  it("returns change from addLine when detected", () => {
    const tracker = new FileChangeTracker();
    const result = tracker.addLine(
      JSON.stringify({
        type: "tool_use",
        name: "Write",
        input: { file_path: "/new.ts" },
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.path).toBe("/new.ts");
  });

  it("returns null from addLine when no file change", () => {
    const tracker = new FileChangeTracker();
    const result = tracker.addLine("plain text");
    expect(result).toBeNull();
  });
});
