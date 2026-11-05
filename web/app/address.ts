// The page's address (browser-behaviors.md "Where a launch opens"): the hash names the place on screen in
// words, so a reload, a bookmark or a copied link opens it again. It names no server: a browser page
// talks to one host, its own origin. The app has no address bar and opens its saved route instead.
import { encodePath } from "../files/api";
import { shorten } from "../files/format";
import type { FilesPlace, SavedRoute } from "../platform/types";
import type { Landing, WorkspaceState } from "../workspace/state";

/** Where a launch opens: a workspace's overview or last tab (the saved route), a session's tab, or a Files place. `workspace` is null when the hash said where but not which workspace. */
export type Launch =
  | { kind: "overview"; workspace: string | null }
  | { kind: "last"; workspace: string | null }
  | { kind: "session"; workspace: string | null; session: string }
  | { kind: "files"; workspace: string | null; place: FilesPlace };

/** The hash for `landing`: `#/`, `#/tabs`, `#/term/<session>`, `#/files/<path>` (a folder ends in `/`; under home it reads `~/…`, else it drops the leading `/`, so `/` itself is `#/files/`). */
export function hashOf(state: WorkspaceState, landing: Landing): string {
  if (landing.route === "home") return "#/";
  if (landing.route === "overview") return "#/tabs";
  const ws = state.workspaces.find((w) => w.id === landing.workspace);
  const tab = ws?.tabs.find((t) => t.id === landing.tab);
  if (tab?.kind === "terminal") return `#/term/${encodeURIComponent(tab.session)}`;
  const place = landing.place ?? (tab?.kind === "files" ? tab.place : null);
  if (!place) return "#/tabs";
  const path = shorten(place.path, ws?.home ?? null);
  const shown = place.kind === "dir" && !path.endsWith("/") ? `${path}/` : path;
  return `#/files/${encodePath(shown.startsWith("/") ? shown.slice(1) : shown)}`;
}

/** `place` with a `~` path made absolute under `home`, so it compares with a tab's canonical place; unchanged while home is unknown. */
export function underHome(place: FilesPlace, home: string | null): FilesPlace {
  const { path } = place;
  return home && (path === "~" || path.startsWith("~/")) ? { ...place, path: `${home}${path.slice(1)}` } : place;
}

/** What a launch opens: `#/` is Home; a place the hash names opens it; an empty or unrecognised hash (the app, a bare origin, an old `#/tab`) opens the saved route. The hash is a trust boundary. */
export function launchOf(hash: string, saved: SavedRoute | null): Launch | null {
  if (hash === "#/") return null;
  const workspace = saved?.workspace ?? null;
  const decode = (s: string): string | null => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  if (hash === "#/tabs") return { kind: "overview", workspace };
  if (hash.startsWith("#/term/")) {
    const session = decode(hash.slice("#/term/".length));
    if (session) return { kind: "session", workspace, session };
  }
  if (hash.startsWith("#/files/")) {
    const rest = decode(hash.slice("#/files/".length));
    if (rest !== null) {
      const raw = rest === "~" || rest.startsWith("~/") ? rest : `/${rest}`;
      const dir = raw.endsWith("/");
      const path = dir && raw.length > 1 ? raw.slice(0, -1) : raw;
      return { kind: "files", workspace, place: { kind: dir || path === "~" ? "dir" : "file", path } };
    }
  }
  if (!saved) return null;
  return saved.route === "overview" ? { kind: "overview", workspace } : { kind: "last", workspace };
}
