import { describe, expect, it } from "vitest";

import {
  classifyTerminalPasteInput,
  countTerminalPasteLineEndings,
  normalizeCommandInput,
  normalizeTerminalPasteInput,
} from "../shared/lib/terminalInput";

describe("terminal input normalization", () => {
  it("submits prompt text with one terminal carriage return", () => {
    expect(normalizeCommandInput("pnpm test")).toBe("pnpm test\r");
    expect(normalizeCommandInput("pnpm test\n")).toBe("pnpm test\r");
    expect(normalizeCommandInput("pnpm test\r\n")).toBe("pnpm test\r");
    expect(normalizeCommandInput("pnpm test\r")).toBe("pnpm test\r");
  });

  it("preserves interior newlines while normalizing only the final submit", () => {
    expect(normalizeCommandInput("printf a\nprintf b\r\n")).toBe("printf a\nprintf b\r");
  });

  it("normalizes direct terminal paste line endings to carriage returns for PowerShell", () => {
    expect(normalizeTerminalPasteInput("Get-Location\n")).toBe("Get-Location\r");
    expect(normalizeTerminalPasteInput("echo one\r\necho two\n")).toBe("echo one\recho two\r");
    expect(normalizeTerminalPasteInput("Write-Host ok\r")).toBe("Write-Host ok\r");
    expect(countTerminalPasteLineEndings("a\r\nb\nc\rd")).toBe(3);
  });

  it("allows a single safe paste without confirmation", () => {
    const guard = classifyTerminalPasteInput("git status\n");
    expect(guard.normalizedText).toBe("git status\r");
    expect(guard.shouldConfirm).toBe(false);
    expect(guard.shouldBlock).toBe(false);
    expect(guard.risk.classes).toContain("read-only");
  });

  it("guards multi-line paste before sending several commands to the PTY", () => {
    const guard = classifyTerminalPasteInput("echo one\necho two\n");
    expect(guard.normalizedText).toBe("echo one\recho two\r");
    expect(guard.lineCount).toBe(2);
    expect(guard.shouldConfirm).toBe(true);
    expect(guard.shouldBlock).toBe(false);
  });

  it("blocks destructive paste and keeps the preview redacted", () => {
    const guard = classifyTerminalPasteInput("rm -rf / --token=secret-value\n");
    expect(guard.shouldBlock).toBe(true);
    expect(guard.risk.allowExecution).toBe(false);
    expect(guard.risk.preview).not.toContain("secret-value");
  });
});
