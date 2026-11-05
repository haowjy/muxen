// One group on Settings' page: a heading, what it covers, and its controls.
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import type { HostClient } from "../../net/hosts";
import styles from "./Settings.module.css";

/** A server's name in Settings' copy. */
export const serverName = (host: HostClient | undefined): string => host?.name ?? "the server";

export function Section({ title, detail, children }: { title: string; detail?: ComponentChildren; children?: ComponentChildren }) {
  const id = useId();
  return (
    <section class={styles.section} aria-labelledby={id}>
      <h3 id={id} class={styles.heading}>{title}</h3>
      {detail !== undefined && <p class={styles.detail}>{detail}</p>}
      {children}
    </section>
  );
}
