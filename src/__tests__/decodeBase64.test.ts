import { describe, it, expect } from "vitest";
import { decodeBase64ToBytes } from "../shared/lib/decodeBase64";

describe("decodeBase64ToBytes", () => {
  it("decodes ASCII text", () => {
    const bytes = decodeBase64ToBytes(btoa("hello"));
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("decodes empty string", () => {
    const bytes = decodeBase64ToBytes(btoa(""));
    expect(bytes.length).toBe(0);
  });

  it("decodes binary data correctly", () => {
    // \x1b[31m = ANSI red color
    const original = "\x1b[31mred\x1b[0m";
    const bytes = decodeBase64ToBytes(btoa(original));
    expect(new TextDecoder().decode(bytes)).toBe(original);
  });

  it("returns Uint8Array", () => {
    const bytes = decodeBase64ToBytes(btoa("test"));
    expect(bytes).toBeInstanceOf(Uint8Array);
  });
});
