import { useApp, useAppView } from "../../app/context";
import { formatSize } from "../../files/format";
import { Menu, type MenuSection } from "../../ui/primitives/Menu";
import { routeWorkspace } from "../../workspace/state";
import { insertSection, useInsert } from "./insert";
import { copyPath } from "./copy";
import { download } from "./FileActions";
import type { RowMenuAsk } from "./FolderList";
import type { FilesSession } from "./session";

interface Props extends RowMenuAsk {
  session: FilesSession;
  onClose: () => void;
}

/**
 * A row's menu (right click, a held touch, Shift+F10): Open, Open in new tab, Copy path, Download (files) and the
 * terminal tabs to insert the path into. A menu's copy has no button left to confirm it, so a notice does.
 */
export function RowMenu({ session, row, at, list, onClose }: Props) {
  const app = useApp();
  const touch = useAppView((v) => v.viewport.density === "touch");
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const workspace = useAppView((v) => routeWorkspace(v.workspace));
  const { place, entry } = row;
  const { choices, insert } = useInsert(place?.path ?? "", null);
  if (!place || !entry) return null;
  const dir = place.kind === "dir";
  const sections: MenuSection[] = [
    {
      items: [
        { label: dir ? "Go into folder" : "Open", icon: dir ? "folder" : "open", ...(!phone && { hint: "↵" }), onSelect: () => { app.openPlace(place); } },
        ...(workspace ? [{ label: "Open in new tab", icon: "newTab" as const, onSelect: () => { app.openFiles(workspace.id, place); } }] : []),
      ],
    },
    {
      items: [
        { label: "Copy path", icon: "copy", onSelect: () => { void copyPath(app, place.path, session.browser.snapshot.home); } },
        ...(!dir ? [{
          label: "Download",
          icon: "download" as const,
          ...(entry.size !== undefined && { hint: formatSize(entry.size) }),
          onSelect: () => { void download(app, session.browser.api.rawUrl(place.path), entry.name); },
        }] : []),
      ],
    },
    insertSection(choices, insert, null),
  ];
  return <Menu anchor={list} at={at} label={entry.name} sections={sections} focusFirst={!touch} onClose={onClose} />;
}
