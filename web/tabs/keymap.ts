// KeyboardEvent to tmux key names (client-architecture.md §7.2, §7.3). Pure: the DOM
// handlers in term/xterm-input.ts and touch/owned-input.ts feed it plain facts, and it says
// what to do. Every name it can produce is in tests/fixtures/proto/keys.json, which the
// daemon's tests check against its allowlist regex (`is_key_name`). A Ctrl or Alt chord on a
// character is `chord()` in touch/modifiers.ts, shared with the armed key row.
import { chord } from "../touch/modifiers";

/** The facts of a `KeyboardEvent` this decision reads. */
export interface KeyFacts {
  /** `keydown`, `keypress` or `keyup`: the same key is routed the same way on each. */
  type: string;
  key: string;
  /** The physical key (`KeyA`, `Digit1`), which names a letter even when Option or Alt changed `key`. */
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

export type KeyDecision =
  /** An IME is composing: it keeps its arrows, Enter and Escape, so nothing is routed. */
  | { kind: "composing" }
  /** The browser's own: every Cmd combination, F5, F6, F11, F12, and Ctrl+Shift+V (paste). */
  | { kind: "browser" }
  /** Sent by tmux name; the event is cancelled. */
  | { kind: "key"; name: string }
  /** Sent as raw bytes (base64); the event is cancelled. Shift+Enter, which tmux 3.4 types as text. */
  | { kind: "bytes"; bytes: string }
  /** Ctrl+Shift+C: copy the selection. */
  | { kind: "copy" }
  /** Ctrl+Shift+F: leave the terminal for the tab strip. */
  | { kind: "leave" }
  /** Not routed here: xterm's own encoding in xterm mode, nothing in owned mode (the text arrives through `beforeinput`). */
  | { kind: "default" };

/** Which source is live: xterm's textarea, or muxen's owned input on a phone. */
export type KeyMode = "xterm" | "owned";

const NAVIGATION: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "IC",
  Delete: "DC",
};

/** F5, F6, F11 and F12 (reload, the address bar or next pane, full screen, devtools) stay the browser's. */
const FUNCTION = /^F(?:[1-4]|[7-9]|10)$/;
const BROWSER_FUNCTION = /^F(?:5|6|11|12)$/;
const SHIFT_ENTER_BYTES = btoa("\x1b[13;2u");

/** `C-`, `M-`, then `S-` where the daemon's allowlist takes it: before navigation and function keys only. */
function modified(e: KeyFacts, name: string, shiftable: boolean): string {
  return `${e.ctrlKey ? "C-" : ""}${e.altKey ? "M-" : ""}${shiftable && e.shiftKey ? "S-" : ""}${name}`;
}

/** The punctuation keys of a US layout, unshifted and shifted, for when `key` is no ASCII character (Option on macOS). */
const PUNCTUATION: Record<string, readonly [string, string]> = {
  Backquote: ["`", "~"], Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"],
  Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", '"'], Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"],
};

/**
 * The character a Ctrl or Alt chord means: what the layout typed (`key`), so Ctrl+A is `C-a` on AZERTY
 * where A is the physical Q. Only when `key` is no ASCII character does the physical key stand in: Option
 * on macOS turns `key` into a symbol, and a Cyrillic or Greek layout types no Latin letter.
 */
function printable(e: KeyFacts): string | null {
  if (/^[\x21-\x7e]$/.test(e.key)) return e.key;
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
  if (letter) return letter.toLowerCase();
  const digit = /^Digit(\d)$/.exec(e.code)?.[1];
  if (digit) return digit;
  return PUNCTUATION[e.code]?.[e.shiftKey ? 1 : 0] ?? null;
}

export function decideKey(e: KeyFacts, mode: KeyMode): KeyDecision {
  if (e.isComposing || e.keyCode === 229) return { kind: "composing" };
  // Cmd (and a Super key elsewhere) is never a terminal key: the browser's shortcuts keep their meaning.
  if (e.metaKey || BROWSER_FUNCTION.test(e.key)) return { kind: "browser" };
  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    const key = printable(e)?.toLowerCase();
    if (key === "c") return { kind: "copy" };
    // No default Chrome, Firefox or Safari shortcut takes Ctrl+Shift+F on macOS, Linux or Windows, and a terminal cannot tell it from Ctrl+F.
    if (key === "f") return { kind: "leave" };
    if (key === "v") return { kind: "browser" };
  }
  const nav = NAVIGATION[e.key];
  if (nav) return { kind: "key", name: modified(e, nav, true) };
  if (FUNCTION.test(e.key)) return { kind: "key", name: modified(e, e.key, true) };
  if (e.key === "Escape") return { kind: "key", name: modified(e, "Escape", false) };
  if (e.key === "Tab") return { kind: "key", name: modified(e, e.shiftKey ? "BTab" : "Tab", false) };
  if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey) return { kind: "bytes", bytes: SHIFT_ENTER_BYTES };
  if (mode === "owned") return decideOwned(e);
  return { kind: "default" };
}

/**
 * A hardware keyboard on a phone fires `keydown` and no `beforeinput` for Ctrl or Alt
 * chords, so those are named here: Ctrl+printable as `C-<key>` and Alt+printable as
 * `M-<key>`. Plain printable keys arrive once, through `beforeinput`.
 */
function decideOwned(e: KeyFacts): KeyDecision {
  if (!e.ctrlKey && !e.altKey) return { kind: "default" };
  switch (e.key) {
    case "Enter":
      return { kind: "key", name: modified(e, "Enter", false) };
    case "Backspace":
      return { kind: "key", name: modified(e, "BSpace", false) };
  }
  const key = e.key === " " ? " " : printable(e);
  const event = key && chord({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }, key);
  if (!event) return { kind: "default" };
  return "bytes" in event ? { kind: "bytes", bytes: event.bytes } : { kind: "key", name: event.key };
}
