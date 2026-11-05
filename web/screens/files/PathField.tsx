import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useOverlay } from "../../app/context";
import { describeError } from "../../files/browser";
import { HttpRefusal } from "../../net/http";
import { enter, fieldView, type FieldContext } from "../../files/pathfield";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { PathInput } from "../../ui/primitives/PathInput";
import { useStore } from "../../ui/store";
import { NarrowedList } from "./NarrowedList";
import type { FilesSession } from "./session";
import { useListbox } from "./useListbox";
import pane from "./FilesScreen.module.css";
import styles from "./PathField.module.css";

interface Props {
  session: FilesSession;
  /** The text at rest: the folder on screen, `~/…/` under home, with its trailing `/`. */
  rest: string;
  /** The folder on screen, canonical: Enter on it stays put. */
  here: string;
  /** The folder's controls, on the line beside the path while it is at rest. */
  actions?: ComponentChildren;
  /** The line's last control, at rest and while editing (the Preview toggle). */
  end?: ComponentChildren;
  /** The list below is the field's while it is editing. */
  onEditing: (editing: boolean) => void;
  /** Go named a folder: the pane opens it in its tab. */
  onOpen: (to: FilesPlace) => void;
}

/** The text a click on the path line selects: the last folder's name and its `/` (`muxen/` in `~/repos/muxen/`), so Delete leaves the parent. */
export function lastNameRange(text: string): [number, number] {
  const cut = text.endsWith("/") ? text.lastIndexOf("/", text.length - 2) : -1;
  return cut < 0 ? [text.length, text.length] : [cut + 1, text.length];
}

/**
 * The path line (browser-behaviors.md "Files"): at rest one plain string that says where you are; a click
 * or tap makes it the field with the last folder's name selected; what is typed
 * narrows the typed folder's rows (folders and files), and Enter opens the selected row, else the place
 * the text names. The narrowing rules are `files/pathfield.ts`'s; this wires keys, taps and focus.
 * Editing is a router overlay (`files/find`), so Back ends the edit before it leaves the folder.
 */
export function PathField({ session, rest, here, actions, end, onEditing, onOpen }: Props) {
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
  const rows = view?.out.rows ?? [];
  // NarrowedList draws the listbox only for a typed folder that did not fail.
  const listed = rows.length > 0 && !!view?.typed && !view.record?.error;
  const box = useListbox({ rows, selected: view?.out.selected ?? null, onSelect: setSelection, keys: "arrows" });

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
    // Enter on the folder you're in (the path as it started) stays put: no second entry for the same place.
    app.router.closeOverlay(place.kind === "dir" && place.path === here ? undefined : () => { onOpen(place); });
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
  // Starting selects the last folder's name, so Delete leaves its parent. iOS places the caret at the tap once
  // focus lands, after this runs, so it is set again on the next frame and once more after the tap settles.
  useLayoutEffect(() => {
    const el = input.current;
    if (!editing || !el) return undefined;
    const [from, to] = lastNameRange(el.value);
    const select = (): void => { if (document.activeElement === el) el.setSelectionRange(from, to); };
    select();
    const frame = requestAnimationFrame(select);
    const later = setTimeout(select, 120);
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
          line
          label="Path"
          placeholder="Go to path"
          value={text ?? rest}
          listId={listed ? box.id : undefined}
          activeId={box.activeId}
          onInput={(value) => { resetSaid(); setText(value); }}
          inputRef={input}
          focusTarget="path"
          onFocus={() => {
            if (active.current || home === null) return;
            active.current = true;
            app.router.openOverlay({ screen: "files", name: "find" });
            setText(rest);
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
            } else if (view) box.onKeyDown(e);
          }}
        />
        {editing ? (
          <Button variant="quiet" onMouseDown={(e) => { e.preventDefault(); }} onClick={cancel}>Cancel</Button>
        ) : actions}
        {end}
      </div>
      {said && <p class={styles.said} role="alert">{said}</p>}
      {view && home !== null && (
        <div class={pane.scroll}>
          <NarrowedList
            view={view}
            home={home}
            hostName={session.hostName}
            box={box}
            loadingRest={loadingRest}
            onOpen={open}
            onUp={(to) => { setText(to); resetSaid(); }}
            onRetry={() => { if (view.ask) void browser.folders.load(view.ask.path, view.ask.hidden); }}
            onLoadRest={loadRest}
          />
        </div>
      )}
    </>
  );
}
