import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  getMaxTokens,
  getModelById,
  getModelBySpecifier,
  MODEL_OPTIONS,
} from "../shared/types/model";

describe("MODEL_OPTIONS", () => {
  it("has at least 3 models", () => {
    expect(MODEL_OPTIONS.length).toBeGreaterThanOrEqual(3);
  });

  it("each model has required fields", () => {
    for (const m of MODEL_OPTIONS) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.provider).toBeTruthy();
      expect(m.cliCommand).toBeTruthy();
      expect(m.color).toMatch(/^(#|var\()/);
      expect(m.maxTokens).toBeGreaterThan(0);
    }
  });

  it("has unique IDs", () => {
    const ids = MODEL_OPTIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getModelById", () => {
  it("finds existing model", () => {
    const model = getModelById("claude-sonnet");
    expect(model).toBeDefined();
    expect(model?.label).toBe("Claude Sonnet");
  });

  it("returns undefined for unknown model", () => {
    expect(getModelById("nonexistent")).toBeUndefined();
  });
});

describe("getMaxTokens", () => {
  it("returns correct tokens for known model", () => {
    expect(getMaxTokens("claude-opus")).toBe(200_000);
    expect(getMaxTokens("gemini")).toBe(1_000_000);
  });

  it("returns fallback for unknown model", () => {
    expect(getMaxTokens("unknown-model")).toBe(200_000);
  });

  it("accepts backend model arguments, not only UI option ids", () => {
    expect(getModelBySpecifier("gemini-2.5-pro")?.id).toBe("gemini");
    expect(getModelBySpecifier("codex-mini")?.id).toBe("codex");
    expect(getModelBySpecifier("sonnet")?.id).toBe("claude-sonnet");
    expect(getMaxTokens("gemini-2.5-pro")).toBe(1_000_000);
    expect(getMaxTokens("codex-mini")).toBe(192_000);
  });
});

describe("DEFAULT_MODEL_ID", () => {
  it("references a valid model", () => {
    expect(getModelById(DEFAULT_MODEL_ID)).toBeDefined();
  });
});
