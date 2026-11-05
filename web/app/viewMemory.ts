// What the page remembers of how it looks on this device: one small typed owner over `PlatformStorage.view`,
// beside `persist.ts` (which owns the workspace and drafts). Not `Preferences`, which crosses the iOS bridge for
// settings native acts on. A value that is missing or unreadable (another build wrote it) is the default.
import type { ViewStore } from "../platform/types";

/** Every remembered setting and its type. Later: the Files Preview panel, its divider's width, Search recents. */
export interface ViewState {
  /** Files shows hidden files. */
  showHidden: boolean;
}

const DEFAULTS: ViewState = { showHidden: false };

/** One reader per setting, since what is stored is text another build may have written. */
const READ: { [K in keyof ViewState]: (stored: unknown) => ViewState[K] | undefined } = {
  showHidden: (stored) => (typeof stored === "boolean" ? stored : undefined),
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
