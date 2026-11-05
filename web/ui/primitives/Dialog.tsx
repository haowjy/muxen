import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { cx } from "../cx";
import { useFocus } from "../focus";
import { useCloseByTap } from "./DialogBars";
import styles from "./Dialog.module.css";

interface DialogProps {
  open: boolean;
  /** Escape, the backdrop, the close button. The parent decides what closing means (usually the router's Back). */
  onClose: () => void;
  title: string;
  /** Where it sits: centred (`dialog`), or filling the screen (`page`). What its top row holds is `header`'s. Focus returns to the control `app.openOverlay` was given, else the one focused at opening; a field marked `data-initial-focus=""` takes focus on opening with a fine pointer. */
  variant?: "dialog" | "page";
  /** The top row: a `TitleBar` or `ScreenBar`, or null for none. `title` is the dialog's accessible name. */
  header: ComponentChildren;
  children: ComponentChildren;
}

/** `<dialog>.showModal()`: top layer, modal focus containment, Escape. Safari lacks `closedby`, so Escape and the backdrop are handled here. */
export function Dialog({ open, onClose, title, variant = "dialog", header, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const focus = useFocus();
  const closeByTap = useCloseByTap(onClose);

  // A layout effect: the dialog opens in the commit of the change that asked, not a frame later
  // (after a paint of the page behind it, and after a tap on its backdrop could land elsewhere).
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) focus.openDialog(dialog);
    else if (!open && dialog.open) focus.closeDialog(dialog);
  }, [open]);

  // A dialog unmounted while open must not leave the page inert.
  useEffect(() => () => {
    const dialog = ref.current;
    if (dialog?.open) dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      class={cx(styles.dialog, variant === "page" && styles.page)}
      aria-label={title}
      tabIndex={-1}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) closeByTap(e.currentTarget); }}
    >
      <div class={styles.panel}>
        {header}
        <div class={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}
