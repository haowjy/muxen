// Fixtures for the Files lane: the real app on a fake file tree served through the fake
// daemon's `/fs` routes, open on a Files tab. The saved workspace holds that tab and its
// place, so each fixture can open at a folder or a preview. Watches are answered, so an
// inserted path reaches a tab's real input.
import type { FilesPlace } from "../../platform/types";
import type { Fixture, Fixtures } from "../fixture";
import { LISTING, savedPlus } from "../shared";
import { BIG, BIG_PAGE, bigTree, ETC, findTree, FIND_ROOT, HOME, REPO, serveTree, type FilesFs } from "./fakes";
import type { FakeTree } from "../../platform/test/fs";
import type { AppController } from "../../app/controller";
import type { ViewState } from "../../app/viewMemory";
import { filesSession, scrollKey } from "../../screens/files/session";

/** A desktop outline as a tab would have left it: these folders open (oldest first), this row selected; `preview: false` with the Preview panel off. */
const outlined = (fixture: Fixture, expanded: string[], selection?: string, preview = true): Fixture => ({
  ...fixture,
  start: (app: AppController) => {
    app.view.set("preview", preview);
    const host = app.hosts.all()[0];
    if (!host) return;
    const session = filesSession(app, host);
    session.expanded.set("files-1", expanded);
    if (selection !== undefined) session.selections.set(scrollKey("files-1", REPO), selection);
  },
});

const at = (place: FilesPlace, tree?: FakeTree, configure?: (fs: FilesFs) => void, page?: number): Fixture => ({
  options: () => ({ workspace: savedPlus({ kind: "files", id: "files-1", host: "h-pop", place }, "files-1") }),
  openActive: true,
  daemon: (d) => {
    d.listing = LISTING;
    d.watch = "ok";
    serveTree(d, tree, configure, page);
  },
});

/** Files this device opened from the fake host, the most recent first; the last is outside `~/muxen`, so Search there leaves it out. */
const OPENED = (): ViewState["opened"] => {
  const now = Math.floor(Date.now() / 1000);
  const file = (path: string, mime: string, minutes: number) => ({ path, mime, at: now - minutes * 60 });
  return {
    "h-pop": [
      file(`${REPO}/docs/plan.md`, "text/markdown; charset=utf-8", 12),
      file(`${REPO}/bench-results.json`, "text/plain; charset=utf-8", 25),
      file(`${REPO}/shot.png`, "image/png", 180),
      file(`${REPO}/src/main.rs`, "text/plain; charset=utf-8", 240),
      file(`${ETC}/hosts`, "text/plain; charset=utf-8", 600),
      file(`${REPO}/notes/note-03.txt`, "text/plain; charset=utf-8", 2 * 24 * 60),
    ],
  };
};

/**
 * Search open over `~/muxen` with `text` typed (asked for as the app starts), and the device's recents unless `fresh`.
 * `then` is typed a moment later, for an answer still on its way over the last one's rows.
 */
const searching = (text: string, { fresh = false, configure, then }: { fresh?: boolean; configure?: (fs: FilesFs) => void; then?: string } = {}): Fixture => ({
  ...at({ kind: "dir", path: REPO }, undefined, configure),
  overlay: { screen: "files", name: "search", params: { root: REPO } },
  start: (app: AppController) => {
    if (!fresh) app.view.set("opened", OPENED());
    // Once the folder is listed and the host has said who it is, as a magnifier tap finds them.
    setTimeout(() => {
      const host = app.hosts.all()[0];
      if (!host) return;
      const search = filesSession(app, host).search("files-1", REPO);
      if (text !== "") search.type(text);
      if (then !== undefined) setTimeout(() => { search.type(then); }, 800);
    }, 300);
  },
});

