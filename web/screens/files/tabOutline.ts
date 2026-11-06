import { useEffect, useMemo, useState } from "preact/hooks";
import { describeError } from "../../files/browser";
import { folderKey } from "../../files/folders";
import type { Entry } from "../../files/api";
import { foldersBetween, withExpanded } from "../../files/outline";
import { baseName } from "../../files/paths";
import type { HttpRefusal } from "../../net/http";
import { useStore } from "../../ui/store";
import type { OutlineProps } from "./FolderList";
import type { PanelPick } from "./PreviewPanel";
import { scrollKey, type FilesSession } from "./session";

export interface TabOutline {
  expanded: ReadonlySet<string>;
  /** The selected row's key under the folder the list starts at; null when nothing is. */
  selection: string | null;
  /** What the Preview panel follows: the selection, and who made it. */
  pick: PanelPick | null;
  /** The user's selection. */
  select: (key: string | null) => void;
  /** The panel has followed the user's selection, so from now on it is just the selection. */
  settled: () => void;
  toggle: (folder: string, open: boolean) => void;
  /**
   * Opens the folders between the list's root and `path` (turning Show hidden files on when a name on the way is
   * hidden), selects it, and loads each folder's pages until the next
   * name down is held, so its row exists. `also.entry`, when the caller has it (a Search result), stands in for the row's
   * until then, so the Preview panel shows the file meanwhile. `opens`: `path` is a new folder, opened too.
   */
  reveal: (path: string, also?: { entry?: Entry; opens?: boolean }) => void;
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
  const [picked, setPicked] = useState<{ root: string | null; key: string | null; by: PanelPick["by"] }>(() => ({ root, key: kept(root), by: "app" }));
  const selection = picked.root === root ? picked.key : kept(root);
  const by = picked.root === root ? picked.by : "app";
  const expanded = useMemo(() => new Set(open), [open]);
  const [revealed, setRevealed] = useState<{ path: string; entry: Entry } | null>(null);

  const choose = (key: string | null, who: PanelPick["by"]): void => {
    setPicked({ root, key, by: who });
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
    pick: selection === null ? null : { path: selection, by },
    select: (key) => { choose(key, "user"); },
    settled: () => { setPicked((now) => ({ ...now, by: "app" })); },
    toggle: (folder, on) => { if (root !== null) expand(withExpanded(open, folder, on, root)); },
    reveal: (path, { entry, opens = false } = {}) => {
      if (root === null) return;
      const folders = foldersBetween(root, path);
      // A hidden name on the way (`~/.config/…`) has no row while Show hidden files is off, so the reveal would stop
      // at the folder above it: asking for the file is asking to see it, so the setting goes on.
      // The toggle relists the root itself, so the root's level waits for that listing instead of asking a second time.
      const showing = !session.browser.snapshot.hidden && [...folders, path].some((p) => baseName(p).startsWith("."))
        ? session.browser.toggleHidden()
        : Promise.resolve();
      expand([...folders, ...(opens ? [path] : [])].reduce((all: readonly string[], folder) => withExpanded(all, folder, true, root), open));
      choose(path, "app");
      setRevealed(entry ? { path, entry } : null);
      // Each level at once, ahead of the outline's other folders: the row is what the user asked for. A refused page
      // (busy is already retried) stops that level; its folder row offers the rest as for any folder.
      const { hidden } = session.browser.snapshot;
      [root, ...folders].forEach((folder, i) => {
        const next = folders[i];
        const until = next === undefined ? { name: baseName(path), dir: entry?.kind === "dir" } : { name: baseName(next), dir: true };
        const level = folder === root ? showing.then(() => session.browser.folders.rest(folder, hidden, until)) : session.browser.folders.rest(folder, hidden, until);
        level.catch(() => undefined);
      });
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
