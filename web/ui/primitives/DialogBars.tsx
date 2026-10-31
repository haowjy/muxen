// The top rows a `Dialog` is given as its `header`: the dialog's variant says where it sits, the
// bar says what its top row holds. Each closes by a tap, so a keyboard that was up can come back.
import type { ComponentChildren } from "preact";
import { useFocus } from "../focus";
import { BottomBar } from "./BottomBar";
import { DockButton } from "./DockButton";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import styles from "./DialogBars.module.css";

/** A close that is a tap's end: the moment a keyboard that was up can come back. */
export function useCloseByTap(onClose: () => void): (from: Element) => void {
  const focus = useFocus();
  return (from) => {
    focus.returnKeyboardInTap(from);
    onClose();
  };
}

/** The title and a close button: a dialog that asks or reports. */
export function TitleBar({ title, onClose }: { title: string; onClose: () => void }) {
  const closeByTap = useCloseByTap(onClose);
  return (
    <header class={styles.title}>
      <h2 class={styles.heading}>{title}</h2>
      <IconButton icon="close" label="Close" data-initial-focus="touch" onClick={(e) => { closeByTap(e.currentTarget); }} />
    </header>
  );
}

/**
 * A full-screen page's one 44 pt row: Back (named for where it goes), then the title and/or the controls it is given.
 * `docked` (touch, where tabs have the dock): Back is in the page's {@link PageBack} at the bottom instead.
 */
export function PageBar({ back, onBack, title, docked = false, children }: { back: string; onBack: () => void; title?: string; docked?: boolean; children?: ComponentChildren }) {
  const closeByTap = useCloseByTap(onBack);
  return (
    <header class={styles.page} data-docked={docked ? "" : undefined}>
      {!docked && <IconButton icon="back" label={back} data-initial-focus="touch" onClick={(e) => { closeByTap(e.currentTarget); }} />}
      {title && <h2 class={styles.heading}>{title}</h2>}
      {children}
    </header>
  );
}

/** A docked page's bottom bar: Back where the dock's tab row has it. */
export function PageBack({ back, onBack }: { back: string; onBack: () => void }) {
  const closeByTap = useCloseByTap(onBack);
  return (
    <BottomBar label={back}>
      <DockButton kind="control" aria-label={back} onClick={(e) => { closeByTap(e.currentTarget); }}><Icon name="back" size={20} /></DockButton>
    </BottomBar>
  );
}
