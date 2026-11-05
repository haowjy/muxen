// A server's settings (fs.md "Server settings") for `FakeDaemon.settings`: the running values,
// saves that apply them as the daemon does, and a reload that answers what a fixture sets.
import type { ErrorBody, Reloaded, ServerSettings, SettingsChange } from "../../proto/generated/messages";

export interface FakeSettings {
  running: ServerSettings;
  /** Every request fails as a dead network does. */
  unreachable?: boolean;
  /** Saves wait for good while set: a save in flight. */
  holdSaves?: boolean;
  /** A save answers this refusal and changes nothing. */
  saveRefusal?: { status: number; body: ErrorBody };
  /** What a reload does: apply `file` and report `restartNeeded`, or answer `refusal`. */
  reload?: { file: Partial<Pick<ServerSettings, "searchSkip" | "uploadsDir">>; restartNeeded: string[] } | { refusal: { status: number; body: ErrorBody } };
}

/** The daemon's defaults, every key absent. */
export function defaultSettings(): ServerSettings {
  return { searchSkip: null, uploadsDir: null, fileChanged: false, defaults: { searchSkip: ["node_modules"], uploadsDir: "~/.muxen-uploads" } };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** `/settings` and `/settings/reload`; `undefined` for any other route. */
export function serveSettings(settings: FakeSettings, method: string, path: string, body: string | null): Promise<Response> | undefined {
  if (settings.unreachable && path.startsWith("/settings")) return Promise.reject(new TypeError("network"));
  if (method === "GET" && path === "/settings") return Promise.resolve(json(200, settings.running));
  if (method === "POST" && path === "/settings") {
    if (settings.holdSaves) return new Promise(() => {});
    if (settings.saveRefusal) return Promise.resolve(json(settings.saveRefusal.status, settings.saveRefusal.body));
    const change = JSON.parse(body ?? "{}") as SettingsChange;
    const searchSkip = change.searchSkip === undefined ? settings.running.searchSkip : change.searchSkip && [...new Set(change.searchSkip)];
    const uploadsDir = change.uploadsDir === undefined ? settings.running.uploadsDir : change.uploadsDir;
    settings.running = { ...settings.running, searchSkip, uploadsDir, fileChanged: false };
    return Promise.resolve(json(200, settings.running));
  }
  if (method === "POST" && path === "/settings/reload") {
    const reload = settings.reload ?? { file: {}, restartNeeded: [] };
    if ("refusal" in reload) return Promise.resolve(json(reload.refusal.status, reload.refusal.body));
    settings.running = { ...settings.running, ...reload.file, fileChanged: false };
    const answer: Reloaded = { settings: settings.running, restartNeeded: reload.restartNeeded };
    return Promise.resolve(json(200, answer));
  }
  return undefined;
}
