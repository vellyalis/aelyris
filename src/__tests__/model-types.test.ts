import { describe, it, expect } from "vitest";
import { MODEL_OPTIONS, DEFAULT_MODEL_ID, getModelById } from "../shared/types/model";

describe("Model Types", () => {
  it("all options have required fields", () => {
    for (const m of MODEL_OPTIONS) {
      expect(m.id).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.provider).toBeTruthy();
      expect(m.cliCommand).toBeTruthy();
      expect(m.modelArg).toBeTruthy();
      expect(m.color).toMatch(/^#/);
    }
  });

  it("IDs are unique", () => {
    const ids = MODEL_OPTIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DEFAULT_MODEL_ID exists in options", () => {
    expect(MODEL_OPTIONS.find((m) => m.id === DEFAULT_MODEL_ID)).toBeDefined();
  });

  it("getModelById returns correct model", () => {
    const opus = getModelById("claude-opus");
    expect(opus?.label).toBe("Claude Opus");
    expect(opus?.provider).toBe("claude");
  });

  it("getModelById returns undefined for unknown", () => {
    expect(getModelById("nonexistent")).toBeUndefined();
  });

  it("has at least 3 providers", () => {
    const providers = new Set(MODEL_OPTIONS.map((m) => m.provider));
    expect(providers.size).toBeGreaterThanOrEqual(3);
  });
});
