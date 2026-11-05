// The Files fixtures' file tree with content (platform/test/fs.ts is the listing; this adds
// what the viewers read).
import { HttpRefusal } from "../../net/http";
import type { FakeDaemon } from "../../platform/test";
import { FakeFs, serveFs, type FakeTree } from "../../platform/test/fs";

const README = `# muxen

Your tmux sessions, wherever you are.

## Building

\`\`\`sh
cargo build --release
pnpm --dir web install
\`\`\`

See [the design](docs/plan.md) and the [fs notes](docs/fs.md), or [the site](https://example.com).

- Small and bounded
- Private to the tailnet

<img alt="map" usemap="#m" src="shot.png"><map name="m"><area shape="default" href="https://evil.example/"></map>
<details><summary>more</summary>hidden</details>
<svg><a href="https://evil.example/"><text y="9">svg link</text></a></svg>
`;

const MAIN_RS = `use std::io;

/// Starts the daemon.
fn main() -> io::Result<()> {
    let name = "muxen";
    println!("starting {name}");
    Ok(())
}
`;

export const HOME = "/home/jimmy";
export const REPO = `${HOME}/muxen`;
export const UPLOADS = `${HOME}/.muxen-uploads`;
/** A folder outside $HOME, with a file in it. */
export const ETC = "/etc";

const MD = "text/markdown; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

/** A run's results, as a tool writes them: nested, with one long line, for the code view. */
const BENCH_JSON = `${JSON.stringify({
  run: "2026-11-05T14:02:11Z",
  host: "pop-os",
  command: "cargo run --release -- bench --host pop-os --sessions 12 --windows-per-session 4 --duration 60s --output-rate 2MiB/s --report bench-results.json",
  tmux: { version: "3.8", socket: "/tmp/tmux-1000/default", control_clients: 1 },
  budget: { rss_mib_cap: 64, cpu_pct_cap: 5, note: "Caps from config.toml [limits]; the run fails if the daemon exceeds either for more than 5 consecutive samples." },
  summary: { rss_mib: { p50: 21.4, p95: 23.9 }, cpu_pct: { p50: 1.2, p95: 2.8 }, dropped_frames: 0 },
  sessions: [{ name: "muxen", windows: 4, attached: true, echo_ms: { p50: 10, p95: 14 } }, { name: "notes", windows: 4, attached: false, echo_ms: null }],
}, null, 2)}\n`;

const ago = (seconds: number): number => Math.floor(Date.now() / 1000) - seconds;
const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;

export function filesTree(): FakeTree {
  const extra = Array.from({ length: 12 }, (_, i) => `${REPO}/notes/note-${String(i + 1).padStart(2, "0")}.txt`);
  return {
    stats: {
      [`${REPO}/src`]: { mtime: ago(2 * HOUR) },
      [`${REPO}/docs`]: { mtime: ago(43 * MIN) },
      [`${REPO}/notes`]: { mtime: ago(6 * DAY) },
      [`${REPO}/empty`]: { mtime: ago(120 * DAY) },
      [`${REPO}/.git`]: { mtime: ago(12 * MIN) },
      [`${REPO}/README.md`]: { size: 6020, mtime: ago(7 * DAY) },
      [`${REPO}/Cargo.toml`]: { size: 1488, mtime: ago(20 * HOUR) },
      [`${REPO}/bench-results.json`]: { size: BENCH_JSON.length, mtime: ago(28 * MIN) },
      [`${REPO}/src/main.rs`]: { size: 3120, mtime: ago(2 * HOUR) },
      [`${REPO}/shot.png`]: { size: 412_330, mtime: ago(3 * HOUR) },
      [`${REPO}/demo.mp4`]: { size: 48_300_000, mtime: ago(3 * DAY) },
      [`${REPO}/muxen.bin`]: { size: 14_890_112, mtime: ago(2 * HOUR) },
      [`${REPO}/.env`]: { size: 214, mtime: ago(40 * DAY) },
    },
    home: HOME,
    dirs: ["/", "/home", ETC, HOME, REPO, `${REPO}/src`, `${REPO}/docs`, `${REPO}/notes`, `${REPO}/.git`, `${REPO}/empty`, `${HOME}/notes`, UPLOADS, `${HOME}/other`, `${HOME}/other/deep`, `${HOME}/.config`],
    files: {
      [`${REPO}/README.md`]: MD,
      [`${REPO}/Cargo.toml`]: TEXT,
      [`${REPO}/bench-results.json`]: TEXT,
      [`${REPO}/src/main.rs`]: TEXT,
      [`${REPO}/docs/plan.md`]: MD,
      [`${REPO}/docs/fs.md`]: MD,
      [`${REPO}/shot.png`]: "image/png",
      [`${REPO}/demo.mp4`]: "video/mp4",
      [`${REPO}/muxen.bin`]: "application/octet-stream",
      [`${REPO}/.env`]: TEXT,
      [`${ETC}/hosts`]: TEXT,
      [`${UPLOADS}/20261022-101010Z-abcd.jpg`]: "image/jpeg",
      ...Object.fromEntries(extra.map((path) => [path, TEXT])),
    },
  };
}

