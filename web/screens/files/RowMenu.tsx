import { useApp, useAppView } from "../../app/context";
import { formatSize } from "../../files/format";
import { within } from "../../files/paths";
import { Menu, type MenuSection } from "../../ui/primitives/Menu";
import type { CreateKind } from "../../proto/generated/messages";
import { routeWorkspace } from "../../workspace/state";
import { insertSection, useInsert } from "./insert";
import { copyPath } from "./copy";
import { download } from "./FileActions";
import type { RowMenuAsk } from "./FolderList";
import type { FilesSession } from "./session";

interface Props extends RowMenuAsk {
  session: FilesSession;
  /** New file or New folder in a folder row. */
  onCreate: (dir: string, kind: CreateKind) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * A row's menu (right click, a held touch, Shift+F10): Open, Open in new tab, Copy path, Download (files), the
 * terminal tabs to insert the path into, then Rename and Delete. A menu's copy has no button left to confirm it, so a notice does.
 */
export function RowMenu({ session, row, at, list, onCreate, onRename, onDelete, onClose }: Props) {
  const app = useApp();
  const touch = useAppView((v) => v.viewport.density === "touch");
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const workspace = useAppView((v) => routeWorkspace(v.workspace));
  const { place, entry } = row;
  const { choices, insert } = useInsert(place?.path ?? "", null);
  if (!entry) return null;
  const dir = place?.kind === "dir";
  // Home, and the folders it lies in: the daemon refuses these too, by what they are, and this spares the question.
  const { home } = session.browser.snapshot;
  const holdsHome = home === null || within(home, row.key);
  const sections: MenuSection[] = [
    ...(place ? [{
      items: [
        { label: dir ? "Go into folder" : "Open", icon: dir ? ("folder" as const) : ("open" as const), ...(!phone && { hint: "↵" }), onSelect: () => { app.openPlace(place); } },
        ...(workspace ? [{ label: "Open in new tab", icon: "newTab" as const, onSelect: () => { app.openFiles(workspace.id, place); } }] : []),
      ],
    }] : []),
    ...(dir ? [{ items: [
      { label: "New file here", icon: "newFile" as const, onSelect: () => { onCreate(row.key, "file"); } },
      { label: "New folder here", icon: "newFolder" as const, onSelect: () => { onCreate(row.key, "dir"); } },
    ] }] : []),
    {
      items: [
        { label: "Copy path", icon: "copy", onSelect: () => { void copyPath(app, row.key, session.browser.snapshot.home); } },
        ...(place && !dir ? [{
          label: "Download",
          icon: "download" as const,
          ...(entry.size !== undefined && { hint: formatSize(entry.size) }),
          onSelect: () => { void download(app, session.browser.api.rawUrl(row.key), entry.name); },
        }] : []),
      ],
    },
    ...(place ? [insertSection(choices, insert, null)] : []),
    ...(!holdsHome ? [{ items: [
      { label: "Rename", icon: "rename" as const, onSelect: onRename },
      { label: "Delete", icon: "trash" as const, danger: true, onSelect: onDelete },
    ] }] : []),
  ];
  return <Menu anchor={list} at={at} label={entry.name} sections={sections} focusFirst={!touch} onClose={onClose} />;
}
