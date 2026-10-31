import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideKey, type KeyDecision, type KeyFacts, type KeyMode } from "./keymap";

/** The names the clients may send, shared with the daemon's own test of `is_key_name`. */
const KEYS = new Set(JSON.parse(readFileSync(new URL("../../tests/fixtures/proto/keys.json", import.meta.url), "utf8")) as string[]);

const ev = (key: string, over: Partial<KeyFacts> = {}): KeyFacts => ({
  type: "keydown",
  key,
  code: "",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  isComposing: false,
  keyCode: 0,
  ...over,
});

const name = (d: KeyDecision): string | undefined => (d.kind === "key" ? d.name : undefined);

describe("decideKey, desktop", () => {
  it("routes arrows, navigation keys and F-keys by tmux name, with C-, M- and S- modifiers", () => {
    expect(name(decideKey(ev("ArrowUp"), "xterm"))).toBe("Up");
    expect(name(decideKey(ev("ArrowLeft", { ctrlKey: true }), "xterm"))).toBe("C-Left");
    expect(name(decideKey(ev("ArrowRight", { altKey: true, shiftKey: true }), "xterm"))).toBe("M-S-Right");
    expect(name(decideKey(ev("Insert"), "xterm"))).toBe("IC");
    expect(name(decideKey(ev("Delete", { shiftKey: true }), "xterm"))).toBe("S-DC");
    expect(name(decideKey(ev("PageDown"), "xterm"))).toBe("PageDown");
    expect(name(decideKey(ev("F9", { ctrlKey: true, altKey: true }), "xterm"))).toBe("C-M-F9");
    // Escape and Tab; Shift is dropped where the daemon's allowlist does not take it.
    expect(name(decideKey(ev("Escape"), "xterm"))).toBe("Escape");
    expect(name(decideKey(ev("Escape", { shiftKey: true }), "xterm"))).toBe("Escape");
    expect(name(decideKey(ev("Tab"), "xterm"))).toBe("Tab");
    expect(name(decideKey(ev("Tab", { shiftKey: true }), "xterm"))).toBe("BTab");
    expect(name(decideKey(ev("Tab", { altKey: true }), "xterm"))).toBe("M-Tab");
  });

  it("leaves printable text, Ctrl-letters and Backspace to xterm's own encoding", () => {
    expect(decideKey(ev("a"), "xterm")).toEqual({ kind: "default" });
    expect(decideKey(ev("c", { ctrlKey: true }), "xterm")).toEqual({ kind: "default" });
    expect(decideKey(ev("Backspace"), "xterm")).toEqual({ kind: "default" });
  });

  it("keeps the browser's shortcuts: Cmd combinations, F5, F6, F11, F12, Ctrl+Shift+V", () => {
    for (const key of ["F5", "F6", "F11", "F12"]) expect(decideKey(ev(key), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("F5", { ctrlKey: true }), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("t", { metaKey: true }), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("ArrowLeft", { metaKey: true }), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("М", { ctrlKey: true, shiftKey: true, code: "KeyV" }), "xterm")).toEqual({ kind: "browser" });
  });

  it("matches Ctrl+Shift+C and F by physical key across layouts", () => {
    expect(decideKey(ev("С", { ctrlKey: true, shiftKey: true, code: "KeyC" }), "xterm")).toEqual({ kind: "copy" });
    expect(decideKey(ev("А", { ctrlKey: true, shiftKey: true, code: "KeyF" }), "xterm")).toEqual({ kind: "leave" });
    expect(decideKey(ev("А", { ctrlKey: true, shiftKey: true, code: "KeyF" }), "owned")).toEqual({ kind: "leave" });
    expect(decideKey(ev("а", { ctrlKey: true, code: "KeyF" }), "xterm")).toEqual({ kind: "default" });
  });
});

