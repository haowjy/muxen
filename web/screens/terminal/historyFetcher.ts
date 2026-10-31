// Older rows from tmux (touch-rows design.md, "Older rows from tmux"), without a DOM: the one procedure that both
// the history view (desktop) and the row list (phone) run to put rows above the ones they hold. A caller hands in
// a few rows it already has as an anchor and the tmux line the first of them should sit on; tmux's line numbers shift
// as it gains rows, so where the anchor lands in the chunk says how far. What a miss means is the caller's rule.
import type { HistoryRow } from "../../tabs/driver";
import { decodeChunk } from "../../term/decode";
import { rowText, type Row } from "../../term/rows";
import { locateRun } from "./anchor";

/** Rows per request ("about 200 lines a request"). */
export const CHUNK = 200;
/** A request that failed (the watch ended, or the daemon was busy) is not repeated sooner than this. */
const RETRY_MS = 1500;

export interface FetcherDeps {
  /** Rows `start..=end` of the tab on screen (tmux line numbers), or null with no live tab. */
  fetch(start: number, end: number): Promise<HistoryRow[]> | null;
  /** The pane's width in columns, which tmux's rows are laid out at. */
  cols(): number;
}

export interface Chunk {
  /** The chunk's rows, decoded: the rows above the anchor, then the anchor's own copy. */
  rows: Row[];
  /** The chunk as tmux sent it, for its soft-wrap flags. */
  fetched: HistoryRow[];
  /** Where the anchor starts in `rows`, or null when it is not there. With no anchor, where it would be. */
  found: number | null;
  /** The tmux line of the chunk's first row. */
  top: number;
}

export class HistoryFetcher {
  private generation = 0;
  private loading = false;
  private retryAt = 0;

  constructor(private readonly deps: FetcherDeps) {}

  /** No request is out and the last one did not fail just now. */
  get idle(): boolean {
    return !this.loading && performance.now() >= this.retryAt;
  }

  /** What was held no longer sits where it did (a snapshot, a tab change): a request in flight is dropped. */
  reset(): void {
    this.generation++;
    this.loading = false;
    this.retryAt = 0;
  }

  /**
   * The chunk of `CHUNK` rows ending where `anchor` ends, whose first row is expected on tmux line `line`.
   * Null when there is nothing to land: no live tab, the request failed, or `reset` came while it was out.
   */
  async load(anchor: readonly string[], line: number): Promise<Chunk | null> {
    const generation = this.generation;
    const end = line + anchor.length - 1;
    const pending = this.deps.fetch(end - CHUNK + 1, end);
    if (!pending) return null;
    this.loading = true;
    let fetched: HistoryRow[];
    try {
      fetched = await pending;
    } catch {
      if (generation === this.generation) {
        this.loading = false;
        this.retryAt = performance.now() + RETRY_MS;
      }
      return null;
    }
    if (generation !== this.generation) return null;
    const rows = await decodeChunk(fetched, this.deps.cols());
    if (generation !== this.generation) return null;
    this.loading = false;
    const expected = fetched.length - anchor.length;
    const found = anchor.length === 0 ? expected : locateRun(rows.map((row) => rowText(row).trimEnd()), anchor, expected);
    return { rows, fetched, found, top: end - fetched.length + 1 };
  }
}
