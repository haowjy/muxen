import type { TargetedKeyboardEvent } from "preact";
import { imeKey } from "../../ui/ime";

/** The keys of a field over a list (the path field, Search): Escape leaves it, Enter acts, the rest move the list. */
export function findKeys(e: TargetedKeyboardEvent<HTMLInputElement>, keys: { onCancel: () => void; onEnter: () => void; onMove?: ((e: TargetedKeyboardEvent<HTMLInputElement>) => void) | undefined }): void {
  if (imeKey(e)) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    keys.onCancel();
  } else if (e.key === "Enter") {
    e.preventDefault();
    keys.onEnter();
  } else keys.onMove?.(e);
}
