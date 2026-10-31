// Armed ctrl and alt (client-architecture.md §7.4): a pure rule for what an armed modifier does
// to the next thing typed from any touch source (the owned input, the line field, the key row).
// Events in; the events to send and the new armed state out. No Preact, no window, no document.
import type { InputEvent } from "../platform/types";

export type Armed = "ctrl" | "alt" | null;

/** Tapping an armed key disarms it; tapping the other switches to it. */
export function toggle(armed: Armed, key: "ctrl" | "alt"): Armed {
  return armed === key ? null : key;
}

/** Keys tmux names that take a C- or M- prefix (the daemon's allowlist, `is_key_name`). */
const PREFIXABLE = /^(?:Enter|Escape|Tab|BSpace|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|IC|DC)$/;

export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** What Ctrl does to a punctuation key: `[ \ ] ^ _` are 0x1b to 0x1f, `/` is `_`'s byte, `?` is DEL. */
function controlByte(char: string): number | null {
  const code = char.charCodeAt(0);
  if (char === "/") return 0x1f;
  if (char === "?") return 0x7f;
  return code >= 0x5b && code <= 0x5f ? code & 0x1f : null;
}

const bytesOf = (...bytes: number[]): { bytes: string } => ({ bytes: btoa(String.fromCharCode(...bytes)) });

/**
 * What a held Ctrl and/or Alt makes of one typed character: the one rule for a hardware chord
 * (`decideKey`) and an armed key-row modifier (`apply`), the same as the app's native `KeyMapper`.
 * Space, letters and digits take a `C-`/`M-` name; Ctrl on a punctuation key is its control byte
 * (Ctrl+[ is ESC); Alt on one is ESC then the character (Alt+. in bash); Ctrl+Alt adds the ESC.
 * Shift matters only for a letter, where it makes the name uppercase. `null`: not a chord.
 */
export function chord({ ctrl, alt, shift }: Chord, char: string): { key: string } | { bytes: string } | null {
  if (!ctrl && !alt) return null;
  const prefix = `${ctrl ? "C-" : ""}${alt ? "M-" : ""}`;
  if (char === " ") return { key: `${prefix}Space` };
  const control = ctrl ? controlByte(char) : null;
  if (control !== null) return alt ? bytesOf(0x1b, control) : bytesOf(control);
  if (alt && /^[\x21-\x7e]$/.test(char) && !/^[A-Za-z0-9]$/.test(char)) return bytesOf(0x1b, char.charCodeAt(0));
  if (!/^[A-Za-z0-9]$/.test(char)) return null;
  return { key: prefix + (shift ? char.toUpperCase() : char.toLowerCase()) };
}

/**
 * Applies `armed` to `events`, the next input from a touch source. A single character or a
 * named key becomes its chord; anything else (a multi-character insert, a paste, bytes)
 * just disarms. `events` is returned as is when nothing changed, so a caller can tell.
 */
export function apply(armed: Armed, events: InputEvent[]): { events: InputEvent[]; armed: Armed } {
  const first = events[0];
  if (armed === null || first === undefined) return { events, armed };
  let event: InputEvent | null = null;
  // A capital typed on the soft keyboard is a shifted letter, but an armed ctrl still sends Ctrl-C for it: the hardware chord
  // keeps Shift (`C-C`, as KeyMapper does), and an app reading extended keys would not take `C-C` for Ctrl-C.
  if ("text" in first) {
    const shift = armed === "alt" && first.text !== first.text.toLowerCase();
    event = chord({ ctrl: armed === "ctrl", alt: armed === "alt", shift }, first.text);
  }
  else if ("key" in first && PREFIXABLE.test(first.key)) event = { key: `${armed === "ctrl" ? "C-" : "M-"}${first.key}` };
  return { events: event === null ? events : [event, ...events.slice(1)], armed: null };
}
