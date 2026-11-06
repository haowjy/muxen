import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import type { Entry } from "../../files/api";
import { describeError } from "../../files/browser";
import { HttpRefusal } from "../../net/http";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import type { FilesSession } from "./session";
import styles from "./NameEntry.module.css";

interface Props {
  session: FilesSession;
  path: string;
  entry: Entry;
  /** Done with the dialog. `hadFocus`: it held the focus, so the list takes it back. */
  onClose: (hadFocus: boolean) => void;
}

/** Asks before a delete, which has no undo. The request is the session's: a dialog closed meanwhile only stops listening. */
export function DeleteEntry({ session, path, entry, onClose }: Props) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => () => { mounted.current = false; }, []);
  const title = `Delete ${entry.name}?`;
  const folder = entry.kind === "dir" && !entry.link;
  const close = (): void => { onClose(true); };
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await session.remove(path);
      if (mounted.current) close();
    } catch (refused) {
      if (!(refused instanceof HttpRefusal)) throw refused;
      const words = `${describeError(refused, session.hostName)}${folder ? " Some of it may be gone." : ""}`;
      if (!mounted.current) {
        app.notify(`Couldn't delete ${entry.name}: ${words}`);
        return;
      }
      setError(words);
      setBusy(false);
    }
  };
  return (
    <Dialog open title={title} header={<TitleBar title={title} onClose={close} />} onClose={close}>
      <div class={styles.dialog}>
        <p>{entry.link ? "Only the link goes, not what it points to." : folder ? "Everything in this folder goes with it. This can't be undone." : "This can't be undone."}</p>
        {error && <p class={styles.error} role="alert">{error}</p>}
        <div class={styles.actions}>
          <Button variant="quiet" onClick={close}>Cancel</Button>
          <Button variant="danger" busy={busy} onClick={() => { void confirm(); }}>{busy ? "Deleting…" : "Delete"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
