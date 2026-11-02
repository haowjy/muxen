// The Platform interface and every type it names (client-architecture.md §5). Types only:
// nothing here may import an implementation, and nothing here names an environment.
import type { LinkHandlers } from "../proto/link";
import type { SessionRef } from "../proto/generated/messages";
import type { Link } from "../net/host";

/** A muxen tab's identity: the daemon's `hostId` and the tmux session it follows (never a name or an index). */
export interface TabKey {
  host: string;
  session: SessionRef;
}

/** Terminal input: text, a tmux key name, raw bytes (base64) or a paste. */
export type InputEvent = { text: string } | { key: string } | { bytes: string } | { paste: string };

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Viewport {
  /** `phone` when `min(width, stableHeight) < 600` CSS px, else `desktop`. */
  layout: "desktop" | "phone";
  /** `touch` (44 px targets) for a coarse primary pointer, else `compact`. */
  density: "compact" | "touch";
  /** Which source feeds the terminal: desktop's xterm textarea, or muxen's own input on a phone (the app is always the latter). */
  directInput: "xterm" | "owned";
  scheme: "light" | "dark";
  /** CSS px of the window or web view. */
  width: number;
  /** Its height with no software keyboard: tmux is sized from this alone. */
  stableHeight: number;
  /** On screen now. */
  visibleHeight: number;
  /**
   * How far the keyboard, or Safari's form bar with a hardware keyboard, covers the bottom of
   * the page the web can see; 0 with none. The dock, sheets and toasts rise by this much (CSS
   * reads it as `--keyboard-inset`). The app's web view fills the screen too, so a docked
   * keyboard covers it the same way. Smaller than the `keyboard` threshold for the bar.
   */
  keyboardInset: number;
  /** Of the keyboard-hidden layout. */
  safeArea: SafeArea;
  keyboard: boolean;
  /**
   * Seconds the keyboard takes to reach `keyboardInset`, sent by the app as the keyboard starts
   * to move, so what rises with it moves with it (`--keyboard-duration`). Absent in a browser,
   * which learns the inset only once the keyboard is there.
   */
  keyboardDuration?: number;
}

export type Appearance = "system" | "light" | "dark";
/** Steps around today's defaults (12 px touch, 13 px compact): one px smaller, then 2 and 4 px larger. */
export type TextSize = "small" | "default" | "large" | "larger";
/** How long the app may sit in the background before Face ID asks again; `launch` unlocks once per launch. */
export type Relock = "5min" | "1hour" | "launch";

/** What the user chose, kept by the platform (the browser's storage, the app's defaults). */
export interface Preferences {
  appearance: Appearance;
  textSize: TextSize;
  /** Reported only by the app, the one environment that locks; chosen with {@link Platform.setRelock}. */
  relock?: Relock;
}

/** Browser: never locked. */
export interface Lifecycle {
  visible: boolean;
  online: boolean;
  locked: boolean;
  /** A native screen covers Terminal; browsers always report false. */
  covered: boolean;
}

export type Unsubscribe = () => void;
export interface MenuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type HapticKind = "key" | "modifier";

/** Where a Files tab is: a folder or a file preview. The folder `~` is the host's home, until the listing names it. */
export type FilesPlace = { kind: "dir"; path: string } | { kind: "file"; path: string };

export function samePlace(a: FilesPlace, b: FilesPlace): boolean {
  return a.kind === b.kind && a.path === b.path;
}

/** One saved tab, in tab order. A Files tab's id is its own; a terminal tab's is `tabId(key)`. */
export type SavedTab =
  | { kind: "terminal"; key: TabKey; session: string; window: string }
  | { kind: "files"; id: string; host: string; place: FilesPlace };

/** One saved workspace: a server's tabs in the order the user gave them, and the tabs it last showed. */
export interface SavedWorkspace {
  id: string;
  host: string;
  /** Terminal tabs carry the last names of their session and window, so restored pills have them before the listing. */
  tabs: SavedTab[];
  /** The tab the workspace last showed: where Home opens it. */
  last: string | null;
  /** The terminal tab last activated: where Insert path and uploads go. */
  lastTerminal: string | null;
  /** The server's canonical `$HOME`, once known: a Files tab there reads "~". */
  home: string | null;
}

/** What persists across a reload. `app/persist.ts` assembles it; `workspace/saved.ts` is the one parser. */
export interface SavedWorkspaces {
  version: 5;
  workspaces: SavedWorkspace[];
  /** The host's last known name: an offline launch cannot ask `/auth/info`, yet still says "Can't reach pop-os". */
  hostName?: string;
  /** Bell attention (sessions/bells.ts): the bell mark this device last showed, by tab id, for the sessions it has seen. */
  bellSeen?: Record<string, number>;
}

export interface DraftRecord {
  key: TabKey;
  text: string;
  revision: number;
  editedAt: number;
}

export interface DraftStore {
  get(key: TabKey): Promise<DraftRecord | null>;
  put(record: DraftRecord, baseRevision: number): Promise<"ok" | "conflict" | "failed">;
  delete(key: TabKey): Promise<void>;
  list(): Promise<DraftRecord[]>;
}

