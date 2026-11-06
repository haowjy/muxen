import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { TargetedSubmitEvent } from "preact";
import { useAppView } from "../../app/context";
import { describeError } from "./failure";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import { Spinner } from "../../ui/primitives/Spinner";
import { TextField } from "../../ui/primitives/TextField";
import type { FilesSession } from "./session";
import { useRequest } from "./useRequest";
import styles from "./NameEntry.module.css";

interface Props {
  session: FilesSession;
  label: string;
  placeholder: string;
  /** The name there is now, for a rename; selected up to its extension when `stem` is that far. */
  was?: string;
  stem?: number;
  /** What the button says, and the same for the refusal ("Couldn't rename x"). */
  action: "Create" | "Rename";
  submit: (name: string) => Promise<void>;
  /** Done with the form. `hadFocus`: the field held it, so the list takes it back; otherwise it has gone where the user sent it. */
  onClose: (hadFocus: boolean) => void;
}

/**
 * Asks for one name: in a form, so Return is the form's and Cancel can't commit it, one request at a time, a refusal
 * keeping the form open with the name in it. A success closes it at once; the landing is the session's. A row among the
 * outline's on a desktop, a dialog on the phone.
 */
export function NameEntry({ session, label, placeholder, was = "", stem = was.length, action, submit, onClose }: Props) {
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const [name, setName] = useState(was);
  const { busy, error, clear, run } = useRequest((refused) => (refused.code === "bad_request" ? "That name can't be used." : describeError(refused, session.hostName)));
  const form = useRef<HTMLFormElement>(null);
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

  const send = async (e: TargetedSubmitEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (busy || name === "") return;
    if (name === was) close();
    else if (await run(() => submit(name), `Couldn't ${action.toLowerCase()} ${name}`)) close();
  };

  const fields = (
    <form
      ref={form}
      class={phone ? styles.dialog : styles.row}
      onSubmit={(e) => { void send(e); }}
      // Inside the outline: its keys, and Files', are not this field's.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      onFocusOut={(e) => {
        const to = e.relatedTarget;
        // Another window took the focus when the field is still the document's active element: it stays to come back to.
        const staying = holdsFocus() || (to instanceof Node && form.current?.contains(to));
        if (phone || (name !== "" && name !== was) || staying) return;
        if (pressing.current) window.addEventListener("click", () => { onClose(false); }, { once: true });
        else onClose(false);
      }}
    >
      <TextField label={label} hideLabel placeholder={placeholder} value={name} selectTo={stem} onInput={(v) => { setName(v); clear(); }} readOnly={busy} error={error} focusTarget="name" data-initial-focus="typing" />
      {busy && !phone && <Spinner label={`${action.slice(0, -1)}ing`} />}
      {(phone || touch) && (
        <div class={styles.actions}>
          <Button variant="quiet" onClick={close}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => { form.current?.requestSubmit(); }}>{action}</Button>
        </div>
      )}
    </form>
  );
  return phone ? <Dialog open title={label} header={<TitleBar title={label} onClose={close} />} onClose={close}>{fields}</Dialog> : fields;
}
