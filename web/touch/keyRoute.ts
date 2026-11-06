// Where a key-row key goes (terminal-interaction-design.md "The dock", the routing table). One
// pure rule for the line field. The key row also reads it to show which keys act on the box. No Preact, no window.
import type { Owner } from "../app/focus";
import type { InputEvent } from "../platform/types";
import type { KeyDecision } from "../tabs/keymap";
import { apply, type Armed } from "./modifiers";

/** A key-row key that is not a modifier: a named tmux key, or a character. */
export type RowKey = { name: string } | { text: string };

/** `aria` is set only where the visible label can't be read aloud as the key (the arrows, the caret chords). */
export type RowKeySpec =
  | { label: string; aria?: string; key: RowKey; repeat?: boolean }
  | { label: string; modifier: "ctrl" | "alt" };

// Order, for agent CLIs (Claude Code, Codex, opencode) first, and the row always opens esc, tab
// (Jimmy, 2026-10-29): esc (interrupt a turn, close a menu), tab (completion), the arrows (menus
// and history), then the modifiers and the shell's punctuation, then ⏎.
// The chords come last, past ⏎, so none sits in the first, easy-tap slots and ^Z (suspend) is
// never beside Return; ^C, the most destructive, is the very last. ⇧tab (mode cycling) is rare
// now and sits after the punctuation. ^S and ^Q are gone: ^S freezes a terminal with flow control on.
export const ROW_KEYS: RowKeySpec[] = [
  { label: "esc", key: { name: "Escape" } },
  { label: "tab", key: { name: "Tab" } },
  { label: "←", aria: "Left arrow", key: { name: "Left" }, repeat: true },
  { label: "↑", aria: "Up arrow", key: { name: "Up" }, repeat: true },
  { label: "↓", aria: "Down arrow", key: { name: "Down" }, repeat: true },
  { label: "→", aria: "Right arrow", key: { name: "Right" }, repeat: true },
  { label: "ctrl", modifier: "ctrl" },
  { label: "alt", modifier: "alt" },
  { label: "|", key: { text: "|" } },
  { label: "~", key: { text: "~" } },
  { label: "/", key: { text: "/" } },
  { label: "-", key: { text: "-" } },
  { label: "⇧tab", aria: "Shift tab", key: { name: "BTab" } },
  { label: "⏎", aria: "Return", key: { name: "Enter" } },
  { label: "^R", aria: "Control R", key: { name: "C-r" } },
  { label: "^Z", aria: "Control Z", key: { name: "C-z" } },
  { label: "^C", aria: "Control C", key: { name: "C-c" } },
];

export type Route =
  /** Input for the terminal, the armed modifier already applied. */
  | { to: "terminal"; events: InputEvent[] }
  /** The box's caret moves one character. */
  | { to: "caret"; step: -1 | 1 }
  /** Typing returns from the box to the terminal; the keyboard stays up. */
  | { to: "focusTerminal" }
  /** A character goes into the box at its caret. */
  | { to: "line"; text: string };

/** Who types: the key row and the native text path exist only while one of these holds the keyboard. */
export type KeyOwner = Exclude<Owner, "none">;

/**
 * The route for `key` and the armed state after it. A route is decided and the modifier it uses up
 * is committed together (`ArmedModifiers.route`), so a caller cannot route and forget to disarm.
 */
export function routeKey(key: RowKey, owner: KeyOwner, armed: Armed): { route: Route; armed: Armed } {
  if ("text" in key) {
    const applied = apply(armed, [{ text: key.text }]);
    // An armed modifier makes a chord for tmux wherever typing goes; a character with no chord is typed unmodified, which still uses the modifier up.
    if (owner === "line" && applied.events[0] && "text" in applied.events[0]) return { route: { to: "line", text: key.text }, armed: applied.armed };
    return { route: { to: "terminal", events: applied.events }, armed: applied.armed };
  }
  // Only an unmodified key acts on the box: armed, ← is the chord for tmux.
  if (owner === "line" && armed === null) {
    if (key.name === "Left") return { route: { to: "caret", step: -1 }, armed };
    if (key.name === "Right") return { route: { to: "caret", step: 1 }, armed };
    if (key.name === "Escape") return { route: { to: "focusTerminal" }, armed };
  }
  const applied = apply(armed, [{ key: key.name }]);
  return { route: { to: "terminal", events: applied.events }, armed: applied.armed };
}

/** The facts of a hardware `keydown` that `routeHardwareKey` reads beyond the key's decision. */
export interface HardwareKey {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type HardwareRoute =
  /** Not ours: the browser or the focused element keeps the key. */
  | { to: "ignore" }
  /** Input for the terminal, the armed modifier applied by the caller. */
  | { to: "input"; events: InputEvent[] }
  /** A key-row key: it goes where the row's key goes, so the line box's Escape returns to the terminal. */
  | { to: "row"; key: RowKey };

/** The keys the line box gives to tmux besides Control chords; the rest edit its text. */
const LINE_KEYS = new Set(["Escape", "Tab", "ArrowUp", "ArrowDown"]);

/**
 * Where a hardware key goes while input is owned: `decision` is `decideKey(event, "owned")`. A chord,
 * Escape, Tab or an arrow fires keydown and no beforeinput, so this sends it. The terminal's input
 * sends all of those; the line box only Control chords, Escape, Tab, up and down. With no box
 * focused (`free`: a terminal on screen, no dialog or menu, nothing else focused) the keys also go
 * to the terminal, and plain typing too, since no beforeinput follows: one code point of `key` as
 * text (Shift and Option have already shaped it), Enter and Backspace by name. `Dead` and longer
 * keys stay the browser's.
 */
export function routeHardwareKey(decision: KeyDecision, e: HardwareKey, owner: Owner, free: boolean): HardwareRoute {
  const ignore: HardwareRoute = { to: "ignore" };
  if (owner === "none" && !free) return ignore;
  if (decision.kind === "key" || decision.kind === "bytes") {
    if (owner === "line" && !e.ctrlKey && !LINE_KEYS.has(e.key)) return ignore;
    if (decision.kind === "bytes") return { to: "input", events: [{ bytes: decision.bytes }] };
    return owner === "line" ? { to: "row", key: { name: decision.name } } : { to: "input", events: [{ key: decision.name }] };
  }
  if (decision.kind !== "default" || owner !== "none" || e.ctrlKey || e.altKey || e.metaKey) return ignore;
  if (e.key === "Enter") return { to: "input", events: [{ key: "Enter" }] };
  if (e.key === "Backspace") return { to: "input", events: [{ key: "BSpace" }] };
  return Array.from(e.key).length === 1 ? { to: "input", events: [{ text: e.key }] } : ignore;
}
