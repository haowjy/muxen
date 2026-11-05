import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { FileRef } from "../../files/browser";
import { formatSize, formatTime } from "../../files/format";
import { viewerFor } from "../../files/kinds";
import type { LinkTarget } from "../../files/render/markdown";
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
  /** Back, named for the folder it returns to; absent in the Preview panel, and at `/`. */
  back?: { folder: string; onBack: () => void } | undefined;
  /** In the Preview panel: the file's folder relative to the list's root, shown quiet before its name (`docs/`). */
  folder?: string | undefined;
  /** In the Preview panel: opens the file full width. */
  onExpand?: (() => void) | undefined;
  /** The header line's last control (the Preview toggle). */
  end?: ComponentChildren;
  onLink: (target: LinkTarget) => void;
  /** Shown instead of the viewer, and the actions, while the file can't be shown yet (loading, refused). */
  children?: ComponentChildren;
}

/**
 * A file, under one header line: Back named for its folder, the name and size, the viewer's controls, then Copy
 * path, Download and Insert ▾. The phone's line is Back, the name, and the actions as icons. In the desktop's Preview
 * panel there is no Back: the line ends with the expand button and the panel's toggle.
 */
export function FileView({ session, file, back, folder: within, onExpand, end, onLink, children }: Props) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  // "Open as text" is one file's: the view stays mounted from file to file (Wrap lines carries over), so it names the file.
  const [textOf, setTextOf] = useState<string | null>(null);
  const asText = textOf === file.path;
  const [wrap, setWrap] = useState(phone);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const kind = asText ? "code" : viewerFor(file.mime);
  // The page's heading is the file full width; in the panel the list's folder is the page, and the file one part of it.
  const Heading = onExpand ? "h2" : "h1";
  const size = file.size !== null ? formatSize(file.size) : null;
  const url = session.browser.api.rawUrl(file.path);
  const text = useText(session.browser.api, file.path, !children && (kind === "code" || kind === "markdown"));
  // Copy text copies what was read: a file past the first MiB copies only that much, and says so.
  const loaded = kind === "code" && text.kind === "done" ? text.value : null;
  const copyNote = loaded?.truncated ? `Copied the first ${formatSize(TEXT_LIMIT)} of ${file.name}` : null;

  return (
    <div class={styles.view}>
      <header class={styles.bar}>
        {back && (phone
          ? <IconButton icon="back" label={`Back to ${back.folder}`} onClick={back.onBack} />
          : <Button variant="quiet" class={styles.back} icon="back" aria-label={`Back to ${back.folder}`} onClick={back.onBack}>{back.folder}</Button>)}
        {back && !phone && <span class={styles.sep} />}
        <Heading class={styles.name} title={file.path}>
          {!phone && <Icon name={fileIcon(file.name, file.mime)} size={16} class={styles.kind} />}
          <span class={styles.text}>{within && <span class={styles.within}>{within}</span>}{file.name}</span>
          {!phone && size !== null && <span class={styles.facts} {...(file.mtime !== null && { title: `Modified ${formatTime(file.mtime)}` })}>{size}</span>}
        </Heading>
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
        {onExpand && (
          <>
            <span class={styles.sep} />
            <IconButton icon="expand" label="Open full width" onClick={onExpand} />
          </>
        )}
        {end}
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
                { label: "Copy text", icon: "copyText", disabled: loaded === null, onSelect: () => { if (loaded) void copyText(app, loaded.text, copyNote ?? `Copied the text of ${file.name}`); } },
              ],
            }]}
          />
        )}
      </header>
      {children ?? <Preview session={session} file={file} text={text} kind={kind} plain={asText} wrap={wrap} onAsText={() => { setTextOf(file.path); }} onLink={onLink} />}
    </div>
  );
}
