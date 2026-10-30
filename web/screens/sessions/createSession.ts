// Open session's commit (browser-behaviors.md "Adding tabs"): new or attach, the client's rule over
// the listing. A listed name attaches; an unlisted one is `newSession` (tmux's `new-session -A` fails
// from the daemon on an existing name); a "duplicate session" refusal means another client created
// it first, so it re-lists and attaches. A new session's tab opens from the next listing that holds it.
import type { AppController } from "../../app/controller";
import { RequestError } from "../../net/host";
import type { HostClient } from "../../net/hosts";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import type { Workspace } from "../../workspace/state";

const LISTING_WAIT_MS = 5_000;

/** Opens the session's tab, or activates the one it already has, and shows Terminal. The tab shows whatever window tmux has current. */
export function openSession(app: AppController, workspace: Workspace, host: HostClient, listing: TmuxListing, session: SessionListing): void {
  if (host.hostId === null) return; // a listing came from a welcomed socket, so the id is known
  app.dispatch({
    type: "opened",
    workspace: workspace.id,
    key: { host: host.hostId, session: { server: listing.server, session: session.id } },
    session: session.name,
    window: session.windows.find((w) => w.active)?.name ?? session.windows[0]?.name ?? "",
  });
}

export type OpenResult = { ok: true } | { error: string };

/** The daemon's own words for a refusal it explains; ours for a request that got no answer. `doing` finishes "Couldn't …". */
export function failureText(error: unknown, hostName: string, doing = "create it"): string {
  if (!(error instanceof RequestError)) return `Couldn't ${doing}. Try again.`;
  switch (error.reason) {
    case "busy":
      return "tether is busy, try again";
    case "lost":
    case "timeout":
    case "background":
      return `Couldn't reach ${hostName}. Try again.`;
    default:
      return error.message;
  }
}

type Found = { listing: TmuxListing; session: SessionListing };

/** Resolves with the first listing that holds a session `find` accepts, asking for a fresh one, or null after a few seconds. */
function listingWith(app: AppController, host: HostClient, find: (listing: TmuxListing) => SessionListing | undefined): Promise<Found | null> {
  const cache = app.sessions;
  const { handle } = host.entry;
  const found = (): Found | null => {
    const listing = cache.snapshot.hosts[handle]?.listing;
    const session = listing ? find(listing) : undefined;
    return listing && session ? { listing, session } : null;
  };
  return new Promise((resolve) => {
    const done = (value: Found | null): void => {
      clearTimeout(timer);
      off();
      resolve(value);
    };
    const timer = setTimeout(() => { done(null); }, LISTING_WAIT_MS);
    const off = cache.subscribe(() => {
      const hit = found();
      if (hit) done(hit);
    });
    app.listing.refresh(handle);
  });
}

/** Attaches `name` if the listing has it, else creates it (`name` empty: tmux names it); the tab opens behind the closing Open session screen. */
export async function openOrCreate(app: AppController, workspace: Workspace, host: HostClient, name: string): Promise<OpenResult> {
  const hostName = host.name ?? "the server";
  const typed = name.trim();
  const attach = ({ listing, session }: Found): OpenResult => {
    app.router.closeOverlay(() => { openSession(app, workspace, host, listing, session); });
    return { ok: true };
  };
  const listed = app.sessions.snapshot.hosts[host.entry.handle]?.listing;
  const existing = typed === "" ? undefined : listed?.sessions.find((s) => s.name === typed);
  if (listed && existing) return attach({ listing: listed, session: existing });

  let created;
  try {
    created = await host.socket.request(
      (req) => ({ type: "newSession", data: { req, ...(typed !== "" && { name: typed }) } }),
      (reply) => (reply.type === "created" ? reply.data : undefined),
    );
  } catch (error) {
    if (error instanceof RequestError && error.message.includes("duplicate session")) {
      const hit = await listingWith(app, host, (l) => l.sessions.find((s) => s.name === typed));
      if (hit) return attach(hit);
    }
    return { error: failureText(error, hostName) };
  }
  const hit = await listingWith(app, host, (l) => (l.server === created.session.server ? l.sessions.find((s) => s.id === created.session.session) : undefined));
  return hit ? attach(hit) : { error: "Created, but it hasn't appeared in the list yet. Close this to see the list." };
}
