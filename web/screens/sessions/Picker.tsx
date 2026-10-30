// The picker (browser-behaviors.md "Picker (desktop) and picker sheet (phone)"): one component for the
// desktop popover and the phone's half-height sheet. The router overlay open says which: `picker` is the
// popover under the top row's +, `sheet` the half sheet over the current tab (Home's card row lands on a
// tab, then opens the sheet over it). The sheet opens on the open tabs and one "Add new tab" row; that
// opens a choice, Add session or Add file (the popover opens on it), and either one is a search above
// that side's list, ending with creation. Every pick leaves it open, the tab it puts on screen behind it; "New session"
// replaces the list with a form page, a router entry of its own, so Back and Escape return to the list
// before they close the picker (a reload drops overlays, so a page never outlives its list).
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { describeError } from "../../files/browser";
import { isPath } from "../../files/pathfield";
import type { HostClient } from "../../net/hosts";
import { HttpRefusal } from "../../net/http";
import { Dialog } from "../../ui/primitives/Dialog";
import { PageBar, ToolBar } from "../../ui/primitives/DialogBars";
import { Row } from "../../ui/primitives/Row";
import { SearchField } from "../../ui/primitives/TextField";
import { useStore } from "../../ui/store";
import { screenOf } from "../../workspace/state";
import { CompletionList } from "../files/CompletionList";
import { useCompletion } from "../files/completion";
import { filesSession } from "../files/session";
import { HostFavoriteLists } from "./HostFavoriteLists";
import { HostSection } from "./HostSection";
import { NewSessionPage } from "./NewSessionPage";
import { useActiveHost, useQuery } from "./pick";
import { pickerMemoryOf, type Side } from "./pickerMemory";
import { listClass } from "./PickRows";
import { SessionPicks } from "./SessionPicks";
import { OpenTabs } from "./OpenTabs";
import styles from "./Picker.module.css";

const SIDES = [{ value: "sessions" }, { value: "files" }] as const;
const FIND: Record<Side, string> = { sessions: "Find a session", files: "Find a folder or type a path" };

type Kind = "popover" | "half";
const KINDS: Record<string, Kind> = { picker: "popover", sheet: "half" };

/** What the open overlay says the picker is; what it was while it closes, so the dialog doesn't change shape on its way out. */
function useContainer(): { open: boolean; name: string; kind: Kind; params: Record<string, unknown> | undefined } {
  const overlay = useAppView((v) => v.entry.overlay);
  const kind = overlay?.screen === "sessions" ? KINDS[overlay.name] : undefined;
  const last = useRef<Kind>("half");
  if (kind) last.current = kind;
  return { open: kind !== undefined, name: overlay?.name ?? "sheet", kind: last.current, params: kind ? overlay?.params : undefined };
}

export function Picker() {
  const container = useContainer();
  const host = useActiveHost();
  if (!host) return null;
  return <PickerDialog {...container} host={host} />;
}

interface DialogProps {
  open: boolean;
  /** The overlay's name, for a page to open as the same overlay. */
  name: string;
  kind: Kind;
  params: Record<string, unknown> | undefined;
  /** The server the sheet is for, else the active tab's: where a typed path and the page's actions go by default. */
  host: HostClient;
}