/**
 * A home folder for finding folders by path: a project folder (`~/repos/muxen`) inside a `~/repos` that
 * holds more, a folder of twenty subfolders (three pages), and ones to refuse, hang on and cap.
 */
export const FIND_ROOT = `${HOME}/repos/muxen`;
export function findTree(): FakeTree {
  const many = Array.from({ length: 20 }, (_, i) => `${HOME}/repos/many/folder-${String(i + 1).padStart(2, "0")}`);
  return {
    home: HOME,
    dirs: [
      "/", "/home", HOME, `${HOME}/repos`, FIND_ROOT, `${FIND_ROOT}/src`, `${FIND_ROOT}/web`, `${FIND_ROOT}/docs`, `${FIND_ROOT}/empty`, `${FIND_ROOT}/.git`, `${FIND_ROOT}/web/src`,
      `${HOME}/repos/muxen-old`, `${HOME}/repos/test-data`, `${HOME}/repos/zebra`, `${HOME}/repos/many`, ...many,
      UPLOADS, `${HOME}/other`, `${HOME}/other/deep`, `${HOME}/.config`,
    ],
    files: {
      [`${FIND_ROOT}/README.md`]: MD,
      [`${FIND_ROOT}/Cargo.toml`]: TEXT,
      [`${HOME}/repos/notes.txt`]: TEXT,
      [`${UPLOADS}/20261022-101010Z-abcd.jpg`]: "image/jpeg",
    },
  };
}

/** A folder of 3 subfolders and 450 files, over the daemon's page of 200: Show more, and narrowing what is loaded. */
export const BIG = `${HOME}/big`;
export const BIG_PAGE = 200;
export function bigTree(): FakeTree {
  const files = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`${BIG}/file-${String(i + 1).padStart(3, "0")}.txt`, TEXT]));
  return { home: HOME, dirs: ["/", "/home", HOME, BIG, `${BIG}/alpha`, `${BIG}/beta`, `${BIG}/gamma`, `${HOME}/other`], files: { ...files, [`${BIG}/zeta-notes.md`]: MD } };
}

const CONTENT: Record<string, string> = {
  [`${REPO}/README.md`]: README,
  [`${REPO}/Cargo.toml`]: '[package]\nname = "muxen"\nversion = "0.1.0"\n',
  [`${REPO}/src/main.rs`]: MAIN_RS,
  [`${REPO}/bench-results.json`]: BENCH_JSON,
  [`${REPO}/docs/plan.md`]: "# Plan\n\nThe product and UX spec.\n",
  [`${REPO}/docs/fs.md`]: "# File API\n\nListing, raw reads.\n",
  [`${REPO}/.env`]: "TOKEN=hidden\n",
};

/** The file tree with content for the viewers. Images are served by the harness's dev server (vite.config.ts). */
export class FilesFs extends FakeFs {
  /** Paths whose listing is refused, for the error state. */
  denied = new Set<string>();
  /** Paths whose listing never answers, for the loading state. */
  hanging = new Set<string>();
  /** Paths the network drops, for the offline state. */
  unreachable = new Set<string>();
  /** Paths whose listing the daemon says it cut short at its scan cap. */
  capped = new Set<string>();

  override async list(path: string, offset: number, hidden: boolean): ReturnType<FakeFs["list"]> {
    return this.guarded(path, await super.list(path, offset, hidden));
  }

  private guarded<T extends { truncated: boolean }>(path: string, listing: T): Promise<T> {
    if (this.denied.has(path)) return Promise.reject(new HttpRefusal(403, "denied"));
    if (this.unreachable.has(path)) return Promise.reject(new TypeError("Failed to fetch"));
    if (this.hanging.has(path)) return new Promise(() => undefined);
    return Promise.resolve(this.capped.has(path) ? { ...listing, truncated: true } : listing);
  }

  override text(path: string): Promise<{ text: string; size: number; truncated: boolean }> {
    const text = CONTENT[path] ?? `${path.split("/").pop() ?? path}\n`;
    return Promise.resolve({ text, size: text.length, truncated: false });
  }
}

/** Serves a tree over the fake daemon's `/fs` routes; the real app browses it through its own HTTP client. */
export function serveTree(daemon: FakeDaemon, tree: FakeTree = filesTree(), configure?: (fs: FilesFs) => void, page = 8): void {
  const fs = new FilesFs(tree, page);
  configure?.(fs);
  daemon.fs = serveFs(fs);
}
