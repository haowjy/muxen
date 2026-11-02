// The terminal's selected text, one kind per environment, chosen once by `TerminalView`: the mark where the platform
// has an edit menu (the app), the DOM selection otherwise (a browser). Both are ranges over the row list's rows.

/** What a touch that begins while a selection is up means: nothing is up, the system's own (handles), the selection's menu, or a tap that closes it. */
export type TouchStart = "plain" | "handOver" | "toggle" | "dismiss";

export interface Selection {
  /** The selected range, cut to the rows, or null with none. */
  range(): Range | null;
  /** The selected text with soft wraps joined, one line per logical line; empty with none. */
  text(): string;
  /** What a touch that begins at the client point means. */
  touch(x: number, y: number): TouchStart;
  clear(): void;
}
