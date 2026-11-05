// The one header row every screen and full-screen page has: Back (named for where it goes) on the left, the
// title, then the screen's own controls at the end, over one rule. Docked (touch, where tabs have the dock),
// Back is in the bottom bar instead and the title starts the row.
import type { ComponentChildren } from "preact";
import { useCloseByTap } from "./DialogBars";
import { IconButton } from "./IconButton";
import styles from "./ScreenBar.module.css";

export function ScreenBar({ title, back, onBack, docked = false, children }: { title: string; back?: string; onBack?: () => void; docked?: boolean; children?: ComponentChildren }) {
  const closeByTap = useCloseByTap(onBack ?? (() => undefined));
  return (
    <header class={styles.screen}>
      <div class={styles.bar}>
        {back && onBack && !docked && <IconButton icon="back" label={back} data-initial-focus="touch" class={styles.back} onClick={(e) => { closeByTap(e.currentTarget); }} />}
        <h1 class={styles.title}>{title}</h1>
        {children}
      </div>
    </header>
  );
}
