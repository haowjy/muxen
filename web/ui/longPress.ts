// A control's menu asked for by a touch held still, or by a right click: the tab pills' and Files rows'
// one gesture. The press that opened the menu swallows the click that ends it.
import { useRef } from "preact/hooks";
import type { TargetedMouseEvent, TargetedPointerEvent } from "preact";

/** A touch held this long asks for the menu. */
const LONG_PRESS_MS = 450;
/** A touch that moves further than this is a scroll, not a press. */
const SLOP = 8;

/** Where the menu was asked for: the element pressed, and the point (a right click's; a held touch's start). */
export interface MenuAsk<E extends HTMLElement> {
  anchor: E;
  x: number;
  y: number;
  /** A held touch, not a right click. */
  touch: boolean;
}

export interface LongPress<E extends HTMLElement> {
  onPointerDown: (e: TargetedPointerEvent<E>) => void;
  onPointerMove: (e: TargetedPointerEvent<E>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: TargetedMouseEvent<E>) => void;
  /** Call first in the click handler: true when this click ends a press that opened the menu, and does nothing else. */
  swallowClick: () => boolean;
}

/** `onMenu` answers whether it opened a menu: a press that opened none leaves the next click alone. */
export function useLongPress<E extends HTMLElement>(onMenu: (ask: MenuAsk<E>) => boolean): LongPress<E> {
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const opened = useRef(false);
  const latest = useRef(onMenu);
  latest.current = onMenu;
  const stop = (): void => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  return {
    onPointerDown: (e) => {
      opened.current = false;
      if (e.pointerType !== "touch") return;
      const anchor = e.currentTarget;
      const { clientX: x, clientY: y } = e;
      hold.current = { x, y, timer: setTimeout(() => { hold.current = null; opened.current = latest.current({ anchor, x, y, touch: true }); }, LONG_PRESS_MS) };
    },
    onPointerMove: (e) => { if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > SLOP) stop(); },
    onPointerUp: stop,
    onPointerCancel: stop,
    onContextMenu: (e) => {
      e.preventDefault();
      stop();
      if (!opened.current) latest.current({ anchor: e.currentTarget, x: e.clientX, y: e.clientY, touch: false });
    },
    swallowClick: () => {
      const was = opened.current;
      opened.current = false;
      return was;
    },
  };
}
