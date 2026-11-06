import { useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { CreateKind } from "../../proto/generated/messages";
import { useStore } from "../../ui/store";
import { Menu, type MenuItem } from "../../ui/primitives/Menu";
import { IconButton } from "../../ui/primitives/IconButton";
import type { IconName } from "../../ui/primitives/Icon";
import { copyPath } from "./copy";
import { PASTE, SEARCH, SHOW_HIDDEN, useChordLabel, useFilesKey } from "./keymap";
import { pasteIntoFolder, startUpload, type FilesSession } from "./session";

interface Props {
  session: FilesSession;
  /** The folder on screen, canonical. */
  path: string;
  /** The folder's listing is on screen: Paste puts into it. */
  pasteable: boolean;
  loading: boolean;
  /** New file or New folder here; absent while the folder isn't listed. */
  onCreate?: ((kind: CreateKind) => void) | undefined;
  /** The magnifier: Search below the folder; absent while it isn't listed (loading, refused, gone). */
  onSearch?: (() => void) | undefined;
}

/**
 * The folder's controls on the path line: Search first, on both layouts. A desktop keeps Upload, Paste and Refresh as icons beside ⋯; the
 * phone's line has room for the path and ⋯ only, so they move into ⋯. Copy path and Show hidden files are in ⋯
 * on both; Cmd/Ctrl+Shift+. toggles hidden files on a keyboard.
 */
export function FolderActions({ session, path, pasteable, loading, onCreate, onSearch }: Props) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const { browser } = session;
  const hidden = useStore(browser, (s) => s.hidden);

  useFilesKey(SHOW_HIDDEN, () => { void browser.toggleHidden(); });
  const hiddenKeys = useChordLabel(SHOW_HIDDEN);
  const pasteKeys = useChordLabel(PASTE);
  const searchKeys = useChordLabel(SEARCH);

  // Drawn as icons beside ⋯ on a desktop, as ⋯'s last rows on the phone.
  const tools: (MenuItem & { icon: IconName })[] = [
    { label: "Upload", icon: "upload", onSelect: () => { startUpload(app, session); } },
    ...(pasteable ? [{ label: "Paste", icon: "paste" as const, ...(!phone && { hint: pasteKeys }), onSelect: () => { pasteIntoFolder(app, session, path); } }] : []),
    { label: "Refresh", icon: "refresh", disabled: loading, onSelect: () => { void browser.reload(); } },
  ];
  const sections = [
    ...(onCreate ? [{ items: [
      { label: "New file", icon: "newFile" as const, onSelect: () => { onCreate("file"); } },
      { label: "New folder", icon: "newFolder" as const, onSelect: () => { onCreate("dir"); } },
    ] }] : []),
    { items: [{ label: "Copy path", icon: "copy" as const, onSelect: () => { void copyPath(app, path, browser.snapshot.home); } }] },
    { items: [{ label: "Show hidden files", checked: hidden, ...(!phone && { hint: hiddenKeys }), onSelect: () => { void browser.toggleHidden(); } }] },
    ...(phone ? [{ items: tools }] : []),
  ];

  return (
    <>
      {onSearch && <IconButton icon="search" label={phone ? "Search" : `Search (${searchKeys})`} aria-keyshortcuts={phone ? undefined : "/ Meta+P Control+P"} onClick={onSearch} />}
      {!phone && tools.map((t) => (
        <IconButton key={t.label} icon={t.icon} label={t.hint === undefined ? t.label : `${t.label} (${t.hint})`} disabled={t.disabled} onClick={t.onSelect} />
      ))}
      <IconButton icon="more" label="Folder options" aria-haspopup="menu" aria-expanded={menu !== null} onClick={(e) => { setMenu(menu ? null : e.currentTarget); }} />
      {menu && <Menu anchor={menu} label="Folder options" sections={sections} focusFirst={!touch} onClose={() => { setMenu(null); }} />}
    </>
  );
}
