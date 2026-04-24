import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  it("ignores TUI-internal prompts during an active session (claude/codex redraw on SIGWINCH)", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("PS C:\\Users\\dev> claude\r\n"));
    expect(result.current.active).toBe(true);

    // Claude's input-box prompt — must NOT look like a shell prompt end.
    act(() => result.current.feed("> \r\n"));
    expect(result.current.active).toBe(true);

    act(() => result.current.feed("❯ something\r\n"));
    expect(result.current.active).toBe(true);

    // Only a real host shell prompt should end the session.
    act(() => result.current.feed("PS C:\\Users\\dev> \r\n"));
    expect(result.current.active).toBe(false);
  });

  it("collapses PSReadLine inline-redraw snapshots to the final state", () => {
    const { result } = renderHook(() => useAICliDetection());
    // PSReadLine writes `\r<prompt><buffer>` for every keystroke.  By the
    // time Enter fires, the single logical output "line" between two `\n`s
    // holds many stacked snapshots — only the substring after the last `\r`
    // is what's actually on screen.
    const snapshot =
      "\rPS C:\\Users\\owner> \r" +
      "PS C:\\Users\\owner> c\r" +
      "PS C:\\Users\\owner> cl\r" +
      "PS C:\\Users\\owner> cla\r" +
      "PS C:\\Users\\owner> claude\r\n";
    act(() => result.current.feed(snapshot));
    expect(result.current.active).toBe(true);
  });

  describe("feedInput (user keystroke path)", () => {
    it("activates when the user types `gemini` + Enter", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => {
        for (const ch of "gemini") result.current.feedInput(ch);
        result.current.feedInput("\r");
      });
      expect(result.current.active).toBe(true);
    });

    it("handles backspace", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => {
        // type "gemxni", backspace the "x" and "n", add "ni", then Enter
        for (const ch of "gemxni") result.current.feedInput(ch);
        result.current.feedInput("\x7f"); // delete "i"
        result.current.feedInput("\x7f"); // delete "n"
        result.current.feedInput("\x7f"); // delete "x"
        result.current.feedInput("i");
        result.current.feedInput("n");
        result.current.feedInput("i");
        result.current.feedInput("\r");
      });
      expect(result.current.active).toBe(true);
    });

    it("Ctrl+C clears the buffer so the aborted `claude` does not count", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => {
        for (const ch of "claude") result.current.feedInput(ch);
        result.current.feedInput("\x03"); // Ctrl+C
      });
      expect(result.current.active).toBe(false);
      // Following Enter on empty buffer should NOT trigger.
      act(() => result.current.feedInput("\r"));
      expect(result.current.active).toBe(false);
    });

    it("Ctrl+U clears the buffer", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => {
        for (const ch of "claude") result.current.feedInput(ch);
        result.current.feedInput("\x15"); // Ctrl+U
        result.current.feedInput("\r");
      });
      expect(result.current.active).toBe(false);
    });

    it("Ctrl+W deletes the last word", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => {
        for (const ch of "ls claude") result.current.feedInput(ch);
        result.current.feedInput("\x17"); // Ctrl+W — removes "claude"
        result.current.feedInput("\r");
      });
      expect(result.current.active).toBe(false);
    });

    it("ignores arrow-key escape sequences (no spurious chars in buffer)", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => {
        result.current.feedInput("\x1b[A"); // up arrow
        result.current.feedInput("\x1b[B"); // down arrow
        for (const ch of "claude") result.current.feedInput(ch);
        result.current.feedInput("\r");
      });
      expect(result.current.active).toBe(true);
    });

    it("does not double-trigger while already in session", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => {
        for (const ch of "claude") result.current.feedInput(ch);
        result.current.feedInput("\r");
      });
      expect(result.current.active).toBe(true);

      // User types inside claude — shouldn't flip state.
      act(() => {
        for (const ch of "hello") result.current.feedInput(ch);
        result.current.feedInput("\r");
      });
      expect(result.current.active).toBe(true);
    });

    it("accepts chunked input (one key per call)", () => {
      const { result } = renderHook(() => useAICliDetection());
      act(() => result.current.feedInput("c"));
      act(() => result.current.feedInput("o"));
      act(() => result.current.feedInput("d"));
      act(() => result.current.feedInput("e"));
      act(() => result.current.feedInput("x"));
      act(() => result.current.feedInput("\r"));
      expect(result.current.active).toBe(true);
    });
  });

  it("survives a full TUI frame redraw (box drawing + inner prompt)", () => {
    const { result } = renderHook(() => useAICliDetection());
    act(() => result.current.feed("PS C:\\> claude\r\n"));
    expect(result.current.active).toBe(true);

    const claudeRedraw =
      "╭─ claude ──────────────╮\r\n" +
      "│                       │\r\n" +
      "│ > Ask me anything     │\r\n" +
      "│                       │\r\n" +
      "╰───────────────────────╯\r\n";
    act(() => result.current.feed(claudeRedraw));
    expect(result.current.active).toBe(true);
  });
});
