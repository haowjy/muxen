import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { describeError, parentPlace } from "../../files/browser";
import { folderKey } from "../../files/folders";
import type { HttpRefusal } from "../../net/http";
import { baseName, parentOf } from "../../files/paths";
import type { FilesTab } from "../../workspace/state";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { FolderActions } from "./FolderActions";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import { shorten } from "../../files/format";
import { DirList, MissingFolder, type OutlineProps, type RowMenuAsk } from "./FolderList";
import { PathField } from "./PathField";
import { FileView } from "./FileView";
import { PASTE, useFilesKey } from "./keymap";
import { PullToRefresh } from "./PullToRefresh";
import { RowMenu } from "./RowMenu";
import { readPaste } from "../terminal/paste";
import { pasteIntoFolder, scrollKey, type FilesSession } from "./session";
import { useTabOutline } from "./tabOutline";
import { UploadPanel } from "./UploadPanel";
import styles from "./FilesScreen.module.css";

/**
 * The file manager for one Files tab: a folder list or a preview, under a header that says
 * where you are. Where you are is the tab's place (the workspace's, written from history);
 * the host's `FileBrowser` follows it and reports the daemon's canonical path back.
 */
export function FilesPane({ session, tab }: { session: FilesSession; tab: FilesTab }) {
  const app = useApp();
  const { browser } = session;
  const view = useStore(browser, (s) => s);
  const wanted = tab.place;
  const { place, dir, home, loading, error } = view;
  // The folder under the place: its pages are `Folders`' record, shared with the path field.
  const pages = useStore(browser.folders, (s) => (dir ? s.held.get(folderKey(dir.path, dir.hidden))?.listing ?? null : null));
  const scroller = useRef<HTMLDivElement>(null);
  // While the path field is being typed in, the path field's matches are the list.
  const [finding, setFinding] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenuAsk | null>(null);
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const held = useStore(browser.folders, (s) => s.held);

  // The one cancellation for answers that land late: this effect's token is current only while the pane still wants this place.
  // A resolve or a Markdown link answer that finds another token (or none) is dropped.
  const wantsNow = useRef<object | null>(null);
  useEffect(() => {
    const token = {};
    wantsNow.current = token;
    void browser.follow(wanted, (settled) => { if (wantsNow.current === token) app.resolvedPlace(wanted, settled); });
    return () => { wantsNow.current = null; };
  }, [app, browser, wanted]);

  // Cmd/Ctrl-V with the folder showing puts the clipboard into it (the path field keeps its own paste).
  const folderShown = place.kind === "dir" && pages?.path === place.path && !error ? pages.path : null;
  useFilesKey(PASTE, (e) => {
    if (folderShown === null || !(e instanceof ClipboardEvent)) return;
    const pasted = readPaste(e.clipboardData);
    if (pasted.kind !== "empty") pasteIntoFolder(app, session, folderShown, pasted);
  }, folderShown !== null);

  const open = (to: FilesPlace): void => { app.openPlace(to); };
  const up = parentPlace(place, pages);
  const listed = pages !== null && (place.kind === "dir" ? pages.path === place.path : pages.path === parentOf(place.file.path));
  const listingVisible = place.kind === "dir" && listed && !error && !finding;

  // Back finds a folder's list scrolled where it was left.
  const folder = listed ? pages.path : null;
  const tree = useTabOutline(session, tab.id, place.kind === "dir" ? folder : null);
  const hidden = view.hidden;
  const describe = useMemo(() => (e: HttpRefusal) => describeError(e, session.hostName), [session]);
  const outline: OutlineProps | undefined = phone ? undefined : {
    expanded: tree.expanded,
    held,
    describe,
    onToggle: tree.toggle,
    onRest: (path, act) => { void (act === "more" ? browser.folders.more(path, hidden) : browser.folders.load(path, hidden)); },
    // Each open folder is listed once, when it first shows, and kept while it shows.
    onShown: (paths) => {
      browser.folders.pin("outline", paths.map((path) => ({ path, hidden })));
      for (const path of paths) if (!browser.folders.snapshot.held.has(folderKey(path, hidden))) void browser.folders.load(path, hidden);
    },
  };
  useEffect(() => () => { browser.folders.pin("outline", []); }, [browser]);
  useLayoutEffect(() => {
    if (folder !== null && scroller.current) scroller.current.scrollTop = session.scroll.get(scrollKey(tab.id, folder)) ?? 0;
  }, [folder, session.scroll, tab.id, listingVisible]);
  // A row's menu belongs to the folder it was asked in.
  useEffect(() => { setRowMenu(null); }, [folder]);

  const onLink = (target: LinkTarget): void => {
    if (target.kind === "external") app.platform.openURL(target.url);
    else if (target.kind === "path") {
      const token = wantsNow.current;
      const here = (): boolean => wantsNow.current === token;
      browser.resolve(target.path).then((to) => { if (here()) open(to); }, (e: unknown) => { if (here()) app.notify(e instanceof Error && "code" in e ? describeError(e as never, session.hostName) : "That link can't be opened."); });
    }
  };

  const title = place.kind === "dir" ? baseName(place.path) : place.file.name;
  // The path line's text: the folder with its trailing `/`, the same text the field starts with.
  const shown = place.kind === "dir" ? shorten(place.path, home) : "";
  const rest = shown === "/" || shown === "" ? shown : `${shown}/`;

  let body;
  if (error) {
    // A folder that vanished (moved, deleted) still has a way up.
    const gone = place.kind === "dir" && error.code === "not_found";
    body = gone ? (
      <MissingFolder onKeyNavigate={() => { app.focus.keepKeyboardOn("list"); }} {...(up && { parent: { path: up.path, onOpen: () => { app.toPlace(up); } } })} />
    ) : (
      <EmptyState icon="alert" title={describeError(error, session.hostName)} action={<Button onClick={() => { void browser.reload(); }}>Try again</Button>} />
    );
  } else if (place.kind === "dir") {
    body = listed ? null : <Loading what="Loading the folder" />;
  } else {
    body = loading && place.file.mime === null && place.file.size === null ? <Loading what="Opening the file" /> : null;
  }

  return (
    <div class={styles.files}>
      {place.kind === "dir" && <h1 class={styles.hiddenTitle}>{title}</h1>}
      {place.kind === "dir" && home !== null && (
        <PathField
          session={session}
          rest={rest}
          here={place.path}
          onEditing={setFinding}
          onOpen={open}
          actions={<FolderActions session={session} path={pages?.path ?? place.path} pasteable={folderShown !== null} loading={loading} />}
        />
      )}
      {!finding && <UploadPanel session={session} onPreview={(path) => { open({ kind: "file", path }); }} />}
      {/* The list stays mounted under a preview, so Back returns to it as it was. */}
      {listed && !error && (
        <div
          ref={scroller}
          key={pages.path}
          class={styles.scroll}
          hidden={!listingVisible}
          onScroll={(e) => { session.scroll.set(scrollKey(tab.id, pages.path), e.currentTarget.scrollTop); }}
        >
          <DirList
            pages={pages}
            hidden={view.hidden}
            loading={loading}
            fresh={view.fresh !== null && parentOf(view.fresh) === pages.path ? baseName(view.fresh) : null}
            onOpen={open}
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
      {phone && listingVisible && <PullToRefresh key={pages.path} scroller={scroller} onRefresh={() => browser.reload()} />}
      {place.kind === "file" && (
        <FileView session={session} file={place.file} up={up} onUp={() => { if (up) app.toPlace(up); }} onLink={onLink}>
          {body ? <div class={styles.scroll}>{body}</div> : undefined}
        </FileView>
      )}
      {place.kind === "dir" && body && !finding && <div class={styles.scroll}>{body}</div>}
      {rowMenu && listingVisible && <RowMenu session={session} {...rowMenu} onClose={() => { setRowMenu(null); }} />}
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}
