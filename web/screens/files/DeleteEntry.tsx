import type { Entry } from "../../files/api";
import { describeError } from "./failure";
import { useRequest } from "../../app/useRequest";
import { ConfirmDialog } from "../../ui/primitives/ConfirmDialog";
import type { FilesSession } from "./session";

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
    <ConfirmDialog title={title} confirm="Delete" confirming="Deleting…" cancel={busy ? "Hide" : "Cancel"} error={error} busy={busy} onConfirm={() => { void confirm(); }} onClose={close}>
      {entry.link ? "Only the link goes, not what it points to." : folder ? "Everything in this folder goes with it. This can't be undone." : "This can't be undone."}
    </ConfirmDialog>
  );
}
