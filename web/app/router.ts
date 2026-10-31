// Browser history is the navigation stack, and this is its only writer (browser-behaviors.md
// "Keyboard ownership and navigation history"). Each entry's state holds the route (Home, a
// workspace's overview, or one of its tabs), the overlay open on it (the tab list over a tab is one), and a record of the tab's Files place. The URL carries the route only, so file paths never enter
// it. Everyone else learns of navigation one way: `navigated`, after every push, replace and pop.
import { samePlace, type FilesPlace } from "../platform/types";
import { isPlace } from "../workspace/saved";
import type { Landing } from "../workspace/state";

/** `{ screen, name, params }` is opaque to the router: each lane adds overlays in its own screen. */
export interface Overlay {
  screen: string;
  name: string;
  params?: Record<string, unknown>;
}

/**
 * One history entry: the route it shows (Home, a workspace's overview, or one of its tabs with the
 * place a Files tab held), and the overlay open on it. On a tab route the current entry names the
 * workspace's last tab (the controller replaces it when that changes), so Back returns to an
 * earlier folder without a new request. The workspace owns the place; the router never decides it.
 */
export type Entry = Landing & {
  /** Unique per entry: lets a pop find its place in the in-memory stack. */
  id: number;
  overlay: Overlay | null;
};

/** The entry without its id, as the router is asked to make one. */
type Next = Landing & { overlay: Overlay | null };

/** What the router needs of `window.history`, so a test can stand in. */
export interface HistoryPort {
  current(): { state: unknown; hash: string };
  push(state: unknown, hash: string): void;
  replace(state: unknown, hash: string): void;
  go(delta: number): void;
  onPop(listener: () => void): () => void;
}

const HASHES: Record<Landing["route"], string> = { home: "#/", overview: "#/overview", tab: "#/tab" };

/** The enrolment code in a setup link's fragment (`#code=7KQ4-XM2P`), or null. Normalised to the bare characters the code field holds. */
export function enrolCodeFromHash(hash: string): string | null {
  const code = hash.startsWith("#code=") ? hash.slice("#code=".length).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "";
  return code === "" ? null : code;
}

/** `history.state` is a trust boundary: an earlier page life, maybe an older build, wrote it. */
function isEntry(state: unknown): state is Entry {
  const e = state as Partial<Record<keyof Entry | "place" | "tab" | "workspace", unknown>> | null;
  if (typeof e?.id !== "number") return false;
  if (e.route === "overview") return typeof e.workspace === "string";
  return e.route === "home" || (e.route === "tab" && typeof e.workspace === "string" && typeof e.tab === "string" && (e.place === null || isPlace(e.place)));
}

const HOME: Next = { route: "home", overlay: null };

export class Router {
  /** Every entry of this page's life, forward ones included; `at` is the one on screen. */
  private stack: Entry[] = [];
  private at = 0;
  private readonly listeners = new Set<(entry: Entry) => void>();
  private nextId = Date.now();
  /** A tab switch going back over the earlier tab's entries: on the pop to entry `at`, `next` is pushed above it. */
  private settling: { at: number; next: Next & { route: "tab" } } | null = null;

  /**
   * A clean launch opens Home, even with saved tabs: the first entry is replaced with Home's.
   * `workspace` finds a workspace by id: a pop to a tab entry that isn't its workspace's last tab is
   * stale, and so is a pop to an entry of a workspace that is gone.
   */
  constructor(private readonly port: HistoryPort, private readonly workspace: (id: string) => { last: string | null } | undefined) {
    const entry = { id: this.nextId++, ...HOME };
    this.stack = [entry];
    port.replace(entry, HASHES.home);
    port.onPop(() => { this.popped(); });
  }

  get entry(): Entry {
    return this.stack[this.at] as Entry;
  }

