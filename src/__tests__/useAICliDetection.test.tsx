import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAICliDetection } from "../features/terminal/hooks/useAICliDetection";

describe("useAICliDetection", () => {
  it("starts inactive", () => {
    const { result } = renderHook(() => useAICliDetection());
    expect(result.current.active).toBe(false);
  });

  it("activates when a PowerShell prompt echoes `claude`", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("PS C:\\Users\\dev> claude\r\n"));
    expect(result.current.active).toBe(true);
  });

  it("activates for codex / gemini / aider", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("PS C:\\> codex --resume\r\n"));
    expect(result.current.active).toBe(true);

    act(() => result.current.reset());
    act(() => result.current.feed("PS C:\\> gemini\r\n"));
    expect(result.current.active).toBe(true);

    act(() => result.current.reset());
    act(() => result.current.feed("PS C:\\> aider src/main.rs\r\n"));
    expect(result.current.active).toBe(true);
  });

  it("deactivates when a subsequent shell prompt appears without an AI CLI command", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("PS C:\\> claude\r\n"));
    expect(result.current.active).toBe(true);

    act(() => result.current.feed("PS C:\\> \r\n"));
    expect(result.current.active).toBe(false);
  });

  it("ignores non-AI commands", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("PS C:\\> git status\r\n"));
    expect(result.current.active).toBe(false);

    act(() => result.current.feed("PS C:\\> ls\r\n"));
    expect(result.current.active).toBe(false);
  });

  it("strips ANSI colour codes before matching", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("\x1b[32mPS C:\\>\x1b[0m claude\r\n"));
    expect(result.current.active).toBe(true);
  });

  it("handles bash-style prompts", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("user@host:~/project$ claude\n"));
    expect(result.current.active).toBe(true);
  });

  it("does not falsely match commands that merely contain an AI CLI name", () => {
    const { result } = renderHook(() => useAICliDetection());
    // `grep claude` and `echo claudeio` should not count — AI_CLI_COMMAND
    // anchors at the start of the command.
    act(() => result.current.feed("PS C:\\> grep claude file.txt\r\n"));
    expect(result.current.active).toBe(false);

    act(() => result.current.feed("PS C:\\> echo claudeio\r\n"));
    expect(result.current.active).toBe(false);
  });

  it("treats an empty output feed as a no-op", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed(""));
    expect(result.current.active).toBe(false);
  });

  it("re-activates on a new AI CLI invocation after session end", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("PS C:\\> claude\r\n"));
    expect(result.current.active).toBe(true);

    act(() => result.current.feed("PS C:\\> \r\n"));
    expect(result.current.active).toBe(false);

    act(() => result.current.feed("PS C:\\> codex\r\n"));
    expect(result.current.active).toBe(true);
  });
});
