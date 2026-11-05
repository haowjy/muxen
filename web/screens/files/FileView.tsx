import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
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
import { CopyButton, DownloadButton, InsertButton } from "./FileActions";
import { fileIcon } from "./fileIcon";
import { copyText } from "./copy";
import { Preview } from "./Preview";
import { TEXT_LIMIT, useText } from "./TextViewers";
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
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const [asText, setAsText] = useState(false);
  const [wrap, setWrap] = useState(phone);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const kind = asText ? "code" : viewerFor(file.mime);
  const size = file.size !== null ? formatSize(file.size) : null;
  const folder = up ? baseName(up.path) || "/" : null;
  const url = session.browser.api.rawUrl(file.path);
  const text = useText(session.browser.api, file.path, !children && (kind === "code" || kind === "markdown"));
  // Copy text copies what was read: a file past the first MiB copies only that much, and says so.
  const loaded = kind === "code" && text.kind === "done" ? text.value : null;
  const copyNote = loaded?.truncated ? `Copied the first ${formatSize(TEXT_LIMIT)} of ${file.name}` : null;

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
            <IconButton icon="wrap" label="Wrap lines" aria-pressed={wrap} class={styles.toggle} onClick={() => { setWrap(!wrap); }} />
            {loaded && <CopyButton value={loaded.text} label="Copy text" icon="copyText" compact note={copyNote} />}
            <span class={styles.sep} />
          </>
        )}
        {!children && (
          <>
            <CopyButton value={file.path} label="Copy path" icon="copy" compact={phone} />
            <DownloadButton url={url} name={file.name} size={size} compact={phone} />
            <InsertButton path={file.path} compact={phone} shortcut />
          </>
        )}
        {!children && phone && kind === "code" && (
          <IconButton icon="more" label="File options" aria-haspopup="menu" aria-expanded={menu !== null} onClick={(e) => { setMenu(menu ? null : e.currentTarget); }} />
        )}
        {menu && (
          <Menu
            anchor={menu}
            label="File options"
            focusFirst={false}
            onClose={() => { setMenu(null); }}
            sections={[{
              items: [
                { label: "Wrap lines", checked: wrap, onSelect: () => { setWrap(!wrap); } },
                { label: "Copy text", icon: "copyText", disabled: loaded === null, onSelect: () => { if (loaded) void copyText(app, loaded.text).then((ok) => { if (ok) app.notify(copyNote ?? `Copied the text of ${file.name}`); }); } },
              ],
            }]}
          />
        )}
      </header>
      {children ?? <Preview session={session} file={file} text={text} kind={kind} plain={asText} wrap={wrap} onAsText={() => { setAsText(true); }} onLink={onLink} />}
    </div>
  );
}
