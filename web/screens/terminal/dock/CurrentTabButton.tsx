import { useApp, useAppView, useBells, useTabLabels } from "../../../app/context";
import { BellDot } from "../../../ui/primitives/BellDot";
import { bellLook } from "../../../sessions/bells";
import { Icon } from "../../../ui/primitives/Icon";
import { DockButton } from "../../../ui/primitives/DockButton";
import { activeTab } from "../../../workspace/state";
import styles from "./CurrentTabButton.module.css";

interface CurrentTabButtonProps {
  /** Typing: the chip sits beside Hide keyboard at its own width and opens the tab menu (`onToggle`); at rest it fills the bar and opens the sessions sheet. */
  compact?: boolean;
  open?: boolean;
  onToggle?: () => void;
}

/** The phone's current-tab chip, at rest and while typing alike: the tab's name and how many tabs are open. A dock control, so a tap never moves focus. */
export function CurrentTabButton({ compact = false, open = false, onToggle }: CurrentTabButtonProps) {
  const app = useApp();
  const tab = useAppView((v) => activeTab(v.workspace));
  const count = useAppView((v) => v.workspace.tabs.length);
  const label = useTabLabels().find((l) => l.id === tab?.id);
  // The tab on screen counts as seen, so a dot here is another tab's.
  const bells = useBells();
  const ringing = useAppView((v) => v.workspace.tabs).some((t) => bellLook(bells, t.id).ring);
  const what = compact ? "switch tabs" : "open sessions and files";
  return (
    <DockButton
      kind="control"
      class={compact ? styles.compact : styles.chip}
      pressed={open}
      aria-haspopup={compact ? "dialog" : undefined}
      aria-expanded={compact ? open : undefined}
      aria-label={label ? `${label.full}, ${String(count)} ${count === 1 ? "tab" : "tabs"}, ${what}${ringing ? ", bell rang in a tab" : ""}` : undefined}
      onClick={(e) => {
        if (compact) onToggle?.();
        else app.openOverlay({ screen: "sessions", name: "sheet" }, e.currentTarget);
      }}
    >
      {label ? (
        <>
          <span class={styles.session}>{label.session}</span>
          {!compact && label.window !== "" && <span class={styles.window}>{label.window}</span>}
          {ringing && <BellDot />}
          <span class={styles.count}>{count}</span>
        </>
      ) : (
        <span class={styles.only}>Sessions</span>
      )}
      <Icon name={open ? "chevronDown" : "chevronUp"} size={16} class={styles.open} />
    </DockButton>
  );
}
