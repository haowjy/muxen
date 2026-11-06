import { useApp } from "../../app/context";
import { baseName } from "../../files/paths";
import type { UploadItem } from "../../files/uploads";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { Spinner } from "../../ui/primitives/Spinner";
import { InsertButton } from "./FileActions";
import type { FilesSession } from "./session";
import styles from "./UploadPanel.module.css";

function Item({ session, item, onPreview }: { session: FilesSession; item: UploadItem; onPreview: (path: string) => void }) {
  const app = useApp();
  // The offer leads with the tab the upload began in, never the one active now.
  const dismiss = (): void => { session.uploads.dismiss(item.id); };

  if (item.state === "uploading") {
    const percent = Math.round(item.progress * 100);
    return (
      <li class={styles.item}>
        <Spinner label="Uploading" />
        <div class={styles.text}>
          <p class={styles.title}>{item.progress === 0 ? "Waiting to upload" : `Uploading ${String(percent)}%`}</p>
          <progress class={styles.progress} max={100} value={percent} aria-label="Upload progress" />
        </div>
        <IconButton icon="close" label="Cancel upload" onClick={() => { app.platform.uploads.cancel(item.id); dismiss(); }} />
      </li>
    );
  }
  if (item.state === "failed") {
    return (
      <li class={styles.item}>
        <Icon name="alert" class={styles.error} />
        <div class={styles.text}>
          <p class={styles.title} role="alert">{item.message}</p>
        </div>
        <IconButton icon="close" label="Dismiss" onClick={dismiss} />
      </li>
    );
  }
  return (
    <li class={styles.item}>
      <Icon name="check" class={styles.ok} />
      <div class={styles.text}>
        <p class={styles.title} role="status">Saved {baseName(item.path)}</p>
        <div class={styles.actions}>
          <InsertButton path={item.path} first={item.target} labelled onInserted={dismiss} />
          <Button variant="quiet" onClick={() => { onPreview(item.path); }}>Preview</Button>
        </div>
      </div>
      <IconButton icon="close" label="Dismiss" onClick={dismiss} />
    </li>
  );
}

/** The uploads this screen started: progress, then Insert path for the tab each began in. */
export function UploadPanel({ session, onPreview }: { session: FilesSession; onPreview: (path: string) => void }) {
  const { items } = useStore(session.uploads, (s) => s);
  if (items.length === 0) return null;
  return (
    <ul class={styles.panel} aria-label="Uploads">
      {items.map((item) => <Item key={item.id} session={session} item={item} onPreview={onPreview} />)}
    </ul>
  );
}
