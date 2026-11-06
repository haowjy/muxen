import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { TargetedSubmitEvent } from "preact";
import { useApp, useAppView } from "../../app/context";
import { describeError } from "../../files/browser";
import { HttpRefusal } from "../../net/http";
import type { CreateKind } from "../../proto/generated/messages";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import { Spinner } from "../../ui/primitives/Spinner";
import { TextField } from "../../ui/primitives/TextField";
import type { FilesSession } from "./session";
import styles from "./NewEntry.module.css";

/** A New file or New folder asked for: where, which, and the list it was asked in. */
export interface Creating {
  dir: string;
  kind: CreateKind;
  root: string;
}

interface Props {
  session: FilesSession;
  dir: string;
  kind: CreateKind;
  /** Done with the form. `hadFocus`: the field held it, so the list takes it back; otherwise it has gone where the user sent it. */
  onClose: (hadFocus: boolean) => void;
}

/**
 * Names a new file or folder: in a form, so Return is the form's and Cancel can't commit it, one request at a time, a
 * refusal keeping the form open with the name in it. A success closes it at once; the landing is the session's. A row
 * among the outline's on a desktop, a dialog on the phone.
 */
export function NewEntry({ session, dir, kind, onClose }: Props) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const label = kind === "file" ? "New file" : "New folder";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => () => { mounted.current = false; }, []);
  const holdsFocus = (): boolean => form.current?.contains(document.activeElement) === true;
  const close = (): void => { onClose(holdsFocus()); };
  // A press that takes focus from an empty field: the row under it stays put until the press ends, so the click lands.
  const pressing = useRef(false);
  useLayoutEffect(() => {
    const down = (): void => { pressing.current = true; };
    const up = (): void => { pressing.current = false; };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);

  const submit = async (e: TargetedSubmitEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (busy || name === "") return;
    setBusy(true);
    setError(null);
    try {
      await session.create(dir, name, kind);
      if (mounted.current) close();
    } catch (refused) {
      if (!(refused instanceof HttpRefusal)) throw refused;
      const words = refused.code === "bad_request" ? "That name can't be used." : describeError(refused, session.hostName);
      if (!mounted.current) {
        app.notify(`Couldn't create ${name}: ${words}`);
        return;
      }
      setError(words);
      setBusy(false);
    }
  };

  const fields = (
    <form
      ref={form}
      class={phone ? styles.dialog : styles.row}
      onSubmit={(e) => { void submit(e); }}
      // Inside the outline: its keys, and Files', are not this field's.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      onFocusOut={(e) => {
        const to = e.relatedTarget;
        // Another window took the focus when the field is still the document's active element: it stays to come back to.
        const staying = holdsFocus() || (to instanceof Node && form.current?.contains(to));
        if (phone || name !== "" || staying) return;
        if (pressing.current) window.addEventListener("click", () => { onClose(false); }, { once: true });
        else onClose(false);
      }}
    >
      <TextField label={label} hideLabel placeholder={kind === "file" ? "File name" : "Folder name"} value={name} onInput={(v) => { setName(v); setError(null); }} readOnly={busy} error={error} focusTarget="name" data-initial-focus="typing" />
      {busy && !phone && <Spinner label="Creating" />}
      {(phone || touch) && (
        <div class={styles.actions}>
          <Button variant="quiet" onClick={close}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => { form.current?.requestSubmit(); }}>Create</Button>
        </div>
      )}
    </form>
  );
  return phone ? <Dialog open title={label} header={<TitleBar title={label} onClose={close} />} onClose={close}>{fields}</Dialog> : fields;
}
