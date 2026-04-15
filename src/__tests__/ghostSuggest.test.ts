import { describe, it, expect } from "vitest";
import { findSuggestion } from "../features/terminal/ghostSuggest";

describe("findSuggestion", () => {
  const history = [
    "git status",
    "git add -A",
    "git commit -m 'fix bug'",
    "pnpm test",
    "pnpm dev",
    "cargo build",
    "cargo test",
  ];

  it("finds prefix match from history", () => {
    expect(findSuggestion("git s", history)).toBe("git status");
  });

  it("returns most recent match", () => {
    // "cargo" matches both "cargo build" and "cargo test"
    // "cargo test" is more recent
    expect(findSuggestion("cargo", history)).toBe("cargo test");
  });

  it("is case-insensitive", () => {
    expect(findSuggestion("GIT S", history)).toBe("git status");
  });

  it("returns null for no match", () => {
    expect(findSuggestion("docker", history)).toBeNull();
  });

  it("returns null for short input (<2 chars)", () => {
    expect(findSuggestion("g", history)).toBeNull();
    expect(findSuggestion("", history)).toBeNull();
  });

  it("returns null when input equals a history entry", () => {
    expect(findSuggestion("pnpm test", history)).toBeNull();
  });

  it("returns null for empty history", () => {
    expect(findSuggestion("git", [])).toBeNull();
  });

  it("matches partial commands", () => {
    expect(findSuggestion("pnpm d", history)).toBe("pnpm dev");
  });
});
