import { useMemo } from "preact/hooks";
import { useAppView } from "../../app/context";
import { describeError, isWaiting } from "../../files/browser";
import type { HttpRefusal } from "../../net/http";
import type { FilesSession } from "./session";

/** How a screen words a failed load of its server's files. */
export interface Failure {
  /** The file manager's words for `error`: "Waiting for pop-os" for a `network` failure while the server isn't known to answer. */
  describe: (error: HttpRefusal) => string;
  /** The failure loads again by itself, so it offers no Try again. */
  waiting: (error: HttpRefusal) => boolean;
}

/**
 * Words failures by the server's shown state, and draws again when it changes. A write form's request is always sent, so
 * it words its own failure with `describeError` alone.
 */
export function useFailure(session: FilesSession): Failure {
  const shown = useAppView((v) => v.hosts.find((h) => h.entry.handle === session.handle)?.shown ?? "reachable");
  return useMemo(() => ({
    describe: (error) => describeError(error, session.hostName, shown),
    waiting: (error) => isWaiting(error, shown),
  }), [session, shown]);
}
