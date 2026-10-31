import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideKey, type KeyDecision, type KeyFacts, type KeyMode } from "./keymap";

/** The names the clients may send, shared with the daemon's own test of `is_key_name`. */
const KEYS = new Set(JSON.parse(readFileSync(new URL("../../tests/fixtures/proto/keys.json", import.meta.url), "utf8")) as string[]);

/** The daemon's allowlist, as written beside `is_key_name` in src/tmux/command.rs. */
const ALLOWED = /^(?:[CM]-)*(?:(?:S-)?(?:Up|Down|Left|Right|Home|End|PageUp|PageDown|IC|DC|F(?:[1-9]|1[0-2]))|[A-Za-z0-9]|Enter|Escape|Tab|BTab|BSpace|Space)$/;

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
  });

  it("routes Escape and Tab, dropping Shift where the daemon's allowlist does not take it", () => {
    expect(name(decideKey(ev("Escape"), "xterm"))).toBe("Escape");
    expect(name(decideKey(ev("Escape", { shiftKey: true }), "xterm"))).toBe("Escape");
    expect(name(decideKey(ev("Tab"), "xterm"))).toBe("Tab");
    expect(name(decideKey(ev("Tab", { shiftKey: true }), "xterm"))).toBe("BTab");
    expect(name(decideKey(ev("Tab", { altKey: true }), "xterm"))).toBe("M-Tab");
  });

  it("sends Shift+Enter as CSI-u bytes, and plain Enter to xterm", () => {
    const shifted = decideKey(ev("Enter", { shiftKey: true }), "xterm");
    expect(shifted.kind === "bytes" && atob(shifted.bytes)).toBe("\x1b[13;2u");
    expect(decideKey(ev("Enter"), "xterm")).toEqual({ kind: "default" });
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

  it("does nothing while an IME composes, however the browser reports it", () => {
    expect(decideKey(ev("ArrowDown", { isComposing: true }), "xterm")).toEqual({ kind: "composing" });
    expect(decideKey(ev("Process", { keyCode: 229 }), "xterm")).toEqual({ kind: "composing" });
    expect(decideKey(ev("Enter", { isComposing: true, shiftKey: true }), "xterm")).toEqual({ kind: "composing" });
  });
});

describe("decideKey, owned input", () => {
  it("names Ctrl and Alt chords from the physical key, so Option's characters and Shift's case don't leak in", () => {
    expect(name(decideKey(ev("c", { ctrlKey: true, code: "KeyC" }), "owned"))).toBe("C-c");
    expect(name(decideKey(ev("X", { ctrlKey: true, shiftKey: true, code: "KeyX" }), "owned"))).toBe("C-X");
    expect(name(decideKey(ev("å", { altKey: true, code: "KeyA" }), "owned"))).toBe("M-a");
    expect(name(decideKey(ev("A", { altKey: true, shiftKey: true, code: "KeyA" }), "owned"))).toBe("M-A");
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

  it("keeps the case Shift gives a letter, for Ctrl as for Alt", () => {
    expect(name(decideKey(ev("A", { ctrlKey: true, shiftKey: true, code: "KeyA" }), "owned"))).toBe("C-A");
    expect(name(decideKey(ev("A", { ctrlKey: true, altKey: true, shiftKey: true, code: "KeyA" }), "owned"))).toBe("C-M-A");
  });
});

// The rules of the app's native KeyMapper (ios/TetherKit), which these cases came from.
describe("decideKey, owned input: punctuation chords", () => {
  const bytes = (...codes: number[]): KeyDecision => ({ kind: "bytes", bytes: btoa(String.fromCharCode(...codes)) });
  const owned = (key: string, over: Partial<KeyFacts> = {}): KeyDecision => decideKey(ev(key, over), "owned");

  it("sends Ctrl on [ \\ ] ^ _ / ? as the control byte", () => {
    expect(owned("[", { ctrlKey: true })).toEqual(bytes(0x1b));
    expect(owned("\\", { ctrlKey: true })).toEqual(bytes(0x1c));
    expect(owned("]", { ctrlKey: true })).toEqual(bytes(0x1d));
    expect(owned("^", { ctrlKey: true, shiftKey: true })).toEqual(bytes(0x1e));
    expect(owned("_", { ctrlKey: true, shiftKey: true })).toEqual(bytes(0x1f));
    expect(owned("/", { ctrlKey: true })).toEqual(bytes(0x1f));
    expect(owned("?", { ctrlKey: true, shiftKey: true })).toEqual(bytes(0x7f));
  });

  it("puts ESC before the control byte when Alt is held too", () => {
    expect(owned("[", { ctrlKey: true, altKey: true })).toEqual(bytes(0x1b, 0x1b));
    expect(owned("/", { ctrlKey: true, altKey: true })).toEqual(bytes(0x1b, 0x1f));
  });

  it("sends Alt on every printable ASCII punctuation as ESC and the character", () => {
    for (let code = 0x21; code <= 0x7e; code++) {
      const char = String.fromCharCode(code);
      if (/[A-Za-z0-9]/.test(char)) continue;
      expect(owned(char, { altKey: true }), `Alt+${char}`).toEqual(bytes(0x1b, code));
    }
  });

  it("reads Option+punctuation on macOS from the physical key, where `key` is a symbol", () => {
    expect(owned("≥", { altKey: true, code: "Period" })).toEqual(bytes(0x1b, 0x2e));
    expect(owned("¯", { altKey: true, shiftKey: true, code: "Comma" })).toEqual(bytes(0x1b, 0x3c));
  });

  it("names Space with its modifiers and leaves a plain or Ctrl-only punctuation key alone", () => {
    expect(name(owned(" ", { ctrlKey: true }))).toBe("C-Space");
    expect(name(owned(" ", { altKey: true }))).toBe("M-Space");
    expect(owned(".", { ctrlKey: true })).toEqual({ kind: "default" });
    expect(owned(".")).toEqual({ kind: "default" });
  });

  it("leaves Cmd combinations to the browser and Shift+Enter as CSI u", () => {
    expect(owned("[", { metaKey: true, altKey: true })).toEqual({ kind: "browser" });
    expect(owned("Enter", { shiftKey: true })).toEqual({ kind: "bytes", bytes: btoa("\x1b[13;2u") });
  });

  it("names the control keys KeyMapper does: Tab, Shift+Tab, Esc, arrows with modifiers", () => {
    expect(name(owned("Tab"))).toBe("Tab");
    expect(name(owned("Tab", { shiftKey: true }))).toBe("BTab");
    expect(name(owned("Escape", { altKey: true }))).toBe("M-Escape");
    expect(name(owned("ArrowUp", { ctrlKey: true, shiftKey: true }))).toBe("C-S-Up");
    expect(name(owned("Backspace", { ctrlKey: true }))).toBe("C-BSpace");
  });
});

describe("every name the handler can produce is in keys.json and the daemon's allowlist", () => {
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

  it("passes the daemon's regex", () => {
    for (const n of names) expect(ALLOWED.test(n), n).toBe(true);
  });

  it("is listed in keys.json, which the Rust tests check", () => {
    expect([...names].filter((n) => !KEYS.has(n)).sort()).toEqual([]);
  });
});
