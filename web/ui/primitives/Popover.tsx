import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { useLayoutEffect, useEffect, useRef } from "preact/hooks";
import { createPortal } from "preact/compat";
import { cx } from "../cx";
import { useFocus } from "../focus";
import styles from "./Popover.module.css";

export interface PopoverProps {
  /** The control it hangs from: it opens on the side with more room, above the keyboard. */
  anchor: HTMLElement;
  /** Opens at this point (a right-click's, in client px) instead of against the anchor's edges; any press outside it then closes it. */
  at?: { x: number; y: number } | undefined;
  role: "menu" | "dialog";
  label: string;
  onClose: () => void;
  /**
   * A fine pointer or a keyboard opened it: it takes focus, on `focusTarget`'s pick or on itself. Touch never focuses, so a
   * raised keyboard stays up.
   */
  focus: boolean;
  focusTarget?: (popover: HTMLElement) => HTMLElement | null;
  class?: string | undefined;
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLDivElement>) => void;
  children: ComponentChildren;
}

/** The click that ends this press, if any, goes nowhere. Ended by the next press, a press that became a scroll, or a second. */
function swallowClick(): void {
  const stop = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = (): void => {
    clearTimeout(timer);
    document.removeEventListener("click", stop, true);
    document.removeEventListener("pointerdown", done, true);
    document.removeEventListener("pointercancel", done, true);
  };
  // Added while this press is being dispatched, so the press itself doesn't end it.
  document.addEventListener("click", stop, true);
  document.addEventListener("pointerdown", done, true);
  document.addEventListener("pointercancel", done, true);
  const timer = setTimeout(done, 1_000);
}

/** Space between the popover and its anchor, and between it and the window's edge. */
const GAP_PX = 8;

/**
 * A small non-modal popover (Dialog's look) placed against a control: Menu's frame, and a file's Info. Not a `<dialog>`:
 * a modal would take focus and lower the keyboard. A press outside, or Escape (focus returns to the anchor), closes it.
 * Files' keys stand aside while one is open (keymap.ts looks for its role).
 */
export function Popover({ anchor, at, role, label, onClose, focus: takeFocus, focusTarget, class: extra, onKeyDown, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const focus = useFocus();

  useLayoutEffect(() => {
    const popover = ref.current;
    if (!popover) return;
    const rect = at ? { top: at.y, bottom: at.y, left: at.x } : anchor.getBoundingClientRect();
    const root = document.documentElement;
    const { clientWidth, clientHeight } = root;
    // The keyboard is a system window over the page: nothing drawn under it shows. Only the space above it counts.
    const visibleBottom = clientHeight - (parseFloat(getComputedStyle(root).getPropertyValue("--keyboard-inset")) || 0);
    const above = rect.top;
    const below = visibleBottom - rect.bottom;
    const up = above > below;
    popover.style.maxHeight = `${String((up ? above : below) - 2 * GAP_PX)}px`;
    popover.style.top = up ? "" : `${String(rect.bottom + GAP_PX)}px`;
    popover.style.bottom = up ? `${String(clientHeight - rect.top + GAP_PX)}px` : "";
    // A control in the right half (a header's ⋯) hangs it from its right edge, so it opens inwards.
    const right = at ? at.x : anchor.getBoundingClientRect().right;
    const start = !at && rect.left > clientWidth / 2 ? right - popover.offsetWidth : rect.left;
    popover.style.left = `${String(Math.max(GAP_PX, Math.min(start, clientWidth - popover.offsetWidth - GAP_PX)))}px`;
    if (takeFocus) focus.focusElement(focusTarget?.(popover) ?? popover);
  }, [anchor, at?.x, at?.y]);

  const pointed = at !== undefined;
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      // A control's own click toggles its popover: closing here too would reopen it. One opened at a point (a row's)
      // has no control under it, and its anchor (a whole list) is only where focus returns.
      if (ref.current?.contains(target) || (!pointed && anchor.contains(target))) return;
      // On touch the tap that closes a popover only closes it, as on iOS: what is under it doesn't also act.
      if (e.pointerType === "touch") swallowClick();
      onClose();
    };
    const keys = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      // Focus goes back to the anchor only when the popover held it: on touch it never did, and a raised keyboard stays up.
      const held = ref.current?.contains(document.activeElement) ?? false;
      onClose();
      if (held) focus.focusElement(anchor);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", keys, true);
    };
  }, [anchor, pointed, onClose]);

  return createPortal(
    <div ref={ref} class={cx(styles.popover, extra)} role={role} aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
      {children}
    </div>,
    document.body,
  );
}
