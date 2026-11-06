// Persist now (browser-behaviors.md "Persistence and input"): the one owner of "hand everything pending to
// storage at once". The saved workspace is assembled, not owned: the workspace
// reducer supplies the tabs, and the host name comes from the controller. Draft writes are debounced by drafts/, which registers a flusher and a clearer.
import type { PlatformStorage, SavedRoute, SavedWorkspace } from "../platform/types";
import { savedTabId } from "../workspace/saved";

export class Persist {
  private hostName: () => string | null = () => null;
  private readonly flushers = new Set<() => void>();
  private readonly clearers = new Set<() => void>();
  /** The tabs that were open when local data was cleared: they stay open until closed but are never saved again. */
  private cleared = new Set<string>();

  constructor(
    private readonly storage: PlatformStorage,
    private readonly workspaces: () => SavedWorkspace[],
    private readonly bellSeen: () => Record<string, number>,
    private readonly shown: () => SavedRoute | null,
    /** When each server was last reached, by host id: written with the workspace, so it costs no write of its own. */
    private readonly reached: () => Record<string, number>,
  ) {}

  /** The controller says the page's host name, once `/auth/info` has told it. */
  provideHostName(getter: () => string | null): void {
    this.hostName = getter;
  }

  /** drafts/ registers its pending-write flush; returns the way to stop. */
  onFlush(flush: () => void): () => void {
    this.flushers.add(flush);
    return () => { this.flushers.delete(flush); };
  }

  /** drafts/ registers the reset of its in-memory state, run by Clear local data; returns the way to stop. */
  onClear(clear: () => void): () => void {
    this.clearers.add(clear);
    return () => { this.clearers.delete(clear); };
  }

  /** The workspaces changed: hand storage the assembled form (the adapter coalesces). */
  save(): void {
    const hostName = this.hostName();
    const shown = this.shown();
    const reached = this.reached();
    const workspaces = this.workspaces();
    const open = new Set(workspaces.flatMap((w) => w.tabs.map(savedTabId)));
    // A closed tab leaves the set, so opening its session again saves it.
    this.cleared = new Set([...this.cleared].filter((id) => open.has(id)));
    const kept = (id: string | null): string | null => (id !== null && this.cleared.has(id) ? null : id);
    this.storage.saveWorkspace({
      version: 5,
      workspaces: workspaces.map((w) => ({ ...w, tabs: w.tabs.filter((t) => !this.cleared.has(savedTabId(t))), last: kept(w.last), lastTerminal: kept(w.lastTerminal) })),
      ...(hostName !== null && { hostName }),
      ...(Object.keys(reached).length > 0 && { reached }),
      bellSeen: this.bellSeen(),
      ...(shown !== null && { shown }),
    });
  }

  /** Deletes drafts and the saved workspace; the tabs open now are not saved again (browser-behaviors.md "Settings"). */
  async clearLocalData(): Promise<void> {
    this.cleared = new Set(this.workspaces().flatMap((w) => w.tabs.map(savedTabId)));
    // Memory first: an open field's draft must not be written back after the store is empty.
    for (const clear of this.clearers) clear();
    await this.storage.clearLocalData();
  }

  /** Every pending draft write and the assembled workspace, now. Called when the page is hidden, before a restart or an update, and on `storage: closing`. */
  persistNow(): void {
    for (const flush of this.flushers) flush();
    this.save();
  }
}
