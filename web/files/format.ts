/** 1536 → "1.5 KB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n < 10 ? n.toFixed(1) : String(Math.round(n))} ${units[unit] ?? "TB"}`;
}

export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** `/home/j/repo` → `~/repo`: how every Files path reads and copies (Insert sends the absolute one). */
export function shorten(path: string, home: string | null): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

/** One short form for every age, so a column of them lines up: `12m`, `3h`, `6d`, `4mo`, `2y`. `now` in ms. */
export function formatAge(unixSeconds: number, now: number): string {
  const minutes = Math.max(0, Math.round((now / 1000 - unixSeconds) / 60));
  if (minutes < 60) return `${String(Math.max(1, minutes))}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${String(days)}d`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${String(months)}mo`;
  return `${String(Math.round(days / 365))}y`;
}
