import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { describeError, parentPlace } from "../../files/browser";
import { folderKey } from "../../files/folders";
import { baseName, parentOf } from "../../files/paths";
import type { HttpRefusal } from "../../net/http";
import type { FilesTab } from "../../workspace/state";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import { Divider } from "./Divider";
import { MissingFolder, type OutlineProps } from "./FolderList";
import { FileView } from "./FileView";
import { PASTE, useFilesKey, type Chord } from "./keymap";
import { ListPane } from "./ListPane";
import { PreviewPanel, PreviewToggle } from "./PreviewPanel";
import { readPaste } from "../terminal/paste";
import { pasteIntoFolder, type FilesSession } from "./session";
import { useTabOutline } from "./tabOutline";
import styles from "./FilesScreen.module.css";
import bar from "./FileView.module.css";

/** Shows and hides the Preview panel while the list has the keys (Finder's Quick Look key). */
const PREVIEW: Chord = { key: " ", inList: true };
/** Leaves a file full width for the list. */
const LEAVE: Chord = { key: "escape" };

/** The list's width beside the Preview panel: at least this, and at most this share of the window, so the panel keeps the rest. */
const LIST_MIN_PX = 300;
const LIST_MAX_SHARE = 0.6;
/** Until the divider is moved: a third of the window, from 400 to 600px. */
const listDefault = (window: number): number => Math.round(Math.min(600, Math.max(400, window / 3)));

/**
 * The file manager for one Files tab. Where you are is the tab's place (the workspace's, written from history); the
 * host's `FileBrowser` follows it and reports the daemon's canonical path back. A folder is the list (`ListPane`), on a
 * desktop the outline with the Preview panel beside it when it is on; a file is its viewer, full width on a desktop,
 * with Back to the list it was opened from.
 */
export function FilesPane({ session, tab }: { session: FilesSession; tab: FilesTab }) {
  const app = useApp();
  const { browser } = session;
  const view = useStore(browser, (s) => s);
  const wanted = tab.place;
  const { place, dir, loading, error, hidden } = view;
  // The folder under the place: its pages are `Folders`' record, shared with the path field.
  const held = useStore(browser.folders, (s) => s.held);
  const pages = dir ? held.get(folderKey(dir.path, dir.hidden))?.listing ?? null : null;
  // While the path field is being typed in, the path field's matches are the list.
  const [finding, setFinding] = useState(false);
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const windowWidth = useAppView((v) => v.viewport.width);

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
  const showing = place.kind === "dir" && listed && !error && !finding;

  const root = place.kind === "dir" && listed ? pages.path : null;
  const tree = useTabOutline(session, tab.id, root);
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
      for (const path of paths) if (!browser.folders.snapshot.held.has(folderKey(path, hidden))) void browser.folders.load(path, hidden, true);
    },
  };
  useEffect(() => () => { browser.folders.pin("outline", []); }, [browser]);

  // Back from a file full width lands on the list with the file selected, its folders open.
  const lastFile = useRef<string | null>(null);
  useEffect(() => {
    if (place.kind === "file") lastFile.current = place.file.path;
    else if (root !== null && lastFile.current !== null) {
      if (!phone && lastFile.current.startsWith(`${root === "/" ? "" : root}/`)) tree.reveal(lastFile.current);
      lastFile.current = null;
    }
  }, [place, root]);

  // The Preview panel and the divider are remembered on this device.
  const [preview, setPreview] = useState(() => app.view.get("preview"));
  const [stored, setStored] = useState(() => app.view.get("listWidth"));
  const files = useRef<HTMLDivElement>(null);
  // The panel stays while the path field is edited: it shows what was selected.
  const panel = !phone && preview && place.kind === "dir" && listed && !error;
  const toggle = (): void => {
    setPreview(!preview);
    app.view.set("preview", !preview);
    // The list keeps the keys, so Space toggles again from where it was.
    app.focus.focusTarget("list");
  };
  useFilesKey(PREVIEW, toggle, !phone && place.kind === "dir");
  const max = Math.max(LIST_MIN_PX, Math.round(windowWidth * LIST_MAX_SHARE));
  const width = Math.round(Math.max(LIST_MIN_PX, Math.min(max, stored ?? listDefault(windowWidth))));
  const toggleControl = (sep: boolean) => (!phone && place.kind === "dir" ? (
    <>
      {sep && <span class={bar.sep} />}
      <PreviewToggle on={preview} onToggle={toggle} />
    </>
  ) : null);

  // A file full width: Back returns to the list it was opened from (history Back), else, after a reload, its folder.
  const backTo = place.kind === "file" ? (phone ? up?.path ?? null : app.router.folderBelow(tab.id, place.file.path) ?? up?.path ?? null) : null;
  const back = backTo === null ? undefined : { folder: baseName(backTo) || "/", onBack: () => { app.toPlace({ kind: "dir", path: backTo }); } };
  useFilesKey(LEAVE, () => { back?.onBack(); }, !phone && back !== undefined);

  const onLink = (target: LinkTarget): void => {
    if (target.kind === "external") app.platform.openURL(target.url);
    else if (target.kind === "path") {
      const token = wantsNow.current;
      const here = (): boolean => wantsNow.current === token;
      browser.resolve(target.path).then((to) => { if (here()) open(to); }, (e: unknown) => { if (here()) app.notify(e instanceof Error && "code" in e ? describeError(e as never, session.hostName) : "That link can't be opened."); });
    }
  };

  const title = place.kind === "dir" ? baseName(place.path) : place.file.name;

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
    <div ref={files} class={styles.files} style={{ "--files-list-w": `${String(width)}px` }}>
      {place.kind === "dir" && <h1 class={styles.hiddenTitle}>{title}</h1>}
      {/* The list stays mounted under a file, so Back returns to it as it was. */}
      <div class={styles.split} hidden={place.kind === "file"} data-panel={panel || undefined}>
        <ListPane
          session={session}
          tab={tab.id}
          view={view}
          pages={listed ? pages : null}
          showing={showing}
          pasteable={folderShown !== null}
          body={body}
          outline={outline}
          selection={tree.selection}
          onSelect={tree.select}
          up={up}
          onOpen={open}
          finding={finding}
          onFinding={setFinding}
          end={panel ? null : toggleControl(true)}
        />
        {panel && (
          <>
            <Divider
              width={width}
              min={LIST_MIN_PX}
              max={max}
              from={() => files.current?.getBoundingClientRect().left ?? 0}
              onDrag={(px) => { files.current?.style.setProperty("--files-list-w", `${String(px)}px`); }}
              onWidth={(px) => { setStored(px); app.view.set("listWidth", px); }}
              onReset={() => { setStored(null); app.view.set("listWidth", null); }}
            />
            <PreviewPanel session={session} root={pages} selection={tree.selection} hidden={hidden} held={held} toggle={toggleControl(true)} fileToggle={toggleControl(false)} onOpen={open} onLink={onLink} />
          </>
        )}
      </div>
      {place.kind === "file" && (
        <FileView session={session} file={place.file} back={back} onLink={onLink}>
          {body ? <div class={styles.scroll}>{body}</div> : undefined}
        </FileView>
      )}
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}
