import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { Entry } from "../../files/api";
import { foldersBetween, UP } from "../../files/outline";
import { parentOf } from "../../files/paths";
import type { CreateKind } from "../../proto/generated/messages";
import { DeleteEntry } from "./DeleteEntry";
import type { EntryRow, Naming } from "./FolderList";
import { NameEntry } from "./NameEntry";
import type { FilesSession } from "./session";
import type { TabOutline } from "./tabOutline";

/** What the list is asking the user about, in the list it was asked in. */
type EntryTask =
  | { do: "create"; dir: string; kind: CreateKind; root: string }
  | { do: "rename"; path: string; entry: Entry; root: string }
  | { do: "delete"; path: string; entry: Entry };

interface Options {
  session: FilesSession;
  /** The folder the list starts at. */
  folder: string | null;
  showing: boolean;
  tree: TabOutline;
  /** The list has a `..` row, which comes first. */
  up: boolean;
  /** A form or dialog that held the focus closed: the list takes it back. */
  onDone: () => void;
}

const dirOf = (task: Exclude<EntryTask, { do: "delete" }>): string => (task.do === "create" ? task.dir : parentOf(task.path));

const sameTask = (a: EntryTask | null, b: EntryTask): boolean =>
  a?.do === b.do && (a.do === "create" && b.do === "create" ? a.dir === b.dir && a.kind === b.kind : a.do !== "create" && b.do !== "create" && a.path === b.path);

/**
 * The list's one question at a time: a new entry's name, a new name, or whether to delete. A name is asked under its
 * folder, which opens to show the field, and the field goes with the folder or the list: a slot among the rows on a
 * desktop (`naming`), a dialog on the phone (`dialog`, with the delete's).
 */
export function useEntryTasks({ session, folder, showing, tree, up, onDone }: Options) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const [task, setTask] = useState<EntryTask | null>(null);
  const done = (hadFocus: boolean): void => {
    setTask(null);
    if (hadFocus) onDone(); // a frame on: a dialog closing still holds the page until then
  };
  const name = (next: EntryTask): void => {
    if (sameTask(task, next)) app.focus.focusTarget("name", true);
    else app.focus.keepKeyboardOn("name"); // the desktop's field; the phone's takes it as its dialog opens, marked `typing`
    setTask(next);
  };
  const asking = task && task.do !== "delete" && task.root === folder && showing ? task : null;
  const named = asking && (phone || dirOf(asking) === folder || [...foldersBetween(folder ?? "", dirOf(asking)), dirOf(asking)].every((f) => tree.expanded.has(f))) ? asking : null;
  useEffect(() => { if (task && task.do !== "delete" && !named) setTask(null); }, [task, named]);

  const field = named && (named.do === "create" ? (
    <NameEntry
      key={`${named.dir}\0${named.kind}`}
      session={session}
      label={named.kind === "file" ? "New file" : "New folder"}
      placeholder={named.kind === "file" ? "File name" : "Folder name"}
      action="Create"
      submit={(chosen) => session.create(named.dir, chosen, named.kind)}
      onClose={done}
    />
  ) : (
    <NameEntry
      key={named.path}
      session={session}
      label={`Rename ${named.entry.name}`}
      placeholder="Name"
      was={named.entry.name}
      {...(named.entry.kind !== "dir" && named.entry.name.lastIndexOf(".") > 0 && { stem: named.entry.name.lastIndexOf(".") })}
      action="Rename"
      submit={(chosen) => session.rename(named.path, chosen, tree.expanded.has(named.path))}
      onClose={done}
    />
  ));
  const after = (dir: string): string | null => (dir !== folder ? dir : up ? UP : null);
  return {
    create: (dir: string, kind: CreateKind): void => {
      if (folder === null) return;
      if (!phone && dir !== folder) tree.toggle(dir, true);
      name({ do: "create", dir, kind, root: folder });
    },
    rename: (row: EntryRow): void => {
      if (folder !== null) name({ do: "rename", path: row.key, entry: row.entry, root: folder });
    },
    remove: (row: EntryRow): void => { setTask({ do: "delete", path: row.key, entry: row.entry }); },
    naming: !phone && named ? ({ row: named.do === "rename" ? named.path : after(named.dir), place: named.do === "rename" ? "over" : "after", field } satisfies Naming) : null,
    dialog: task?.do === "delete" ? <DeleteEntry session={session} path={task.path} entry={task.entry} onClose={done} /> : phone && field,
  };
}
