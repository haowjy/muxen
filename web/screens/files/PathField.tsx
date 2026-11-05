import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useOverlay } from "../../app/context";
import { describeError } from "../../files/browser";
import { HttpRefusal } from "../../net/http";
import { move } from "../../files/outline";
import { enter, fieldView, type FieldContext } from "../../files/pathfield";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { PathInput } from "../../ui/primitives/PathInput";
import { useStore } from "../../ui/store";
import { rowId } from "./FolderList";
import { NarrowedList } from "./NarrowedList";
import type { FilesSession } from "./session";
import pane from "./FilesScreen.module.css";
import styles from "./PathField.module.css";

interface Props {
  session: FilesSession;
  /** The text at rest: the folder on screen, `~/…` under home. */
  rest: string;
  /** The list below is the field's while it is editing. */
  onEditing: (editing: boolean) => void;
  /** Go named a folder: the pane opens it in its tab. */
  onOpen: (to: FilesPlace) => void;
}

/**
 * The path field (browser-behaviors.md "Files"): at rest it reads where you are; focused, what is typed
 * narrows the typed folder's rows (folders and files), and Enter opens the selected row, else the place
 * the text names. The narrowing rules are `files/pathfield.ts`'s; this wires keys, taps and focus.
 * Editing is a router overlay (`files/find`), so Back ends the edit before it leaves the folder.
 */
