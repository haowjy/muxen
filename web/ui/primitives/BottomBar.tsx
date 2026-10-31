// The bottom bar of a touch screen without a dock (Home, the tab list, a page dialog): the same row as the
// dock's tab row, in the same place, so back and the screen's controls never move between top and bottom.
import type { ComponentChildren } from "preact";
import styles from "./BottomBar.module.css";

export function BottomBar({ label, children }: { label: string; children: ComponentChildren }) {
  return <nav class={styles.bar} aria-label={label}>{children}</nav>;
}
