import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView, useOverlay } from "../../app/context";
import { parentPlace } from "../../files/browser";
import { folderKey } from "../../files/folders";
import type { Found, SearchView } from "../../files/search";
import { baseName, parentOf, under } from "../../files/paths";
import type { FilesTab } from "../../workspace/state";
import type { LinkTarget } from "../../files/render/markdown";
import type { HttpRefusal } from "../../net/http";
import type { FilesPlace } from "../../platform/types";
import { Store, useStore } from "../../ui/store";
import { cx } from "../../ui/cx";
import { IconButton } from "../../ui/primitives/IconButton";
import { Divider } from "./Divider";
import { useFailure } from "./failure";
import { FileView } from "./FileView";
import { useFilesKey, type Chord } from "./keymap";
import { ListPane, Loading, Refused } from "./ListPane";
import { PreviewPanel } from "./PreviewPanel";
import type { FilesSession } from "./session";
import { useTabOutline } from "./tabOutline";
import styles from "./FilesScreen.module.css";
import bar from "./FileView.module.css";

/** Shows and hides the Preview panel while the list has the keys (Finder's Quick Look key). */
const PREVIEW: Chord = { key: " ", inList: true };

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

  const failure = useFailure(session);
  const open = (to: FilesPlace): void => { app.openPlace(to); };
  const up = parentPlace(place, pages);
  const listed = pages !== null && (place.kind === "dir" ? pages.path === place.path : pages.path === parentOf(place.file.path));

  const root = place.kind === "dir" && listed ? pages.path : null;
  const tree = useTabOutline(session, tab.id, root);
  // Search is open while its history entry is the current one; the tab's own, so Back to its results finds them as they were.
  // The entry names the folder it searches: on a Back to it, the folder may not have caught up for a render.
  const overlay = useOverlay("files", "search");
  const search = overlay.open && root !== null && overlay.params?.["root"] === root ? session.search(tab.id, root) : null;
  const found = useStore(search ?? CLOSED, chosenFound);

  // Back from a file full width lands on the list with the file selected, its folders open.
  const lastFile = useRef<string | null>(null);
  useEffect(() => {
    if (place.kind === "file") lastFile.current = place.file.path;
    else if (root !== null && lastFile.current !== null) {
      if (!phone && under(lastFile.current, root)) tree.reveal(lastFile.current);
      lastFile.current = null;
    }
  }, [place, root]);

  // What just landed under the list is selected once on a desktop, so the Preview panel shows it; the phone marks its row.
  const { fresh } = view;
  const here = !phone && root !== null && wanted.kind === "dir" && fresh !== null && under(fresh.path, root);
  useEffect(() => {
    if (!here) return;
    tree.reveal(fresh.path, { opens: fresh.opens });
    browser.freshSeen();
  }, [here, fresh]);

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
  // One toggle on the header line's right end over both layouts of the split: the bar under it leaves it room.
  const toggleShown = !phone && place.kind === "dir" && view.home !== null;

  // A file full width: Back returns to the list it was opened from (history Back), else, after a reload, its folder.
  const backTo = place.kind === "file" ? (phone ? up?.path ?? null : app.router.folderBelow(tab.id, place.file.path) ?? up?.path ?? null) : null;
  const back = backTo === null ? undefined : { folder: baseName(backTo) || "/", onBack: () => { app.toPlace({ kind: "dir", path: backTo }); } };

  const onLink = (target: LinkTarget): void => {
    if (target.kind === "external") app.platform.openURL(target.url);
    else if (target.kind === "path") {
      const token = wantsNow.current;
      const here = (): boolean => wantsNow.current === token;
      browser.resolve(target.path).then((to) => { if (here()) open(to); }, (e: unknown) => { if (here()) app.notify(e instanceof Error && "code" in e ? failure.describe(e as HttpRefusal) : "That link can't be opened."); });
    }
  };

  const title = place.kind === "dir" ? baseName(place.path) : place.file.name;

  // A file full width that can't be shown yet: refused, or still being probed.
  const fileBody = place.kind !== "file" ? null
    : error ? <Refused session={session} error={error} />
    : loading && place.file.mime === null && place.file.size === null ? <Loading what="Opening the file" /> : null;
  // A text handed from the view that left is the next one's only: past this place nothing takes it.
  useEffect(() => { session.handed = null; }, [session, place]);
  // A file shown full width (or full screen) was opened: Search's recents list it first.
  const shownFile = place.kind === "file" && !fileBody ? place.file : null;
  useEffect(() => { if (shownFile) session.opened(shownFile); }, [session, shownFile?.path]);

  return (
    <div ref={files} class={styles.files} style={{ "--files-list-w": `${String(width)}px` }}>
      {place.kind === "dir" && <h1 class={styles.hiddenTitle}>{title}</h1>}
      {/* The list stays mounted under a file, so Back returns to it as it was. */}
      <div class={styles.split} hidden={place.kind === "file"} data-panel={panel || undefined} data-end={toggleShown || undefined}>
        <ListPane
          session={session}
          tab={tab.id}
          view={view}
          pages={listed ? pages : null}
          tree={tree}
          up={up}
          search={search}
          onOpen={open}
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
            <PreviewPanel session={session} tab={tab.id} root={pages} pick={search ? found && { path: found.path, by: "user" } : tree.pick} known={search ? found : tree.known} hidden={hidden} held={held} onSettled={tree.settled} onOpen={open} onLink={onLink} />
          </>
        )}
      </div>
      {toggleShown && (
        <div class={styles.end}>
          <span class={bar.sep} />
          <IconButton icon="panel" label={preview ? "Hide preview" : "Show preview"} aria-keyshortcuts="Space" class={cx(styles.toggle, preview && styles.on)} onClick={toggle} />
        </div>
      )}
      {place.kind === "file" && (
        <FileView session={session} file={place.file} back={back} onLink={onLink}>
          {fileBody ? <div class={styles.scroll}>{fileBody}</div> : undefined}
        </FileView>
      )}
    </div>
  );
}

/** Search's row the user picked, for the Preview panel to follow; null when it shows none (a failed search shows no rows). */
const chosenFound = ({ selected, chosen, shown, error }: SearchView): Found | null =>
  (chosen && !error ? shown.rows.find((f) => f.path === selected) ?? null : null);
/** Search closed: no row. */
const CLOSED = new Store<SearchView>({ text: "", shown: { rows: [], stopped: null }, asking: false, error: null, selected: null, chosen: false });
