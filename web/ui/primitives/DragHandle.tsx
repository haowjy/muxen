import type { TargetedKeyboardEvent, TargetedPointerEvent } from "preact";
import { Icon } from "./Icon";
import styles from "./DragHandle.module.css";

/**
 * The grip a list row is dragged by, and only it: a drag starts here, so scrolling the list never
 * reorders it. The arrow keys move the row one place, the keyboard's way to reorder.
 */
export function DragHandle({ label, onDragStart, onNudge }: {
  label: string;
  onDragStart: (e: TargetedPointerEvent<HTMLButtonElement>) => void;
  /** -1 up, 1 down. */
  onNudge: (step: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      class={styles.handle}
      aria-label={label}
      onPointerDown={onDragStart}
      onKeyDown={(e: TargetedKeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        onNudge(e.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <Icon name="grip" size={20} />
    </button>
  );
}
