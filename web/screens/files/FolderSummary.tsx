import { useEffect } from "preact/hooks";
import type { Entry, Listing } from "../../files/api";
import { describeError, type FileRef } from "../../files/browser";
import type { Held } from "../../files/folders";
import { formatTime, shorten } from "../../files/format";
import { baseName, join } from "../../files/paths";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Icon } from "../../ui/primitives/Icon";
import { Spinner } from "../../ui/primitives/Spinner";
import { useStore } from "../../ui/store";
import { CopyButton, InsertButton } from "./FileActions";
import type { FilesSession } from "./session";
import { MarkdownViewer, useText } from "./TextViewers";
import bar from "./FileView.module.css";
import viewers from "./Viewers.module.css";
import styles from "./FolderSummary.module.css";

const README = /^readme\.(md|markdown)$/i;

interface Props {
  session: FilesSession;
  /** The folder, canonical. */
  path: string;
  /** Its own row's entry, from its parent's listing, when that is held: its time. */
  entry: Entry | null;
  /** What is held of it; null until asked. */
  record: Held | null;
  /** The folder the list starts at: no "Go into" for it. */
  root: string;
  onOpen: (place: FilesPlace) => void;
  onLink: (target: LinkTarget) => void;
}

/** "2 folders, 5 files"; a folder not held in full says how many entries it has. */
function contents(listing: Listing): string {
  if (listing.entries.length < listing.total || listing.truncated) return `${listing.total.toLocaleString()} entries`;
  if (listing.total === 0) return "Nothing";
  const folders = listing.entries.filter((e) => e.kind === "dir").length;
  const files = listing.total - folders;
  return [folders > 0 && `${String(folders)} ${folders === 1 ? "folder" : "folders"}`, files > 0 && `${String(files)} ${files === 1 ? "file" : "files"}`].filter(Boolean).join(", ");
}

/**
 * The Preview panel on a folder (the one selected, or the list's own when nothing is): one header line with Copy
 * path and Insert, then its README rendered if it has one, else what it holds, when it changed, where it is.
 */
export function FolderSummary({ session, path, entry, record, root, onOpen, onLink }: Props) {
  const { browser } = session;
  const home = useStore(browser, (s) => s.home);
  const hidden = useStore(browser, (s) => s.hidden);
  const listing = record?.listing ?? null;
  const shown = shorten(path, home);
  const name = baseName(shown);
  const within = shown.slice(0, shown.length - name.length);
  const readme = listing?.entries.find((e) => e.kind === "file" && README.test(e.name)) ?? null;
  const readmeRef: FileRef | null = readme && { path: join(path, readme.name), name: readme.name, size: readme.size ?? null, mtime: readme.mtime ?? null, mime: readme.mime ?? null };
  const text = useText(session, readmeRef?.path ?? "", readmeRef !== null);

  // The folder is listed once it is the panel's (the selection settled on it), and kept while it is.
  const asked = record !== null;
  useEffect(() => {
    if (!asked) void browser.folders.load(path, hidden);
  }, [browser, path, hidden, asked]);
  useEffect(() => {
    browser.folders.pin("panel", [{ path, hidden }]);
    return () => { browser.folders.pin("panel", []); };
  }, [browser, path, hidden]);

  let body;
  if (record?.error && !listing) {
    body = <EmptyState icon="alert" title={describeError(record.error, session.hostName)} action={<Button onClick={() => { void browser.folders.load(path, hidden); }}>Try again</Button>} />;
  } else if (!listing) {
    body = <div class={viewers.loading}><Spinner label="Loading the folder" /><p>Loading the folder</p></div>;
  } else if (readmeRef) {
    body = (
      <div class={viewers.viewer}>
        <Button variant="quiet" icon="fileText" class={styles.source} onClick={() => { onOpen({ kind: "file", path: readmeRef.path }); }}>{readmeRef.name}</Button>
        <MarkdownViewer api={browser.api} text={text} file={readmeRef} onLink={onLink} describe={(e) => describeError(e, session.hostName)} />
      </div>
    );
  } else {
    body = (
      <div class={viewers.unsupported}>
        <div class={viewers.card}>
          <h3 class={viewers.cardTitle}><Icon name="folder" size={20} class={styles.folder} /><span>{name}</span></h3>
          <dl class={viewers.meta}>
            <dt>Contains</dt><dd>{contents(listing)}</dd>
            {entry?.mtime !== undefined && <><dt>Modified</dt><dd>{formatTime(entry.mtime)}</dd></>}
            <dt>Path</dt><dd class={viewers.mono}>{shown}{path === "/" ? "" : "/"}</dd>
          </dl>
          {path !== root && (
            <div class={viewers.cardActions}>
              <Button icon="folderOpen" onClick={() => { onOpen({ kind: "dir", path }); }}>Go into {name}</Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div class={bar.view}>
      <header class={bar.bar}>
        <h2 class={bar.name} title={shown}>
          <Icon name="folder" size={16} class={styles.folder} />
          <span class={bar.text}>{within && <span class={bar.within}>{within}</span>}<span class={bar.base}>{name}</span></span>
          {readmeRef && listing && <span class={bar.facts}>{contents(listing)}</span>}
        </h2>
        <CopyButton value={shown} label="Copy path" icon="copy" />
        <InsertButton path={path} />
      </header>
      {body}
    </div>
  );
}
