import { useEffect, useId } from "preact/hooks";
import { move, type Move, type OutlineRow } from "../../files/outline";

/** What a key does in a list: a selection move, opening the selected row, or going up. */
export function listKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): Move | "open" | "goUp" | null {
  if (e.altKey || e.shiftKey) return null;
  const cmd = e.metaKey || e.ctrlKey;
  if (e.key === "ArrowUp" && cmd) return "goUp";
  if (cmd) return null;
  switch (e.key) {
    case "ArrowDown": return "down";
    case "ArrowUp": return "up";
    case "Home": return "first";
    case "End": return "last";
    case "Enter": return "open";
    case "Backspace": return "goUp";
    default: return null;
  }
}

interface ListboxOptions {
  rows: readonly OutlineRow[];
  /** The selected row's key, or null. */
  selected: string | null;
  onSelect: (selection: string | null) => void;
  /** Enter on the selected row. Absent where Enter is the caller's (a text field). */
  onOpen?: (row: OutlineRow) => void;
  /** Backspace and Cmd/Ctrl+↑. Absent at `/` and in a text field. */
  onUp?: () => void;
  /** `arrows`: only ↑ and ↓, for a list driven from a text field, where Home, End and Backspace edit the text. */
  keys?: "all" | "arrows";
}

export interface Listbox {
  /** The listbox's own id, for `aria-controls`. */
  id: string;
  /** An option's id, from its row key: it follows the row when the rows around it change. */
  optionId: (key: string) => string;
  /** The `aria-activedescendant` of whatever holds the focus. */
  activeId: string | undefined;
  onKeyDown: (e: KeyboardEvent) => void;
}

/** The one keyboard model of Files' lists: option ids, the active descendant, keeping it in view, and the keys. */
export function useListbox({ rows, selected, onSelect, onOpen, onUp, keys = "all" }: ListboxOptions): Listbox {
  const id = useId();
  const optionId = (key: string): string => `${id}-${encodeURIComponent(key)}`;
  const activeId = selected === null ? undefined : optionId(selected);
  useEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" }); }, [activeId]);
  const onKeyDown = (e: KeyboardEvent): void => {
    const action = listKey(e);
    if (action === null || (keys === "arrows" && action !== "up" && action !== "down")) return;
    e.preventDefault();
    if (action === "open") {
      const row = rows.find((r) => r.key === selected);
      if (row) onOpen?.(row);
    } else if (action === "goUp") onUp?.();
    else onSelect(move(rows, selected, action).selection);
  };
  return { id, optionId, activeId, onKeyDown };
}
