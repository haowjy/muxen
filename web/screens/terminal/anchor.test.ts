import { describe, expect, it } from "vitest";
import { locateRun } from "./anchor";

describe("locateRun", () => {
  const repeated = ["", "", "", "", "x", "", ""];
  it.each([
    [["a", "b", "c", "d", "e"], ["d", "e"], 3, 3], // where it was expected
    [["a", "b", "c", "d", "e"], ["c", "d"], 3, 2], // moved: the numbering shifted
    [repeated, ["", ""], 5, 5], // the match nearest the expected place
    [repeated, ["", ""], 1, 1],
    [["", "", "", ""], [""], 1.5, 1], // the older of two equally near
    [["a", "b"], ["z"], 0, null], // not there
    [["a"], ["a", "b"], 0, null],
  ])("%j finding %j near %d is %j", (rows, run, near, at) => {
    expect(locateRun(rows, run, near)).toBe(at);
  });
});
