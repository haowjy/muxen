import type { ComponentChildren, Ref, TargetedFocusEvent, TargetedKeyboardEvent } from "preact";
import { useCallback } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { applyFieldSettings } from "./fieldSettings";
import { Icon } from "./Icon";
import styles from "./PathInput.module.css";

interface PathInputProps {
  /** The accessible name: the field has a placeholder, not a visible label. */
  label: string;
  value: string;
  /** The new text, and the element, so the caller can read the caret. */
  onInput: (value: string, el: HTMLInputElement) => void;
  onFocus?: (e: TargetedFocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: TargetedFocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: TargetedKeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  /** The list this field narrows (when it has rows), and its selected row, for assistive technology. */
  listId?: string | undefined;
  activeId?: string | undefined;
  /** The name the app moves focus to this field by. */
  focusTarget?: FocusTarget;
  /** Takes focus when its dialog opens, with a fine pointer (`Dialog`). */
  "data-initial-focus"?: string;
  /** At rest it reads as a line of text, not a box; focused, it is the field. */
  line?: boolean;
  /** Files' Search: a magnifier before the text, the keyboard's Search key, and the UI font, as a query is not a path. */
  search?: boolean;
  /** Inside the field's end, after the text: a quiet note on what the text is (Search's mode). */
  end?: ComponentChildren;
  class?: string;
}

/**
 * A path typed to narrow the folder's listing (Files' path field). The ordinary text keyboard, since the
 * URL keyboard has no space bar and folder names hold spaces, with a Go key, and no autocorrect,
 * capitals or spellcheck: a path is not prose.
 */
export function PathInput({ label, value, onInput, inputRef, listId, activeId, focusTarget, line, search, end, class: className, ...rest }: PathInputProps) {
  const registered = useFocusRef(focusTarget);
  // Stable: a new ref callback each render would withdraw and register the field every time.
  const attach = useCallback(
    (el: HTMLInputElement | null) => {
      registered(el);
      applyFieldSettings(el);
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef) inputRef.current = el;
    },
    [registered, inputRef],
  );
  return (
    <div class={cx(styles.field, line && styles.line, search && styles.search, className)}>
      {search && <Icon name="search" size={16} class={styles.glass} />}
      <input
        type="text"
        enterkeyhint={search ? "search" : "go"}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeId}
        {...rest}
        value={value}
        onInput={(e) => { onInput(e.currentTarget.value, e.currentTarget); }}
        aria-label={label}
        class={styles.input}
        ref={attach}
      />
      {end !== undefined && <span class={styles.end}>{end}</span>}
    </div>
  );
}
