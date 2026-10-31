// The one parser for a saved workspace (browser-behaviors.md "Persistence and input"). Storage is a trust
// boundary: an older build wrote what comes back, so the adapters hand it over as `unknown`
// and every version decision lives here. Anything but the current version is discarded
// whole, never converted; drafts are keyed by tab key and are not this parser's to touch.
import { isTabKey, tabId } from "../platform/tabKey";
import type { FilesPlace, SavedTab, SavedWorkspace, SavedWorkspaces } from "../platform/types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

export function isPlace(v: unknown): v is FilesPlace {
  return isRecord(v) && (v["kind"] === "dir" || v["kind"] === "file") && isString(v["path"]);
}

function parseTab(v: unknown): SavedTab | null {
  if (!isRecord(v)) return null;
  if (v["kind"] === "terminal") return isTabKey(v["key"]) && isString(v["session"]) && isString(v["window"]) ? (v as unknown as SavedTab) : null;
  if (v["kind"] !== "files" || !isString(v["id"]) || !isString(v["host"])) return null;
  const place = isPlace(v["place"]) ? v["place"] : null;
  return place && { kind: "files", id: v["id"], host: v["host"], place };
}

/** A saved tab's id: a terminal tab has none of its own. */
export const savedTabId = (t: SavedTab): string => (t.kind === "terminal" ? tabId(t.key) : t.id);

const idOrNull = (v: unknown): string | null => (isString(v) ? v : null);

/** A workspace whose tabs all parse; a tab id seen twice keeps its first tab. */
function parseWorkspace(v: unknown): SavedWorkspace | null {
  if (!isRecord(v) || !isString(v["id"]) || !isString(v["host"]) || !Array.isArray(v["tabs"])) return null;
  const parsed = (v["tabs"] as unknown[]).map(parseTab);
  if (parsed.some((t) => t === null)) return null;
  const seen = new Set<string>();
  const tabs = (parsed as SavedTab[]).filter((t) => !seen.has(savedTabId(t)) && seen.add(savedTabId(t)));
  return { id: v["id"], host: v["host"], tabs, last: idOrNull(v["last"]), lastTerminal: idOrNull(v["lastTerminal"]), home: idOrNull(v["home"]) };
}

/** The current version, or null for anything else: an older version (one strip of tabs), or a record that is not saved workspaces. */
export function parseSavedWorkspaces(raw: unknown): SavedWorkspaces | null {
  if (!isRecord(raw) || raw["version"] !== 5 || !Array.isArray(raw["workspaces"])) return null;
  const parsed = (raw["workspaces"] as unknown[]).map(parseWorkspace);
  if (parsed.some((w) => w === null)) return null;
  const { hostName } = raw;
  const bellSeen = isRecord(raw["bellSeen"]) ? Object.fromEntries(Object.entries(raw["bellSeen"]).filter((e): e is [string, number] => Number.isInteger(e[1]))) : {};
  return { version: 5, workspaces: parsed as SavedWorkspace[], ...(isString(hostName) && { hostName }), bellSeen };
}
