// Search over one host's listing (client-architecture.md §6.3), as pure functions. Filtering
// is local: nothing here asks the daemon, so a keystroke costs no round trip. Lists show
// sessions only, so a search matches session names and nothing else.
import type { SessionListing, SessionRef, TmuxListing } from "../proto/generated/messages";

/** The sessions whose name contains `query`, ignoring case; all of them for a blank query. */
export function matching(listing: TmuxListing, query: string): SessionListing[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? listing.sessions : listing.sessions.filter((s) => s.name.toLowerCase().includes(needle));
}

/** The session `ref` names in this listing, if the listing has it. */
export function findSession(listing: TmuxListing, ref: SessionRef): SessionListing | undefined {
  return listing.server === ref.server ? listing.sessions.find((s) => s.id === ref.session) : undefined;
}

/** "1 window", "3 windows". */
export function windowCount(n: number): string {
  return `${String(n)} ${n === 1 ? "window" : "windows"}`;
}

/** How long ago `then` (ms since the epoch) was, in the words a status line uses. */
export function ago(then: number): string {
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${String(hours)} ${hours === 1 ? "hour" : "hours"} ago` : `${String(Math.floor(hours / 24))} days ago`;
}
