import { describe, it, expect } from "vitest";
import { detectPrompt, CommandBlockTracker } from "../features/terminal/commandBlock";

describe("detectPrompt", () => {
  it("detects PowerShell prompt", () => {
    const result = detectPrompt("PS C:\\Users\\owner> git status");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("git status");
  });

  it("detects bash $ prompt", () => {
    const result = detectPrompt("user@host:~/project$ ls -la");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("ls -la");
  });

  it("detects simple $ prompt", () => {
    const result = detectPrompt("$ echo hello");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("echo hello");
  });

  it("detects CMD prompt", () => {
    const result = detectPrompt("C:\\Users\\owner> dir");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("dir");
  });

  it("detects chevron prompt", () => {
    const result = detectPrompt("❯ npm install");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("npm install");
  });

  it("detects lambda prompt", () => {
    const result = detectPrompt("λ cargo build");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("cargo build");
  });

  it("returns null for regular output lines", () => {
    expect(detectPrompt("  total 42")).toBeNull();
    expect(detectPrompt("drwxr-xr-x 2 user user 4096")).toBeNull();
    expect(detectPrompt("Compiling aether v0.1.0")).toBeNull();
    expect(detectPrompt("")).toBeNull();
  });

  it("handles prompt with no command", () => {
    const result = detectPrompt("$ ");
    expect(result).not.toBeNull();
    expect(result!.command).toBe("");
  });
});

describe("CommandBlockTracker", () => {
  it("tracks a single command block", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ echo hello");
    tracker.addLine("hello");
    tracker.addLine("$ ");

    const blocks = tracker.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].command).toBe("echo hello");
    expect(blocks[0].startLine).toBe(0);
    expect(blocks[0].endLine).toBe(1);
  });

  it("tracks multiple command blocks", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ ls");
    tracker.addLine("file1.txt");
    tracker.addLine("file2.txt");
    tracker.addLine("$ echo done");
    tracker.addLine("done");
    tracker.addLine("$ ");

    const blocks = tracker.getBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0].command).toBe("ls");
    expect(blocks[0].startLine).toBe(0);
    expect(blocks[0].endLine).toBe(2);
    expect(blocks[1].command).toBe("echo done");
    expect(blocks[1].startLine).toBe(3);
    expect(blocks[1].endLine).toBe(4);
  });

  it("returns current in-progress block", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ npm test");
    tracker.addLine("running tests...");

    const current = tracker.getCurrentBlock();
    expect(current).not.toBeNull();
    expect(current!.command).toBe("npm test");
    expect(current!.startLine).toBe(0);
  });

  it("handles no prompts gracefully", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("some output");
    tracker.addLine("more output");

    expect(tracker.getBlocks()).toHaveLength(0);
    expect(tracker.getCurrentBlock()).toBeNull();
  });

  it("getRecentBlocks returns last N blocks", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ cmd1");
    tracker.addLine("out1");
    tracker.addLine("$ cmd2");
    tracker.addLine("out2");
    tracker.addLine("$ cmd3");
    tracker.addLine("out3");
    tracker.addLine("$ ");

    expect(tracker.getRecentBlocks(2)).toHaveLength(2);
    expect(tracker.getRecentBlocks(2)[0].command).toBe("cmd2");
    expect(tracker.getRecentBlocks(2)[1].command).toBe("cmd3");
  });

  it("tracks blockCount correctly", () => {
    const tracker = new CommandBlockTracker();
    expect(tracker.blockCount).toBe(0);

    tracker.addLine("$ cmd1");
    tracker.addLine("$ cmd2");
    expect(tracker.blockCount).toBe(1);

    tracker.addLine("$ cmd3");
    expect(tracker.blockCount).toBe(2);
  });

  it("captures output lines into the block", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ ls");
    tracker.addLine("file1.txt");
    tracker.addLine("file2.txt");
    tracker.addLine("file3.txt");
    tracker.addLine("$ ");

    const block = tracker.getBlocks()[0];
    expect(block.outputLines).toEqual(["file1.txt", "file2.txt", "file3.txt"]);
  });

  it("does not capture prompt line as its own output", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ echo hi");
    tracker.addLine("hi");
    tracker.addLine("$ echo bye");

    const block = tracker.getBlocks()[0];
    expect(block.outputLines).toEqual(["hi"]);
  });

  it("assigns monotonic ids", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ a");
    tracker.addLine("$ b");
    tracker.addLine("$ c");

    const blocks = tracker.getBlocks();
    expect(blocks[0].id).toBe("blk-0");
    expect(blocks[1].id).toBe("blk-1");
  });

  it("records timestamps and closes endedAt on next prompt", () => {
    const tracker = new CommandBlockTracker();
    const before = Date.now();
    tracker.addLine("$ cmd1");
    tracker.addLine("output");
    tracker.addLine("$ cmd2");
    const after = Date.now();

    const [block] = tracker.getBlocks();
    expect(block.startedAt).toBeGreaterThanOrEqual(before);
    expect(block.startedAt).toBeLessThanOrEqual(after);
    expect(block.endedAt).not.toBeNull();
    expect(block.endedAt!).toBeGreaterThanOrEqual(block.startedAt);
  });

  it("currentBlock has endedAt null while it is still open", () => {
    const tracker = new CommandBlockTracker();
    tracker.addLine("$ npm test");
    tracker.addLine("still running");

    const cur = tracker.getCurrentBlock();
    expect(cur).not.toBeNull();
    expect(cur!.endedAt).toBeNull();
    expect(cur!.outputLines).toEqual(["still running"]);
  });

  it("prune keeps only the most recent N blocks", () => {
    const tracker = new CommandBlockTracker();
    for (let i = 0; i < 10; i++) {
      tracker.addLine(`$ cmd${i}`);
      tracker.addLine(`out${i}`);
    }
    tracker.addLine("$ ");
    expect(tracker.blockCount).toBe(10);

    tracker.prune(3);
    expect(tracker.blockCount).toBe(3);
    const blocks = tracker.getBlocks();
    expect(blocks[0].command).toBe("cmd7");
    expect(blocks[2].command).toBe("cmd9");
  });
});
