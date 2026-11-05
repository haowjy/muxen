import type { IconName } from "../../ui/primitives/Icon";

/** A file's glyph by its extension, then its type. Folders are the only coloured icons, so a file's says what kind it is. */
const BY_EXTENSION: Record<string, IconName> = {
  md: "fileText", markdown: "fileText", txt: "fileText", rst: "fileText",
  json: "fileData", jsonc: "fileData", csv: "fileData", xml: "fileData",
  toml: "fileConfig", yaml: "fileConfig", yml: "fileConfig", ini: "fileConfig", conf: "fileConfig", cfg: "fileConfig", env: "fileConfig",
  lock: "fileLock",
  sh: "fileScript", bash: "fileScript", zsh: "fileScript", fish: "fileScript",
  rs: "fileCode", ts: "fileCode", tsx: "fileCode", js: "fileCode", jsx: "fileCode", mjs: "fileCode", py: "fileCode", go: "fileCode",
  c: "fileCode", h: "fileCode", swift: "fileCode", css: "fileCode", html: "fileCode",
};

export function fileIcon(name: string, mime: string | null | undefined): IconName {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const byName = dot >= 0 ? BY_EXTENSION[lower.slice(dot + 1)] : undefined;
  if (byName) return byName;
  const type = mime ?? "";
  if (type.startsWith("image/")) return "fileImage";
  if (type.startsWith("video/")) return "fileVideo";
  if (type.startsWith("audio/")) return "fileAudio";
  if (type.startsWith("text/")) return "fileText";
  return type === "" ? "file" : "fileBinary";
}
