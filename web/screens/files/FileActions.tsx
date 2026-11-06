// A file's actions, wherever the file is offered: Copy path, Download and Insert ▾ (icons in headers). One Insert control everywhere
// (a file's header, an upload's offer, a row's menu), listing this host's terminal tabs, the default first.
import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { Menu } from "../../ui/primitives/Menu";
import type { AppController } from "../../app/controller";
import { copyText } from "./copy";
import { insertSection, useInsert } from "./insert";
import { useChordLabel, useFilesKey, type Chord } from "./keymap";
import styles from "./FileActions.module.css";

/** Sends the path to the default tab, with no menu. */
const INSERT: Chord = { key: "i", mod: true };

/** How long a copy button shows that it copied. */
const COPIED_MS = 1_600;

/**
 * Insert ▾: opens the list of terminal tabs, as an icon; `labelled` is the upload offer's form, with its words. With `shortcut`, Cmd/Ctrl+I sends the
 * path to the first tab.
 */
export function InsertButton({ path, first = null, labelled, shortcut, onInserted }: { path: string; first?: string | null; labelled?: boolean; shortcut?: boolean; onInserted?: () => void }) {
  const app = useApp();
  const touch = useAppView((v) => v.viewport.density === "touch");
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { choices, insert } = useInsert(path, first, onInserted);
  useFilesKey(INSERT, () => {
    const lead = choices[0];
    if (!lead) app.notify("Open a terminal tab first");
    else if (lead.blocked !== null) app.notify(`Can't insert into ${lead.label}: ${lead.blocked.toLowerCase()}`);
    else insert(lead.id);
  }, shortcut === true);
  const keys = useChordLabel(INSERT);

  const toggle = (e: { currentTarget: HTMLElement }): void => { setAnchor(anchor ? null : e.currentTarget); };
  return (
    <>
      {labelled ? (
        <Button variant="quiet" class={styles.tool} icon="terminal" aria-haspopup="menu" aria-expanded={anchor !== null} onClick={toggle}>
          Insert into terminal
          <Icon name="chevronDown" size={16} class={styles.caret} />
        </Button>
      ) : (
        <IconButton icon="terminal" menu label="Insert into terminal" aria-haspopup="menu" aria-expanded={anchor !== null} onClick={toggle} />
      )}
      {anchor && <Menu anchor={anchor} label="Insert path into" sections={[insertSection(choices, insert, shortcut && !phone ? keys : null)]} focusFirst={!touch} onClose={() => { setAnchor(null); }} />}
    </>
  );
}

/**
 * A copy button: copies `value` and confirms in place with a check for 1.6 s (its label reads "Copied"), so
 * nothing else on screen moves. `note`, when set, is said as well: what was copied isn't all there is.
 */
export function CopyButton({ value, label, icon, note }: { value: string; label: string; icon: "copy" | "copyText"; note?: string | null }) {
  const app = useApp();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => { setCopied(false); }, COPIED_MS);
    return () => { clearTimeout(timer); };
  }, [copied]);
  const copy = (): void => {
    void copyText(app, value, note ?? null).then((ok) => { if (ok) setCopied(true); });
  };
  return (
    <>
      <IconButton icon={copied ? "check" : icon} label={copied ? "Copied" : label} class={copied ? styles.copied : undefined} onClick={copy} />
      <span class={styles.status} role="status">{copied && !note ? "Copied" : ""}</span>
    </>
  );
}

/** Saves the file at `url` (`rawUrl`) through the platform, and says a failure in the notice. */
export async function download(app: AppController, url: string, name: string): Promise<void> {
  const failure = await app.platform.download(url, name);
  if (failure !== null) app.notify(`Couldn't download ${name}: ${failure}`);
}

/** Download: the platform's save of `/fs/raw` (the browser's download, the app's share sheet). `big` is the one a file muxen can't show offers, with its size. */
/** The header's Download icon, or with `big` the can't-preview card's button, which names the size. */
export function DownloadButton({ url, name, size = null, big }: { url: string; name: string; size?: string | null; big?: boolean }) {
  const app = useApp();
  const save = (): void => { void download(app, url, name); };
  if (big) return <Button variant="primary" class={styles.big} icon="download" onClick={save}>{size === null ? "Download" : `Download ${size}`}</Button>;
  return <IconButton icon="download" label="Download" onClick={save} />;
}
