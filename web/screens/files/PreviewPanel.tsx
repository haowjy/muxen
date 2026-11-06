import { useEffect, useState } from "preact/hooks";
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

interface Props {
  session: FilesSession;
  tab: string;
  /** The folder the list starts at, and its pages. */
  root: Listing;
  /** The list the selection is in: a switch (Search opening or closing) shows at once, as a new root does. */
  from: "outline" | "search";
  selection: string | null;
  /** The selected row's entry when no listing held holds it: a Search result, or a revealed one until its row loads. */
  known?: { path: string; entry: Entry } | null;
  hidden: boolean;
  held: ReadonlyMap<string, Held>;
  onOpen: (place: FilesPlace) => void;
  onLink: (target: LinkTarget) => void;
}

/**
 * The desktop's Preview panel, beside the outline: the file last picked under this tab and root (the session's, so it
 * outlives the panel), or with none the summary of the folder the list starts at. Only a file moves it: a folder, `..`
 * or a row's end leaves it where it is. It follows once the selection settles, so the reads of the rows passed over are
 * never made, and a viewer's read for a row left is aborted (`useText`).
 */
export function PreviewPanel({ session, tab, root, from, selection, known, hidden, held, onOpen, onLink }: Props) {
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
  const picked = fileAt(selection);
  // A move within the list waits to settle; a new root, or the other list, shows at once.
  const [settled, setSettled] = useState({ selection, root: root.path, from });
  const moved = settled.root !== root.path || settled.from !== from;
  // Not a move: what the app selected (a tab's row whose folder lands late) shows when it can, and was nobody's pick.
  const atOnce = moved || selection === settled.selection ? picked : null;
  const kept = session.previews.get(keep);
  const file = atOnce ?? (kept ? stillThere(kept) : null);
  useEffect(() => {
    if (atOnce) session.previews.set(keep, atOnce);
    if (moved) setSettled({ selection, root: root.path, from });
    if (moved || selection === settled.selection) return undefined;
    if (!picked) {
      setSettled({ selection, root: root.path, from });
      return undefined;
    }
    const timer = setTimeout(() => {
      session.previews.set(keep, picked);
      setSettled({ selection, root: root.path, from });
      // The user moved the selection here and it stayed: a file shown is opened, for Search's recents.
      session.opened(picked);
    }, PANEL_SETTLE_MS);
    return () => { clearTimeout(timer); };
  }, [keep, selection, picked?.path, atOnce?.path, root.path, from, settled.selection, moved]);
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
