import { describe, expect, it } from "vitest";
import { cellsOf } from "./rows";

describe("cellsOf", () => {
  it("gives a wide character or an emoji two cells and anything else one, as xterm does", () => {
    expect(cellsOf("a日b")).toEqual(["a", "日", "", "b"]);
    expect(cellsOf("e\u0301x")).toEqual(["e\u0301", "x"]);
    expect(cellsOf("😀")).toEqual(["😀", ""]);
    expect(cellsOf("©™✔")).toEqual(["©", "™", "✔"]);
  });
});
