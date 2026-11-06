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

interface Props {
  session: FilesSession;
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
 * The desktop's Preview panel, beside the outline: the file last selected, or with none the summary of the folder the
 * list starts at. Only a file moves it: a folder, `..` or a row's end leaves it where it is. It follows once the
 * selection settles, so the reads of the rows passed over are never made, and a viewer's read for a row left is aborted
 * (`useText`).
 */
export function PreviewPanel({ session, root, from, selection, known, hidden, held, onOpen, onLink }: Props) {
  const listingOf = (path: string): Listing | null => (path === root.path ? root : held.get(folderKey(path, hidden))?.listing ?? null);
  const entryOf = (path: string): Entry | null => (known?.path === path ? known.entry : listingOf(parentOf(path))?.entries.find((e) => e.name === baseName(path)) ?? null);
  const fileAt = (key: string | null): FileRef | null => {
    const entry = key === null || key === UP ? null : entryOf(key);
    return entry?.kind === "file" && entry.utf8 !== false ? { path: key as string, name: entry.name, size: entry.size ?? null, mtime: entry.mtime ?? null, mime: entry.mime ?? null } : null;
  };

  const picked = fileAt(selection);
  // A move within the list waits to settle; a new root, or the other list, shows at once.
  const [settled, setSettled] = useState({ file: picked, root: root.path, from });
  const moved = settled.root !== root.path || settled.from !== from;
  // The file stays once its folder is closed and its row gone: `settled` is why the panel doesn't lose it.
  const file = moved ? picked : settled.file && (fileAt(settled.file.path) ?? settled.file);
  useEffect(() => {
    if (moved) {
      setSettled({ file: picked, root: root.path, from });
      return undefined;
    }
    if (!picked || picked.path === settled.file?.path) return undefined;
    const timer = setTimeout(() => {
      setSettled({ file: picked, root: root.path, from });
      // The user moved the selection here and it stayed: a file shown is opened, for Search's recents. What shows at
      // once (the selection a tab kept, a new root's) was nobody's pick now.
      session.opened(picked);
    }, PANEL_SETTLE_MS);
    return () => { clearTimeout(timer); };
  }, [picked?.path, root.path, from, settled.file?.path, moved]);
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
