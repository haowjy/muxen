import { HostLink } from "../../proto/link";
import type { Transport } from "../types";

/** Same-origin `/ws`, offering `muxen.v1` only: the browser holds no credential. */
export function createBrowserTransport(): Transport {
  return {
    openSocket(_handle, handlers, connectTimeoutMs) {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      return new HostLink({ url: `${scheme}://${location.host}/ws`, build: import.meta.env.MODE, kind: "web", connectTimeoutMs }, handlers);
    },
    httpBase: () => "",
  };
}
