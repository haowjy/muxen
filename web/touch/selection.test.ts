import { describe, expect, it } from "vitest";
import { charsAcross } from "./selection";

describe("charsAcross", () => {
  it("counts characters, not cells, so wide and combining text moves the cursor right", () => {
    expect(charsAcross("ab日本", 4, "end")).toBe(2);
    expect(charsAcross("ab日本", 3, "end")).toBe(2); // lands inside 日: crossed whole
    expect(charsAcross("e\u0301x", 2, "end")).toBe(2);
    expect(charsAcross("日本cd", 4, "start")).toBe(2);
    expect(charsAcross("日本cd", 3, "start")).toBe(2); // the move stops inside 本: it crosses too
    expect(charsAcross("ab", 9, "start")).toBe(2);
  });
});
