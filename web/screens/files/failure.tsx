import { useMemo } from "preact/hooks";
import { useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import type { HttpRefusal } from "../../net/http";
import { refusalWords } from "../../net/refusalWords";
import { hostProblem, type HostProblem } from "../../ui/hostProblem";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import type { FilesSession } from "./session";
import styles from "./failure.module.css";

/** A `network` failure while the server isn't known to answer: nothing to try, since it loads again by itself (plan.md "Requests"). */
export function isWaiting(error: HttpRefusal, shown: HostClient["shown"]): boolean {
  return error.code === "network" && shown !== "reachable";
}

/**
 * One line for a refusal, in the file manager's words (fs.md "Errors"). `shown` is the server's shown state; a write
 * form, whose request is always sent, leaves it out.
 */
export function describeError(error: HttpRefusal, host: string, shown: HostClient["shown"] = "reachable"): string {
  const problem = (kind: HostProblem): string => {
    const { title, hint } = hostProblem(kind, host);
    return hint ? `${title}. ${hint}` : title;
  };
  switch (error.code) {
    case "network": return isWaiting(error, shown) ? `Waiting for ${host}` : problem("unreachable");
    case "incompatible": return problem("incompatible");
    case "auth_required": case "forbidden": case "http_401": return problem("unauthorized");
    default: return refusalWords(error.code);
  }
}

/** How a screen words a failed load of its server's files. */
export interface Failure {
  /** The file manager's words for `error`: "Waiting for pop-os" for a `network` failure while the server isn't known to answer. */
  describe: (error: HttpRefusal) => string;
  /** The failure loads again by itself, so it offers no Try again. */
  waiting: (error: HttpRefusal) => boolean;
}

/** The server's shown state, read for every view of its files. */
export function useShown(session: FilesSession): HostClient["shown"] {
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

/** A load the server refused or never answered, with Try again unless it loads again by itself. `title` heads the words where they alone would not say what failed. */
export function Refused({ failure, error, onRetry, title }: { failure: Failure; error: HttpRefusal; onRetry: () => void; title?: string }) {
  const waiting = failure.waiting(error);
  const action = waiting ? undefined : <Button onClick={onRetry}>Try again</Button>;
  if (title === undefined || waiting) return <EmptyState icon="alert" title={failure.describe(error)} action={action} />;
  return <EmptyState icon="alert" title={title} action={action}>{failure.describe(error)}</EmptyState>;
}

export function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}
