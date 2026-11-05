import { LISTING, SAVED, WITH_FILES } from "../shared";
import { serveTree } from "../files/fakes";
import type { ServerSettings, TmuxListing } from "../../proto/generated/messages";
import { defaultSettings } from "../../platform/test/settings";
import type { Fixtures } from "../fixture";
import { Cards } from "./Cards";

const win = (id: number, index: number, name: string) => ({ id, index, name, active: index === 0, activity: 0 });

/** Thirty sessions with long names: the list must scroll, search must narrow it, and nothing may overflow. */
const MANY: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: i === 7 ? "a-session-with-a-very-long-name-that-has-to-truncate-instead-of-pushing-the-row-wider" : `project-${String(i + 1).padStart(2, "0")}`,
    bell: { mark: 0, covered: true }, windows: [win((i + 1) * 10, 0, "editor"), win((i + 1) * 10 + 1, 1, i % 2 ? "server" : "shell")],
  })),
};

const SEVERAL: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: ["muxen", "notes", "blog", "infra", "dotfiles", "scratch", "mars", "a-session-with-a-very-long-name-that-has-to-truncate", "api"].map((name, i) => ({
    id: i + 1,
    name,
    bell: { mark: 0, covered: true }, windows: [win(i * 10 + 1, 0, "zsh")],
  })),
};

const SETTINGS = { screen: "settings", name: "settings" } as const;
const CUSTOM = (): ServerSettings => ({ ...defaultSettings(), searchSkip: ["node_modules", "dist", "*.egg-info"], uploadsDir: "~/inbox" });

export const fixtures: Fixtures = {
  /** Thirty sessions, none open. */
  homeMany: { daemon: (d) => { d.listing = MANY; } },
  /** The daemon's tmux has no sessions. */
  emptyServer: { daemon: (d) => { d.listing = { server: "main:1-1", version: "3.4", sessions: [] }; } },
  /** Offline with a saved workspace: open tabs show as checking, drafts stay reachable. */
  offlineTabs: { options: () => ({ workspace: SAVED }), daemon: (d) => { d.info = "down"; } },
  /** Every state of a Home workspace row at once. */
  homeCards: { render: Cards },
  /** Saved terminal tabs and a Files tab on a live server: one row with its tab count. */
  homeTabs: { options: () => ({ workspace: WITH_FILES }), daemon: (d) => { d.listing = SEVERAL; serveTree(d); } },
  /** Two servers, one card each, in the app (Add server shown). */
  homeTwoServers: {
    options: () => ({
      workspace: SAVED,
      managed: true,
      hosts: [
        { handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null },
        { handle: "h2", hostId: "h-mac", name: "jimmys-macbook-air", pageOrigin: null },
      ],
    }),
    daemon: (d) => { d.listing = LISTING; serveTree(d); },
  },
  /** The app with no server added: enrolment instructions and Add server. */
  homeNoServers: { options: () => ({ hosts: [], managed: true }) },
  /** A phone browser that hasn't installed the app: Home shows Add to Home Screen. */
  homeInstall: { options: () => ({ pwa: true }), daemon: (d) => { d.listing = LISTING; } },
  /** Settings, the page behind Home's gear, in the browser. */
  settings: { overlay: { screen: "settings", name: "settings" }, daemon: (d) => { d.listing = LISTING; } },
  /** Settings in the app: Manage servers, and no Remove this device (the host admits by token). */
  /** A server's section, its list changed from the default and a hand-set uploads folder. */
  settingsServer: { overlay: SETTINGS, daemon: (d) => { d.listing = LISTING; d.settings.running = CUSTOM(); } },
  /** Saves never answer: tap Remove to see a save in flight. */
  settingsServerSaving: { overlay: SETTINGS, daemon: (d) => { d.listing = LISTING; d.settings = { running: CUSTOM(), holdSaves: true }; } },
  /** Saves fail (a read-only config.toml): tap Remove to see the error beside the list. */
  settingsServerError: {
    overlay: SETTINGS,
    daemon: (d) => { d.listing = LISTING; d.settings = { running: CUSTOM(), saveRefusal: { status: 409, body: { error: "config_read_only" } } }; },
  },
  /** The server's settings can't be fetched. */
  settingsServerOffline: { overlay: SETTINGS, daemon: (d) => { d.listing = LISTING; d.settings.unreachable = true; } },
  /** config.toml was edited by hand and doesn't parse: tap Reload config.toml to see where. */
  settingsServerBroken: {
    overlay: SETTINGS,
    daemon: (d) => {
      d.listing = LISTING;
      d.settings = { running: { ...CUSTOM(), fileChanged: true }, reload: { refusal: { status: 503, body: { error: "config_unavailable", detail: "line 3, column 7" } } } };
    },
  },
  /** config.toml was edited by hand, including a key that waits for a restart: tap Reload config.toml. */
  settingsServerRestart: {
    overlay: SETTINGS,
    daemon: (d) => {
      d.listing = LISTING;
      d.settings = { running: { ...CUSTOM(), fileChanged: true }, reload: { file: { searchSkip: null }, restartNeeded: ["memory_budget_mib"] } };
    },
  },
  settingsApp: {
    options: () => ({ managed: true, hosts: [{ handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null }] }),
    overlay: { screen: "settings", name: "settings" },
    daemon: (d) => { d.listing = LISTING; },
  },
};
