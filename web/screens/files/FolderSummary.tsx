import type { Entry, Listing } from "../../files/api";
import type { FileRef } from "../../files/browser";
import { formatTime, shorten } from "../../files/format";
import { baseName, join } from "../../files/paths";
import type { LinkTarget } from "../../files/render/markdown";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { useStore } from "../../ui/store";
import { CopyButton, InsertButton } from "./FileActions";
import { useFailure } from "./failure";
import type { FilesSession } from "./session";
import { MarkdownViewer, useText } from "./TextViewers";
import bar from "./FileView.module.css";
import viewers from "./Viewers.module.css";
import styles from "./FolderSummary.module.css";

const README = /^readme\.(md|markdown)$/i;

interface Props {
  session: FilesSession;
  /** The folder the list starts at. */
  listing: Listing;
  /** Its own row's entry, from its parent's listing, when that is held: its time. */
  entry: Entry | null;
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
 * The Preview panel with no file to show, on the folder the list starts at: one header line with Copy path and Insert,
 * then its README rendered if it has one, else what it holds, when it changed, where it is.
 */
export function FolderSummary({ session, listing, entry, onOpen, onLink }: Props) {
  const { browser } = session;
  const home = useStore(browser, (s) => s.home);
  const { path } = listing;
  const shown = shorten(path, home);
  const name = baseName(shown);
  const within = shown.slice(0, shown.length - name.length);
  const readme = listing.entries.find((e) => e.kind === "file" && README.test(e.name)) ?? null;
  const readmeRef: FileRef | null = readme && { path: join(path, readme.name), name: readme.name, size: readme.size ?? null, mtime: readme.mtime ?? null, mime: readme.mime ?? null };
  const { describe } = useFailure(session);
  const text = useText(session, readmeRef?.path ?? "", readmeRef !== null);

  let body;
  if (readmeRef) {
    body = (
      <div class={viewers.viewer}>
        <Button variant="quiet" icon="fileText" class={styles.source} onClick={() => { onOpen({ kind: "file", path: readmeRef.path }); }}>{readmeRef.name}</Button>
        <MarkdownViewer api={browser.api} text={text} file={readmeRef} onLink={onLink} describe={describe} />
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
          {readmeRef && <span class={bar.facts}>{contents(listing)}</span>}
        </h2>
        <CopyButton value={shown} label="Copy path" icon="copy" />
        <InsertButton path={path} />
      </header>
      {body}
    </div>
  );
}
