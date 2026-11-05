import { useEffect, useState } from "preact/hooks";
import type { Entry, Listing } from "../../files/api";
import type { FileRef } from "../../files/browser";
import { folderKey, type Held } from "../../files/folders";
import { UP } from "../../files/outline";
import { baseName, parentOf } from "../../files/paths";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { FileView } from "./FileView";
import { FolderSummary } from "./FolderSummary";
import type { FilesSession } from "./session";
import styles from "./PreviewPanel.module.css";

/** The panel waits this long after the selection last moved, so a held arrow key costs no read per row. */
const PANEL_SETTLE_MS = 200;

/** What the panel shows: a file, or a folder's summary. */
type Shown = { kind: "file"; file: FileRef } | { kind: "dir"; path: string; entry: Entry | null };

interface Props {
  session: FilesSession;
  /** The folder the list starts at, and its pages. */
  root: Listing;
  selection: string | null;
  hidden: boolean;
  held: ReadonlyMap<string, Held>;
  onOpen: (place: FilesPlace) => void;
  onLink: (target: LinkTarget) => void;
}

/**
 * The desktop's Preview panel, beside the outline: the selected file's viewer, or the selected folder's summary (the
 * list's own folder with nothing, `..` or a row's end selected). It follows the selection once it settles, so the
 * reads of the rows passed over are never made, and a viewer's read for a row left is aborted (`useText`).
 */
export function PreviewPanel({ session, root, selection, hidden, held, onOpen, onLink }: Props) {
  const listingOf = (path: string): Listing | null => (path === root.path ? root : held.get(folderKey(path, hidden))?.listing ?? null);
  const entryOf = (path: string): Entry | null => listingOf(parentOf(path))?.entries.find((e) => e.name === baseName(path)) ?? null;
  /** A file row shows its viewer, a folder row its summary; anything else (nothing, `..`, a folder's end) the root's. */
  const shownFor = (key: string | null): Shown => {
    const entry = key === null || key === UP ? null : entryOf(key);
    if (key !== null && entry && entry.utf8 !== false) {
      if (entry.kind === "file") return { kind: "file", file: { path: key, name: entry.name, size: entry.size ?? null, mtime: entry.mtime ?? null, mime: entry.mime ?? null } };
      if (entry.kind === "dir") return { kind: "dir", path: key, entry };
    }
    return { kind: "dir", path: root.path, entry: entryOf(root.path) };
  };

  // A move within the list waits to settle; a new root shows at once.
  const [settled, setSettled] = useState({ key: selection, root: root.path });
  const moved = settled.root !== root.path;
  const showing = moved ? selection : settled.key;
  useEffect(() => {
    if (moved) {
      setSettled({ key: selection, root: root.path });
      return undefined;
    }
    if (selection === settled.key) return undefined;
    const timer = setTimeout(() => { setSettled({ key: selection, root: root.path }); }, PANEL_SETTLE_MS);
    return () => { clearTimeout(timer); };
  }, [selection, root.path, settled.key, moved]);
  const shown = shownFor(showing);
  const within = (path: string): string => {
    const dir = parentOf(path);
    return dir === root.path ? "" : `${dir.slice(root.path === "/" ? 1 : root.path.length + 1)}/`;
  };
  return (
    <section class={styles.panel} aria-label="Preview">
      {shown.kind === "file" ? (
        <FileView
          session={session}
          file={shown.file}
          folder={within(shown.file.path)}
          onExpand={() => { onOpen({ kind: "file", path: shown.file.path }); }}
          onLink={onLink}
        />
      ) : (
        <FolderSummary
          key={shown.path}
          session={session}
          path={shown.path}
          entry={shown.entry}
          record={shown.path === root.path ? { listing: root, loading: false, error: null } : held.get(folderKey(shown.path, hidden)) ?? null}
          root={root.path}
          onOpen={onOpen}
          onLink={onLink}
        />
      )}
    </section>
  );
}
