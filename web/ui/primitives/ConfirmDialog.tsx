import type { ComponentChildren } from "preact";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { TitleBar } from "./DialogBars";
import styles from "./ConfirmDialog.module.css";

interface Props {
  open?: boolean;
  title: string;
  /** Says what the action does and whether it can be undone. */
  children?: ComponentChildren;
  /** The action, named: "Delete". */
  confirm: string;
  /** The action's label while it runs. */
  confirming: string;
  /** Why the action failed. */
  error: string | null;
  busy: boolean;
  /** The other button; "Cancel" unless an action in flight can't be cancelled. */
  cancel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Asks before an action that destroys something, and stays open with the reason if it fails. */
export function ConfirmDialog({ open = true, title, children, confirm, confirming, error, busy, cancel = "Cancel", onConfirm, onClose }: Props) {
  return (
    <Dialog open={open} title={title} header={<TitleBar title={title} onClose={onClose} />} onClose={onClose}>
      {open && (
        <div class={styles.body}>
          {children && <p>{children}</p>}
          {error && <p class={styles.error} role="alert">{error}</p>}
          <div class={styles.actions}>
            <Button variant="quiet" onClick={onClose}>{cancel}</Button>
            <Button variant="danger" busy={busy} onClick={onConfirm}>{busy ? confirming : confirm}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
