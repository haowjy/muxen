import { OTPInput } from "input-otp";
import { useId } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { applyFieldSettings } from "./fieldSettings";
import styles from "./CodeField.module.css";

const LENGTH = 8;
const GROUP = 4;

/** What the field keeps of typed or pasted text: letters and digits, uppercased. The dash in `7KQ4-XM2P` is drawn, never part of the value. */
const clean = (text: string): string => text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

interface CodeFieldProps {
  label: string;
  /** Up to eight characters, no separator. */
  value: string;
  onInput: (value: string) => void;
  focusTarget?: FocusTarget;
  class?: string | undefined;
}

/**
 * An eight-cell code, `▢▢▢▢ – ▢▢▢▢`, on input-otp: one real input under drawn cells, with the
 * fixes for iOS Safari's paste menu, caret and autofill that a hand-made overlay kept missing
 * (on a real iPhone the old one took one character and then nothing, and offered no Paste).
 */
export function CodeField({ label, value, onInput, focusTarget, class: className }: CodeFieldProps) {
  const id = useId();
  const focusRef = useFocusRef(focusTarget);
  return (
    <div class={cx(styles.field, className)}>
      <label for={id} class={styles.label}>{label}</label>
      <OTPInput
        id={id}
        maxLength={LENGTH}
        value={value}
        onChange={(next) => { onInput(clean(next)); }}
        pasteTransformer={clean}
        enterKeyHint="next"
        containerClassName={cx(styles.cells)}
        ref={(el: HTMLInputElement | null) => { applyFieldSettings(el, { autocapitalize: "characters" }); focusRef(el); }}
        render={({ slots }) => (
          <>
            {slots.map((slot, i) => (
              <>
                {i === GROUP && <span class={styles.dash} aria-hidden="true" />}
                <span class={cx(styles.cell, slot.isActive && styles.active)}>{slot.char ?? ""}</span>
              </>
            ))}
          </>
        )}
      />
    </div>
  );
}
