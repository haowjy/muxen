import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { useStore } from "../../ui/store";
import { Menu, type MenuItem } from "../../ui/primitives/Menu";
import { IconButton } from "../../ui/primitives/IconButton";
import { copyPath } from "./copy";
import { pasteIntoFolder, startUpload, type FilesSession } from "./session";

interface Props {
  session: FilesSession;
  /** The folder on screen, canonical. */
  path: string;
  /** The folder's listing is on screen: Paste puts into it. */
  pasteable: boolean;
  loading: boolean;
}

/**
 * The folder's controls on the path line. A desktop keeps Upload, Paste and Refresh as icons beside ⋯; the
 * phone's line has room for the path and ⋯ only, so they move into ⋯. Copy path and Show hidden files are in ⋯
 * on both; Cmd/Ctrl+Shift+. toggles hidden files on a keyboard.
 */
export function FolderActions({ session, path, pasteable, loading }: Props) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const { browser } = session;
  const hidden = useStore(browser, (s) => s.hidden);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "." && e.code !== "Period") return;
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      void browser.toggleHidden();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [browser]);

  const upload: MenuItem = { label: "Upload", icon: "upload", onSelect: () => { startUpload(app, session); } };
  const paste: MenuItem = { label: "Paste", icon: "paste", onSelect: () => { pasteIntoFolder(app, session, path); } };
  const refresh: MenuItem = { label: "Refresh", icon: "refresh", disabled: loading, onSelect: () => { void browser.reload(); } };
  const sections = [
    { items: [{ label: "Copy path", icon: "copy" as const, onSelect: () => { void copyPath(app, path, browser.snapshot.home); } }] },
    { items: [{ label: "Show hidden files", checked: hidden, ...(!phone && { hint: "⇧⌘." }), onSelect: () => { void browser.toggleHidden(); } }] },
    ...(phone ? [{ items: [upload, ...(pasteable ? [paste] : []), refresh] }] : []),
  ];

  return (
    <>
      {!phone && (
        <>
          <IconButton icon="upload" label="Upload" onClick={() => { startUpload(app, session); }} />
          {pasteable && <IconButton icon="paste" label="Paste (⌘V)" onClick={() => { pasteIntoFolder(app, session, path); }} />}
          <IconButton icon="refresh" label="Refresh" disabled={loading} onClick={() => { void browser.reload(); }} />
        </>
      )}
      <IconButton icon="more" label="Folder options" aria-haspopup="menu" aria-expanded={menu !== null} onClick={(e) => { setMenu(menu ? null : e.currentTarget); }} />
      {menu && <Menu anchor={menu} label="Folder options" sections={sections} focusFirst={!touch} onClose={() => { setMenu(null); }} />}
    </>
  );
}
