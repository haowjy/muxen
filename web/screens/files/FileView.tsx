import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useAppView } from "../../app/context";
import type { FileRef } from "../../files/browser";
import { formatSize, formatTime } from "../../files/format";
import { viewerFor } from "../../files/kinds";
import { baseName } from "../../files/paths";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { Menu } from "../../ui/primitives/Menu";
import { CopyPathButton, DownloadButton, InsertButton } from "./FileActions";
import { fileIcon } from "./FolderList";
import { Preview } from "./Preview";
import type { FilesSession } from "./session";
import styles from "./FileView.module.css";

interface Props {
  session: FilesSession;
  file: FileRef;
  /** The folder Back goes to; null at `/`. */
  up: FilesPlace | null;
  onUp: () => void;
  onLink: (target: LinkTarget) => void;
  /** Shown instead of the viewer, and the actions, while the file can't be shown yet (loading, refused). */
  children?: ComponentChildren;
}

/**
 * A file, under one header line: Back named for its folder, the name and size, the viewer's controls, then Copy
 * path, Download and Insert ▾. The phone's line is Back, the name, and the actions as icons.
 */
export function FileView({ session, file, up, onUp, onLink, children }: Props) {
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const [asText, setAsText] = useState(false);
  const [wrap, setWrap] = useState(phone);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const kind = asText ? "code" : viewerFor(file.mime);
  const size = file.size !== null ? formatSize(file.size) : null;
  const folder = up ? baseName(up.path) || "/" : null;
  const url = session.browser.api.rawUrl(file.path);

  return (
    <div class={styles.view}>
      <header class={styles.bar}>
        {up && (phone
          ? <IconButton icon="back" label={`Back to ${folder ?? ""}`} onClick={onUp} />
          : <Button variant="quiet" class={styles.back} icon="back" aria-label={`Back to ${folder ?? ""}`} onClick={onUp}>{folder}</Button>)}
        {up && !phone && <span class={styles.sep} />}
        <h1 class={styles.name} title={file.path}>
          {!phone && <Icon name={fileIcon(file.name, file.mime)} size={16} class={styles.kind} />}
          <span class={styles.text}>{file.name}</span>
          {!phone && size !== null && <span class={styles.facts} {...(file.mtime !== null && { title: `Modified ${formatTime(file.mtime)}` })}>{size}</span>}
        </h1>
        {!children && kind === "code" && !phone && (
          <>
            <IconButton icon="wrap" label={wrap ? "Don't wrap lines" : "Wrap lines"} aria-pressed={wrap} class={styles.toggle} onClick={() => { setWrap(!wrap); }} />
            <span class={styles.sep} />
          </>
        )}
        {!children && (
          <>
            <CopyPathButton path={file.path} compact={phone} />
            <DownloadButton url={url} name={file.name} size={size} compact={phone} />
            <InsertButton path={file.path} compact={phone} shortcut />
          </>
        )}
        {!children && phone && kind === "code" && (
          <IconButton icon="more" label="File options" aria-haspopup="menu" aria-expanded={menu !== null} onClick={(e) => { setMenu(menu ? null : e.currentTarget); }} />
        )}
        {menu && (
          <Menu anchor={menu} label="File options" focusFirst={false} onClose={() => { setMenu(null); }} sections={[{ items: [{ label: "Wrap lines", checked: wrap, onSelect: () => { setWrap(!wrap); } }] }]} />
        )}
      </header>
      {children ?? <Preview session={session} file={file} kind={kind} plain={asText} wrap={wrap} onAsText={() => { setAsText(true); }} onLink={onLink} />}
    </div>
  );
}
