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
}

/** A row as DOM text. The container sets `--cell-height`. */
export function rowElement(row: Row, theme: TerminalTheme): HTMLDivElement {
  const element = document.createElement("div");
  element.className = styles.row ?? "";
  if (row.runs.every((run) => Object.keys(run.style).length === 0)) {
    element.textContent = rowText(row);
    return element;
  }
  for (const run of row.runs) {
    const span = document.createElement("span");
    span.textContent = run.text;
    const css = styleCss(run.style, theme);
    if (css) span.style.cssText = css;
    element.append(span);
  }
  return element;
}
