// Path arithmetic on the daemon's `/`-separated canonical paths.

export const parentOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf("/")));
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || "/";
/** `path` lies under `folder`. */
export const under = (path: string, folder: string): boolean => path.startsWith(join(folder, ""));
/** `path` is `folder` or lies under it. */
export const within = (path: string, folder: string): boolean => path === folder || under(path, folder);
/** `path`, at or under `from`, with `from` now at `to`. */
export const moved = (path: string, from: string, to: string): string => to + path.slice(from.length);
export const join = (dir: string, name: string): string => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);
