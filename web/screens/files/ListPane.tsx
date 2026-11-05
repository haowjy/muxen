import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { Listing } from "../../files/api";
import type { FilesView } from "../../files/browser";
import { shorten } from "../../files/format";
import { baseName, parentOf } from "../../files/paths";
import type { FilesPlace } from "../../platform/types";
import { DirList, type OutlineProps, type RowMenuAsk } from "./FolderList";
import { FolderActions } from "./FolderActions";
import { PathField } from "./PathField";
import { PullToRefresh } from "./PullToRefresh";
import { RowMenu } from "./RowMenu";
import { scrollKey, type FilesSession } from "./session";
import { UploadPanel } from "./UploadPanel";
import styles from "./FilesScreen.module.css";

interface Props {
  session: FilesSession;
  tab: string;
  view: FilesView;
  /** The pages of the folder the list shows, once they are the place's (or a viewed file's folder's). */
  pages: Listing | null;
  /** The list shows a folder (not a file full width, an error or the path field's matches). */
  showing: boolean;
  /** Paste puts into the folder on screen. */
  pasteable: boolean;
  /** What stands in for the list: loading, refused, gone. */
  body: ComponentChildren;
  outline: OutlineProps | undefined;
  selection: string | null;
  onSelect: (key: string | null) => void;
  /** The folder above, for `..`, Backspace and Cmd+Up. */
  up: FilesPlace | null;
  onOpen: (place: FilesPlace) => void;
  /** Whether the path field is being edited; its matches are then the list. */
  finding: boolean;
  onFinding: (editing: boolean) => void;
  /** The header line's last control, when the Preview panel is off (its toggle). */
  end?: ComponentChildren;
}

/**
 * The Files list's column: the folder's header line (the path, then its controls), an upload's progress, and the
 * list (the outline on a desktop), scrolled where the tab left it. It stays mounted under a file full width, so Back
 * returns to it as it was.
 */
export function ListPane({ session, tab, view, pages, showing, pasteable, body, outline, selection, onSelect, up, onOpen, finding, onFinding, end }: Props) {
  const app = useApp();
  const { browser } = session;
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const scroller = useRef<HTMLDivElement>(null);
  const [rowMenu, setRowMenu] = useState<RowMenuAsk | null>(null);
  const { place, home, loading } = view;

  // Back finds a folder's list scrolled where it was left.
  const folder = pages?.path ?? null;
  useLayoutEffect(() => {
    if (folder !== null && scroller.current) scroller.current.scrollTop = session.scroll.get(scrollKey(tab, folder)) ?? 0;
  }, [folder, session.scroll, tab, showing]);
  // A row's menu belongs to the folder it was asked in.
  useEffect(() => { setRowMenu(null); }, [folder]);

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
          onEditing={onFinding}
          onOpen={onOpen}
          actions={<FolderActions session={session} path={pages?.path ?? place.path} pasteable={pasteable} loading={loading} />}
          end={end}
        />
      )}
      {!finding && <UploadPanel session={session} onPreview={(path) => { onOpen({ kind: "file", path }); }} />}
      {pages && !view.error && (
        <div
          ref={scroller}
          key={pages.path}
          class={styles.scroll}
          hidden={!showing}
          onScroll={(e) => { session.scroll.set(scrollKey(tab, pages.path), e.currentTarget.scrollTop); }}
        >
          <DirList
            pages={pages}
            hidden={view.hidden}
            loading={loading}
            fresh={view.fresh !== null && parentOf(view.fresh) === pages.path ? baseName(view.fresh) : null}
            onOpen={onOpen}
            outline={outline}
            selection={selection}
            onSelect={onSelect}
            onKeyNavigate={() => { app.focus.keepKeyboardOn("list"); }}
            onMore={() => { void browser.more(); }}
            onToggleHidden={() => { void browser.toggleHidden(); }}
            onRowMenu={setRowMenu}
            {...(up?.kind === "dir" && { onUp: () => { app.toPlace(up); } })}
          />
        </div>
      )}
      {phone && showing && pages && <PullToRefresh key={`pull:${pages.path}`} scroller={scroller} onRefresh={() => browser.reload()} />}
      {place.kind === "dir" && body && !finding && <div class={styles.scroll}>{body}</div>}
      {rowMenu && showing && <RowMenu session={session} {...rowMenu} onClose={() => { setRowMenu(null); }} />}
    </div>
  );
}
