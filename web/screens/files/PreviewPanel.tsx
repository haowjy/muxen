import { useLayoutEffect, useReducer, useRef } from "preact/hooks";
import type { Entry, Listing } from "../../files/api";
import type { FileRef } from "../../files/browser";
import { folderKey, type Held } from "../../files/folders";
import { loadedOf, UP } from "../../files/outline";
import { baseName, parentOf } from "../../files/paths";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { FileView } from "./FileView";
import { FolderSummary } from "./FolderSummary";
import { scrollKey, type FilesSession } from "./session";
import styles from "./PreviewPanel.module.css";

/** The panel waits this long after the selection last moved, so a held arrow key costs no read per row. */
const PANEL_SETTLE_MS = 200;

/** The row the panel may follow. `by: "app"` (a reveal, a row a tab kept) shows when it can; only the user's waits to settle, and counts as opened. */
export interface PanelPick {
  path: string;
  by: "user" | "app";
}

interface Props {
  session: FilesSession;
  tab: string;
  /** The folder the list starts at, and its pages. */
  root: Listing;
  pick: PanelPick | null;
  /** The picked row's entry when no listing held holds it: a Search result, or a revealed one until its row loads. */
  known?: { path: string; entry: Entry } | null;
  hidden: boolean;
  held: ReadonlyMap<string, Held>;
  /** The user's pick has settled: it is no longer a move, so a list coming back to it shows it at once. */
  onSettled: () => void;
  onOpen: (place: FilesPlace) => void;
  onLink: (target: LinkTarget) => void;
}

/**
 * The desktop's Preview panel, beside the outline: the file last picked under this tab and root (the session's, so it
 * outlives the panel), or with none the summary of the folder the list starts at. Only a file moves it: a folder, `..`
 * or a row's end leaves it where it is. It follows once the selection settles, so the reads of the rows passed over are
 * never made, and a viewer's read for a row left is aborted (`useText`).
 */
export function PreviewPanel({ session, tab, root, pick, known, hidden, held, onSettled, onOpen, onLink }: Props) {
  const listingOf = (path: string): Listing | null => (path === root.path ? root : held.get(folderKey(path, hidden))?.listing ?? null);
  const entryOf = (path: string): Entry | null => (known?.path === path ? known.entry : listingOf(parentOf(path))?.entries.find((e) => e.name === baseName(path)) ?? null);
  const fileAt = (key: string | null): FileRef | null => {
    const entry = key === null || key === UP ? null : entryOf(key);
    return entry?.kind === "file" && entry.utf8 !== false ? { path: key as string, name: entry.name, size: entry.size ?? null, mtime: entry.mtime ?? null, mime: entry.mime ?? null } : null;
  };
  /** The kept file as its row has it now. With no row: a folder closed, or paged no further, keeps it; a folder held in full has lost it. */
  const stillThere = (file: FileRef): FileRef | null => {
    const parent = listingOf(parentOf(file.path));
    return fileAt(file.path) ?? (loadedOf(parent) === "all" ? null : file);
  };

  const keep = scrollKey(tab, root.path);
  const picked = fileAt(pick?.path ?? null);
  const kept = session.previews.get(keep) ?? null;
  const file = kept && stillThere(kept);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // The first pick a panel sees was made before it, so it isn't a move.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const atOnce = pick?.by === "app" || !mounted.current;
    mounted.current = true;
    if (kept && !file) session.previews.delete(keep);
    if (!picked || picked.path === file?.path) return undefined;
    const show = (): void => {
      session.previews.set(keep, picked);
      rerender(0);
    };
    if (atOnce) {
      show();
      return undefined;
    }
    const timer = setTimeout(() => {
      show();
      session.opened(picked);
      onSettled();
    }, PANEL_SETTLE_MS);
    return () => { clearTimeout(timer); };
  }, [keep, pick?.by, picked?.path, file?.path]);
  return (
    <section class={styles.panel} aria-label="Preview">
      {file ? (
        <FileView
          session={session}
          file={file}
          onExpand={() => { onOpen({ kind: "file", path: file.path }); }}
          onLink={onLink}
        />
      ) : (
        <FolderSummary
          key={root.path}
          session={session}
          listing={root}
          entry={entryOf(root.path)}
          onOpen={onOpen}
          onLink={onLink}
        />
      )}
    </section>
  );
}
