import { useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { FileRef } from "../../files/browser";
import type { TextPreview } from "../../files/api";
import type { Edit } from "../../files/edits";
import { HttpRefusal } from "../../net/http";
import { useRequest } from "../../app/useRequest";
import { cx } from "../../ui/cx";
import { Button } from "../../ui/primitives/Button";
import { CodeEditor, type EditorHandle } from "../../ui/primitives/CodeEditor";
import { ConfirmDialog } from "../../ui/primitives/ConfirmDialog";
import { describeError } from "./failure";
import type { FilesSession } from "./session";
import { TEXT_LIMIT } from "./TextViewers";
import bar from "./FileView.module.css";
import styles from "./EditView.module.css";

/** Where a save's refusal means more than the same code does on a read. */
const SAVE_WORDS: Partial<Record<string, string>> = {
  too_large: "That's over the 1 MiB this editor saves.",
  denied: "Can't save over this file: it's read-only, another user's, or has another hard link.",
  not_found: "This file is gone. Copy your text before you leave.",
};

const bytes = (text: string): number => new TextEncoder().encode(text).length;

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
  const editor = useRef<EditorHandle | null>(null);
  const [conflict, setConflict] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const { busy, error, clear, run } = useRequest((refused) => SAVE_WORDS[refused.code] ?? describeError(refused, session.hostName));
  const start = useRef({ from: edit.state ?? { text: edit.text, ending: edit.ending }, fresh: edit.state === null && !edit.changed }).current;

  const save = (overwrite = false): void => {
    const open = editor.current;
    if (!open || busy) return;
    const text = open.text();
    const sent = open.state().doc;
    setConflict(false);
    void run(async () => {
      try {
        const etag = await session.save(file.path, text, overwrite);
        onSaved({ text, size: bytes(text), truncated: false, etag, ending: edit.ending });
        session.edits.keep(file.path, { changed: !open.state().doc.eq(sent) });
        app.notify(`Saved ${file.name}`);
      } catch (refused) {
        if (refused instanceof HttpRefusal && refused.code === "changed") setConflict(true);
        else throw refused;
      }
    }, `Couldn't save ${file.name}`);
  };

  const reload = (): void => {
    void run(async () => {
      const fresh = await session.browser.api.text(file.path, TEXT_LIMIT);
      if (fresh.ending !== edit.ending || fresh.etag === null) return "This file can't be edited here any more.";
      editor.current?.replace(fresh.text);
      session.edits.keep(file.path, { etag: fresh.etag, changed: false });
      onSaved(fresh);
      setConflict(false);
      return null;
    }, `Couldn't reload ${file.name}`);
  };

  const finish = (): void => { session.finishEdit(file.path); };

  return (
    <div class={cx(bar.view, styles.editing)}>
      <header class={bar.bar}>
        <Button variant="quiet" onClick={() => { if (edit.changed) setDiscarding(true); else finish(); }}>{edit.changed ? "Cancel" : "Done"}</Button>
        <h1 class={bar.name} title={file.path}><span class={bar.text}><span class={bar.base}>{file.name}</span></span></h1>
        <Button variant="primary" busy={busy} disabled={!edit.changed} onClick={() => { save(); }}>{busy ? "Saving…" : "Save"}</Button>
      </header>
      {error && <p class={styles.problem} role="alert">{error}</p>}
      {conflict && (
        <div class={styles.problem} role="alert">
          <p>{file.name} changed on {session.hostName} since you opened it.</p>
          <div class={styles.actions}>
            <Button variant="quiet" onClick={reload}>Reload theirs</Button>
            <Button variant="danger" onClick={() => { save(true); }}>Overwrite with mine</Button>
          </div>
        </div>
      )}
      <CodeEditor
        start={start.from}
        wrap={phone}
        takeKeyboard={start.fresh}
        onChange={() => {
          clear();
          if (!session.edits.snapshot.open.get(file.path)?.changed) session.edits.keep(file.path, { changed: true });
        }}
        onSave={() => { if (edit.changed) save(); }}
        onReady={(handle) => {
          editor.current = handle;
          session.edits.attach({ path: file.path, editor: handle });
        }}
        onLeave={(state) => {
          session.edits.attach(null);
          session.edits.keep(file.path, { state });
        }}
      />
      {discarding && (
        <ConfirmDialog title="Discard your changes?" confirm="Discard" confirming="Discarding…" error={null} busy={false} onConfirm={finish} onClose={() => { setDiscarding(false); }}>
          {`What you changed in ${file.name} goes. The file stays as it was last saved.`}
        </ConfirmDialog>
      )}
    </div>
  );
}
