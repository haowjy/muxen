import type { ButtonHTMLAttributes } from "preact";
import { cx } from "../cx";
import { useFocusRef, type FocusTarget } from "../focus";
import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./Tooltip";
import styles from "./IconButton.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes, "icon" | "label"> {
  icon: IconName;
  /** The accessible name, and the tooltip's text. Required: an icon button has no other name. */
  label: string;
  placement?: "top" | "bottom" | "right";
  /** Pressed state, for toggles such as the top row's current tab (`aria-current`). */
  current?: boolean;
  /** Registers the button with the focus controller under this name. */
  focusTarget?: FocusTarget;
  /** It opens a menu of choices: a small ▾ after the icon. */
  menu?: boolean;
}

export function IconButton({ icon, label, placement = "bottom", current, focusTarget, menu, class: className, ...rest }: IconButtonProps) {
  const focusRef = useFocusRef(focusTarget);
  return (
    <Tooltip label={label} placement={placement}>
      <button
        type="button"
        {...rest}
        class={cx(styles.button, menu && styles.menu, className as string | undefined)}
        aria-label={label}
        aria-current={current ? "page" : undefined}
        ref={focusRef}
      >
        <Icon name={icon} size={20} />
        {menu && <Icon name="chevronDown" size={16} class={styles.caret} />}
      </button>
    </Tooltip>
  );
}
