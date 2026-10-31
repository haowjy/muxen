// Fixtures for the phone dock and the sessions overlay: the saved workspace restored against a
// daemon that answers `watch`, so the dock opens on a live tab in the phone layout.
import type { Fixtures } from "../fixture";
import type { TmuxListing } from "../../proto/generated/messages";
import { serveTree } from "../files/fakes";
import { LISTING, SAVED, WITH_FILES } from "../shared";

const win = (id: number, index: number, name: string) => ({ id, index, name, active: index === 0, activity: 0 });

/** Eight sessions on one server; `muxen` has three windows. */
const SEVERAL: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: [
    { id: 1, name: "muxen", bell: { mark: 0, covered: true }, windows: [win(1, 0, "agent"), win(2, 1, "shell"), win(4, 2, "logs")] },
    { id: 2, name: "notes", bell: { mark: 0, covered: true }, windows: [win(3, 0, "shell")] },
    ...["blog", "infra", "dotfiles", "scratch", "mars", "a-session-with-a-very-long-name-that-has-to-truncate"].map((name, i) => ({ id: i + 5, name, bell: { mark: 0, covered: true }, windows: [win(20 + i, 0, "zsh")] })),
  ],
};

const OPEN = { screen: "sessions", name: "open", params: { workspace: "ws/h-pop" } } as const;

export const fixtures: Fixtures = {
  /** A live tab with two others open, in the phone layout: the tab row at rest. */
  dock: { options: () => ({ workspace: SAVED }), openActive: true, daemon: (d) => { d.listing = LISTING; d.watch = "ok"; } },
  /** The workspace's tab overview: terminal rows with their windows, a Files row, Open session and Open files. */
  overview: { options: () => ({ workspace: WITH_FILES }), overview: true, daemon: (d) => { d.listing = SEVERAL; d.watch = "ok"; serveTree(d); } },
  /** A workspace with no tab open. */
  overviewEmpty: { overview: true, daemon: (d) => { d.listing = LISTING; } },
  /** Open session over the overview: sessions not open here, filtered by the field, ending in the create row. */
  openSession: { options: () => ({ workspace: WITH_FILES }), overview: true, overlay: OPEN, daemon: (d) => { d.listing = SEVERAL; d.watch = "ok"; serveTree(d); } },
  /** The server has no tmux server: nothing to attach to or create. */
  openSessionNoTmux: { options: () => ({ workspace: WITH_FILES }), overview: true, overlay: OPEN, daemon: (d) => { d.listing = null; serveTree(d); } },
  /** The server can't be reached: the saved tabs stay, the list says it can't load yet. */
  openSessionOffline: { options: () => ({ workspace: WITH_FILES }), overview: true, overlay: OPEN, daemon: (d) => { d.info = "down"; serveTree(d); } },
};