  subscribe(listener: (entry: Entry) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Shows Home: pushes an entry unless already there. */
  goHome(): void {
    if (this.entry.route === "home") return;
    this.push(HOME);
  }

  /**
   * Shows the active tab, a level above Home: Back from it is Home. The overview route (a workspace with no
   * tab) is replaced, so it is never a stop on the way back. Switching tabs on a tab route adds no entry.
   */
  openTab(workspace: string, tab: string, place: FilesPlace | null): void {
    const next: Next = { route: "tab", workspace, tab, place, overlay: null };
    if (this.entry.route === "overview") this.replace(next);
    else this.push(next);
  }

  /** Shows `workspace`'s overview, the page of a workspace with no tab: pushed from Home, else the nearest overview of it below. */
  toOverview(workspace: string): void {
    const { entry } = this;
    if (entry.route === "overview" && entry.workspace === workspace) return;
    const overview: Next = { route: "overview", workspace, overlay: null };
    if (entry.route === "home") this.push(overview);
    else this.goUp(overview, (e) => e.route === "overview" && e.workspace === workspace);
  }

  openOverlay(overlay: Overlay): void {
    this.push({ ...this.entry, overlay });
  }

  /**
   * Back closes the top overlay first. After a reload there is nothing to go back to, so the
   * entry is replaced. `then` runs once the overlay is closed: closing is `history.back()`,
   * which lands on a later `popstate`, so an action that navigates must wait, or its entry
   * is pushed before the pop and the pop undoes it (§6.6). With no overlay open it runs at once.
   */
  closeOverlay(then?: () => void): void {
    this.close(1, then);
  }

  /** Closes every overlay open on this entry at once: one history step, so none is left open (WebKit drops a second `back()` issued before the first pops). `then` as for {@link closeOverlay}. */
  closeAllOverlays(then?: () => void): void {
    let open = 0;
    while (this.stack[this.at - open]?.overlay) open++;
    this.close(open, then);
  }

  private close(count: number, then?: () => void): void {
    if (this.entry.overlay === null) {
      then?.();
      return;
    }
    if (then) {
      // Closed once the entries it names are gone: the one below may itself hold an overlay (a form page over its list).
      const target = this.at - count;
      const off = this.subscribe((entry) => {
        if (entry.overlay !== null && this.at > target) return;
        off();
        then();
      });
    }
    this.closeOverlays(count);
  }

  private closeOverlays(count: number): void {
    const { entry } = this;
    if (entry.overlay === null) return;
    // The entry below may name an earlier tab (a tab switch behind the overlay): the pop repairs it.
    const base = this.stack[this.at - count];
    if (base?.route === entry.route) this.port.go(-count);
    else this.replace({ ...entry, overlay: null });
  }

  /**
   * The workspace's last tab changed while a tab is on screen: the entry names `tab` now, and pushes nothing. With no
   * overlay open, the earlier tab's entries (its folders) go too, so Back from any tab is one step to Home, never a
   * stop on a tab no longer shown. Under an overlay, closing it settles the same way.
   */
  switchTab(tab: string, place: FilesPlace | null): void {
    const { entry } = this;
    if (entry.route !== "tab") return;
    const next = { route: "tab" as const, workspace: entry.workspace, tab, place, overlay: entry.overlay };
    if (entry.overlay === null) this.settle(next);
    else this.replace(next);
  }

  /**
   * Shows `next`, a tab entry with no overlay, as the one entry above the entry under this workspace's run of tab
   * entries (Home): one history step back to it, then a push, which also drops the earlier tab's forward entries.
   * With nothing under the run (an entry from an earlier page life), the current entry is replaced.
   */
  private settle(next: Next & { route: "tab" }): void {
    if (this.settling) {
      this.settling.next = next;
      return;
    }
    const under = this.stack.slice(0, this.at).findLastIndex((e) => e.route !== "tab" || e.workspace !== next.workspace);
    if (under < 0 || under === this.at - 1) {
      this.replace(next);
      return;
    }
    this.settling = { at: (this.stack[under] as Entry).id, next };
    this.port.go(under - this.at);
  }

  /** Drilling into a folder or preview of Files tab `tab`: a new entry. */
  pushPlace(tab: string, to: FilesPlace): void {
    const { entry } = this;
    if (entry.route === "tab") this.push({ route: "tab", workspace: entry.workspace, tab, place: to, overlay: null });
  }

  /** The Files tab's place is now `place` (the daemon's canonical path for what was asked): the entry says so. */
  replacePlace(tab: string, place: FilesPlace): void {
    const { entry } = this;
    if (entry.route === "tab") this.replace({ route: "tab", workspace: entry.workspace, tab, place, overlay: entry.overlay });
  }

  /** Back to Home, from a tab or the overview: the nearest Home entry below, else the entry is replaced with it. */
  toHome(): void {
    if (this.entry.route !== "home") this.goUp(HOME, (e) => e.route === "home");
  }

  /** The in-app back inside a Files tab: to `place`, the enclosing one. The nearest entry below that holds that place in this tab, else the entry is replaced with it. */
  toPlace(tab: string, place: FilesPlace): void {
    const { entry } = this;
    if (entry.route !== "tab") return;
    this.goUp({ route: "tab", workspace: entry.workspace, tab, place, overlay: null }, (e) => e.route === "tab" && e.tab === tab && e.place !== null && samePlace(e.place, place));
  }

  /**
   * Shows the nearest entry below the current one that `matches` and has no overlay open, in one history step, so
   * no entry between is left to step back onto; with none (after a reload or a deep link), the current entry is
   * replaced with `fallback`, so Back never leaves the app unexpectedly.
   */
  private goUp(fallback: Next, matches: (entry: Entry) => boolean): void {
    const at = this.stack.slice(0, this.at).findLastIndex((e) => e.overlay === null && matches(e));
    if (at >= 0) this.port.go(at - this.at);
    else this.replace(fallback);
  }

  private push(next: Next): void {
    const entry = { ...next, id: this.nextId++ };
    this.stack.splice(this.at + 1, Infinity, entry);
    this.at++;
    this.port.push(entry, HASHES[entry.route]);
    this.emit();
  }

  private replace(next: Next): void {
    const entry = { ...next, id: this.nextId++ };
    this.stack[this.at] = entry;
    this.port.replace(entry, HASHES[entry.route]);
    this.emit();
  }

  private popped(): void {
    const { state } = this.port.current();
    const left = this.at;
    if (isEntry(state)) {
      const at = this.stack.findIndex((e) => e.id === state.id);
      // An entry from this page's life moves the cursor; one from an earlier life (forward past a reload) stands alone.
      if (at >= 0) this.at = at;
      else this.stand({ ...state, overlay: null });
    } else {
      this.stand({ id: this.nextId++, ...HOME });
    }
    // Only the pop the switch asked for settles it: another traversal that landed first (a fast Back, ‹ Home) wins.
    const { settling } = this;
    this.settling = null;
    if (settling && this.entry.id === settling.at) {
      this.push(settling.next);
      return;
    }
    const { entry } = this;
    // Back out of overlays lands on the entry below them. The overlay's entry names the current tab and place (tabs switch under an open overlay), the one below may not: it takes them, so closing leaves the tab as it is.
    const closed = this.stack.slice(this.at + 1, left + 1);
    if (closed.length > 0 && closed.every((e) => e.overlay !== null) && entry.overlay === null && entry.route === "tab") {
      const top = closed[closed.length - 1] as Entry;
      if (top.route === "tab") {
        this.settle({ route: "tab", workspace: top.workspace, tab: top.tab, place: top.place, overlay: null });
        return;
      }
    }
    // An entry for a workspace that is gone, or for a tab that isn't its workspace's last, is stale: skip to Home without announcing it.
    if ((entry.route === "tab" && this.workspace(entry.workspace)?.last !== entry.tab) || (entry.route === "overview" && !this.workspace(entry.workspace))) {
      this.toHome();
      return;
    }
    this.emit();
  }

  private stand(entry: Entry): void {
    this.stack = [entry];
    this.at = 0;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this.entry);
  }
}

/** `window.history` as a {@link HistoryPort}. */
export function browserHistory(): HistoryPort {
  return {
    current: () => ({ state: history.state as unknown, hash: location.hash }),
    push: (state, hash) => { history.pushState(state, "", hash); },
    replace: (state, hash) => { history.replaceState(state, "", hash); },
    go: (delta) => { history.go(delta); },
    onPop: (listener) => {
      addEventListener("popstate", listener);
      return () => { removeEventListener("popstate", listener); };
    },
  };
}
