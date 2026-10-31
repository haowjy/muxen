import { describe, expect, it } from "vitest";
import { decodeChunk } from "./decode";
import { rowText } from "./rows";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("decodeChunk", () => {
  it("starts every row in the default style, reads 256-colour, 24-bit and bright colours, and keeps xterm's cells", async () => {
    const [first, second] = await decodeChunk(
      [{ bytes: bytes("\x1b[1;31mred bold\x1b[38;5;202mo\x1b[48;2;1;2;3mb\x1b[93mc"), continues: false }, { bytes: bytes("日本x"), continues: false }],
      12,
    );
    expect(first?.runs.map((run) => run.style)).toEqual([{ bold: true, fg: 1 }, { bold: true, fg: 202 }, { bold: true, fg: 202, bg: "#010203" }, { bold: true, fg: 11, bg: "#010203" }]);
    expect(second?.runs).toEqual([{ text: "日本x", style: {} }]);
    expect(second?.cells).toEqual(["日", "", "本", "", "x", " ", " ", " ", " ", " ", " ", " "]);
  });

  it("marks the row after a continuing one as wrapped, and keeps the blanks only where the line goes on", async () => {
    const rows = await decodeChunk(
      [{ bytes: bytes("long line "), continues: true }, { bytes: bytes("tail   "), continues: false }, { bytes: bytes("next   "), continues: false }],
      10,
    );
    expect(rows.map((r) => [rowText(r), r.wrapped])).toEqual([["long line ", false], ["tail", true], ["next", false]]);
  });
});
