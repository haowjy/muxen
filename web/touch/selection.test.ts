import { describe, expect, it } from "vitest";
import { budgetStart, charsAcross, selectedText, wordAt } from "./selection";

const cells = (s: string): string[] => s.split("");

describe("wordAt", () => {
  const wide = ["x", " ", "日", "", "本", "", "y"];
  it.each([
    ["ls -la /usr/bin", cells("ls -la /usr/bin"), 8, { from: 7, to: 15 }], // non-separators around the cell
    ["ls -la /usr/bin", cells("ls -la /usr/bin"), 0, { from: 0, to: 2 }],
    ["f(arg1, 'b')", cells("f(arg1, 'b')"), 3, { from: 2, to: 6 }], // stops at brackets and quotes like xterm
    ["f(arg1, 'b')", cells("f(arg1, 'b')"), 1, { from: 1, to: 2 }],
    ["a  b", cells("a  b"), 1, null], // blank cell
    ["ab", cells("ab"), 5, null], // past the row
    ["wide", wide, 3, { from: 2, to: 5 }], // a wide character counts once; columns map to text offsets
    ["wide", wide, 6, { from: 2, to: 5 }],
  ])("case %# (%s)", (_name, row, column, expected) => {
    expect(wordAt(row, column)).toEqual(expected);
  });
});

describe("selectedText", () => {
  const lines = ["    indented line", "", "a long command that wrapped across rows   ", "last"];
  it("copies from the endpoints only, and drops trailing blanks only where the line's end is part of the copy", () => {
    expect(selectedText(lines, { line: 0, offset: 0 }, { line: 3, offset: 4 })).toBe("    indented line\n\na long command that wrapped across rows\nlast");
    expect(selectedText(lines, { line: 0, offset: 4 }, { line: 0, offset: 12 })).toBe("indented");
    expect(selectedText(lines, { line: 2, offset: 2 }, { line: 3, offset: 2 })).toBe("long command that wrapped across rows\nla");
    expect(selectedText(lines, { line: 2, offset: 0 }, { line: 2, offset: 6 })).toBe("a long");
    expect(selectedText(["ab   "], { line: 0, offset: 0 }, { line: 0, offset: 4 })).toBe("ab  ");
  });
});

describe("budgetStart", () => {
  it("keeps everything under the budget, the rows in view and 2000 above them, and drops by bytes without dropping the rows in view", () => {
    expect(budgetStart(Array.from({ length: 10 }, () => 10), 8, 10)).toBe(0);
    const bytes = Array.from({ length: 10_000 }, () => 10);
    expect(budgetStart(bytes, 5000, 5024)).toBe(3000);
    expect(budgetStart(bytes, 500, 524)).toBe(0);
    const heavy = Array.from({ length: 100 }, () => 10_000);
    const start = budgetStart(heavy, 90, 100);
    expect(100 - start).toBeLessThanOrEqual(52);
    expect(start).toBeGreaterThan(0);
    expect(budgetStart(heavy.map(() => 100_000), 90, 100)).toBe(90);
  });
});

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
