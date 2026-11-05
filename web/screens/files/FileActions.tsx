// A file's actions, wherever the file is offered: Copy path, Download and Insert ▾. One Insert control everywhere
// (a file's header, an upload's offer, a row's menu), listing this host's terminal tabs, the default first.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { cx } from "../../ui/cx";
import { Button } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { Menu, type MenuSection } from "../../ui/primitives/Menu";
import { routeWorkspace } from "../../workspace/state";
import { copyText } from "./copy";
import { insertPath, useInsertChoices, type InsertChoice } from "./insert";
import styles from "./FileActions.module.css";

/** How long a copy button shows that it copied. */
const COPIED_MS = 1_600;

/** The Insert menu's rows: each terminal tab, the default (first) with ⌘I; a tab that can't take a path is disabled and says why. */
export function insertSection(choices: readonly InsertChoice[], insert: (id: string) => void, phone: boolean): MenuSection {
  if (choices.length === 0) return { title: "Insert path into", items: [{ label: "Open a terminal tab first", disabled: true, onSelect: () => undefined }] };
  return {
    title: "Insert path into",
    items: choices.map((c, i) => ({
      label: c.label,
      icon: "terminal" as const,
      disabled: c.blocked !== null,
      ...(c.blocked !== null ? { hint: c.blocked } : i === 0 && !phone ? { hint: "⌘I" } : {}),
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
 * path to the first tab while no field, dialog or menu has the keys.
 */
export function InsertButton({ path, first = null, compact, shortcut, onInserted }: { path: string; first?: string | null; compact?: boolean; shortcut?: boolean; onInserted?: () => void }) {
  const app = useApp();
  const touch = useAppView((v) => v.viewport.density === "touch");
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { choices, insert } = useInsert(path, first, onInserted);
  const latest = useRef({ choices, insert });
  latest.current = { choices, insert };

  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== "i" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const target = e.target;
      if (document.querySelector("dialog[open], [role=menu]") || (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]"))) return;
      e.preventDefault();
      const lead = latest.current.choices[0];
      if (!lead) app.notify("Open a terminal tab first");
      else if (lead.blocked !== null) app.notify(`Can't insert into ${lead.label}: ${lead.blocked.toLowerCase()}`);
      else latest.current.insert(lead.id);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [app, shortcut]);

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
      {anchor && <Menu anchor={anchor} label="Insert path into" sections={[insertSection(choices, insert, phone)]} focusFirst={!touch} onClose={() => { setAnchor(null); }} />}
    </>
  );
}

/** Copy path: the absolute path, confirmed in place by a check for 1.6 s (and "Copied", where there is room). */
export function CopyPathButton({ path, compact }: { path: string; compact?: boolean }) {
  const app = useApp();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => { setCopied(false); }, COPIED_MS);
    return () => { clearTimeout(timer); };
  }, [copied]);
  const copy = (): void => { void copyText(app, path).then((ok) => { if (ok) setCopied(true); }); };
  return (
    <>
      {compact
        ? <IconButton icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy path"} class={copied ? styles.copied : undefined} onClick={copy} />
        : <Button variant="quiet" class={cx(styles.tool, copied && styles.copied)} icon={copied ? "check" : "copy"} title={path} onClick={copy}><span class={styles.label}>{copied ? "Copied" : "Copy path"}</span></Button>}
      <span class={styles.status} role="status">{copied ? "Copied the path" : ""}</span>
    </>
  );
}

/** Download, where the platform can save a file: the browser's own download of `/fs/raw`. */
export function DownloadButton({ url, name, size, compact }: { url: string; name: string; size: string | null; compact?: boolean }) {
  const app = useApp();
  const { download } = app.platform;
  if (!download) return null;
  const save = (): void => { download(url, name); };
  return compact
    ? <IconButton icon="download" label="Download" onClick={save} />
    : <Button variant="quiet" class={styles.tool} icon="download" {...(size !== null && { title: `Download ${size}` })} onClick={save}><span class={styles.label}>Download</span></Button>;
}
