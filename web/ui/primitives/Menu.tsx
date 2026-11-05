import { useLayoutEffect, useEffect, useRef } from "preact/hooks";
import { createPortal } from "preact/compat";
import { cx } from "../cx";
import { useFocus } from "../focus";
import { Icon, type IconName } from "./Icon";
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
  /** Opens at this point (a right-click's, in client px) instead of against the anchor's edges. */
  at?: { x: number; y: number } | undefined;
  label: string;
  sections: MenuSection[];
  onClose: () => void;
  /** A fine pointer or a keyboard opened it: the first row takes focus. Touch never focuses, so a raised keyboard stays up. */
  focusFirst: boolean;
}

/** Space between the menu and its anchor, and between it and the window's edge. */
const GAP_PX = 8;

/**
 * A small non-modal menu in the popover look (Dialog's), placed against a control. Not a
 * `<dialog>`: a modal would take focus and lower the keyboard. Every row cancels its pointerdown,
 * like a dock control. A press outside, Escape (focus returns to the anchor), or a chosen row closes it.
 */
export function Menu({ anchor, at, label, sections, onClose, focusFirst }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const focus = useFocus();

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = at ? { top: at.y, bottom: at.y, left: at.x } : anchor.getBoundingClientRect();
    const root = document.documentElement;
    const { clientWidth, clientHeight } = root;
    // The keyboard is a system window over the page: nothing drawn under it shows. Only the space above it counts.
    const visibleBottom = clientHeight - (parseFloat(getComputedStyle(root).getPropertyValue("--keyboard-inset")) || 0);
    const above = rect.top;
    const below = visibleBottom - rect.bottom;
    const up = above > below;
    menu.style.maxHeight = `${String((up ? above : below) - 2 * GAP_PX)}px`;
    menu.style.top = up ? "" : `${String(rect.bottom + GAP_PX)}px`;
    menu.style.bottom = up ? `${String(clientHeight - rect.top + GAP_PX)}px` : "";
    // A control in the right half (a header's ⋯) hangs the menu from its right edge, so it opens inwards.
    const right = at ? at.x : anchor.getBoundingClientRect().right;
    const start = !at && rect.left > clientWidth / 2 ? right - menu.offsetWidth : rect.left;
    menu.style.left = `${String(Math.max(GAP_PX, Math.min(start, clientWidth - menu.offsetWidth - GAP_PX)))}px`;
    if (focusFirst) {
      const first = menu.querySelector<HTMLElement>("button:not([aria-disabled])");
      if (first) focus.focusElement(first);
    }
  }, [anchor, at?.x, at?.y]);

  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      // The anchor's own click toggles the menu: closing here too would reopen it.
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const keys = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Focus goes back to the anchor only when the menu held it: on touch it never did, and a raised keyboard stays up.
        const held = ref.current?.contains(document.activeElement) ?? false;
        onClose();
        if (held) focus.focusElement(anchor);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([aria-disabled])") ?? [])];
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const next = rows[(at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
      if (next && ref.current?.contains(document.activeElement)) {
        e.preventDefault();
        focus.focusElement(next);
      }
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", keys, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", keys, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} class={styles.menu} role="menu" aria-label={label}>
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
    </div>,
    document.body,
  );
}
