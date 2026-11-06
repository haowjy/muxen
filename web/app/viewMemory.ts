// What the page remembers of how it looks on this device: one small typed owner over `PlatformStorage.view`,
// beside `persist.ts` (which owns the workspace and drafts). Not `Preferences`, which crosses the iOS bridge for
// settings native acts on. A value that is missing or unreadable (another build wrote it) is the default.
import type { LineEnding } from "../files/api";
import type { ViewStore } from "../platform/types";

/** A file this device opened in Files, for Search's recents. */
export interface OpenedFile {
  path: string;
  mime: string | null;
  /** Unix seconds. */
  at: number;
}

/** What of an edit outlives the page. */
export interface UnsavedEdit {
  path: string;
  etag: string;
  ending: LineEnding;
  text: string;
}

/** Every remembered setting and its type. */
export interface ViewState {
  /** Files shows hidden files. */
  showHidden: boolean;
  /** A desktop's Files shows the Preview panel beside the list. */
  preview: boolean;
  /** The desktop Files list's width beside the Preview panel, in CSS px, as the divider left it; null: the default. */
  listWidth: number | null;
  /** The files opened in Files, by host id, the most recent first. */
  opened: Readonly<Record<string, readonly OpenedFile[]>>;
  /** The latest unsaved edit of each host, by host id, written as the page goes away. */
  unsaved: Readonly<Record<string, UnsavedEdit>>;
  /** When a stuck socket last reloaded the page (ms since the epoch; 0: never), so a slow link can't loop reloads. */
  stuckReload: number;
}

const DEFAULTS: ViewState = { showHidden: false, preview: true, listWidth: null, opened: {}, unsaved: {}, stuckReload: 0 };

const isOpened = (v: unknown): v is OpenedFile => {
  const o = v as Partial<Record<keyof OpenedFile, unknown>> | null;
  return typeof o === "object" && o !== null && typeof o.path === "string" && o.path.startsWith("/") && (o.mime === null || typeof o.mime === "string") && typeof o.at === "number";
};

const isUnsaved = (v: unknown): v is UnsavedEdit => {
  const o = v as Partial<Record<keyof UnsavedEdit, unknown>> | null;
  return typeof o === "object" && o !== null && typeof o.path === "string" && typeof o.etag === "string" && typeof o.text === "string" && (o.ending === "\n" || o.ending === "\r\n");
};

/** One reader per setting, since what is stored is text another build may have written. */
const READ: { [K in keyof ViewState]: (stored: unknown) => ViewState[K] | undefined } = {
  showHidden: (stored) => (typeof stored === "boolean" ? stored : undefined),
  preview: (stored) => (typeof stored === "boolean" ? stored : undefined),
  listWidth: (stored) => (typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : undefined),
  stuckReload: (stored) => (typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : undefined),
  unsaved: (stored) => (typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? Object.fromEntries(Object.entries(stored).filter((e): e is [string, UnsavedEdit] => isUnsaved(e[1])))
    : undefined),
  // A host's list that doesn't parse is dropped, not the others'.
  opened: (stored) => (typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? Object.fromEntries(Object.entries(stored).filter((e): e is [string, OpenedFile[]] => Array.isArray(e[1]) && e[1].every(isOpened)))
    : undefined),
};

export class ViewMemory {
  constructor(private readonly store: ViewStore) {}

  get<K extends keyof ViewState>(key: K): ViewState[K] {
    const text = this.store.get(key);
    if (text === null) return DEFAULTS[key];
    try {
      return READ[key](JSON.parse(text)) ?? DEFAULTS[key];
    } catch {
      return DEFAULTS[key];
    }
  }

  set<K extends keyof ViewState>(key: K, value: ViewState[K]): void {
    this.store.set(key, JSON.stringify(value));
  }
}
