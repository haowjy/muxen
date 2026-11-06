import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { TEXT_LIMIT } from "../../files/api";
import type { FileRef } from "../../files/browser";
import { formatSize, formatTime, shorten } from "../../files/format";
import { viewerFor } from "../../files/kinds";
import type { LinkTarget } from "../../files/render/markdown";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { Menu } from "../../ui/primitives/Menu";
import { Popover } from "../../ui/primitives/Popover";
import { useStore } from "../../ui/store";
import { EditView } from "./EditView";
import { CopyButton, DownloadButton, InsertButton } from "./FileActions";
import { fileIcon } from "./fileIcon";
import { copyText } from "./copy";
import { useFilesKey, type Chord } from "./keymap";
import { Preview } from "./Preview";
import { TextFacts, useText } from "./TextViewers";
import type { FilesSession } from "./session";
import viewers from "./Viewers.module.css";
import styles from "./FileView.module.css";

/** Leaves a file full width for the list. */
const LEAVE: Chord = { key: "escape" };

interface Props {
  session: FilesSession;
  file: FileRef;
  /** Back, named for the folder it returns to; absent in the Preview panel, and at `/`. */
  back?: { folder: string; onBack: () => void } | undefined;
  /** In the Preview panel: opens the file full width. The panel's header also shows the file's folder, quiet, before its name. */
  onExpand?: (() => void) | undefined;
  onLink: (target: LinkTarget) => void;
  /** Shown instead of the viewer, and the actions, while the file can't be shown yet (loading, refused). */
  children?: ComponentChildren;
}

/**
 * A file, under one header line: Back named for its folder, the name, the viewer's controls, then Copy
 * path, Download and Insert ▾ as icons and ⋯ (File options), whose Info holds the size, time and path. A path reads
 * `~/…` under the host's home and absolute elsewhere, as in the path field; Copy path copies that form, Insert the
 * absolute one. In the desktop's Preview panel there is no Back: the line ends with ⋯ and the expand button, and leaves
 * room for the panel's toggle (FilesPane's).
 */
