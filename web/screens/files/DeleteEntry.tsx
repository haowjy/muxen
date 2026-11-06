import type { Entry } from "../../files/api";
import { describeError } from "../../files/browser";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import type { FilesSession } from "./session";
import { useRequest } from "./useRequest";
import styles from "./NameEntry.module.css";

interface Props {
  session: FilesSession;
  path: string;
  entry: Entry;
  /** Done with the dialog. `hadFocus`: it held the focus, so the list takes it back. */
  onClose: (hadFocus: boolean) => void;
}

/** Asks before a delete, which has no undo. Once it runs it can't be stopped, so Cancel becomes Hide: the request is the session's. */
export function DeleteEntry({ session, path, entry, onClose }: Props) {
  const title = `Delete ${entry.name}?`;
  const folder = entry.kind === "dir" && !entry.link;
  const close = (): void => { onClose(true); };
  const { busy, error, run } = useRequest((refused) => `${describeError(refused, session.hostName)}${folder ? " Some of it may be gone." : ""}`);
  const confirm = async (): Promise<void> => {
    if (await run(() => session.remove(path), `Couldn't delete ${entry.name}`)) close();
  };
  return (
    <Dialog open title={title} header={<TitleBar title={title} onClose={close} />} onClose={close}>
      <div class={styles.dialog}>
        <p>{entry.link ? "Only the link goes, not what it points to." : folder ? "Everything in this folder goes with it. This can't be undone." : "This can't be undone."}</p>
        {error && <p class={styles.error} role="alert">{error}</p>}
        <div class={styles.actions}>
          <Button variant="quiet" onClick={close}>{busy ? "Hide" : "Cancel"}</Button>
          <Button variant="danger" busy={busy} onClick={() => { void confirm(); }}>{busy ? "Deleting…" : "Delete"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
