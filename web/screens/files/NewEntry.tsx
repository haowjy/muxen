import { useEffect, useRef, useState } from "preact/hooks";
import type { TargetedSubmitEvent } from "preact";
import { useApp, useAppView } from "../../app/context";
import { describeError } from "../../files/browser";
import { join } from "../../files/paths";
import { HttpRefusal } from "../../net/http";
import type { CreateKind } from "../../proto/generated/messages";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import { TextField } from "../../ui/primitives/TextField";
import type { FilesSession } from "./session";
import styles from "./NewEntry.module.css";

/** A New file or New folder asked for: where, and which. */
export interface Creating {
  dir: string;
  kind: CreateKind;
}

interface Props extends Creating {
  session: FilesSession;
  /** The name took: a desktop opens a new folder here, before the landing reveals it. */
  onCreated: (path: string) => void;
  onClose: () => void;
}

/**
 * Names a new file or folder: in a form, so Return is the form's and Cancel can't commit it, one request at a time, a
 * refusal keeping the form open with the name in it. A row of the outline on a desktop, a dialog on the phone.
 */
export function NewEntry({ session, dir, kind, onCreated, onClose }: Props) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const { browser } = session;
  const label = kind === "file" ? "New file" : "New folder";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (!phone) app.focus.focusTarget("name"); }, [app, phone]);

  const submit = async (e: TargetedSubmitEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (busy || name === "") return;
    setBusy(true);
    setError(null);
    try {
      await browser.api.create(dir, name, kind);
    } catch (refused) {
      if (!(refused instanceof HttpRefusal)) throw refused;
      // Taken, perhaps by this name's own lost answer: the row shows once the folder is listed again.
      if (refused.code === "exists") void browser.folders.drop(dir);
      setError(refused.code === "bad_request" ? "That name can't be used." : describeError(refused, session.hostName));
      setBusy(false);
      return;
    }
    const path = join(dir, name);
    // Asking for a dot name is asking to see it.
    if (name.startsWith(".") && !browser.snapshot.hidden) await browser.toggleHidden();
    onCreated(path);
    await browser.added(path);
    app.notify(`Created ${name}`);
    onClose();
  };

  const fields = (
    <form
      ref={form}
      class={phone ? styles.dialog : styles.row}
      onSubmit={(e) => { void submit(e); }}
      // Inside the outline: its keys, and Files', are not this field's.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
      onFocusOut={(e) => {
        const to = e.relatedTarget;
        if (!phone && name === "" && !busy && !(to instanceof Node && form.current?.contains(to))) onClose();
      }}
    >
      <TextField label={label} hideLabel placeholder={kind === "file" ? "File name" : "Folder name"} value={name} onInput={(v) => { setName(v); setError(null); }} error={error} focusTarget="name" data-initial-focus="touch" />
      {phone && (
        <div class={styles.actions}>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => { form.current?.requestSubmit(); }}>Create</Button>
        </div>
      )}
    </form>
  );
  return phone ? <Dialog open title={label} header={<TitleBar title={label} onClose={onClose} />} onClose={onClose}>{fields}</Dialog> : fields;
}
