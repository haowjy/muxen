import { useEffect, useRef } from "preact/hooks";
import { DockButton } from "./DockButton";
import styles from "./KeyStrip.module.css";

/** A held key that repeats does so after this, then at this rate. */
const REPEAT_AFTER_MS = 400;
const REPEAT_EVERY_MS = 33;

export interface StripKey {
  label: string;
  /** Set only where `label` can't be read aloud as the key (the arrows, the caret chords). */
  aria?: string | undefined;
  /** Holding it repeats it (the arrows). */
  repeat?: boolean;
  /** A key that stays on until used, and whether it is: undefined for an ordinary key. */
  pressed?: boolean | undefined;
  /** Marks a key that acts on the box holding the keyboard rather than on what the row usually drives. */
  acts?: "box" | undefined;
  onPress: () => void;
  onDown: () => void;
}

/**
 * The keys a phone keyboard lacks, in a horizontal scroller above it. A tap never moves focus or lowers the keyboard
 * (DockButton), and a key acts on `pointerup` inside it.
 */
export function KeyStrip({ label, keys }: { label: string; keys: StripKey[] }) {
  return (
    <div class={styles.keys} role="group" aria-label={label}>
      {keys.map((key) => <Key key={key.label} spec={key} />)}
    </div>
  );
}

function Key({ spec }: { spec: StripKey }) {
  const { onPress, onDown, repeat = false, pressed } = spec;
  // A ref: pressing ctrl re-renders its own key between the pointer going down and up.
  const hold = useRef<{ delay?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval>; repeated: boolean } | null>(null);
  const stop = (): void => {
    clearTimeout(hold.current?.delay);
    clearInterval(hold.current?.every);
    hold.current = null;
  };
  // The row unmounts when the keyboard goes down, with no pointerup: a held arrow must not outlive it.
  useEffect(() => stop, []);
  return (
    <DockButton
      kind="key"
      pressed={pressed === true}
      aria-label={spec.aria}
      data-acts={spec.acts}
      aria-pressed={pressed}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
        stop();
        const state: NonNullable<typeof hold.current> = { repeated: false };
        hold.current = state;
        if (repeat) {
          state.delay = setTimeout(() => {
            state.repeated = true;
            onPress();
            state.every = setInterval(onPress, REPEAT_EVERY_MS);
          }, REPEAT_AFTER_MS);
        }
      }}
      onPointerUp={(e) => {
        const held = hold.current;
        stop();
        const box = e.currentTarget.getBoundingClientRect();
        const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
        if (held && !held.repeated && inside) onPress();
      }}
      // Fires after pointerup and pointercancel, and when the key is removed while held.
      onLostPointerCapture={stop}
      // Keyboard activation (Enter or Space on a focused key) has no pointer: `detail` is 0.
      onClick={(e) => { if (e.detail === 0) onPress(); }}
      onContextMenu={(e) => { e.preventDefault(); }}
    >
      {spec.label}
    </DockButton>
  );
}
