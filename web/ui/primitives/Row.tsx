import type { ComponentChildren, ButtonHTMLAttributes, HTMLAttributes } from "preact";
import { cx } from "../cx";
import { Icon, type IconName } from "./Icon";
import styles from "./Row.module.css";

export interface RowProps extends Omit<ButtonHTMLAttributes, "icon" | "label"> {
  /** The leading glyph: a session, a terminal window, a folder, a file. */
  icon: IconName;
  label: ComponentChildren;
  /** A sign that must stay visible when the label ellipsizes: the bell dot. */
  mark?: ComponentChildren;
  /** Quiet text after the label: a count, a size, "Open". */
  meta?: ComponentChildren;
  /** The trailing glyph, usually a chevron. Window rows have none. */
  trailing?: IconName;
  /** An open tab, a selected file: marked by fill, not hue. */
  selected?: boolean;
  /** Joins the arrow-key roving of the surrounding `RovingList`. */
  roving?: boolean;
}

function Slots({ icon, label, mark, meta, trailing }: { icon: IconName; label: ComponentChildren; mark?: ComponentChildren; meta?: ComponentChildren; trailing?: IconName | undefined }) {
  return (
    <>
      <span class={styles.leading}><Icon name={icon} size={20} /></span>
      <span class={styles.label}>{label}</span>
      {mark !== undefined && <span class={styles.mark}>{mark}</span>}
      {meta !== undefined && <span class={styles.meta}>{meta}</span>}
      {trailing && <Icon name={trailing} size={16} class={styles.trailing} />}
    </>
  );
}

/** One list row with fixed slots, so session, window, folder, file and tab rows line up. */
export function Row({ icon, label, mark, meta, trailing, selected, roving, class: className, ...rest }: RowProps) {
  return (
    <button type="button" data-roving={roving ? "" : undefined} {...rest} class={cx(styles.row, selected && styles.selected, className as string | undefined)}>
      <Slots icon={icon} label={label} mark={mark} meta={meta} trailing={trailing} />
    </button>
  );
}

export interface OptionRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "icon" | "label"> {
  icon: IconName;
  label: ComponentChildren;
  meta?: ComponentChildren;
  trailing?: IconName;
  /** The list's selection: filled, and announced. */
  selected?: boolean;
  /** Cannot be opened: it stays in the list and the selection can rest on it. */
  disabled?: boolean;
}

/**
 * A {@link Row} that is an option of a listbox: not focusable itself. The listbox holds focus and
 * names the selected option (`aria-activedescendant`), so a selection can move while the focus
 * stays in the list or in a field above it.
 */
export function OptionRow({ icon, label, meta, trailing, selected, disabled, class: className, ...rest }: OptionRowProps) {
  return (
    <div role="option" aria-selected={selected === true} aria-disabled={disabled === true ? true : undefined} {...rest} class={cx(styles.row, selected && styles.selected, disabled && styles.disabled, className as string | undefined)}>
      <Slots icon={icon} label={label} meta={meta} trailing={trailing} />
    </div>
  );
}
