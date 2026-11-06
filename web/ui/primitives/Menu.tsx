import type { TargetedKeyboardEvent } from "preact";
import { cx } from "../cx";
import { useFocus } from "../focus";
import { Icon, type IconName } from "./Icon";
import { Popover } from "./Popover";
import styles from "./Menu.module.css";

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** The window the tab shows: filled. */
  selected?: boolean;
  /** A setting the row turns on and off: a check in the glyph's slot while on (`menuitemcheckbox`). */
  checked?: boolean;
  /** Quiet text at the row's end: its shortcut (`⌘I`) or a fact about it (`19 KB`). */
  hint?: string;
  /** Can't be chosen now: muted, and a click does nothing. `hint` says why, when it can. */
  disabled?: boolean;
  /** Ends something: the danger colour. */
  danger?: boolean;
  onSelect: () => void;
}

/** Sections are set apart by a rule; a titled one says what its rows are. */
export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

interface MenuProps {
  /** The control it hangs from: it opens on the side with more room, above the keyboard. */
  anchor: HTMLElement;
  /** Opens at this point (a right-click's, in client px) instead of against the anchor's edges; any press outside the menu then closes it. */
  at?: { x: number; y: number } | undefined;
  label: string;
  sections: MenuSection[];
  onClose: () => void;
  /** A fine pointer or a keyboard opened it: the first row takes focus. Touch never focuses, so a raised keyboard stays up. */
  focusFirst: boolean;
}

const firstRow = (menu: HTMLElement): HTMLElement | null => menu.querySelector<HTMLElement>("button:not([aria-disabled])");

/** A small non-modal menu in a {@link Popover}. Every row cancels its pointerdown, like a dock control; a chosen row closes it. */
export function Menu({ anchor, at, label, sections, onClose, focusFirst }: MenuProps) {
  const focus = useFocus();
  const arrows = (e: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([aria-disabled])")];
    const at = rows.findIndex((row) => row === document.activeElement);
    const next = rows[(at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
    if (!next) return;
    e.preventDefault();
    focus.focusElement(next);
  };

  return (
    <Popover anchor={anchor} at={at} role="menu" label={label} onClose={onClose} focus={focusFirst} focusTarget={firstRow} class={styles.menu} onKeyDown={arrows}>
      {sections.map((section, i) => (
        <div key={i} class={styles.section} role="group" aria-label={section.title}>
          {section.title && <p class={styles.title}>{section.title}</p>}
          {section.items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              aria-disabled={item.disabled || undefined}
              class={cx(styles.item, item.selected && styles.selected, item.danger && styles.danger, item.disabled && styles.disabled)}
              onPointerDown={(e) => { e.preventDefault(); }}
              onClick={() => { if (item.disabled) return; onClose(); item.onSelect(); }}
            >
              {/* Rows without a glyph keep its slot, so the labels line up. A setting's check takes the slot. */}
              {item.checked ? <Icon name="check" size={20} class={cx(styles.icon, styles.check)} /> : item.icon ? <Icon name={item.icon} size={20} class={styles.icon} /> : <span class={styles.icon} />}
              <span class={styles.text}>{item.label}</span>
              {item.hint !== undefined && <span class={styles.hint}>{item.hint}</span>}
            </button>
          ))}
        </div>
      ))}
    </Popover>
  );
}
