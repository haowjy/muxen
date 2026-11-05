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
import { filesSession, scrollKey } from "../../screens/files/session";

/** A desktop outline as a tab would have left it: these folders open (oldest first), this row selected. */
const outlined = (fixture: Fixture, expanded: string[], selection?: string): Fixture => ({
  ...fixture,
  start: (app: AppController) => {
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

export const fixtures: Fixtures = {
  /** A new Files tab: it opens `~`. */
  files: at({ kind: "dir", path: "~" }),
  filesFolder: at({ kind: "dir", path: REPO }),
  filesMarkdown: at({ kind: "file", path: `${REPO}/README.md` }),
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
  /** Open folders that are loading (`src` never answers), refused (`docs`) and empty. */
  filesOutlineStates: outlined(at({ kind: "dir", path: REPO }, undefined, (fs) => { fs.hanging.add(`${REPO}/src`); fs.denied.add(`${REPO}/docs`); }), [`${REPO}/src`, `${REPO}/docs`, `${REPO}/empty`]),
  /** The folder refuses to list. */
  filesDenied: at({ kind: "dir", path: REPO }, undefined, (fs) => { fs.denied.add(REPO); }),
};
