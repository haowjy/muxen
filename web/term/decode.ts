import { readRows } from "./lines";
import { parsingTerminal } from "./model";
import type { Row } from "./rows";

/**
 * tmux's history rows (`capture-pane -e`, one per physical row) as rows, decoded by xterm in a
 * Terminal of its own at the pane's width: one style, attribute and width rule for every row in the
 * list. Each row is written after a reset of its style, so none carries into the next, and a row
 * wraps when the one before it continued. Async because xterm parses writes asynchronously.
 */
export async function decodeChunk(rows: readonly { bytes: Uint8Array; continues: boolean }[], cols: number): Promise<Row[]> {
  // One row more than the chunk: the last row's line break must not scroll the first away.
  const term = parsingTerminal({ cols, rows: rows.length + 1, scrollback: 0 });
  const head = new TextEncoder().encode("\x1b[0m");
  const tail = new TextEncoder().encode("\r\n");
  const parts = rows.flatMap((row) => [head, row.bytes, tail]);
  const data = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    data.set(part, at);
    at += part.length;
  }
  await new Promise<void>((done) => { term.write(data, done); });
  const decoded = readRows(term.buffer.active, 0, rows.length, (y) => rows[y - 1]?.continues ?? false);
  term.dispose();
  return decoded;
}
