// What one host's Files tabs keep while the screen is away: the browser state (the folder and
// preview shown last), the uploads under way, and each folder's scroll. The screen unmounts
// when you go to the terminal or another tab; the active tab's own place, held by the
// workspace, is what the browser follows when you come back.
import type { AppController } from "../../app/controller";
import type { OpenedFile } from "../../app/viewMemory";
import type { FsApi, TextPreview } from "../../files/api";
import { FileBrowser, type FileRef } from "../../files/browser";
import { baseName, join, moved, parentOf, within } from "../../files/paths";
import { Recent } from "../../files/recent";
import { FileSearch, type Found } from "../../files/search";
import { UploadTracker } from "../../files/uploads";
import type { HostClient } from "../../net/hosts";
import { HttpRefusal } from "../../net/http";
import type { Pasted, UploadEvent } from "../../platform/types";
import type { CreateKind } from "../../proto/generated/messages";
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
   * The folders a Files tab has expanded in its desktop outline, least recently opened first (at most `MAX_EXPANDED`), by tab: view
   * state, never history or the workspace. Paths are absolute, so a folder stays open when the list's root moves.
   */
  expanded: Recent<readonly string[]>;
  /** The selected row's key (`files/outline.ts`), by Files tab and the folder the list starts at (`scrollKey`). */
  selections: Recent<string>;
  /** The file the Preview panel keeps, by Files tab and the folder the list starts at (`scrollKey`): it stays when a folder is selected. */
  previews: Recent<FileRef>;
  /**
   * A file's text, handed from the view leaving to the one taking its place (the Preview panel's file opened full
   * width, and Back to the panel): taken once by `useText`, and dropped once the place has changed, so it is never a
   * cache.
   */
  handed: { path: string; text: TextPreview } | null;
  /**
   * The user opened `file`: full width, full screen on the phone, Enter on a Search result, or a selection that settled
   * in the Preview panel. Search's recents list it first.
   */
  opened: (file: { path: string; mime: string | null }) => void;
  /**
   * Makes an empty file or folder in `dir`. A refusal rejects; the landing (the folder listed again, the entry shown)
   * goes on after it resolves, whatever is on screen by then.
   */
  create: (dir: string, name: string, kind: CreateKind) => Promise<void>;
  /** A new name for what is at `path`, in its folder, reopening a folder that was open (`opens`). The landing is as for `create`. */
  rename: (path: string, to: string, opens: boolean) => Promise<void>;
  /** Deletes what is at `path` for good. A refusal rejects, and the folder is listed again: a folder may be partly gone. */
  remove: (path: string) => Promise<void>;
  /** The tab's Search below `root`: the one it left there, so Back to its results finds them as they were, unless `fresh`. */
  search: (tab: string, root: string, fresh?: boolean) => FileSearch;
}

/** Scrolls, expanded folders and selections kept per host: the least recently set go first, so closed tabs' do not pile up. */
const SCROLLS_KEPT = 64;

/** Files opened, per host, that Search lists when its field is empty. */
const OPENED_KEPT = 20;
/** Searches kept per host, by Files tab and the folder searched: each that Back may return to. */
const SEARCHES_KEPT = 8;

/** A host whose daemon has said who it is: a Files tab names its host by that id. */
export type KnownHost = HostClient & { readonly hostId: string };

/** Two tabs may show the same folder, each scrolled its own way. */
export const scrollKey = (tab: string, path: string): string => `${tab}\n${path}`;

/**
 * By the host's adapter and its id: the id a host's slot holds can change (the app learns the daemon's own, which can
 * differ from the saved one), and a session writes recents and the home under the id it was built for.
 */
const sessions = new WeakMap<FsApi, { hostId: string; session: FilesSession; forget: () => void }>();