function PickerDialog({ open, name, kind, params, host }: DialogProps) {
  const app = useApp();
  const memory = pickerMemoryOf(app);
  const remembered = useStore(memory, (s) => s.side);
  // `add` is the step: "choose" (Add session / Add file) or the side chosen, each a router entry so Back steps back.
  const step = params?.["add"];
  const chosen: Side | null = step === "sessions" || step === "files" ? step : null;
  const side: Side = chosen ?? remembered;
  // The Files side asks for folders when first shown, then stays mounted (hidden) until the picker closes.
  const [filesShown, setFilesShown] = useState(false);
  useEffect(() => { setFilesShown(open && (filesShown || side === "files")); }, [open, side]);
  const [query, setQuery] = useQuery(open);
  const search = useRef<HTMLInputElement | null>(null);
  const noTabs = useAppView((v) => v.workspace.tabs.length === 0);
  const touch = useAppView((v) => v.viewport.density === "touch");
  // A pick may have put a terminal under the picker: closing it hands the keyboard to that terminal.
  const onTerminal = useAppView((v) => screenOf(v.workspace) === "terminal");
  const returnFocusTo = kind === "popover" ? (noTabs || touch ? "plus" as const : "terminal" as const) : onTerminal && !touch ? "terminal" as const : undefined;
  const hosts = useAppView((v) => v.hosts);
  const close = (): void => { app.router.closeOverlay(); };

  // A form page is the same overlay with `newSession` (the server's handle) and `name`.
  const target = typeof params?.["newSession"] === "string" ? hosts.find((h) => h.entry.handle === params["newSession"]) : undefined;
  const page = params?.["newSession"] !== undefined;
  // The phone's sheet opens on the open tabs, whose last row, "Add new tab", opens the choice; the
  // desktop's + opens on the choice, since its tabs are on the top row.
  const choosing = !page && chosen === null && (step === "choose" || kind === "popover");
  const listing = !page && chosen !== null;
  const showTabs = !page && !choosing && !listing;
  const add = (to: "choose" | Side): void => {
    if (to !== "choose") memory.setSide(to);
    app.openOverlay({ screen: "sessions", name, params: { ...params, add: to } });
  };
  const newSession = (on: HostClient, initial: string): void => {
    app.openOverlay({ screen: "sessions", name, params: { ...params, newSession: on.entry.handle, name: initial } });
  };

  // On the Files side, text starting with ~ or / is a path on one server: the default one, or the one whose "Open a folder…" row started it.
  const [pathOn, setPathOn] = useState<string | null>(null);
  const pathMode = side === "files" && isPath(query);
  useEffect(() => { if (!pathMode) setPathOn(null); }, [pathMode]);
  const pathHost = hosts.find((h) => h.entry.handle === pathOn) ?? host;
  const session = filesSession(app, pathHost);
  const [pathError, setPathError] = useState<string | null>(null);
  const field = useCompletion({
    session,
    text: pathMode ? query : null,
    setText: setQuery,
    enterOpens: true,
    onOpen: async (path) => {
      const { hostId } = pathHost;
      if (hostId === null) return;
      setPathError(null);
      try {
        // The daemon says whether it is a folder it can read, in its own words; the listing it answers seeds the new tab.
        const listing = await session.browser.api.list(path, 0, false);
        session.browser.folders.loaded(listing, false, path);
        setQuery("");
        app.openFiles(hostId, { kind: "dir", path: listing.path });
      } catch (e) {
        setPathError(describeError(e instanceof HttpRefusal ? e : new HttpRefusal(0, "internal"), session.hostName));
      }
    },
  });
  useEffect(() => { setPathError(null); }, [query]);
  /** "Open a folder…" on `on`: starts a path there, inside the tap so the keyboard comes up with it. */
  const startPath = (on: HostClient): void => {
    setPathOn(on.entry.handle);
    setQuery("~/");
    if (search.current) app.focus.focusElement(search.current);
  };

  const searchField = (
    <SearchField
      label={FIND[side]}
      placeholder={FIND[side]}
      value={query}
      class={styles.search}
      inputRef={search}
      {...(pathMode ? { onInput: field.input.onInput, onKeyDown: field.input.onKeyDown, listId: field.input.listId, activeId: field.input.activeId } : { onInput: (v: string) => { setQuery(v); } })}
      {...(kind === "popover" && { "data-initial-focus": "" })}
    />
  );
  const TITLE: Record<Side, string> = { sessions: "Add session", files: "Add file" };
  const problem = pathError ?? field.said;
  return (
    <Dialog
      open={open}
      title="Open"
      variant={kind === "popover" ? { to: "plus" } : "sheet"}
      {...(returnFocusTo && { returnFocusTo })}
      onClose={close}
      header={page
        ? <PageBar back="Back" onBack={close} title={`New session on ${target?.name ?? "the server"}`} />
        : listing
          ? <><PageBar back="Back" onBack={close} title={TITLE[side]} /><ToolBar>{searchField}</ToolBar></>
          : choosing && kind !== "popover"
            ? <PageBar back="Back to open tabs" onBack={close} title="Add new tab" />
            : false}
    >
      {open && showTabs && <OpenTabs onAdd={() => { add("choose"); }} onPick={close} />}
      {open && choosing && (
        <div class={listClass}>
          <Row icon="terminal" label="Add session" trailing="chevron" onClick={() => { add("sessions"); }} />
          <Row icon="folder" label="Add file" trailing="chevron" onClick={() => { add("files"); }} />
        </div>
      )}
      {/* The list stays mounted under a page, so Back finds it as it was. */}
      <div hidden={!listing}>
        {open && SIDES.map(({ value }) => (
          <div key={value} hidden={side !== value}>
            {value === "sessions" ? (
              <SessionPicks query={query} onNew={newSession} />
            ) : filesShown && (pathMode ? (
              <HostSection hostName={pathHost.name ?? "the server"} label={`Folders on ${pathHost.name ?? "the server"}`} titled={hosts.length > 1}>
                {problem && <p class={styles.refused} role="alert">{problem}</p>}
                {field.completion && field.home !== null && <CompletionList completion={field.completion} home={field.home} hostName={session.hostName} {...field.list} />}
              </HostSection>
            ) : (
              <HostFavoriteLists query={query} onPath={startPath} />
            ))}
          </div>
        ))}
      </div>
      {open && page && target && <NewSessionPage key={target.entry.handle} host={target} initialName={typeof params["name"] === "string" ? params["name"] : ""} />}
    </Dialog>
  );
}
