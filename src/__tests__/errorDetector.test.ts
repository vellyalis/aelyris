import { describe, expect, it } from "vitest";
import { detectError } from "../shared/lib/errorDetector";

describe("detectError", () => {
  it("detects TypeScript errors", () => {
    const result = detectError("src/App.tsx(42,5): error TS2345: Argument of type 'string' is not assignable");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("build_error");
    expect(result?.message).toContain("Argument of type");
    expect(result?.suggestedPrompt).toContain("Fix TypeScript error");
  });

  it("detects Rust compiler errors", () => {
    const result = detectError("error[E0308]: mismatched types");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("build_error");
    expect(result?.message).toBe("mismatched types");
  });

  it("detects Python errors", () => {
    const result = detectError("ValueError: invalid literal for int()");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("runtime_error");
    expect(result?.message).toContain("ValueError");
  });

  it("detects test failures", () => {
    const result = detectError("FAIL src/__tests__/App.test.tsx");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("test_failure");
  });

  it("detects test failure count", () => {
    const result = detectError("Tests: 3 failed, 10 passed");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("test_failure");
    expect(result?.message).toContain("3 test(s) failed");
  });

  it("detects missing module errors", () => {
    const result = detectError("Error: Cannot find module 'lodash'");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("dependency_error");
    expect(result?.message).toContain("lodash");
  });

  it("detects permission errors", () => {
    const result = detectError("Error: EACCES: permission denied, open '/etc/passwd'");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("permission_error");
  });

  it("detects network errors", () => {
    const result = detectError("Error: connect ECONNREFUSED 127.0.0.1:5432");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("network_error");
  });

  it("detects SyntaxError", () => {
    const result = detectError("SyntaxError: Unexpected token '{'");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("build_error");
  });

  it("returns null for normal output", () => {
    expect(detectError("Compiled successfully")).toBeNull();
    expect(detectError("$ npm test")).toBeNull();
    expect(detectError("listening on port 3000")).toBeNull();
    expect(detectError("")).toBeNull();
  });

  it("strips ANSI codes before matching", () => {
    const result = detectError("\x1b[31merror TS2345: Type mismatch\x1b[0m");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("build_error");
  });

  it("generates actionable suggested prompts", () => {
    const result = detectError("error[E0308]: mismatched types");
    expect(result?.suggestedPrompt).toBe("Fix Rust compiler error: mismatched types");
  });
});