export function filesSession(app: AppController, host: KnownHost): FilesSession {
  const existing = sessions.get(host.fs);
  if (existing?.hostId === host.hostId) return existing.session;
  existing?.forget();
  const { hostId } = host;
  const known = app.snapshot.workspace.workspaces.find((w) => w.host === hostId)?.home ?? null;
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
    if (home === told || home === null) return;
    told = home;
    app.dispatch({ type: "homeKnown", host: hostId, home });
  });
  const searches = new Recent<FileSearch>(SEARCHES_KEPT);
  // Clear local data forgets the recents: a kept Search would still show the ones it began with.
  const unclear = app.persist.onClear(() => { searches.clear(); });
  // What failed for want of the server loads again once it answers (plan.md "Requests"); stopped with the session.
  const unrecover = app.hosts.recovered(host.entry.handle, () => {
    void browser.recovered();
    for (const search of searches.values()) search.recovered();
  });
  const forget = (): void => { unclear(); unrecover(); };
  /** `ask`, a change in `dir`. A refusal rejects, and what is really there shows once the folder is listed again: the name was taken, or gone, or (`partly`, a delete that stopped) part of it was. */
  const changing = async (dir: string, partly: string | null, ask: () => Promise<void>): Promise<void> => {
    try {
      await ask();
    } catch (refused) {
      void browser.folders.changed(dir, partly);
      throw refused;
    }
  };
  /** What was at `path` left it, for `to` or for good: the previews and recents go with it. */
  const left = (path: string, to: string | null): void => {
    session.previews.revise((file) => {
      if (!within(file.path, path)) return file;
      if (to === null) return null;
      const at = moved(file.path, path, to);
      return { ...file, path: at, name: baseName(at) };
    });
    const all = app.view.get("opened");
    const kept = (all[hostId] ?? []).flatMap((file) => {
      if (!within(file.path, path)) return [file];
      return to === null ? [] : [{ ...file, path: moved(file.path, path, to) }];
    });
    app.view.set("opened", { ...all, [hostId]: kept });
  };
  const session: FilesSession = {
    handle: host.entry.handle,
    get hostName() { return app.hosts.get(host.entry.handle)?.name ?? "the server"; },
    browser,
    uploads: new UploadTracker((path) => { void browser.added(path); }),
    scroll: new Recent(SCROLLS_KEPT),
    expanded: new Recent(SCROLLS_KEPT),
    selections: new Recent(SCROLLS_KEPT),
    previews: new Recent(SCROLLS_KEPT),
    handed: null,
    opened: (file) => {
      const all = app.view.get("opened");
      const before = (all[hostId] ?? []).filter((f) => f.path !== file.path);
      const now = { path: file.path, mime: file.mime, at: Math.floor(Date.now() / 1000) };
      app.view.set("opened", { ...all, [hostId]: [now, ...before].slice(0, OPENED_KEPT) });
    },
    create: async (dir, name, kind) => {
      await changing(dir, null, () => browser.api.create(dir, name, kind));
      app.notify(`Created ${name}`);
      void browser.added(join(dir, name), { opens: kind === "dir" });
    },
    rename: async (path, to, opens) => {
      const dir = parentOf(path);
      await changing(dir, null, () => browser.api.rename(dir, baseName(path), to));
      app.notify(`Renamed to ${to}`);
      left(path, join(dir, to));
      void browser.added(join(dir, to), { opens, was: path });
    },
    remove: async (path) => {
      const dir = parentOf(path);
      await changing(dir, path, () => browser.api.delete(dir, baseName(path)).catch((refused: unknown) => {
        // Already gone is done: this delete's own lost answer, or the terminal's.
        if (!(refused instanceof HttpRefusal) || refused.code !== "not_found") throw refused;
      }));
      app.notify(`Deleted ${baseName(path)}`);
      left(path, null);
      void browser.removed(path);
    },
    search: (tab, root, fresh = false) => {
      const kept = searches.get(scrollKey(tab, root));
      if (kept && !fresh) return kept;
      kept?.stop();
      const made = new FileSearch(host.fs, root, browser.snapshot.hidden, recentsBelow(app.view.get("opened")[hostId] ?? [], root));
      searches.set(scrollKey(tab, root), made);
      return made;
    },
  };
  sessions.set(host.fs, { hostId, session, forget });
  return session;
}

/** The files opened below `root`, as Search's rows. */
function recentsBelow(opened: readonly OpenedFile[], root: string): Found[] {
  const prefix = join(root, "");
  return opened.filter((f) => f.path.startsWith(prefix)).map((f) => ({
    path: f.path,
    rel: f.path.slice(prefix.length),
    hits: [],
    entry: { name: baseName(f.path), kind: "file", link: false, ...(f.mime !== null && { mime: f.mime }) },
    opened: f.at,
  }));
}

/**
 * The tap on Upload. The picker must open inside the tap, so `pick` is called here and
 * its stream followed afterwards. The terminal tab last used on this host is the one the saved path is offered to.
 */
export function startUpload(app: AppController, session: FilesSession): void {
  const target = insertTargetOf(app.snapshot.workspace);
  void session.uploads.track(app.platform.uploads.pick(session.handle), target);
}

/**
 * Paste, inside the tap, into the folder `dir` shown: a desktop paste event's contents (`pasted`), else the
 * clipboard, which the platform reads itself. The path goes nowhere; Insert path on the file stays the way to use it.
 */
export function pasteIntoFolder(app: AppController, session: FilesSession, dir: string, pasted?: Pasted): void {
  void app.platform.uploads.paste(session.handle, dir, pasted).then((result) => {
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
      await session.browser.added(event.path);
    }
  }
}
