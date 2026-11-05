// Where small per-device view settings live (Show hidden now; the Preview panel, the divider's width and
// Search recents later): the page's own localStorage, read synchronously so a screen can start from it.
// It never crosses the iOS bridge (that is for Preferences, which native acts on). localStorage can throw
// (blocked storage, private modes) or be absent: a failed write keeps the value for this page life.
import type { ViewStore } from "./types";

const PREFIX = "muxen.view.";

export function createViewStore(): ViewStore {
  const memory = new Map<string, string>();
  return {
    get(key) {
      const kept = memory.get(key);
      if (kept !== undefined) return kept;
      try {
        return localStorage.getItem(PREFIX + key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        localStorage.setItem(PREFIX + key, value);
      } catch {
        // Blocked or full: the value holds for this page.
      }
    },
    clear() {
      memory.clear();
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
      } catch {
        // Nothing stored that could be read.
      }
    },
  };
}
