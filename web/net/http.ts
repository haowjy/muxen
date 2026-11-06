import type { ErrorBody, HttpError } from "../proto/generated/messages";

// The generic client for a host's HTTP origin (the file API, /settings, /complete).

/**
 * The daemon's generated codes, plus the client's own: `network` when nothing answered,
 * `incompatible` from native's proxy, `http_<status>` for a refusal without a code.
 */
export type RefusalCode = HttpError | "network" | "incompatible" | `http_${string}`;

/** A refusal: the daemon's `{"error": code}` ({@link ErrorBody}), or one of the client's codes. */
export class HttpRefusal extends Error {
  /** `detail` is the daemon's, where it says more (`config_unavailable`: "line 3, column 7"). */
  constructor(readonly status: number, readonly code: RefusalCode, readonly detail?: string) {
    super(code);
  }
}

/** `busy` is answered with `Retry-After: 1`; a couple of retries ride out a burst. */
export const BUSY_RETRIES = 2;

/**
 * One request to a host's HTTP origin. A refusal becomes an {@link HttpRefusal} with the
 * daemon's code, a dead network `network`; `busy` is retried `retries` times.
 */
export async function send(target: string, init: RequestInit = {}, retries = BUSY_RETRIES, fetchFn: typeof fetch = (input, opts) => fetch(input, opts)): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(target, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new HttpRefusal(0, "network");
    }
    if (res.ok) return res;
    // Native's own answer while the app is locked or still unlocking: nothing reached the server, and the socket's return after the unlock is what loads it again.
    if (res.status === 423) throw new HttpRefusal(0, "network");
    const body = await res.json().then((b: unknown) => b as Partial<ErrorBody> | null, () => null);
    const code = body?.error;
    const detail = typeof body?.detail === "string" ? body.detail : undefined;
    const err = new HttpRefusal(res.status, typeof code === "string" ? code : `http_${String(res.status)}`, detail);
    if (err.code !== "busy" || attempt >= retries) throw err;
    const wait = Number(res.headers.get("Retry-After")) || 1;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

/**
 * Reads a response's body. A body that dies mid-read (the server went, or the request was
 * aborted for it) is `network` like a failed request; the caller's own abort stays an abort.
 */
export async function readBody<T>(res: Response, signal: AbortSignal | null | undefined, read: (res: Response) => Promise<T>): Promise<T> {
  try {
    return await read(res);
  } catch (error) {
    if (signal?.aborted || error instanceof SyntaxError) throw error;
    throw new HttpRefusal(0, "network");
  }
}

/** {@link send} and the JSON body of its answer. */
export async function sendJson<T>(target: string, init?: RequestInit, fetchFn?: typeof fetch): Promise<T> {
  return (await readBody(await send(target, init, BUSY_RETRIES, fetchFn), init?.signal, (res) => res.json())) as T;
}
