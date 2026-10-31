import type { TerminalTheme } from "../../../term";
import { rowText, styleCss, type Row } from "../../../term/rows";
import styles from "./Rows.module.css";

/** Enough characters that one advance measures to well under a device pixel. */
const PROBE_CHARS = 100;

/**
 * Matches the DOM text's advance in `container` to the canvas cell. The renderer rounds its cell
 * to device pixels (WebGL floors it), while DOM text advances by the font's own fractional width,
 * so without this rows run wider than the canvas and drift a little more each column. `container`
 * must be laid out (in the document, not `display: none`), where its font applies.
 */
export function fitText(container: HTMLElement, cellWidth: number): void {
  const probe = document.createElement("span");
  probe.textContent = "W".repeat(PROBE_CHARS);
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;letter-spacing:0";
  container.append(probe);
  const advance = probe.getBoundingClientRect().width / PROBE_CHARS;
  probe.remove();
  if (advance > 0) container.style.letterSpacing = `${String(cellWidth - advance)}px`;
  container.style.setProperty("--cell-width", `${String(cellWidth)}px`);
}

/** Draws `row` into `element`: its runs as spans, a wide character in a box of two cells. */
export function drawRow(element: HTMLElement, row: Row, theme: TerminalTheme): void {
  if (row.runs.every((run) => !run.wide && Object.keys(run.style).length === 0)) {
    element.textContent = rowText(row);
    return;
  }
  element.replaceChildren(
    ...row.runs.map((run) => {
      const span = document.createElement("span");
      span.textContent = run.text;
      if (run.wide) span.className = styles.wide ?? "";
      const css = styleCss(run.style, theme);
      if (css) span.style.cssText = css;
      return span;
    }),
  );
}

/** A row as DOM text. The container sets `--cell-height`. */
export function rowElement(row: Row, theme: TerminalTheme): HTMLDivElement {
  const element = document.createElement("div");
  element.className = styles.row ?? "";
  drawRow(element, row, theme);
  return element;
}
