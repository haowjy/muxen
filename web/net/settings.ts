// A host's server settings (fs.md "Server settings"): what its config.toml keeps and applies
// without a restart, read and written on the daemon. `SettingsClient` is the one owner, per
// host, of the server's latest answer and of the queue every read, save and reload goes
// through, so they reach the daemon one at a time and in order whatever screen is open:
// Settings draws from it, and can close mid-save without losing the save or its outcome.

import { HttpRefusal, sendJson } from "./http";
import type { ServerSettings, SettingsChange } from "../proto/generated/messages";
import { Store } from "../ui/store";

export interface SettingsApi {
  /** The running values, with the daemon's defaults. */
  read(): Promise<ServerSettings>;
  /** Writes `change` to config.toml; the answer is what is running after it. */
  save(change: SettingsChange): Promise<ServerSettings>;
  /** Applies a hand edit to config.toml; a refusal `config_unavailable` carries where it doesn't parse. */
  reload(): Promise<ServerSettings>;
}

export function httpSettingsApi(origin: string, fetchFn?: typeof fetch): SettingsApi {
  const json = <T>(path: string, init?: RequestInit): Promise<T> => sendJson<T>(`${origin}${path}`, init, fetchFn);
  const post = (body: string): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body });
  return {
    read: () => json<ServerSettings>("/settings"),
    save: (change) => json<ServerSettings>("/settings", post(JSON.stringify(change))),
    reload: () => json<ServerSettings>("/settings/reload", post("")),
  };
}

/** What a save changes, so its failure is shown beside that field. */
export type SettingsField = "searchSkip" | "uploadsDir";

export interface SettingsView {
  /** The server's latest answer; null until the first. */
  settings: ServerSettings | null;
  /** The last read is in flight. */
  reading: boolean;
  /** The last read got no answer, and nothing has answered since. */
  unreachable: boolean;
  /** Saves queued or in flight. */
  saving: number;
  reloading: boolean;
  /** The last reload found config.toml doesn't parse (`where`: the parser's line and column), until an answer says the file is what runs. */
  broken: { where: string | null } | null;
  /** The last failure of a save of each field, and of a reload, until that succeeds or the user edits the field. */
  failed: Record<SettingsField | "reload", HttpRefusal | null>;
}

/** Anything that isn't a daemon's refusal reads as no answer. */
const failure = (error: unknown): HttpRefusal => (error instanceof HttpRefusal ? error : new HttpRefusal(0, "network"));

export class SettingsClient extends Store<SettingsView> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly api: SettingsApi) {
    super({ settings: null, reading: false, unreachable: false, saving: 0, reloading: false, broken: null, failed: { searchSkip: null, uploadsDir: null, reload: null } });
  }

  /** Reads the running values again (Settings opening, Try again), after whatever is queued. */
  read(): void {
    this.update({ reading: true });
    void this.enqueue(async () => {
      try {
        this.answered(await this.api.read());
        this.update({ unreachable: false });
      } catch {
        this.update({ unreachable: true });
      } finally {
        this.update({ reading: false });
      }
    });
  }

  /**
   * Queues a save of `field`. `change` is built when its turn comes, from the server's answer
   * to everything before it, and returns null when there is nothing to change (no request).
   * Resolves false if the save failed; the failure is in `failed[field]`.
   */
  save(field: SettingsField, change: (now: ServerSettings) => SettingsChange | null): Promise<boolean> {
    this.update({ saving: this.snapshot.saving + 1 });
    return this.enqueue(async () => {
      try {
        const now = this.snapshot.settings;
        const body = now && change(now);
        if (!body) return now !== null;
        this.answered(await this.api.save(body));
        this.fail(field, null);
        return true;
      } catch (error) {
        this.fail(field, failure(error));
        return false;
      } finally {
        this.update({ saving: this.snapshot.saving - 1 });
      }
    });
  }

  /** Queues a reload of config.toml. A file that doesn't parse sets `broken`. */
  reload(): void {
    this.update({ reloading: true });
    void this.enqueue(async () => {
      try {
        this.answered(await this.api.reload());
        this.update({ failed: { searchSkip: null, uploadsDir: null, reload: null } });
      } catch (error) {
        const failed = failure(error);
        if (failed.code === "config_unavailable") this.update({ broken: { where: failed.detail ?? null } });
        else this.fail("reload", failed);
      } finally {
        this.update({ reloading: false });
      }
    });
  }

  /** The user is editing `field`: its last failure no longer applies. */
  dismiss(field: SettingsField): void {
    this.fail(field, null);
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private answered(settings: ServerSettings): void {
    this.update({ settings, unreachable: false, ...(!settings.fileChanged && { broken: null }) });
  }

  private fail(key: SettingsField | "reload", failed: HttpRefusal | null): void {
    if (this.snapshot.failed[key] !== failed) this.update({ failed: { ...this.snapshot.failed, [key]: failed } });
  }
}
