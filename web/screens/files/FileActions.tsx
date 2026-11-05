// A file's actions, wherever the file is offered: Copy path, Download and Insert ▾. One Insert control everywhere
// (a file's header, an upload's offer, a row's menu), listing this host's terminal tabs, the default first.
import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { cx } from "../../ui/cx";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { Menu, type MenuSection } from "../../ui/primitives/Menu";
import { routeWorkspace } from "../../workspace/state";
import { copyText } from "./copy";
import { insertPath, useInsertChoices, type InsertChoice } from "./insert";
import { useChordLabel, useFilesKey, type Chord } from "./keymap";
import styles from "./FileActions.module.css";

/** Sends the path to the default tab, with no menu. */
const INSERT: Chord = { key: "i", mod: true };

/** How long a copy button shows that it copied. */
const COPIED_MS = 1_600;

/** The Insert menu's rows: each terminal tab, the default (first) with `shortcut`, where the control has one; a tab that can't take a path is disabled and says why. */
export function insertSection(choices: readonly InsertChoice[], insert: (id: string) => void, shortcut: string | null): MenuSection {
  if (choices.length === 0) return { title: "Insert path into", items: [{ label: "Open a terminal tab first", disabled: true, onSelect: () => undefined }] };
  return {
    title: "Insert path into",
    items: choices.map((c, i) => ({
      label: c.label,
      icon: "terminal" as const,
      disabled: c.blocked !== null,
      ...(c.blocked !== null ? { hint: c.blocked } : i === 0 && shortcut !== null ? { hint: shortcut } : {}),
      onSelect: () => { insert(c.id); },
    })),
  };
}

/** The terminal tabs `path` can go to from the screen's server, `first` leading (else its last terminal tab). */
export function useInsert(path: string, first: string | null, onInserted?: () => void): { choices: InsertChoice[]; insert: (id: string) => void } {
  const app = useApp();
  const workspace = useAppView((v) => routeWorkspace(v.workspace));
  const choices = useInsertChoices(workspace, first);
  return { choices, insert: (id) => { if (insertPath(app, id, path)) onInserted?.(); } };
}

/**
 * Insert ▾: opens the list of terminal tabs. `compact` is the phone's icon form. With `shortcut`, Cmd/Ctrl+I sends the
 * path to the first tab.
 */
export function InsertButton({ path, first = null, compact, shortcut, onInserted }: { path: string; first?: string | null; compact?: boolean; shortcut?: boolean; onInserted?: () => void }) {
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
      {compact ? (
        <IconButton icon="terminal" menu label="Insert into terminal" aria-haspopup="menu" aria-expanded={anchor !== null} onClick={toggle} />
      ) : (
        <Button variant="quiet" class={styles.tool} icon="terminal" aria-haspopup="menu" aria-expanded={anchor !== null} onClick={toggle}>
          <span class={styles.label}>Insert into terminal</span>
          <Icon name="chevronDown" size={16} class={styles.caret} />
        </Button>
      )}
      {anchor && <Menu anchor={anchor} label="Insert path into" sections={[insertSection(choices, insert, shortcut && !phone ? keys : null)]} focusFirst={!touch} onClose={() => { setAnchor(null); }} />}
    </>
  );
}

/**
 * A copy button: copies `value` and confirms in place with a check for 1.6 s ("Copied", where there is room), so
 * nothing else on screen moves. `note`, when set, is said as well: what was copied isn't all there is.
 */
export function CopyButton({ value, label, icon, compact, note }: { value: string; label: string; icon: "copy" | "copyText"; compact?: boolean; note?: string | null }) {
  const app = useApp();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => { setCopied(false); }, COPIED_MS);
    return () => { clearTimeout(timer); };
  }, [copied]);
  const copy = (): void => {
    void copyText(app, value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (note) app.notify(note);
    });
  };
  return (
    <>
      {compact
        ? <IconButton icon={copied ? "check" : icon} label={copied ? "Copied" : label} class={copied ? styles.copied : undefined} onClick={copy} />
        : <Button variant="quiet" class={cx(styles.tool, copied && styles.copied)} icon={copied ? "check" : icon} onClick={copy}><span class={styles.label}>{copied ? "Copied" : label}</span></Button>}
      <span class={styles.status} role="status">{copied && !note ? "Copied" : ""}</span>
    </>
  );
}

/** Download, where the platform can save a file: the browser's own download of `/fs/raw`. `big` is the one a file muxen can't show offers, with its size. */
export function DownloadButton({ url, name, size, compact, big }: { url: string; name: string; size: string | null; compact?: boolean; big?: boolean }) {
  const app = useApp();
  const { download } = app.platform;
  if (!download) return null;
  const save = (): void => { download(url, name); };
  if (big) return <Button variant="primary" class={styles.big} icon="download" onClick={save}>{size === null ? "Download" : `Download ${size}`}</Button>;
  return compact
    ? <IconButton icon="download" label="Download" onClick={save} />
    : <Button variant="quiet" class={styles.tool} icon="download" {...(size !== null && { title: `Download ${size}` })} onClick={save}><span class={styles.label}>Download</span></Button>;
}
