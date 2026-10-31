/**
 * Turns autocorrect off on a text field. It must be an attribute, never the JSX prop: Preact assigns
 * `autocorrect="off"` to WebKit's `autocorrect` property, which is a boolean, so "off" reads as true and
 * iOS gets autocorrect and its prediction row.
 */
export function autocorrectOff(el: HTMLElement | null): void {
  el?.setAttribute("autocorrect", "off");
}