export function FileView({ session, file, back, onExpand, onLink, children }: Props) {
  const app = useApp();
  const home = useStore(session.browser, (s) => s.home);
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const fine = useAppView((v) => v.viewport.density !== "touch");
  // "Open as text" is one file's: the view stays mounted from file to file (Wrap lines carries over), so it names the file.
  const [textOf, setTextOf] = useState<string | null>(null);
  const asText = textOf === file.path;
  const [wrap, setWrap] = useState(phone);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [info, setInfo] = useState<HTMLElement | null>(null);
  const kind = asText ? "code" : viewerFor(file.mime);
  // The page's heading is the file full width; in the panel the list's folder is the page, and the file one part of it.
  const Heading = onExpand ? "h2" : "h1";
  const size = file.size !== null ? formatSize(file.size) : null;
  const shown = shorten(file.path, home);
  const within = onExpand ? shown.slice(0, shown.length - file.name.length) : "";
  const url = session.browser.api.rawUrl(file.path);
  const edit = useStore(session.edits, (s) => s.open.get(file.path));
  // The Preview panel shows the file: its editor is full width, and an edit waits there. A file that can't be shown still
  // has its unsaved text, which only the editor can reach.
  const editing = edit && !onExpand && (!children || edit.changed) ? edit : null;
  const readable = kind === "code" || kind === "markdown";
  const [text, setText] = useText(session, file.path, !children && !editing && readable);
  const editable = readable && text.kind === "done" ? text.value.editable : null;
  // Copy text copies what was read: a file past the first MiB copies only that much, and says so.
  const loaded = kind === "code" && text.kind === "done" ? text.value : null;
  const copyNote = loaded?.truncated ? `Copied the first ${formatSize(TEXT_LIMIT)} of ${file.name}` : null;
  /** Leaving for the view that shows this file in the other size: it takes the text read here. */
  const handOver = (go: () => void) => (): void => {
    session.handed = text.kind === "done" ? { path: file.path, text: text.value } : null;
    go();
  };
  const expand = onExpand && handOver(onExpand);
  const leave = back && handOver(back.onBack);
  useFilesKey(LEAVE, () => { leave?.(); }, !phone && leave !== undefined && !editing);

  if (editing) return <EditView key={file.path} session={session} file={file} edit={editing} onSaved={setText} />;

  return (
    <div class={styles.view}>
      <header class={styles.bar}>
        {back && (phone
          ? <IconButton icon="back" label={`Back to ${back.folder}`} onClick={leave} />
          : <Button variant="quiet" class={styles.back} icon="back" aria-label={`Back to ${back.folder}`} onClick={leave}>{back.folder}</Button>)}
        {back && !phone && <span class={styles.sep} />}
        <Heading class={styles.name} title={shown}>
          {!phone && <Icon name={fileIcon(file.name, file.mime)} size={16} class={styles.kind} />}
          <span class={styles.text}>{within && <span class={styles.within}>{within}</span>}<span class={styles.base}>{file.name}</span></span>
        </Heading>
        {!children && kind === "code" && !phone && (
          <>
            <IconButton icon="wrap" label="Wrap lines" aria-pressed={wrap} class={styles.toggle} onClick={() => { setWrap(!wrap); }} />
            {loaded && <CopyButton value={loaded.text} label="Copy text" icon="copyText" note={copyNote} />}
            <span class={styles.sep} />
          </>
        )}
        {!children && (
          <>
            <CopyButton value={shown} label="Copy path" icon="copy" />
            <DownloadButton url={url} name={file.name} />
            <InsertButton path={file.path} shortcut />
          </>
        )}
        {!children && (
          // Its click closes what it opened, Info included: a press on the anchor is left to the anchor.
          <IconButton icon="more" label="File options" aria-haspopup="menu" aria-expanded={menu !== null || info !== null} onClick={(e) => { if (menu || info) { setMenu(null); setInfo(null); } else setMenu(e.currentTarget); }} />
        )}
        {expand && (
          <>
            <span class={styles.sep} />
            <IconButton icon="expand" label="Open full width" onClick={expand} />
          </>
        )}
        {menu && (
          <Menu
            anchor={menu}
            label="File options"
            focusFirst={fine}
            onClose={() => { setMenu(null); }}
            sections={[
              ...(phone && kind === "code" ? [{
                items: [
                  { label: "Wrap lines", checked: wrap, onSelect: () => { setWrap(!wrap); } },
                  { label: "Copy text", icon: "copyText" as const, disabled: loaded === null, onSelect: () => { if (loaded) void copyText(app, loaded.text, copyNote ?? `Copied the text of ${file.name}`); } },
                ],
              }] : []),
              ...(editable ? [{
                items: [{
                  label: "Edit",
                  onSelect: () => {
                    if (text.kind === "done") session.edits.begin({ path: file.path, ...editable, text: text.value.text }, false);
                    expand?.();
                  },
                }],
              }] : []),
              { items: [{ label: "Info", icon: "info", onSelect: () => { setInfo(menu); } }] },
            ]}
          />
        )}
        {info && (
          <Popover anchor={info} role="dialog" label={`Info: ${file.name}`} focus={fine} class={styles.info} onClose={() => { setInfo(null); }}>
            <dl class={viewers.meta}>
              {loaded && <TextFacts name={file.name} preview={loaded} plain={asText} />}
              {size !== null && <><dt>Size</dt><dd>{size}</dd></>}
              {file.mtime !== null && <><dt>Modified</dt><dd>{formatTime(file.mtime)}</dd></>}
              <dt>Path</dt><dd class={viewers.mono}>{shown}</dd>
            </dl>
          </Popover>
        )}
      </header>
      {children ?? <Preview session={session} file={file} text={text} kind={kind} plain={asText} wrap={wrap} onAsText={() => { setTextOf(file.path); }} onLink={onLink} />}
    </div>
  );
}