export interface PlatformStorage {
  /** Coalesced; the latest wins. */
  saveWorkspace(ws: SavedWorkspaces): void;
  drafts: DraftStore;
  clearLocalData(): Promise<void>;
}

export interface Transport {
  /** Returns a Link at once. A refusal arrives as a synthetic close, like 4401. */
  openSocket(handle: string, handlers: LinkHandlers): Link;
  /** Where every /auth, /fs and /complete URL starts. Browser: "" (same origin). */
  httpBase(handle: string): string;
}

export type UploadEvent =
  | { id: string; progress: number }
  | { id: string; path: string }
  | { id: string; error: string };

export interface Clipboard {
  writeText(text: string): Promise<"ok" | "denied">;
  /** Paste in the terminal's edit menu (§7.6). Call synchronously in its tap. */
  read(tab: TabKey): Promise<{ text: string } | { image: File } | { uploading: string } | "empty" | "denied">;
}

export interface Uploads {
  /** Call synchronously in the tap. Ends on completion, failure, or the picker's cancel. */
  pick(handle: string, signal: AbortSignal): AsyncIterable<UploadEvent>;
  /** One pasted image the page already holds. Present in the browser only. */
  send?(handle: string, file: File, signal: AbortSignal): AsyncIterable<UploadEvent>;
  /** An upload the platform started itself, by the id `clipboard.read` returned as `uploading`. Native only. */
  follow?(id: string, signal: AbortSignal): AsyncIterable<UploadEvent>;
}

/**
 * `ready`: a new build waits for a tap. `reload`: another page applied an update, and this page keeps
 * running the previous build. `required`: this page asked for a file of its build and the daemon no
 * longer has it.
 */
export type UpdateState = "none" | "ready" | "reload" | "required";
export interface Updates {
  check(): Promise<void>;
  apply(): void;
}

export interface HostEntry {
  /** The adapter's handle for this endpoint; transport methods take it. */
  handle: string;
  /** The daemon's identity and name, when the adapter already knows them. */
  hostId: string | null;
  name: string | null;
  /** The page origin the daemon must name as `browserOrigin`; null when a native token admits the client. */
  pageOrigin: string | null;
}

export interface BootResult {
  hosts: HostEntry[];
  /** As stored, possibly by an older build: `workspace/saved.ts` parses it. */
  workspace: unknown;
  viewport: Viewport;
  preferences: Preferences;
  lifecycle: Lifecycle;
}

/** The one change channel. The controller in app/ routes each event to its owner. */
export type PlatformEvent =
  | { type: "hosts"; hosts: HostEntry[] }
  | { type: "viewport"; viewport: Viewport }
  | { type: "lifecycle"; lifecycle: Lifecycle }
  | { type: "preferences"; preferences: Preferences }
  | { type: "draftChanged"; key: TabKey }
  /** The app's edit menu over the terminal's mark: Copy or Paste was chosen (`Platform.editMenu`). */
  | { type: "menuCopy" }
  | { type: "menuPaste" }
  | { type: "storage"; state: "closing" | "closed" }
  | { type: "update"; state: UpdateState };

/** Optional members are capabilities only some environments have; the interface has no environment name. */
export interface Platform {
  boot(): Promise<BootResult>;
  subscribe(listener: (event: PlatformEvent) => void): Unsubscribe;
  transport: Transport;
  /** Changes one preference; the platform applies it and answers with a `preferences` event (and a `viewport` event when the scheme changed). */
  setPreference<K extends Exclude<keyof Preferences, "relock">>(name: K, value: Preferences[K]): void;
  storage: PlatformStorage;
  uploads: Uploads;
  clipboard: Clipboard;
  /** http(s) and mailto: only. */
  openURL(url: string): void;
  playVideo(handle: string, path: string): "handled" | "inline";
  haptic(kind: HapticKind): void;
  /** Whether the platform's own back swipe may run (native: WebKit's left-edge swipe, which pops the page's history). Browser: no-op, since Safari owns the edge swipe. */
  setBackSwipe(enabled: boolean): void;
  restart(reason: "stuck" | "update"): void;
  /** Shows the platform's edit menu (Copy, Paste) over `rect`, in the page's client px, or hides it with null. Choices come back as `menuCopy` and `menuPaste`. The app only: it is what lets the terminal mark text, keyboard up or down. */
  editMenu?: (rect: MenuRect | null) => void;
  /** Opens the platform's own screen for adding, pairing and removing servers. Native only. */
  manageHosts?: () => void;
  /** Chooses when Face ID asks again. Native only. A longer interval needs a fresh Face ID there, so the answer may be the unchanged `preferences`. */
  setRelock?: (value: Relock) => void;
  /** Hands a server's https origin, and the unspent enrolment code if the page holds one, to the muxen app installed on this device. Offered only where the app can exist (iPhone, iPad) and this is not the app. */
  openInApp?: (origin: string, code: string | null) => void;
  updates?: Updates;
  install?: { installed(): boolean };
}
