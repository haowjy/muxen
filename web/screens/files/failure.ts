import { useMemo, useState } from "preact/hooks";
import { useAppView } from "../../app/context";
import { describeError, isWaiting } from "../../files/browser";
import type { HostClient } from "../../net/hosts";
import type { HttpRefusal } from "../../net/http";
import type { FilesSession } from "./session";

/** How a screen words a failed load of its server's files. */
export interface Failure {
  /** The file manager's words for `error`: "Waiting for pop-os" for a `network` failure while the server isn't known to answer. */
  describe: (error: HttpRefusal) => string;
  /** The failure loads again by itself, so it offers no Try again. */
  waiting: (error: HttpRefusal) => boolean;
}

/** The server's shown state, read for every view of its files. */
function useShown(session: FilesSession): HostClient["shown"] {
  return useAppView((v) => v.hosts.find((h) => h.entry.handle === session.handle)?.shown ?? "reachable");
}

/**
 * Words failures by the server's shown state, and draws again when it changes. A write form's request is always sent, so
 * it words its own failure with `describeError` alone.
 */
export function useFailure(session: FilesSession): Failure {
  const shown = useShown(session);
  return useMemo(() => ({
    describe: (error) => describeError(error, session.hostName, shown),
    waiting: (error) => isWaiting(error, shown),
  }), [session, shown]);
}

/**
 * Whether a file loaded by its URL (an image, a video, audio) can start loading: it waits while the server isn't
 * reachable and starts when it is, and once started is never cut short (plan.md "Requests"). A new file remounts the viewer, so it asks again.
 */
export function useReachableOnce(session: FilesSession): boolean {
  const shown = useShown(session);
  const [started, setStarted] = useState(shown === "reachable");
  if (shown === "reachable" && !started) setStarted(true);
  return started;
}
