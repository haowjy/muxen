// The pure rules of touch text (client-architecture.md §7.6): the logical lines a selection copies, and how many
// characters the cursor crosses for a tap on the prompt row.
import { cellsOf } from "../term/rows";

/** Rows joined at their soft wraps: the text of each logical line. */
export function logicalLines(rows: readonly { text: string; wrapped: boolean }[]): string[] {
  const lines: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.wrapped && index > 0) lines[lines.length - 1] = (lines.at(-1) ?? "") + row.text;
    else lines.push(row.text);
  }
  return lines;
}

/**
 * How many characters the cursor crosses to move `cells` columns through `text`, the text on
 * one side of it (`edge` "end": the text before the cursor, moving left; "start": after it,
 * moving right). A character the move lands inside counts whole, as the shell moves by characters.
 */
export function charsAcross(text: string, cells: number, edge: "start" | "end"): number {
  const all = cellsOf(text);
  const span = edge === "end" ? all.slice(Math.max(0, all.length - cells)) : all.slice(0, cells);
  const crossed = span.filter((cell) => cell !== "").length;
  // Landing on the second half of a wide character crosses the first half too.
  return edge === "end" && span[0] === "" ? crossed + 1 : crossed;
}