describe("decideKey, owned input", () => {
  it("names Ctrl and Alt chords from the physical key, so Option's characters don't leak in, and keeps the case Shift gives a letter", () => {
    expect(name(decideKey(ev("c", { ctrlKey: true, code: "KeyC" }), "owned"))).toBe("C-c");
    expect(name(decideKey(ev("X", { ctrlKey: true, shiftKey: true, code: "KeyX" }), "owned"))).toBe("C-X");
    expect(name(decideKey(ev("å", { altKey: true, code: "KeyA" }), "owned"))).toBe("M-a");
    expect(name(decideKey(ev("A", { altKey: true, shiftKey: true, code: "KeyA" }), "owned"))).toBe("M-A");
    expect(name(decideKey(ev("A", { ctrlKey: true, altKey: true, shiftKey: true, code: "KeyA" }), "owned"))).toBe("C-M-A");
    expect(name(decideKey(ev("2", { altKey: true, code: "Digit2" }), "owned"))).toBe("M-2");
    expect(name(decideKey(ev("x", { ctrlKey: true, altKey: true, code: "KeyX" }), "owned"))).toBe("C-M-x");
    expect(name(decideKey(ev(" ", { ctrlKey: true }), "owned"))).toBe("C-Space");
    expect(name(decideKey(ev("Backspace", { altKey: true }), "owned"))).toBe("M-BSpace");
    expect(name(decideKey(ev("Enter", { altKey: true }), "owned"))).toBe("M-Enter");
  });

  it("leaves plain printable keys to beforeinput, and still routes the named keys", () => {
    expect(decideKey(ev("a", { code: "KeyA" }), "owned")).toEqual({ kind: "default" });
    expect(decideKey(ev("Backspace"), "owned")).toEqual({ kind: "default" });
    expect(name(decideKey(ev("ArrowUp"), "owned"))).toBe("Up");
    expect(name(decideKey(ev("Escape"), "owned"))).toBe("Escape");
  });

  it("names a Ctrl letter from the layout, falling back to the physical key when `key` is no ASCII character", () => {
    // AZERTY: the physical Q types a, W types z, M types a comma, and the digit row types symbols.
    expect(name(decideKey(ev("a", { ctrlKey: true, code: "KeyQ" }), "owned"))).toBe("C-a");
    expect(name(decideKey(ev("z", { ctrlKey: true, code: "KeyW" }), "owned"))).toBe("C-z");
    expect(decideKey(ev(",", { ctrlKey: true, code: "KeyM" }), "owned")).toEqual({ kind: "default" });
    expect(decideKey(ev("&", { ctrlKey: true, code: "Digit1" }), "owned")).toEqual({ kind: "default" });
    expect(name(decideKey(ev("A", { ctrlKey: true, shiftKey: true, code: "KeyQ" }), "owned"))).toBe("C-A");
    expect(name(decideKey(ev("a", { altKey: true, code: "KeyQ" }), "owned"))).toBe("M-a");
    expect(name(decideKey(ev("с", { ctrlKey: true, code: "KeyC" }), "owned"))).toBe("C-c");
    expect(name(decideKey(ev("¡", { altKey: true, code: "Digit1" }), "owned"))).toBe("M-1");
  });
});

