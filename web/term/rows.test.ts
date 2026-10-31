import { describe, expect, it } from "vitest";
import { cellsOf, historyRows, parseSgrRow, rowText } from "./rows";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("parseSgrRow", () => {
  it("splits runs where the style changes, reads 256-colour, 24-bit and bright colours, and drops other escapes", () => {
    const runs = parseSgrRow(bytes("plain \x1b[1;31mred bold\x1b[0m done"));
    expect(runs.map((r) => r.text)).toEqual(["plain ", "red bold", " done"]);
    expect(runs[1]?.style).toEqual({ bold: true, fg: 1 });
    expect(runs[2]?.style).toEqual({});
    expect(parseSgrRow(bytes("\x1b[38;5;202ma\x1b[48;2;1;2;3mb\x1b[93mc")).map((r) => r.style)).toEqual([{ fg: 202 }, { fg: 202, bg: "#010203" }, { fg: 11, bg: "#010203" }]);
    expect(rowText({ runs: parseSgrRow(bytes("a\x1b[2Kb 日本 \x1b[m")), wrapped: false })).toBe("ab 日本 ");
  });
});

describe("historyRows", () => {
  it("marks the row after a continuing one as wrapped, and keeps the blanks only where the line goes on", () => {
    const rows = historyRows([
      { bytes: bytes("long line "), continues: true },
      { bytes: bytes("tail   "), continues: false },
      { bytes: bytes("next   "), continues: false },
    ]);
    expect(rows.map((r) => [rowText(r), r.wrapped])).toEqual([["long line ", false], ["tail", true], ["next", false]]);
  });
});

describe("cellsOf", () => {
  it("gives a wide character or an emoji two cells and anything else one, as xterm does", () => {
    expect(cellsOf("a日b")).toEqual(["a", "日", "", "b"]);
    expect(cellsOf("e\u0301x")).toEqual(["e\u0301", "x"]);
    expect(cellsOf("😀")).toEqual(["😀", ""]);
    expect(cellsOf("©™✔")).toEqual(["©", "™", "✔"]);
  });
});
