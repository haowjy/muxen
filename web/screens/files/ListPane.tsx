import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { Listing } from "../../files/api";
import { describeError, type FilesView } from "../../files/browser";
import { shorten } from "../../files/format";
import { baseName, parentOf } from "../../files/paths";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import { readPaste } from "../terminal/paste";
import { DirList, MissingFolder, type RowMenuAsk } from "./FolderList";
import { FolderActions } from "./FolderActions";
import { PASTE, useFilesKey } from "./keymap";
import { PathField } from "./PathField";
import { PullToRefresh } from "./PullToRefresh";
import { RowMenu } from "./RowMenu";
import { pasteIntoFolder, scrollKey, type FilesSession } from "./session";
import { useOutlineListings, type TabOutline } from "./tabOutline";
import { UploadPanel } from "./UploadPanel";
import styles from "./FilesScreen.module.css";

/**
 * What the column shows under its header line: the folder's rows (or, until they are there, why not), the path
 * field's matches while it is edited, or a folder that no longer exists. Search's results join these in phase 3.
 */
type Mode = "list" | "finding" | "missing";

interface Props {
  session: FilesSession;
  tab: string;
  view: FilesView;
  /** The pages of the folder the list shows, once they are the place's (or a viewed file's folder's). */
  pages: Listing | null;
  /** The tab's outline: its open folders and selection, shared with the Preview panel. */
  tree: TabOutline;
  /** The folder above, for `..`, Backspace and Cmd+Up. */
  up: FilesPlace | null;
  onOpen: (place: FilesPlace) => void;
}

/**
 * The Files list's column: the folder's header line (the path, then its controls), an upload's progress, and the
 * list (the outline on a desktop), scrolled where the tab left it. It stays mounted under a file full width, so Back
 * returns to it as it was.
 */
export function ListPane({ session, tab, view, pages, tree, up, onOpen }: Props) {
  const app = useApp();
  const { browser } = session;
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const scroller = useRef<HTMLDivElement>(null);
  const [rowMenu, setRowMenu] = useState<RowMenuAsk | null>(null);
  const [finding, setFinding] = useState(false);
  const { place, home, loading, error, hidden } = view;
  const outline = useOutlineListings(session, tree, hidden, !phone);
  const mode: Mode = finding ? "finding" : place.kind === "dir" && error?.code === "not_found" ? "missing" : "list";
  /** The folder's rows are on screen. */
  const showing = mode === "list" && place.kind === "dir" && pages !== null && !error;

  // Cmd/Ctrl-V with the folder showing puts the clipboard into it (the path field keeps its own paste).
  const folderShown = place.kind === "dir" && pages?.path === place.path && !error ? pages.path : null;
  useFilesKey(PASTE, (e) => {
    if (folderShown === null || !(e instanceof ClipboardEvent)) return;
    const pasted = readPaste(e.clipboardData);
    if (pasted.kind !== "empty") pasteIntoFolder(app, session, folderShown, pasted);
  }, folderShown !== null);

  // Back finds a folder's list scrolled where it was left.
  const folder = pages?.path ?? null;
  useLayoutEffect(() => {
    if (folder !== null && scroller.current) scroller.current.scrollTop = session.scroll.get(scrollKey(tab, folder)) ?? 0;
  }, [folder, session.scroll, tab, showing]);
  // A row's menu belongs to the folder it was asked in.
  useEffect(() => { setRowMenu(null); }, [folder]);

  // What stands in for the rows: a folder gone (it still has a way up), refused, or not here yet.
  const body = mode === "missing" ? (
    <MissingFolder onKeyNavigate={() => { app.focus.keepKeyboardOn("list"); }} {...(up && { parent: { path: up.path, onOpen: () => { app.toPlace(up); } } })} />
  ) : mode === "list" && place.kind === "dir" && !showing ? (
    error ? <Refused session={session} error={error} /> : <Loading what="Loading the folder" />
  ) : null;

  // The path line's text: the folder with its trailing `/`, the same text the field starts with.
  const shown = place.kind === "dir" ? shorten(place.path, home) : "";
  const rest = shown === "/" || shown === "" ? shown : `${shown}/`;

  return (
    <div class={styles.list}>
      {place.kind === "dir" && home !== null && (
        <PathField
          session={session}
          rest={rest}
          here={place.path}
          onEditing={setFinding}
          onOpen={onOpen}
          actions={<FolderActions session={session} path={pages?.path ?? place.path} pasteable={folderShown !== null} loading={loading} />}
        />
      )}
      {mode !== "finding" && <UploadPanel session={session} onPreview={(path) => { onOpen({ kind: "file", path }); }} />}
      {pages && !error && (
        <div
          ref={scroller}
          key={pages.path}
          class={styles.scroll}
          hidden={!showing}
          onScroll={(e) => { session.scroll.set(scrollKey(tab, pages.path), e.currentTarget.scrollTop); }}
        >
          <DirList
            pages={pages}
            hidden={hidden}
            loading={loading}
            fresh={view.fresh !== null && parentOf(view.fresh) === pages.path ? baseName(view.fresh) : null}
            onOpen={onOpen}
            outline={outline}
            selection={tree.selection}
            onSelect={tree.select}
            onKeyNavigate={() => { app.focus.keepKeyboardOn("list"); }}
            onMore={() => { void browser.more(); }}
            onToggleHidden={() => { void browser.toggleHidden(); }}
            onRowMenu={setRowMenu}
            {...(up?.kind === "dir" && { onUp: () => { app.toPlace(up); } })}
          />
        </div>
      )}
      {phone && showing && <PullToRefresh key={`pull:${pages.path}`} scroller={scroller} onRefresh={() => browser.reload()} />}
      {body && <div class={styles.scroll}>{body}</div>}
      {rowMenu && showing && <RowMenu session={session} {...rowMenu} onClose={() => { setRowMenu(null); }} />}
    </div>
  );
}

/** A listing or a file the host refused, in the file manager's words, with Try again. */
export function Refused({ session, error }: { session: FilesSession; error: NonNullable<FilesView["error"]> }) {
  return <EmptyState icon="alert" title={describeError(error, session.hostName)} action={<Button onClick={() => { void session.browser.reload(); }}>Try again</Button>} />;
}

export function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}