// The rules of the app's native KeyMapper (ios/MuxenKit), which these cases came from.
describe("decideKey, owned input: punctuation chords", () => {
  const bytes = (...codes: number[]): KeyDecision => ({ kind: "bytes", bytes: btoa(String.fromCharCode(...codes)) });
  /** The US-layout physical keys the punctuation characters come from, so events carry the `code` a browser reports. */
  const CODES: Record<string, string> = {
    "[": "BracketLeft", "{": "BracketLeft", "]": "BracketRight", "}": "BracketRight", "\\": "Backslash", "|": "Backslash", "/": "Slash", "?": "Slash",
    ".": "Period", ">": "Period", ",": "Comma", "<": "Comma", ";": "Semicolon", ":": "Semicolon", "'": "Quote", '"': "Quote", "`": "Backquote", "~": "Backquote",
    "-": "Minus", "_": "Minus", "=": "Equal", "+": "Equal", "^": "Digit6", "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0",
    "!": "Digit1", "@": "Digit2", "#": "Digit3", "$": "Digit4", "%": "Digit5",
  };
  const owned = (key: string, over: Partial<KeyFacts> = {}): KeyDecision => decideKey(ev(key, { code: CODES[key] ?? "", ...over }), "owned");

  it("sends Ctrl on punctuation as the control byte (ESC first with Alt), names the control keys, and leaves the rest alone", () => {
    expect(owned("[", { ctrlKey: true })).toEqual(bytes(0x1b));
    expect(owned("\\", { ctrlKey: true })).toEqual(bytes(0x1c));
    expect(owned("]", { ctrlKey: true })).toEqual(bytes(0x1d));
    expect(owned("^", { ctrlKey: true, shiftKey: true })).toEqual(bytes(0x1e));
    expect(owned("_", { ctrlKey: true, shiftKey: true })).toEqual(bytes(0x1f));
    expect(owned("/", { ctrlKey: true })).toEqual(bytes(0x1f));
    expect(owned("?", { ctrlKey: true, shiftKey: true })).toEqual(bytes(0x7f));
    expect(owned("[", { ctrlKey: true, altKey: true })).toEqual(bytes(0x1b, 0x1b));
    expect(owned("/", { ctrlKey: true, altKey: true })).toEqual(bytes(0x1b, 0x1f));
    expect(owned(".", { ctrlKey: true })).toEqual({ kind: "default" });
    expect(owned(".")).toEqual({ kind: "default" });
    expect(name(owned(" ", { ctrlKey: true }))).toBe("C-Space");
    expect(name(owned("Tab"))).toBe("Tab");
    expect(name(owned("Tab", { shiftKey: true }))).toBe("BTab");
    expect(name(owned("Escape", { altKey: true }))).toBe("M-Escape");
    expect(name(owned("ArrowUp", { ctrlKey: true, shiftKey: true }))).toBe("C-S-Up");
    expect(name(owned("Backspace", { ctrlKey: true }))).toBe("C-BSpace");
  });

  it("sends Alt on every printable ASCII punctuation as ESC and the character, reading Option+punctuation on macOS from the physical key", () => {
    for (let code = 0x21; code <= 0x7e; code++) {
      const char = String.fromCharCode(code);
      if (/[A-Za-z0-9]/.test(char)) continue;
      expect(owned(char, { altKey: true }), `Alt+${char}`).toEqual(bytes(0x1b, code));
    }
    expect(owned("≥", { altKey: true, code: "Period" })).toEqual(bytes(0x1b, 0x2e));
    expect(owned("¯", { altKey: true, shiftKey: true, code: "Comma" })).toEqual(bytes(0x1b, 0x3c));
    expect(name(owned(" ", { altKey: true }))).toBe("M-Space");
  });
});

describe("every name the handler can produce is in keys.json", () => {
  const keys = [
    ..."abcdefghijklmnopqrstuvwxyz".split("").map((k) => ev(k, { code: `Key${k.toUpperCase()}` })),
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((k) => ev(k, { code: `Key${k}`, shiftKey: true })),
    ..."0123456789".split("").map((k) => ev(k, { code: `Digit${k}` })),
    ...["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert", "Delete", "Escape", "Tab", "Enter", "Backspace", " "].map((k) => ev(k)),
    ...Array.from({ length: 12 }, (_, i) => ev(`F${String(i + 1)}`)),
  ];
  const modes: KeyMode[] = ["xterm", "owned"];
  const names = new Set<string>();
  for (const mode of modes) {
    for (const base of keys) {
      for (let bits = 0; bits < 8; bits++) {
        const d = decideKey({ ...base, ctrlKey: (bits & 1) !== 0, altKey: (bits & 2) !== 0, shiftKey: base.shiftKey || (bits & 4) !== 0 }, mode);
        if (d.kind === "key") names.add(d.name);
      }
    }
  }

  it("is listed in keys.json, which the Rust tests check", () => {
    expect([...names].filter((n) => !KEYS.has(n)).sort()).toEqual([]);
  });
});
