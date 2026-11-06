import { useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { FileRef } from "../../files/browser";
import type { TextPreview } from "../../files/api";
import { useRequest } from "../../app/useRequest";
import { cx } from "../../ui/cx";
import { Button } from "../../ui/primitives/Button";
import { CodeEditor } from "../../ui/primitives/CodeEditor";
import { ConfirmDialog } from "../../ui/primitives/ConfirmDialog";
import { describeError } from "./failure";
import type { Edit } from "./edits";
import type { FilesSession } from "./session";
import bar from "./FileView.module.css";
import styles from "./EditView.module.css";

/** Where a save's refusal means more than the same code does on a read. */
const SAVE_WORDS: Partial<Record<string, string>> = {
  too_large: "Over the 1 MiB save limit.",
  denied: "Can't save: this file is read-only, another user's, or hard-linked.",
  not_found: "This file is gone.",
};

interface Props {
  session: FilesSession;
  file: FileRef;
  edit: Edit;
  /** The file as a save or a reload left it, for the viewer it goes back to. */
  onSaved: (text: TextPreview) => void;
}

/** A file being edited, under a line of Cancel, its name and Save. A save that finds the file changed elsewhere asks which to keep. */
export function EditView({ session, file, edit, onSaved }: Props) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const { edits } = session;
  const { path } = file;
  const [discarding, setDiscarding] = useState(false);
  const { busy, error, clear, run } = useRequest((refused) => SAVE_WORDS[refused.code] ?? describeError(refused, session.hostName));
  const takeKeyboard = useRef(edit.state === null && !edit.changed).current;

  const save = (overwrite = false): void => {
    if (busy) return;
    void run(async () => {
      const saved = await edits.save(path, overwrite);
      if (!saved) return;
      onSaved(saved);
      app.notify(`Saved ${file.name}`);
    }, `Couldn't save ${file.name}`);
  };

  const reload = (): void => {
    void run(async () => {
      const fresh = await edits.reload(path);
      if (!fresh) return "Can't edit this file any more.";
      onSaved(fresh);
      return null;
    }, `Couldn't reload ${file.name}`);
  };

  const finish = (): void => { edits.end(path); };

  return (
    <div class={cx(bar.view, styles.editing)}>
      <header class={bar.bar}>
        <Button variant="quiet" onClick={() => { if (edit.changed) setDiscarding(true); else finish(); }}>{edit.changed ? "Cancel" : "Done"}</Button>
        <h1 class={bar.name} title={path}><span class={bar.text}><span class={bar.base}>{file.name}</span></span></h1>
        <Button variant="primary" busy={busy} disabled={!edit.changed} onClick={() => { save(); }}>{busy ? "Saving…" : "Save"}</Button>
      </header>
      {error && <p class={styles.problem} role="alert">{error}</p>}
      {edit.conflict && (
        <div class={styles.problem} role="alert">
          <p>{file.name} changed on {session.hostName}.</p>
          <div class={styles.actions}>
            <Button variant="quiet" onClick={reload}>Reload theirs</Button>
            <Button variant="danger" onClick={() => { save(true); }}>Overwrite with mine</Button>
          </div>
        </div>
      )}
      <CodeEditor
        start={() => { const now = edits.snapshot.open.get(path) ?? edit; return now.state ?? { text: now.text, ending: now.ending }; }}
        wrap={phone}
        takeKeyboard={takeKeyboard}
        onChange={() => {
          clear();
          edits.typed(path);
        }}
        onSave={() => { if (edit.changed) save(); }}
        onReady={(handle) => { edits.attach(path, handle); }}
        onLeave={(handle, state) => { edits.detach(handle, state); }}
      />
      {discarding && (
        <ConfirmDialog title="Discard your changes?" confirm="Discard" confirming="Discarding…" error={null} busy={false} onConfirm={finish} onClose={() => { setDiscarding(false); }} />
      )}
    </div>
  );
}
