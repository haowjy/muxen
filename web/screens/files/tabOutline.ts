import { useEffect, useMemo, useState } from "preact/hooks";
import { describeError } from "../../files/browser";
import { folderKey } from "../../files/folders";
import type { Entry } from "../../files/api";
import { foldersBetween, withExpanded } from "../../files/outline";
import { baseName } from "../../files/paths";
import type { HttpRefusal } from "../../net/http";
import { useStore } from "../../ui/store";
import type { OutlineProps } from "./FolderList";
import { scrollKey, type FilesSession } from "./session";

export interface TabOutline {
  expanded: ReadonlySet<string>;
  /** The selected row's key under the folder the list starts at; null when nothing is. */
  selection: string | null;
  select: (key: string | null) => void;
  toggle: (folder: string, open: boolean) => void;
  /**
   * Opens the folders between the list's root and `path`, selects it, and loads each folder's pages until the next
   * name down is held, so its row exists. `entry`, when the caller has it (a Search result), stands in for the row's
   * until then, so the Preview panel shows the file meanwhile.
   */
  reveal: (path: string, entry?: Entry) => void;
  /** The entry `reveal` was given, while that path is still the selection. */
  known: { path: string; entry: Entry } | null;
}

/**
 * A Files tab's desktop outline, kept in its session so a tab switch or a Back finds it as it was: the folders open
 * in place (the tab's, whatever the root) and the row selected (the tab's under each root). `root` is the folder the
 * list starts at, null while there is none.
 */
export function useTabOutline(session: FilesSession, tab: string, root: string | null): TabOutline {
  const [open, setOpen] = useState(() => session.expanded.get(tab) ?? []);
  const kept = (at: string | null): string | null => (at === null ? null : session.selections.get(scrollKey(tab, at)) ?? null);
  // The selection belongs to the root it was made under; another root starts from what the session kept for it.
  const [picked, setPicked] = useState(() => ({ root, key: kept(root) }));
  const selection = picked.root === root ? picked.key : kept(root);
  const expanded = useMemo(() => new Set(open), [open]);
  const [revealed, setRevealed] = useState<{ path: string; entry: Entry } | null>(null);

  const select = (key: string | null): void => {
    setPicked({ root, key });
    if (root === null) return;
    if (key === null) session.selections.delete(scrollKey(tab, root));
    else session.selections.set(scrollKey(tab, root), key);
  };
  const expand = (next: readonly string[]): void => {
    setOpen(next);
    session.expanded.set(tab, next);
  };
  return {
    expanded,
    selection,
    select,
    toggle: (folder, on) => { if (root !== null) expand(withExpanded(open, folder, on, root)); },
    reveal: (path, entry) => {
      if (root === null) return;
      const folders = foldersBetween(root, path);
      expand(folders.reduce((all: readonly string[], folder) => withExpanded(all, folder, true, root), open));
      select(path);
      setRevealed(entry ? { path, entry } : null);
      // Each level at once, ahead of the outline's other folders: the row is what the user asked for.
      const { hidden } = session.browser.snapshot;
      [root, ...folders].forEach((folder, i) => { void session.browser.folders.rest(folder, hidden, baseName(folders[i] ?? path)); });
    },
    known: revealed?.path === selection ? revealed : null,
  };
}

/**
 * What a desktop outline draws its open folders from: the host's folder cache. Each open folder is listed once, when
 * it first shows (behind what the user is looking at, `Folders.load`), and pinned while it shows. Undefined when off
 * (the phone has no outline).
 */
export function useOutlineListings(session: FilesSession, tree: TabOutline, hidden: boolean, on: boolean): OutlineProps | undefined {
  const { folders } = session.browser;
  const held = useStore(folders, (s) => s.held);
  const describe = useMemo(() => (e: HttpRefusal) => describeError(e, session.hostName), [session]);
  useEffect(() => () => { folders.pin("outline", []); }, [folders]);
  if (!on) return undefined;
  return {
    expanded: tree.expanded,
    held,
    describe,
    onToggle: tree.toggle,
    onRest: (path, act) => { void (act === "more" ? folders.more(path, hidden) : folders.load(path, hidden)); },
    onShown: (paths) => {
      folders.pin("outline", paths.map((path) => ({ path, hidden })));
      for (const path of paths) if (!folders.snapshot.held.has(folderKey(path, hidden))) void folders.load(path, hidden, true);
    },
  };
}
