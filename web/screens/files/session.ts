// What one host's Files tabs keep while the screen is away: the browser state (the folder and
// preview shown last), the uploads under way, and each folder's scroll. The screen unmounts
// when you go to the terminal or another tab; the active tab's own place, held by the
// workspace, is what the browser follows when you come back.
import type { AppController } from "../../app/controller";
import type { FsApi } from "../../files/api";
import { FileBrowser } from "../../files/browser";
import { baseName } from "../../files/paths";
import { Recent } from "../../files/recent";
import { UploadTracker } from "../../files/uploads";
import type { HostClient } from "../../net/hosts";
import type { Pasted, UploadEvent } from "../../platform/types";
import { insertTargetOf } from "../../workspace/state";

export interface FilesSession {
  /** The host's adapter handle: uploads and video take it. */
  handle: string;
  /** The host's name now: it is unknown until `/auth/info` answers, so it is read on each use. */
  readonly hostName: string;
  browser: FileBrowser;
  uploads: UploadTracker;
  /** Scroll position by Files tab and folder path (`scrollKey`), so Back finds the list where it was. */
  scroll: Recent<number>;
  /**
   * The folders a Files tab has expanded in its desktop outline, oldest first (at most `MAX_EXPANDED`), by tab: view
   * state, never history or the workspace. Paths are absolute, so a folder stays open when the list's root moves.
   */
  expanded: Recent<readonly string[]>;
  /** The selected row's key (`files/outline.ts`), by Files tab and the folder the list starts at (`scrollKey`). */
  selections: Recent<string>;
}

/** Scrolls, expanded folders and selections kept per host: the least recently set go first, so closed tabs' do not pile up. */
const SCROLLS_KEPT = 64;

/** Two tabs may show the same folder, each scrolled its own way. */
export const scrollKey = (tab: string, path: string): string => `${tab}\n${path}`;

const sessions = new WeakMap<FsApi, FilesSession>();

export function filesSession(app: AppController, host: HostClient): FilesSession {
  const existing = sessions.get(host.fs);
  if (existing) return existing;
  const known = app.snapshot.workspace.workspaces.find((w) => w.host === host.hostId)?.home ?? null;
  const browser = new FileBrowser({ api: host.fs, hidden: app.view.get("showHidden"), home: known });
  // The workspace keeps the host's home, so a Files tab there is labelled "~" on every screen and after a reload.
  let told = known;
  let remembered = browser.snapshot.hidden;
  browser.subscribe(() => {
    // Show hidden is kept per device, not per host or tab.
    if (browser.snapshot.hidden !== remembered) {
      remembered = browser.snapshot.hidden;
      app.view.set("showHidden", remembered);
    }
    const { home } = browser.snapshot;
    if (home === told || home === null || host.hostId === null) return;
    told = home;
    app.dispatch({ type: "homeKnown", host: host.hostId, home });
  });
  const session: FilesSession = {
    handle: host.entry.handle,
    get hostName() { return app.hosts.get(host.entry.handle)?.name ?? "the server"; },
    browser,
    uploads: new UploadTracker((path) => { void browser.uploaded(path); }),
    scroll: new Recent(SCROLLS_KEPT),
    expanded: new Recent(SCROLLS_KEPT),
    selections: new Recent(SCROLLS_KEPT),
  };
  sessions.set(host.fs, session);
  return session;
}

/**
 * The tap on Upload. The picker must open inside the tap, so `pick` is called here and
 * its stream followed afterwards. The terminal tab last used on this host is the one the saved path is offered to.
 */
export function startUpload(app: AppController, session: FilesSession): void {
  const target = insertTargetOf(app.snapshot.workspace);
  void session.uploads.track(app.platform.uploads.pick(session.handle, new AbortController().signal), target);
}

/**
 * Paste, inside the tap, into the folder `dir` shown: a desktop paste event's contents (`pasted`), else the
 * clipboard, which the platform reads itself. The path goes nowhere; Insert path on the file stays the way to use it.
 */
export function pasteIntoFolder(app: AppController, session: FilesSession, dir: string, pasted?: Pasted): void {
  void app.platform.uploads.paste(session.handle, dir, new AbortController().signal, pasted).then((result) => {
    if (result === "empty") app.notify("Nothing to paste");
    else if (result === "denied") app.notify("Couldn't paste: clipboard access was refused");
    else return followPaste(app, session, result);
    return undefined;
  });
}

/** A notice when the file lands (naming it) or fails; the listing shows it. */
async function followPaste(app: AppController, session: FilesSession, events: AsyncIterable<UploadEvent>): Promise<void> {
  app.notify("Pasting…");
  for await (const event of events) {
    if ("error" in event) app.notify(`Couldn't paste: ${event.error}`);
    else if ("path" in event) {
      app.notify(`Pasted ${baseName(event.path)}`);
      await session.browser.uploaded(event.path);
    }
  }
}
