import { baseName } from "../files/paths";
import type { Tab } from "./state";

export interface TabLabel {
  /** Shown bold: a terminal tab's session, a Files tab's folder or file name. */
  session: string;
  /** The window a terminal tab shows now, shown in regular weight after the session, set apart by spacing alone. Empty for a Files tab. */
  window: string;
  /** The pill's tooltip and accessible name, and what a list row, the dock and a notice call the tab: the session, then its window (or "Files: " and the name). */
  full: string;
}

/**
 * The one name of a tab. The two parts are separate fields so a pill can truncate the window
 * name first and keep the session name. A workspace is one server's, so the label never names
 * the host. `home` is that server's home folder, once known: a Files tab there reads "~".
 */
export function labelOf(tab: Tab, home: string | null): TabLabel {
  if (tab.kind === "files") {
    const name = tab.place.path === home ? "~" : baseName(tab.place.path);
    return { session: name, window: "", full: `Files: ${name}` };
  }
  return { session: tab.session, window: tab.window, full: `${tab.session} ${tab.window}` };
}
