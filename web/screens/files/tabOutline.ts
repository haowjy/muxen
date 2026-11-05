import { useMemo, useState } from "preact/hooks";
import { foldersBetween, withExpanded } from "../../files/outline";
import { scrollKey, type FilesSession } from "./session";

export interface TabOutline {
  expanded: ReadonlySet<string>;
  /** The selected row's key under the folder the list starts at; null when nothing is. */
  selection: string | null;
  select: (key: string | null) => void;
  toggle: (folder: string, open: boolean) => void;
  /** Opens the folders between the list's root and `path`, and selects it. */
  reveal: (path: string) => void;
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
    toggle: (folder, on) => { expand(withExpanded(open, folder, on)); },
    reveal: (path) => {
      if (root === null) return;
      expand(foldersBetween(root, path).reduce((all: readonly string[], folder) => withExpanded(all, folder, true), open));
      select(path);
    },
  };
}
