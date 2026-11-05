// The Files keymap: every Files shortcut registers here, and one document listener decides when keys are free.
// Nothing in the pane need hold focus for a shortcut to work, so the listener is the document's; only
// app/focus.ts may move focus to make one.
import { useEffect, useRef } from "preact/hooks";
import { useApp } from "../../app/context";

/** A shortcut. `mod` is Cmd or Ctrl (either is taken, on every platform). */
export interface Chord {
  /** `KeyboardEvent.key`, lower case. One character with no `mod` is matched by the character alone, Shift and AltGr ignored. */
  key: string;
  /** Matched as well as `key`, for a key whose `key` changes with Shift (`.` is `>` on a US layout). */
  code?: string;
  mod?: boolean;
  shift?: boolean;
  /** Also fires while a text field has focus. */
  inField?: boolean;
  /** Fires only while the list has the keys (it, or nothing, has focus): a plain key on a button or a viewer is theirs. A held key fires once. */
  inList?: boolean;
}

/** Cmd/Ctrl+V, served by the `paste` event: only it carries the clipboard, and the Edit menu's Paste fires it too. */
export const PASTE: Chord = { key: "v", mod: true };

/** Toggles hidden files: on a folder, and in Search's field, which it searches again. */
export const SHOW_HIDDEN: Chord = { key: ".", code: "Period", mod: true, shift: true };
export const SHOW_HIDDEN_IN_SEARCH: Chord = { ...SHOW_HIDDEN, inField: true };

/** Opens Search: `/`, and Cmd/Ctrl+P, taken from the browser's Print only while Files has the keys. */
export const SEARCH: Chord = { key: "p", mod: true };
export const SEARCH_SLASH: Chord = { key: "/" };

type Run = (e: KeyboardEvent | ClipboardEvent) => void;
interface Binding { chord: Chord; run: { current: Run } }

/** Newest last: a key two components register goes to the one mounted last. */
const bindings: Binding[] = [];

/** Keys are free for Files when no dialog or menu is open, no one claimed the key, and no text field has it (unless the chord allows that). */
function free(e: Event, chord: Chord): boolean {
  if (e.defaultPrevented || document.querySelector("dialog[open], [role=menu]")) return false;
  const target = e.target;
  if (chord.inList) return target === document.body || (target instanceof HTMLElement && target.matches("[role=tree], [role=listbox]"));
  return chord.inField === true || !(target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]"));
}

function matches(e: KeyboardEvent, chord: Chord): boolean {
  if (chord === PASTE || e.isComposing) return false;
  // A printed character (`/`) is whatever keys type it: Shift+7 on a German layout, AltGr (Ctrl+Alt to the page) on
  // some Windows layouts. Only Cmd or Ctrl held for themselves make it another key.
  if (printed(chord)) return e.key === chord.key && (e.getModifierState("AltGraph") || !(e.metaKey || e.ctrlKey));
  if (e.altKey) return false;
  return (e.key.toLowerCase() === chord.key || e.code === chord.code) && (e.metaKey || e.ctrlKey) === (chord.mod === true) && e.shiftKey === (chord.shift === true);
}

/** A chord that is one character typed, with no Cmd/Ctrl and no key position of its own. */
const printed = (chord: Chord): boolean => chord.key.length === 1 && chord.mod !== true && chord.code === undefined;

function dispatch(e: Event, find: (b: Binding) => boolean): void {
  const hit = bindings.findLast(find);
  if (!hit || !free(e, hit.chord)) return;
  e.preventDefault();
  // A held list key is still the list's (Space would scroll it), but it toggles once, not on every repeat.
  if (hit.chord.inList && e instanceof KeyboardEvent && e.repeat) return;
  hit.run.current(e as KeyboardEvent | ClipboardEvent);
}

const onKey = (e: KeyboardEvent): void => { dispatch(e, (b) => matches(e, b.chord)); };
const onPaste = (e: ClipboardEvent): void => { dispatch(e, (b) => b.chord === PASTE); };

/** Runs `run` on `chord` while mounted and `on`, when keys are free for Files. */
export function useFilesKey(chord: Chord, run: Run, on = true): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!on) return undefined;
    const binding: Binding = { chord, run: latest };
    if (bindings.length === 0) {
      document.addEventListener("keydown", onKey);
      document.addEventListener("paste", onPaste);
    }
    bindings.push(binding);
    return () => {
      bindings.splice(bindings.indexOf(binding), 1);
      if (bindings.length > 0) return;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
    };
  }, [chord, on]);
}

/** How `chord` is written on this platform's keyboard: `⇧⌘.` on Apple's, `Ctrl+Shift+.` elsewhere. */
export function useChordLabel(chord: Chord): string {
  const apple = useApp().platform.shortcuts === "apple";
  const key = chord.key.toUpperCase();
  if (apple) return `${chord.shift ? "⇧" : ""}${chord.mod ? "⌘" : ""}${key}`;
  return [chord.mod && "Ctrl", chord.shift && "Shift", key].filter(Boolean).join("+");
}
