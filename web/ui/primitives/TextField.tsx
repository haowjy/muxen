import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { useCallback, useId } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { applyFieldSettings } from "./fieldSettings";
import styles from "./TextField.module.css";

interface FieldProps {
  label: string;
  /** The label is for screen readers: what surrounds the field already says what it is. */
  hideLabel?: boolean;
  value: string;
  /** Called with the new text on every edit. */
  onInput: (value: string) => void;
  /** Return, or leaving the field: a value that saves when it is done, not on every edit. */
  onCommit?: () => void;
  placeholder?: string;
  name?: string;
  disabled?: boolean;
  /** The text from its start to here starts selected: a name's stem, so typing replaces it and keeps the extension. */
  selectTo?: number;
  /** Stays focused while a request runs, as a disabled field wouldn't. */
  readOnly?: boolean;
  hint?: string | undefined;
  /** Shown under the field and announced; also marks the field invalid. */
  error?: string | null | undefined;
  /** Registers the input with the focus controller under this name. */
  focusTarget?: FocusTarget;
  /** Takes focus when its dialog opens: "" with a fine pointer, "typing" on touch too (`FocusController.openDialog`). */
  "data-initial-focus"?: string;
  /** A control in the input's row, after it (Add): what Return does, for touch, which shows no Return. */
  action?: ComponentChildren;
  class?: string | undefined;
}

/** A labelled single-line field. With SearchField, the only place an `<input>` lives for screens (lint rule 1). */
export function TextField({ label, hideLabel = false, value, onInput, onCommit, hint, error, focusTarget, action, selectTo, class: className, ...rest }: FieldProps) {
  const id = useId();
  const focusRef = useFocusRef(focusTarget);
  const attach = useCallback((el: HTMLInputElement | null) => {
    applyFieldSettings(el);
    if (selectTo) el?.setSelectionRange(0, selectTo);
    focusRef(el);
  }, [focusRef, selectTo]);
  const note = error ?? hint;
  return (
    <div class={cx(styles.field, className)}>
      <label for={id} class={cx(styles.label, hideLabel && styles.hidden)}>{label}</label>
      {wrapIn(action, <input
        type="text"
        {...rest}
        id={id}
        value={value}
        onInput={(e) => { onInput(e.currentTarget.value); }}
        {...(onCommit && {
          onBlur: onCommit,
          onKeyDown: (e: TargetedKeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && !e.isComposing) onCommit(); },
        })}
        class={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        ref={attach}
      />)}
      {note && <p id={`${id}-note`} class={cx(styles.note, error && styles.error)} role={error ? "alert" : undefined}>{note}</p>}
    </div>
  );
}

/** The input alone, or in a row with its action. */
const wrapIn = (action: ComponentChildren, input: ComponentChildren): ComponentChildren =>
  action === undefined ? input : <div class={styles.row}>{input}{action}</div>;
