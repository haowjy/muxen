import { useRef } from "preact/hooks";
import styles from "./Divider.module.css";

/** One arrow press moves the divider this far; with Shift, four times as far. */
const STEP_PX = 16;

interface Props {
  /** The list's width now, in CSS px. */
  width: number;
  min: number;
  max: number;
  /** The width the list starts at, and a double-click returns to. */
  initial: number;
  /** Where the list's left edge is, to read a drag's width from the pointer. */
  from: () => number;
  /** Draws the list at `width` during a drag, without a render per pointer move. */
  onDrag: (width: number) => void;
  /** The width chosen: a drag let go, a key, a double-click. */
  onWidth: (width: number) => void;
}

/** The line between the Files list and the Preview panel: drag it, or focus it and use the arrow keys, Home and End. */
export function Divider({ width, min, max, initial, from, onDrag, onWidth }: Props) {
  const dragged = useRef<number | null>(null);
  const clamp = (px: number): number => Math.round(Math.max(min, Math.min(max, px)));
  const end = (): void => {
    if (dragged.current !== null) onWidth(dragged.current);
    dragged.current = null;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="List width"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      class={styles.divider}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragged.current = width;
      }}
      onPointerMove={(e) => {
        if (dragged.current === null) return;
        dragged.current = clamp(e.clientX - from());
        onDrag(dragged.current);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDblClick={() => { onWidth(clamp(initial)); }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 4 * STEP_PX : STEP_PX;
        const to = e.key === "ArrowLeft" ? width - step : e.key === "ArrowRight" ? width + step : e.key === "Home" ? min : e.key === "End" ? max : null;
        if (to === null) return;
        e.preventDefault();
        onWidth(clamp(to));
      }}
    />
  );
}