export const fixtures: Fixtures = {
  /** A new Files tab: it opens `~`. */
  files: at({ kind: "dir", path: "~" }),
  filesFolder: at({ kind: "dir", path: REPO }),
  filesMarkdown: at({ kind: "file", path: `${REPO}/README.md` }),
  /** On a desktop, a file full width, opened from a reload: Back goes to its folder. */
  filesCode: at({ kind: "file", path: `${REPO}/src/main.rs` }),
  /** JSON, with a line longer than the window: the code view's numbers and wrapping. */
  filesJson: at({ kind: "file", path: `${REPO}/bench-results.json` }),
  filesImage: at({ kind: "file", path: `${REPO}/shot.png` }),
  filesVideo: at({ kind: "file", path: `${REPO}/demo.mp4` }),
  filesBinary: at({ kind: "file", path: `${REPO}/muxen.bin` }),
  filesEmpty: at({ kind: "dir", path: `${REPO}/empty` }),
  /** `/`: no up row. */
  filesRoot: at({ kind: "dir", path: "/" }),
  /** A folder, and a file, outside the home folder. */
  filesOutside: at({ kind: "dir", path: ETC }),
  filesOutsideFile: at({ kind: "file", path: `${ETC}/hosts` }),
  /** A folder that was deleted or moved since the tab last showed it. */
  filesGone: at({ kind: "dir", path: `${HOME}/gone/deeper` }),
  /** Finding folders by path (the path field), in `~/repos/muxen`. */
  filesFind: at({ kind: "dir", path: FIND_ROOT }, findTree()),
  /** Listing `src` never answers (slow), `docs` is refused (denied), the network drops `src` (offline), the daemon cuts `web` short at its scan cap (capped). */
  filesFindSlow: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.hanging.add(`${FIND_ROOT}/src`); }),
  filesFindDenied: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.denied.add(`${FIND_ROOT}/docs`); }),
  filesFindOffline: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.unreachable.add(`${FIND_ROOT}/src`); }),
  filesFindCapped: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.capped.add(`${FIND_ROOT}/web`); }),
  /** A folder over 200 entries: the first page holds the three subfolders and the first files. */
  filesBig: at({ kind: "dir", path: BIG }, bigTree(), undefined, BIG_PAGE),
  /** The desktop outline: two folders open in place, a file in one selected; `notes` has more than a page. */
  filesOutline: outlined(at({ kind: "dir", path: REPO }), [`${REPO}/src`, `${REPO}/notes`], `${REPO}/src/main.rs`),
  /** The Preview panel on a selected folder with no README: its facts and Go into. (`filesFolder` shows the list's own README, `filesOutsideFile`'s folder its facts.) */
  filesPanelFolder: outlined(at({ kind: "dir", path: REPO }), [`${REPO}/docs`], `${REPO}/docs`),
  /** The Preview panel off: the list takes the window's width. */
  filesPanelOff: outlined(at({ kind: "dir", path: REPO }), [`${REPO}/src`, `${REPO}/notes`], `${REPO}/src/main.rs`, false),
  /** Open folders that are loading (`src` never answers), refused (`docs`) and empty. */
  filesOutlineStates: outlined(at({ kind: "dir", path: REPO }, undefined, (fs) => { fs.hanging.add(`${REPO}/src`); fs.denied.add(`${REPO}/docs`); }), [`${REPO}/src`, `${REPO}/docs`, `${REPO}/empty`]),
  /** Search, field empty: the files opened on this device below the folder. */
  filesSearch: searching(""),
  /** Search, field empty, on a device that has opened nothing. */
  filesSearchFresh: searching("", { fresh: true }),
  /** Typed, the answer not here yet: the recents stay, quieted. */
  filesSearchTyping: searching("md", { configure: (fs) => { fs.searchHangs = () => true; } }),
  filesSearchFuzzy: searching("md"),
  filesSearchGlob: searching("*.txt"),
  /** The walk stopped at its entry cap. */
  filesSearchStopped: searching("note", { configure: (fs) => { fs.searchStopped = "entries"; } }),
  filesSearchNothing: searching("zqx"),
  filesSearchDenied: searching("md", { configure: (fs) => { fs.searchFails = "denied"; } }),
  filesSearchOffline: searching("md", { configure: (fs) => { fs.searchFails = "offline"; } }),
  /** The answer for "md" is up; "md zz" never answers, so its rows stay, quieted. */
  filesSearchSlow: searching("md", { configure: (fs) => { fs.searchHangs = (q) => q.includes("zz"); }, then: "md zz" }),
  /** The folder refuses to list. */
  filesDenied: at({ kind: "dir", path: REPO }, undefined, (fs) => { fs.denied.add(REPO); }),
};
