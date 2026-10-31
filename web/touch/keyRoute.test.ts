import { describe, expect, it } from "vitest";
import type { Owner } from "../app/focus";
import { decideKey, type KeyFacts } from "../tabs/keymap";
import { routeHardwareKey, type HardwareRoute } from "./keyRoute";

const facts = (key: string, over: Partial<KeyFacts> = {}): KeyFacts => ({
  type: "keydown", key, code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: false, keyCode: 0, ...over,
});
const route = (owner: Owner, key: string, over: Partial<KeyFacts> = {}, free = true): HardwareRoute => {
  const e = facts(key, over);
  return routeHardwareKey(decideKey(e, "owned"), e, owner, free);
};
const input = (...events: object[]): HardwareRoute => ({ to: "input", events } as HardwareRoute);
const ignore: HardwareRoute = { to: "ignore" };

type Row = [key: string, over: Partial<KeyFacts>, expected: HardwareRoute, free?: boolean];
const check = (owner: Owner, rows: Row[]): void => {
  for (const [key, over, expected, free = true] of rows) expect(route(owner, key, over, free), `${key} ${JSON.stringify(over)}`).toEqual(expected);
};
const row = (name: string): HardwareRoute => ({ to: "row", key: { name } });
const ctrlC = { ctrlKey: true, code: "KeyC" };

describe("routeHardwareKey", () => {
  it("owner terminal: sends every chord, Escape, Tab and arrow, leaves typing to beforeinput, and ignores `free`", () => {
    check("terminal", [
      ["c", ctrlC, input({ key: "C-c" })],
      ["Escape", {}, input({ key: "Escape" })],
      ["Tab", {}, input({ key: "Tab" })],
      ["ArrowLeft", {}, input({ key: "Left" })],
      ["b", { altKey: true, code: "KeyB" }, input({ key: "M-b" })],
      ["[", { ctrlKey: true }, input({ bytes: btoa("\x1b") })],
      ["a", {}, ignore],
      ["Enter", {}, ignore],
      ["Backspace", {}, ignore],
      ["Escape", {}, input({ key: "Escape" }), false],
    ]);
  });

  it("owner line: takes Control chords, Escape, Tab, up and down as key-row keys, keeps what edits the text, sends a control byte as input", () => {
    check("line", [
      ["c", ctrlC, row("C-c")],
      ["Escape", {}, row("Escape")],
      ["Tab", {}, row("Tab")],
      ["ArrowUp", {}, row("Up")],
      ["ArrowDown", {}, row("Down")],
      ...["ArrowLeft", "ArrowRight", "Home", "End", "Delete", "Backspace", "Enter", "a"].map((key): Row => [key, {}, ignore]),
      ["Backspace", { altKey: true }, ignore],
      ["ArrowLeft", { altKey: true }, ignore],
      ["/", { ctrlKey: true }, input({ bytes: btoa("\x1f") })],
    ]);
  });

  it("owner none: sends chords and named keys, types one code point as text, leaves the rest and a page that is not free alone", () => {
    check("none", [
      ["c", ctrlC, input({ key: "C-c" })],
      ["Tab", {}, input({ key: "Tab" })],
      ["ArrowUp", {}, input({ key: "Up" })],
      ["l", {}, input({ text: "l" })],
      ["L", { shiftKey: true }, input({ text: "L" })],
      [" ", {}, input({ text: " " })],
      ["å", {}, input({ text: "å" })],
      ["😀", {}, input({ text: "😀" })],
      ["Enter", {}, input({ key: "Enter" })],
      ["Backspace", {}, input({ key: "BSpace" })],
      ["Dead", {}, ignore],
      ["Shift", {}, ignore],
      ["CapsLock", {}, ignore],
      [".", { ctrlKey: true }, ignore],
      ["r", { metaKey: true }, ignore],
      ["F5", {}, ignore],
      ["a", { isComposing: true }, ignore],
      ["Process", { keyCode: 229 }, ignore],
      ["c", ctrlC, ignore, false],
      ["a", {}, ignore, false],
      ["Enter", {}, ignore, false],
    ]);
  });
});
