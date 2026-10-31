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

describe("routeHardwareKey: owner terminal", () => {
  it("sends every chord, Escape, Tab and arrow, and leaves typing to beforeinput", () => {
    expect(route("terminal", "c", { ctrlKey: true, code: "KeyC" })).toEqual(input({ key: "C-c" }));
    expect(route("terminal", "Escape")).toEqual(input({ key: "Escape" }));
    expect(route("terminal", "Tab")).toEqual(input({ key: "Tab" }));
    expect(route("terminal", "ArrowLeft")).toEqual(input({ key: "Left" }));
    expect(route("terminal", "b", { altKey: true, code: "KeyB" })).toEqual(input({ key: "M-b" }));
    expect(route("terminal", "[", { ctrlKey: true })).toEqual(input({ bytes: btoa("\x1b") }));
    expect(route("terminal", "a")).toEqual(ignore);
    expect(route("terminal", "Enter")).toEqual(ignore);
    expect(route("terminal", "Backspace")).toEqual(ignore);
  });
});

describe("routeHardwareKey: owner line", () => {
  it("takes Control chords, Escape, Tab, up and down, as a key-row key", () => {
    expect(route("line", "c", { ctrlKey: true, code: "KeyC" })).toEqual({ to: "row", key: { name: "C-c" } });
    expect(route("line", "Escape")).toEqual({ to: "row", key: { name: "Escape" } });
    expect(route("line", "Tab")).toEqual({ to: "row", key: { name: "Tab" } });
    expect(route("line", "ArrowUp")).toEqual({ to: "row", key: { name: "Up" } });
    expect(route("line", "ArrowDown")).toEqual({ to: "row", key: { name: "Down" } });
  });

  it("keeps what edits the text", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Delete", "Backspace", "Enter", "a"]) expect(route("line", key), key).toEqual(ignore);
    expect(route("line", "Backspace", { altKey: true })).toEqual(ignore);
    expect(route("line", "ArrowLeft", { altKey: true })).toEqual(ignore);
  });

  it("sends a control byte as input", () => {
    expect(route("line", "/", { ctrlKey: true })).toEqual(input({ bytes: btoa("\x1f") }));
  });
});

describe("routeHardwareKey: owner none", () => {
  it("sends chords and the named keys to the terminal", () => {
    expect(route("none", "c", { ctrlKey: true, code: "KeyC" })).toEqual(input({ key: "C-c" }));
    expect(route("none", "Tab")).toEqual(input({ key: "Tab" }));
    expect(route("none", "ArrowUp")).toEqual(input({ key: "Up" }));
  });

  it("types one code point as text, Enter and Backspace by name", () => {
    expect(route("none", "l")).toEqual(input({ text: "l" }));
    expect(route("none", "L", { shiftKey: true })).toEqual(input({ text: "L" }));
    expect(route("none", " ")).toEqual(input({ text: " " }));
    expect(route("none", "å")).toEqual(input({ text: "å" }));
    expect(route("none", "😀")).toEqual(input({ text: "😀" }));
    expect(route("none", "Enter")).toEqual(input({ key: "Enter" }));
    expect(route("none", "Backspace")).toEqual(input({ key: "BSpace" }));
  });

  it("leaves dead keys, longer keys, an unchorded Ctrl key and the browser's own alone", () => {
    expect(route("none", "Dead")).toEqual(ignore);
    expect(route("none", "Shift")).toEqual(ignore);
    expect(route("none", "CapsLock")).toEqual(ignore);
    expect(route("none", ".", { ctrlKey: true })).toEqual(ignore);
    expect(route("none", "r", { metaKey: true })).toEqual(ignore);
    expect(route("none", "F5")).toEqual(ignore);
    expect(route("none", "a", { isComposing: true })).toEqual(ignore);
    expect(route("none", "Process", { keyCode: 229 })).toEqual(ignore);
  });

  it("does nothing when the page is not free: another element, a dialog or menu, no terminal on screen", () => {
    expect(route("none", "c", { ctrlKey: true, code: "KeyC" }, false)).toEqual(ignore);
    expect(route("none", "a", {}, false)).toEqual(ignore);
    expect(route("none", "Enter", {}, false)).toEqual(ignore);
  });

  it("is not blocked by `free` when a box owns the keyboard", () => {
    expect(route("terminal", "Escape", {}, false)).toEqual(input({ key: "Escape" }));
  });
});
