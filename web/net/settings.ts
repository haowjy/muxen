// The client for a host's server settings (fs.md "Server settings"): what its config.toml
// keeps and applies without a restart, read and written on the daemon, never kept here.

import { BUSY_RETRIES, send } from "./http";
import type { ServerSettings, SettingsChange } from "../proto/generated/messages";

export interface SettingsApi {
  /** The running values, with the daemon's defaults. */
  read(): Promise<ServerSettings>;
  /** Writes `change` to config.toml; the answer is what is running after it. */
  save(change: SettingsChange): Promise<ServerSettings>;
  /** Applies a hand edit to config.toml; a refusal `config_unavailable` carries where it doesn't parse. */
  reload(): Promise<ServerSettings>;
}

export function httpSettingsApi(origin: string, fetchFn?: typeof fetch): SettingsApi {
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => (await (await send(`${origin}${path}`, init, BUSY_RETRIES, fetchFn)).json()) as T;
  const post = (body: string): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body });
  return {
    read: () => json<ServerSettings>("/settings"),
    save: (change) => json<ServerSettings>("/settings", post(JSON.stringify(change))),
    reload: () => json<ServerSettings>("/settings/reload", post("")),
  };
}