export function PathField({ session, rest, onEditing, onOpen }: Props) {
  const app = useApp();
  const { browser } = session;
  const home = useStore(browser, (s) => s.home);
  const showHidden = useStore(browser, (s) => s.hidden);
  const held = useStore(browser.folders, (s) => s.held);
  const input = useRef<HTMLInputElement>(null);
  /** The typed text; null at rest. */
  const [text, setText] = useState<string | null>(null);
  /** A row picked with the arrow keys; otherwise the first match is the selection. */
  const [selection, setSelection] = useState<string | null>(null);
  /** Why Enter opened nothing. */
  const [said, setSaid] = useState<string | null>(null);
  const [loadingRest, setLoadingRest] = useState(false);
  const listId = useId();
  const latest = useRef(text);
  latest.current = text;
  const editing = text !== null;
  const find = useOverlay("files", "find");
  /** Set and cleared synchronously, so a blur that an end of editing causes does not end it twice. */
  const active = useRef(false);

  const ctx: FieldContext | null = home === null ? null : { home, showHidden, held: (key) => held.get(key) };
  const view = ctx && text !== null ? fieldView(text, ctx, selection) : null;

  // The folder the field names is listed once typing settles; leaving cancels a pending one.
  const ask = view?.ask ?? null;
  useEffect(() => { browser.folders.ask(ask); }, [browser, ask?.path, ask?.hidden]);
  const selected = view?.out.selected ?? null;
  useEffect(() => {
    const at = view?.out.rows.findIndex((row) => row.key === selected) ?? -1;
    if (at >= 0) document.getElementById(rowId(listId, at))?.scrollIntoView({ block: "nearest" });
  }, [listId, selected]);

  const resetSaid = (): void => { setSelection(null); setSaid(null); };
  /** The field is at rest again and the keyboard is down; the history entry is the caller's. */
  const endEditing = (): void => {
    active.current = false;
    setText(null);
    resetSaid();
    if (input.current && document.activeElement === input.current) app.focus.blurElement(input.current);
  };
  /** Ends editing from the field (Escape, Cancel): Back's step. */
  const cancel = (): void => {
    if (!active.current) return;
    endEditing();
    app.router.closeOverlay();
  };
  const open = (place: FilesPlace): void => {
    endEditing();
    app.router.closeOverlay(() => { onOpen(place); });
  };

  /** Enter: opens the selected row, else what the text names. */
  const submit = async (): Promise<void> => {
    if (home === null || text === null) return;
    const now = (): FieldContext => ({ home, showHidden, held: (key) => browser.folders.snapshot.held.get(key) });
    let v = fieldView(text, now(), selection);
    let go = enter(v, home);
    if ("wait" in go && v.ask) {
      // The typed folder's listing decides what the name is: it must have arrived.
      await browser.folders.load(v.ask.path, v.ask.hidden);
      if (latest.current !== text) return;
      v = fieldView(text, now(), selection);
      go = enter(v, home);
    }
    if ("open" in go) open(go.open);
    else if ("up" in go) { setText(go.up); resetSaid(); }
    else if ("resolve" in go) {
      try { open(await browser.resolve(go.resolve)); }
      catch (error) {
        if (latest.current !== text) return;
        // A partial name on a page not loaded can't be probed: the list offers the rest.
        if (error instanceof HttpRefusal && error.code === "not_found") setSaid(`Nothing named ${v.typed?.segment ?? ""} in the entries loaded. Load the rest to match more.`);
        else setSaid(error instanceof HttpRefusal ? describeError(error, session.hostName) : "That path can't be opened.");
      }
    } else if ("say" in go) setSaid(go.say);
  };

  const loadRest = (): void => {
    if (!view?.ask) return;
    setLoadingRest(true);
    browser.folders.rest(view.ask.path, view.ask.hidden).catch((error: unknown) => {
      setSaid(error instanceof HttpRefusal ? describeError(error, session.hostName) : "Couldn't load the rest.");
    }).finally(() => { setLoadingRest(false); });
  };

  useEffect(() => { onEditing(editing); }, [editing, onEditing]);
  // Starting puts the caret after the trailing `/`, where typing narrows. iOS places the caret at the tap
  // once focus lands, after this runs, so it is set again on the next frame and once more after the tap settles.
  useLayoutEffect(() => {
    const el = input.current;
    if (!editing || !el) return undefined;
    const toEnd = (): void => { if (document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length); };
    toEnd();
    const frame = requestAnimationFrame(toEnd);
    const later = setTimeout(toEnd, 120);
    return () => { cancelAnimationFrame(frame); clearTimeout(later); };
  }, [editing]);
  // Back (or Forward) moved off the edit's entry; or an entry that held the edit came back without its text.
  useEffect(() => {
    if (active.current && !find.open) endEditing();
    else if (!active.current && find.open) app.router.closeOverlay();
  }, [find.open]);
  // Where you are changed some other way: the field is at rest again.
  useEffect(cancel, [rest]);

  return (
    <>
      <div class={styles.find}>
        <PathInput
          label="Go to path"
          placeholder="Go to path"
          value={text ?? rest}
          listId={view && view.out.rows.length > 0 ? listId : undefined}
          activeId={selected !== null && view ? rowId(listId, view.out.rows.findIndex((row) => row.key === selected)) : undefined}
          onInput={(value) => { resetSaid(); setText(value); }}
          inputRef={input}
          focusTarget="path"
          onFocus={() => {
            if (active.current || home === null) return;
            active.current = true;
            app.router.openOverlay({ screen: "files", name: "find" });
            setText(rest.endsWith("/") ? rest : `${rest}/`);
          }}
          // Losing focus (the keyboard hidden, a tap elsewhere) only lowers the keyboard: the edit and its text
          // stay, and a tap on the field resumes it. Cancel, Escape and Back end it.
          onKeyDown={(e) => {
            if (editing && e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            } else if (editing && e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (view && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setSelection(move(view.out.rows, selected, e.key === "ArrowDown" ? "down" : "up").selection);
            }
          }}
        />
        {editing && (
          <Button variant="quiet" onMouseDown={(e) => { e.preventDefault(); }} onClick={cancel}>Cancel</Button>
        )}
      </div>
      {said && <p class={styles.said} role="alert">{said}</p>}
      {view && home !== null && (
        <div class={pane.scroll}>
          <NarrowedList
            view={view}
            home={home}
            hostName={session.hostName}
            listId={listId}
            loadingRest={loadingRest}
            onOpen={open}
            onUp={(to) => { setText(to); resetSaid(); }}
            onRetry={() => { if (view.ask) { browser.folders.drop(view.ask.path); void browser.folders.load(view.ask.path, view.ask.hidden); } }}
            onLoadRest={loadRest}
          />
        </div>
      )}
    </>
  );
}
