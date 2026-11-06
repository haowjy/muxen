import type { ComponentChildren, RefObject, TargetedKeyboardEvent } from "preact";
import { useCallback, useId } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { applyFieldSettings } from "./fieldSettings";
import { Icon } from "./Icon";
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
export function TextField({ label, hideLabel = false, value, onInput, onCommit, hint, error, focusTarget, action, class: className, ...rest }: FieldProps) {
  const id = useId();
  const focusRef = useFocusRef(focusTarget);
  const attach = useCallback((el: HTMLInputElement | null) => {
    applyFieldSettings(el);
    focusRef(el);
  }, [focusRef]);
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

type SearchProps = Pick<FieldProps, "label" | "placeholder" | "focusTarget" | "class"> & {
  value: string;
  /** The new text, and the element, so an owner that completes paths can read the caret. */
  onInput: (value: string, el?: HTMLInputElement) => void;
  /** Keys the owner handles first (a search that also completes paths); Escape still empties the field. */
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** The list this field completes into (when it has rows), and its highlighted row, for assistive technology. */
  listId?: string | undefined;
  activeId?: string | undefined;
};

/** A field that filters a list: a search glyph, and Escape empties it before it closes anything else. */
export function SearchField({ label, value, onInput, placeholder, focusTarget, onKeyDown, inputRef, listId, activeId, class: className, ...rest }: SearchProps) {
  const focusRef = useFocusRef(focusTarget);
  const attach = useCallback((el: HTMLInputElement | null) => {
    applyFieldSettings(el);
    focusRef(el);
    if (inputRef) inputRef.current = el;
  }, [focusRef, inputRef]);
  return (
    <div class={cx(styles.search, className)}>
      <Icon name="search" size={16} class={styles.glyph} />
      <input
        type="text"
        role="searchbox"
        {...rest}
        {...(placeholder !== undefined && { placeholder })}
        aria-controls={listId}
        aria-activedescendant={activeId}
        value={value}
        onInput={(e) => { onInput(e.currentTarget.value, e.currentTarget); }}
        aria-label={label}
        class={styles.searchInput}
        ref={attach}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Escape" && value !== "") {
            e.preventDefault(); // a dialog around the field would otherwise close
            e.stopPropagation();
            onInput("");
          }
        }}
      />
    </div>
  );
}
