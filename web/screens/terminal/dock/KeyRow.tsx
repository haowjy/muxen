// The dock's key row (client-architecture.md §7.4): the keys a phone keyboard lacks, on a KeyStrip.
// Where a key goes (tmux, or the compose box that holds the keyboard) is `routeKey`'s decision;
// ctrl and alt arm the next key.
import { useApp } from "../../../app/context";
import { KeyStrip } from "../../../ui/primitives/KeyStrip";
import { useStore } from "../../../ui/store";
import { routeKey, type RowKey } from "../../../touch/keyRoute";
import { terminalsOf } from "../terminals";

/** `aria` is set only where the visible label can't be read aloud as the key (the arrows, the caret chords). */
export type Spec =
  | { label: string; aria?: string; key: RowKey; repeat?: boolean }
  | { label: string; modifier: "ctrl" | "alt" };

// Order, for agent CLIs (Claude Code, Codex, opencode) first, and the row always opens esc, tab
// (Jimmy, 2026-10-29): esc (interrupt a turn, close a menu), tab (completion), the arrows (menus
// and history), then the modifiers and the shell's punctuation, then ⏎.
// The chords come last, past ⏎, so none sits in the first, easy-tap slots and ^Z (suspend) is
// never beside Return; ^C, the most destructive, is the very last. ⇧tab (mode cycling) is rare
// now and sits after the punctuation. ^S and ^Q are gone: ^S freezes a terminal with flow control on.
export const KEYS: Spec[] = [
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

export function KeyRow() {
  const app = useApp();
  const terminals = terminalsOf(app);
  const { modifiers } = terminals;
  const armed = useStore(modifiers, (s) => s.armed);
  const owner = useStore(app.focus, (s) => s.owner);

  if (owner === "none") return null; // the row is mounted only while typing

  return (
    <KeyStrip
      label="Terminal keys"
      keys={KEYS.map((spec) => ({
        label: spec.label,
        aria: "aria" in spec ? spec.aria : undefined,
        repeat: "repeat" in spec && spec.repeat,
        pressed: "modifier" in spec ? armed === spec.modifier : undefined,
        // The two destinations look different: a key whose tap lands in the compose box rather than in tmux.
        acts: "key" in spec && routeKey(spec.key, owner, armed).route.to !== "terminal" ? "box" : undefined,
        // `terminals.key` routes against the live owner and armed state, not this render's: a held key fires from the render it was pressed in.
        onPress: () => { if ("modifier" in spec) modifiers.toggle(spec.modifier); else terminals.key(spec.key); },
        onDown: () => { app.platform.haptic("modifier" in spec ? "modifier" : "key"); },
      }))}
    />
  );
}
