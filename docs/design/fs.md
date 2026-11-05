# File API: listing, search, raw reads, uploads

`src/fs/` serves the phone's file manager: directory listings, file bytes with Range
for the viewers and the native video player, and uploads. It reads and, for an upload that names a folder, writes any path the daemon's user can: there is no scope.
A device token already runs any command in tmux as Jimmy, so a boundary here would
guard against nothing but Jimmy. Every path the file API touches passes through one
function, `fs::open`, which canonicalizes the path and returns an open descriptor with
the path it was really opened at. No route opens a client's path any other way.

The product side (what the file manager shows, viewers, photo → terminal) is in
[plan.md](plan.md#file-manager); the scheme handler and native player that carry these
routes to the web are in [ios-shell.md](ios-shell.md#where-the-web-ui-comes-from);
auth is [auth.md](auth.md). Decisions and the alternatives rejected are in
[decisions.md](decisions.md#file-api).

## Constants

| Constant | Value | When hit |
|---|---|---|
| listing page | 200 entries | the client asks for the next `offset` |
| directory scan | 5,000 entries read or 1 MiB of names, whichever first; every entry read counts, hidden ones included | `truncated: true`; the rest isn't listed |
| scans at once | 1 | wait |
| search walk | 100,000 entries read or 500 ms, whichever first; every entry read counts | `stopped` says which; the matches so far are answered |
| search queue | 1 MiB of relative paths still to read, offsets counted | stops queueing; `stopped: "queue"` |
| searches at once | 1, its own slot | wait |
| search matches | 50 | the best 50 by score |
| search query | 256 bytes | `400 bad_request` |
| raw responses at once | 2 | wait |
| uploads at once | 1 | `503 busy` at once |
| fs lane | 4 of the runtime's 8 blocking threads; includes scan, search and raw-response slot waits | wait up to 10 s |
| fs lane waiters | 8 across all fs slots and blocking calls | `503 busy` at once; timed-out requests get `Retry-After: 1` |
| raw read and upload write chunk | 64 KiB | |
| raw stall deadline | 30 s for the socket to take the next chunk | the response is aborted, its slot freed |
| upload size | 128 MiB | `413 too_large`; the partial file is deleted |
| upload idle timeout | 30 s waiting for a body byte | aborted with `400 bad_request`; the partial file is deleted |
| upload flush | every 2 MiB: `fdatasync`, then drop the written pages | the dirty pages in between are charged to the unit, and the [ceiling](#limits-and-the-memory-ceiling) counts them |
| page drop during a raw read | files over 8 MiB: after each chunk, everything from the response's first byte to the current position | |
| socket buffers, every accepted socket | `SO_SNDBUF` and `SO_RCVBUF` 64 KiB (Linux doubles them); Serve reaches the daemon over a local Unix-socket hop, not another network round trip | the writer waits |
| path in a request | 4,096 bytes, UTF-8, absolute or `~`-prefixed, no NUL | `400 bad_request` |

## The uploads folder

An upload that names no folder goes to `uploads_dir` in `config.toml` (default `~/.muxen-uploads`), absolute or
starting with `~/`. A missing absolute path is created by the next upload; one that is
neither absolute nor `~/` makes every upload answer `409 not_a_directory`. There are no
favorites. `uploads_dir` is edited by hand or from Settings, through the one route that writes
`config.toml` ([Server settings](#server-settings)).

An upload may instead name a folder ([`dir`](#post-fsupload)): Files' Paste writes into the
folder it shows. Those folders are any path the daemon's user can write, which adds writes
to the reads that already had no scope; the single-device-token argument above covers it
([decisions.md](decisions.md#paste-into-an-open-folder-2026-11-02)). `uploads_dir` is only
the default, for the terminal's pasted images and Files' Upload.

**`config.toml` is read once, at startup, and again only on a reload**, as nginx and sshd do. The
daemon holds the live keys (`uploads_dir`, `search_skip`) in memory; uploads and search read that copy,
never the file. A **reload** is SIGHUP (`systemctl --user reload muxen`, the unit's `ExecReload`) or
Settings' **Reload config.toml** (`POST /settings/reload`). It reads and parses the whole file first:
if it doesn't parse, nothing changes, the running config stays, and the error is logged at `warn` and
answered (`503 config_unavailable` with the parser's line and column in `detail`). If it parses, the
live keys take the new values at once, and a restart-only key that differs from the running value
(`name`, `memory_budget_mib`, `[tmux]`, `[complete]`) is reported, not applied: logged, and listed in
the answer's `restartNeeded`. A Settings save writes the file and then updates the copy in memory, so
its change needs no reload. A hand edit does nothing until a reload; the file and the running config
can differ until then, and Settings shows the running values with "config.toml has changed since it
was loaded" and the Reload button when the file's `files::Stamp` differs from the one last loaded or
written. Listing and raw reads don't use the config.

## Path resolution: `fs::open`

```text
fs::open(path: &str, home: &Path, want: Want) -> Result<Opened, FsError>
fs::open_absolute(path: &str, want: Want) -> Result<Opened, FsError>   // path already absolute
Want   = Dir | File
Opened = { file: File, path: String /* canonical */, meta: Metadata }
```

A third `Want`, `Parent`, belongs to v2's writes ([below](#v2-what-this-must-not-preclude))
and doesn't exist yet. `open` runs on the fs lane (the dir lane for completion
listings), and does, in order:

1. **Shape.** `path` must be absolute, or `~` or start with `~/`, which is the daemon user's
   `$HOME` (`fs::expand`, as `uploads_dir` uses; `open` is `expand` then `open_absolute`, the one open path); at most 4,096 bytes and free of NUL; otherwise
   `bad_request`. The client learns the canonical home from a listing of `~`, whose `path` is
   canonical: Open files lists `~` anyway, so knowing home costs no request of its own. Paths on the wire are UTF-8 strings, so a non-UTF-8 name can't be
   requested ([listing](#get-fslistpath)).
2. **Canonicalize** with `realpath`: every symlink and every `..` is resolved against
   the real tree, so `..` needs no lexical rule and a symlink is followed like any
   path (the terminal follows it too). A missing path is `not_found`. A canonical path
   that isn't UTF-8 (a link to a non-UTF-8 name) is `bad_request`.
3. **Open** the canonical path, after an `lstat` of it refuses any kind but a regular
   file or directory (`not_a_file` / `not_a_directory`) so no device is opened, with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC |
   O_NOCTTY`, plus `O_DIRECTORY` for `Dir`. `O_NONBLOCK` keeps a FIFO from blocking
   the thread. `fstat` then refuses anything but a regular file for `File`
   (`not_a_file`) or a directory for `Dir` (`not_a_directory`). `ELOOP` here means
   the last component became a symlink after step 2: `not_found`.
4. **Read the descriptor's real path** (`readlink /proc/self/fd/N` on Linux,
   `rustix::fs::getpath` on macOS). `Opened.path` is that path, so a component swapped
   for a symlink between steps 2 and 3 is reported where the file actually is, and the
   listing's `path` and `parent` are the real ones.

Callers get the descriptor, never a path to open again: listings read the directory
through it, raw reads `pread` it, uploads create files relative to it.

**`newWindow` and `newSession` `dir` use `fs::check_dir`**, not `open`: tmux runs as
Jimmy, and the web's start-directory prompt offers the tab's cwd or any typed path.
The connection calls it on the dir lane, with a 300 ms wait: step 1's shape rules, then `stat` (following links) must find a directory. It passes `dir` to tmux as given, so
the shell shows the path Jimmy chose. A refusal is `error { req, code: badRequest,
message }`, the message naming the cause ("not an absolute path", "no such
directory"). It reads no config, so a broken `config.toml` never blocks a new window.

## Routes

Every route sits in the `devices` router in `src/http/`, behind both auth layers
([auth.md](auth.md#endpoints)). A path rides in the URL path, not the query:
`/fs/raw/home/jimmy/repo/clip.mov`. The client percent-encodes each segment and joins
them with `/`; the daemon decodes and prepends `/`. `~` and `~/…` ride bare after the route's own `/`
(`/fs/list/~`) and keep no leading `/`. `{*path}` doesn't match an empty path, so `/fs/list/` is registered as its own route,
listing `/`. The
native player then sees the file's extension in the URL, and the Markdown viewer
resolves a relative `![](img.png)` against the document's own raw URL. A path that
doesn't decode, or a bad query value, is answered as `400 bad_request` in the JSON
error shape (handlers take `Result<Path<…>, PathRejection>`, as `enroll.rs` does for
`Json`). Queries need axum's `query` feature.

### `GET /fs/list/{*path}`

Query: `offset` (default 0), `hidden=0|1` (default 0). `fs::open(…, Dir)` on any
directory, `/` included, then one
scan of the directory through its descriptor, holding the scan slot:

- Read names and `d_type` up to the scan cap, dropping `.` and `..` and, unless
  `hidden=1`, every name starting with `.`. The cap counts every entry read, the
  dropped ones too, so a directory full of dotfiles is cut off as a full one is and one
  page's cost stays bounded. `fstatat` (following links) only the
  entries whose `d_type` is `DT_LNK` or `DT_UNKNOWN`, so a symlinked directory sorts as
  a directory. Past the cap the scan stops and the response says `truncated`: the
  directory is too big for the phone, and the terminal is the tool for it.
- Sort: directories first, then by name with ASCII case folded, ties by bytes.
- Take `[offset, offset + 200)` and `fstatat` those entries for size and time.

```text
Listing = { path: string,            // canonical
            parent: string | null,   // null only at "/"
            total: u32, offset: u32, truncated: bool,
            entries: [Entry] }
Entry   = { name: string,
            kind: "dir" | "file" | "other" | "broken",  // after following a link
            link: bool,              // the entry itself is a symlink
            size?: u64,              // files
            mtime?: i64,             // unix seconds; absent for "broken"
            mime?: string,           // files: the type /fs/raw would send
            utf8?: false }           // present only for a non-UTF-8 name
```

- **Paging** is by offset over a fresh scan: the daemon keeps no cursor or listing
  between requests. If the directory changes between pages an entry can repeat or be
  skipped; pull-to-refresh starts over (no file watcher).
- **Symlinks** show their target's kind, size and mtime and are marked `link`. Opening
  one follows it like any path.
- **Non-UTF-8 names** are listed with U+FFFD in place of bad bytes and `utf8: false`;
  the web shows them greyed and not openable, since their path can't be sent back.
- **Hidden files:** dotfiles are left out unless `hidden=1`, which the file manager's
  toggle sets. A hidden directory opened by path lists normally. `.gitignore` rules
  are v2 (repo-viewer parity, [plan.md](plan.md#file-manager)).

### `GET /fs/search/{*path}`

Query: `q` (required, 1 to 256 bytes, not only spaces), `hidden=0|1` (default 0); `/fs/search/`
searches `/`. Files' Search: the files and
folders below a folder whose path, relative to it, matches `q`. `fs::open(…, Dir)` on the root, then
one **walk** that streams every entry it reads through the matcher and keeps only the best 50.
Nothing is kept between requests. The client sends the query once typing pauses 250 ms and aborts a
request it no longer needs ([browser-behaviors.md](client/browser-behaviors.md#files)).

**The walk** is breadth first, with one directory open at a time:

- A queue holds the directories still to read, as paths relative to the root. The walk opens the
  next one relative to the root's descriptor (read with `Dir::new` on that descriptor, never a copy
  of it), streams its names and `d_type` through the matcher,
  queueing its subdirectories as it goes, and closes it. At most two descriptors are open (the root and the one being read; three for a cache-tag probe), whatever
  the depth, and a capped walk has covered everything down to some depth, so a short path under the
  root is never missed for a deep one.
- **Opening** refuses symlinks in every component and never leaves the root's filesystem: on Linux
  `openat2(root, rel, O_DIRECTORY | O_CLOEXEC, RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS |
  RESOLVE_NO_XDEV)`, which refuses a same-device bind mount too (where `openat2` answers `ENOSYS`,
  before Linux 5.6, the walk falls back to `openat` with `O_NOFOLLOW` and the device check below); on macOS `openat(root, rel, O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW_ANY)` and an
  `fstat` whose device must equal the root's. A symlinked directory is matched but never entered, so
  there are no cycles, and no walk wanders into `/proc`, a network mount or another disk. An
  entry whose relative path would pass 4,096 bytes with the root's is neither matched nor queued:
  no route could open it.
- **Kinds:** names and `d_type` only; `fstatat` (not following, relative to the folder being read) is
  called only for a `DT_UNKNOWN` entry, as listings do, so a filesystem without `d_type` is still walked.
- **Skipped:** every name starting with `.` unless `hidden=1` (so `.git`, `.cache` and `.venv` too);
  any directory whose name matches one of the server's **search skip patterns**
  ([Server settings](#server-settings); default `node_modules`); and any directory below the root tagged as a cache
  under the [Cache Directory Tagging spec](https://bford.info/cachedir/): it holds a regular file
  `CACHEDIR.TAG` whose first 43 bytes are `Signature: 8a477f597d28d172789f06886806bc55` (cargo's `target/`,
  pip's and ccache's caches, the convention `tar --exclude-caches` and backup tools follow). Before
  reading a directory below the root, the walk tries `openat(dir, "CACHEDIR.TAG", O_RDONLY | O_NOFOLLOW |
  O_NONBLOCK | O_CLOEXEC | O_NOCTTY)` on its descriptor (a third descriptor, for that moment). `ENOENT`,
  the usual answer, costs one lookup (0.9 µs warm on macOS). Any other error means no tag. On success
  `fstat` must find a regular file, and the read loops until 43 bytes or end of file; only an exact
  signature is a tag, and the directory then isn't read. **A skipped directory is listed, not entered**,
  by either rule: its own entry, read in its parent, is matched like any other, so Search can find
  `node_modules` or `target` and a tap goes into it (where, as the root, nothing is skipped). The probe
  leaves a negative dentry per directory, kernel memory charged to the unit but reclaimable, like page
  cache. A pattern is a folder name or a glob with `*` and `?` over the name alone,
  compared exactly (no case folding); `[` and every other character are literal. The root itself is never skipped, whatever its name. Non-UTF-8 names are
  neither matched nor entered (their path can't be sent back).
- **Errors below the root** (`EACCES`, `ENOENT` from a folder deleted mid-walk, `ELOOP`, `ENOTDIR`,
  `EXDEV`, an `EIO` from `getdents`) skip that directory. Only an error on the root fails the request.
- **Caps:** 100,000 entries read or 500 ms of wall time, whichever comes first; every entry read
  counts, skipped ones too. The walk then answers what it matched and `stopped` names the cap. The
  queue is one byte buffer of relative paths with their offsets, capped at 1 MiB with the offsets
  counted; when it is full the walk stops queueing, keeps reading what is queued, and answers
  `stopped: "queue"`. The deadline and the cancel flag are checked every 1,024 entries and
  between directories; one stalled filesystem call can't be interrupted.
- **Host cost:** measured on pop-os, warm, through the route, with these skip rules: a 67,000-entry
  repo (`hidden=1`) walks in 60 to 73 ms, and 100,000 entries of `~` or `~/gitrepos` take 75 to 140 ms
  of one core unconstrained, 180 to 330 ms under the unit's `CPUQuota=50%`. The cache-tag probe is
  about 1 µs a directory there: 6 to 8 ms of the repo's walk (6,400 directories), 5 to 25 ms of a
  100,000-entry one, most where `hidden=1` opens more folders. A cold walk wasn't measured (dropping
  the caches needs root). That is the
  bound per settled query, shared with the rest of muxen inside the unit's quota. The walk doesn't
  change its thread's priority: an unprivileged thread can't lower its nice again (`RLIMIT_NICE` is
  0), so a lane thread would stay deprioritised for every later listing.
- **The slot** is the search slot, its own, so a listing never waits behind a walk. Its permit moves
  into the lane closure with the walk, as the raw producer's does: it is freed when the walk ends, not
  when the request does, so aborted searches never overlap.
- **Cancel:** the handler holds a guard that sets a flag when the response future is dropped (the
  client aborted or went away); the walk sees it at its next check and stops.

**Matching** works on the relative path's Unicode scalar values (`/`-separated, the root's own name
not included). Case is folded for ASCII letters only, and only while `q` has no ASCII uppercase
letter (smart case); other scalars match exactly. Names are not Unicode-normalised, so an NFD name
doesn't match an NFC query.

- **`q` containing `*` or `?` is a glob** (Jimmy chose "glob when `*`/`?` typed"). `*` matches any
  run within one segment, `?` one scalar within a segment,
  `**` matches any run of whole segments, zero included (`src/**/main.rs` matches `src/main.rs`); a
  `**` not bounded by `/` or the pattern's ends is a `*`. `[` and every other character are literal;
  there is no escape. A pattern with no `/` is matched, anchored at both ends, against the
  last segment; one with `/`, anchored, against the whole relative path. The matcher is the
  iterative one with two backtrack points (one for `*`, one for `**`), linear-time in practice and
  never recursive. A glob match's `hits` are the runs its literal characters matched. Glob matches
  rank by depth, then the last segment with ASCII case folded, then bytes.
- **Anything else is fuzzy.** `q` is split on spaces into terms (a trailing space is ignored); every
  term must appear in the path as a subsequence. Each term is aligned first within the last segment
  and only then across the whole path. The alignment is fzf's v1: the leftmost forward subsequence
  match, then a backward pass from its end that tightens it to the shortest window. The score adds,
  per matched scalar, a bonus at a segment or word start (after `/`, `_`, `-`, `.` or a space, or a
  lowercase-to-uppercase change), a bonus for following the previous matched scalar, a bonus for
  matching in the last segment, and subtracts the gaps between matched scalars.
  Terms are matched independently and in any order, and may share scalars; the path's score is the
  sum of its terms' scores less a fixed amount per folder level, counted once, so nearer files rank
  first; the terms' hit runs are merged. Score only depends on `q` and the
  path; ties go to the shorter path, then bytes. Positions are computed again for the final 50 only,
  so the walk keeps scores, not hits. The cost is linear
  in the path per entry, and only paths that pass the subsequence check are scored.
- The best 50 are kept in order as the walk goes (a sorted list of at most 50: an entry that can't
  beat the 50th costs one comparison), then `fstatat` (following links) is called on
  those 50 only, so a result means what a listing entry means.

```text
Search  = { path: string,                    // canonical root
            matches: [Match],                // best first, at most 50
            read: u32,                       // entries read
            stopped: "entries" | "time" | "queue" | null }   // null: the walk covered everything
Match   = Entry & { path: string,            // relative to the root, "/"-separated
                    hits: [[u16, u16]] }     // [start, end) runs of matched text, in UTF-16 code units
```

`Match` carries a listing's [`Entry`](#get-fslistpath) fields (`name`, `kind` after following,
`link`, `size`, `mtime`, `mime`), so the client opens a result as it opens a row. Its absolute path is
the root's path, `/` (unless the root is `/`), and `path`. The client draws `hits` and never matches
again, so the matcher lives in one place; `hits` are UTF-16 runs because that is how a JS string is
indexed. An answer is at most 50 entries, a few KiB: a search costs the host's walk, not the network.

### `GET /fs/raw/{*path}`

`fs::open(…, File)` on any file, then the bytes, holding a raw-response slot. A directory, FIFO,
socket or device is `409 not_a_file`; the file manager's web code expects that answer
when a link leads to a folder. A producer task
`pread`s 64 KiB chunks from the descriptor (each on the fs lane)
into a channel of capacity 1 that feeds the response body. If a send waits past the
stall deadline (a paused player, a sleeping phone), the producer drops the channel
with an error, which aborts the response and frees the slot. For a file over 8 MiB,
after each chunk the producer calls `posix_fadvise(DONTNEED)` on **everything from the
response's first byte to the current position**, not on the chunk alone, so streaming
a video doesn't fill the unit's page cache; smaller files keep theirs, which other
processes (a build reading the same source) may be using. The range must reach back
to the start because the kernel reads ahead in large folios, and a folio that extends
past a 64 KiB range survives a drop of that range (a per-chunk drop left a whole
1 GiB download cached on Linux 7.1, ext4). It stops at the current position, not the
end of the file: dropping ahead would evict the readahead and read it twice. The drop
is Linux-only and a no-op elsewhere. Use std file calls through the fs lane, never
`tokio::fs::File`, whose buffer grows to 2 MiB. All blocking work goes through `src/blocking.rs`; Tokio's `fs` feature is
disabled.

| Header | Value |
|---|---|
| `Content-Type` | from the extension table below |
| `ETag` | strong: `"<ino>-<size>-<mtime_ns>"` in hex, from `files::Stamp` of the `fstat` at open |
| `Accept-Ranges` | `bytes` |
| `Cache-Control` | `no-store` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `sandbox` |

The daemon sets `nosniff`, `sandbox`, `no-store` and same-origin CORP itself, because
the native player fetches without the scheme handler. The browser shell and raw
responses share one origin, so the web reads `Content-Range` and `ETag` directly; the
daemon sends no CORS headers. CORP prevents another origin from embedding a raw
response, while `no-store` prevents private file bytes being retained by an HTTP
cache. `sandbox` and non-executable MIME types keep repository content from running
as muxen or registering as its service worker.

- **Range:** one range only, `bytes=a-b`, `bytes=a-` or `bytes=-n` → `206` with
  `Content-Range`. A range list, or a header that doesn't parse, is ignored → `200`
  with the whole file (RFC 9110 allows it). A range starting at or past the end →
  `416 bad_range` with `Content-Range: bytes */<size>`. An end past the end is
  clamped.
- **`If-Range`** not equal to the ETag → the Range is ignored (`200`). There is no
  `304`: nothing on the phone caches these responses.
- **A file that changes while it is sent:** `Content-Length` comes from the `fstat` at
  open and the body sends exactly that many bytes. If the file shrinks under the
  stream, the response is aborted rather than cut short.
- **Two slots are enough for the web:** it loads images (the image viewer, a
  Markdown document's images) through a queue of 2, so a document with many images
  never meets `busy`; `<img>` doesn't retry.
- **Text previews:** the code and Markdown viewers read at most the first 1 MiB with
  Range and say the file is truncated; the binary viewer offers "open as text" the
  same way for `application/octet-stream`.

**Content types.** One table in `src/fs/mime.rs`, by lowercased extension, plus a few
whole names (`Makefile`, `Dockerfile`, `LICENSE`, `README`). It is an allowlist of the
types the viewers need, and **it sends nothing a browser runs**.

| Kind | Types |
|---|---|
| images | `image/png`, `jpeg`, `gif`, `webp`, `heic`, `heif`, `avif`, `bmp`, `x-icon`, `svg+xml` |
| video, audio | `video/mp4` (`mp4`, `m4v`), `video/quicktime` (`mov`), `audio/mpeg`, `audio/mp4`, `audio/wav` |
| Markdown | `text/markdown; charset=utf-8` |
| code and text | `text/plain; charset=utf-8` for every source, config, data and markup extension, **`html`, `htm`, `xhtml`, `js`, `mjs`, `css` and `xml` included** |
| PDF | `application/pdf` (viewer in v2) |
| anything else | `application/octet-stream` |

The web picks a code viewer's language by extension, not by type. SVG goes out as
`image/svg+xml` for `<img>`, which runs no script.

**Video** plays in `AVPlayerViewController`, not the web view
([ios-shell.md](ios-shell.md#web-content-security)): the web sends `playVideo { host,
path }`, native builds `{baseURL}/fs/raw/{encoded path}` with the same segment
encoding and opens it with `Authorization: Bearer`. AVFoundation probes with `Range:
bytes=0-1`, then reads ranges; it needs the `206`s, an exact `Content-Type` (`nosniff`
stops it guessing), and an ETag that stays put while the file does.

### `POST /fs/upload`

`POST /fs/upload?name=<the client's file name>[&dir=<folder>][&text=1]`; the body is the
file's bytes, not multipart or JSON. `dir` is `~`, `~/…` or an absolute path to an
existing folder, resolved by `fs::open(…, Dir)` (a missing one is `404 not_found`, a file
`409 not_a_directory`, a relative path `400 bad_request`); absent, the folder is
`uploads_dir`, as step 2 says. `text=1` says the body is pasted text: the file is named
`pasted-YYYYMMDD-HHMMSSZ.txt`, then `…-2.txt`, `…-3.txt` on a clash, and `name` is ignored. axum's default body limit is off on this route; the handler checks
the cap against `Content-Length` up front, when sent, and against the running count.

1. Take the upload slot (none free: `503 busy` at once).
2. Without `dir`: create `uploads_dir` (0700) if missing, then resolve it and `fs::open(…, Dir)`
   it, so a directory that didn't exist when the config was read still counts. An `uploads_dir` that can't be resolved to a directory (neither absolute
   nor `~/`, or not a directory) answers `409 not_a_directory`.
   On Linux, `fstatfs` on the opened directory descriptor rejects tmpfs and ramfs with
   `409 memory_backed` before a `.part` file is created (a `dir` too). A folder the user
   can't write is `403 denied`, and nothing is created. On macOS there is no cgroup
   memory limit, so this filesystem-type refusal is not applied.
3. Name the file `YYYYMMDD-HHMMSSZ-xxxx.<ext>`: UTC (no time-zone crate), 4 random
   base32 characters, and the extension of `name`, lowercased, if it is 1 to 8 ASCII
   alphanumerics, else `bin`. Nothing else of `name` is used, so it can't carry a
   path, a shell metacharacter or a hidden name into the folder.
4. Clear the record of a part file a dead daemon left and delete that file (see below), record the new part file's path, then create `.muxen-upload-<random>.part` relative to the directory's descriptor with
   `O_CREAT | O_EXCL | O_NOFOLLOW`, mode 0600 (never executable). Write each body chunk
   on the fs lane. Every 2 MiB, `fdatasync` and
   `posix_fadvise(DONTNEED)` what was written, so the upload's dirty pages stay small
   on a disk the unit reaches at idle I/O priority. Dirty pages can't be reclaimed
   until they are written, so the 2 MiB between flushes is memory the unit holds: the
   [ceiling](#limits-and-the-memory-ceiling) counts it. The flush is the one wait without
   a deadline: on a slow disk it slows the upload to the disk's pace, holding the
   upload slot and one fs slot, which is the backpressure wanted. The idle timeout
   counts only time spent waiting for the body, not time spent writing.
5. At the end of the body, rename the part file to the final name relative to the same
   descriptor without replacing (`renameat2 RENAME_NOREPLACE` on Linux,
   `renamex_np RENAME_EXCL` on macOS, both `rustix::fs::renameat_with`); on a clash,
   a new suffix and retry. A filesystem that lacks the no-replace flag has no
   fallback: the rename fails, the part file is deleted and the answer is `500
   internal`, since a check-then-rename could replace a file. No final `fsync`: a photo
   lost to a power cut is re-sent.

If cleanup cannot get a thread from the fs lane, or the daemon dies mid-upload, a `.part`
file is left behind. At most one part file exists at a time, so the daemon records it:
**`upload-part` in the state directory holds the in-flight part file's absolute path**,
written before the part file is created. The upload slot is held exactly while a part
file may exist: it moves into the part file and is released only after the part file is
renamed or deleted and the record cleared, so a request that went away can't free the
slot while its cleanup still runs. A record that can't be written fails the upload `500
internal`.

At startup, and again at step 4 of the next upload, the daemon reads the record and
deletes it (both in the state directory, inline), then deletes the file the record named
if that is still a regular file whose name is `.muxen-upload-*.part`. That delete runs on
the fs lane and is not awaited: the path may be on a hung mount, and that must fill an
fs thread, not hold up the start or an upload. The record is already gone, so the hang
happens once. Nothing else is touched, and nothing in this cleanup fails an upload or the
start: a missing or unreadable record, or a file it can't delete, is logged at `debug`.
The path is logged at `info` before the delete is queued; if the fs lane is saturated
(the hung-mount case) the delete is dropped unrun and that log line is the only trace of
the file left behind.
No folder is scanned.

6. Answer `201 { path, size }`, `path` the absolute canonical path, which native
   inserts, quoted, into the tab ([ios-shell.md](ios-shell.md#files-and-sharing)).

On the cap, the idle timeout, a client disconnect or a write error, the part file is
deleted. A body that stalls for the idle timeout, or that breaks because the client
disconnected, answers `400 bad_request`: the body failed, and the client is usually
gone to read it. Nothing else in muxen uses the `.muxen-upload-` prefix.

## Server settings

`GET /settings` and `POST /settings` read and write the keys of `config.toml` that apply without a
restart, so Settings can show and change them per server. Both sit in the `devices` router behind both
auth layers. The code is `src/config/` (the writer beside the loader), not `src/fs/`.

```text
ServerSettings = { searchSkip: [string] | null,   // null: no key, the default applies
                   fileChanged: bool,             // the file differs from what is running
                   uploadsDir: string | null,
                   defaults: { searchSkip: [string], uploadsDir: string } }   // the daemon's own
SettingsChange = { searchSkip?: [string] | null, uploadsDir?: string | null }
```

- **Values are the running config's,** not the file's (they differ after a hand edit until a reload;
  GET also answers `fileChanged: bool`). **Keys:** `search_skip` (top level) and `uploads_dir`. A key that is absent means the default
  (`["node_modules"]`, `"~/.muxen-uploads"`); `defaults` carries them so the client keeps no copy.
  `searchSkip: []` is a set key that skips nothing; `null` is no key, the default.
- **`POST`** takes a `SettingsChange`: a field left out is unchanged, `null` removes the key, a value
  sets it. An unknown or mistyped field is `bad_request` with axum's 422, as every JSON body axum rejects. It answers the resulting `ServerSettings`, which the
  client draws. **Validation:** at most 64 patterns, each 1–255 bytes of UTF-8 with no `/` or NUL, not
  made only of `*` (which would skip every folder); duplicates are dropped, order kept. `uploadsDir`
  absolute or starting with `~/`, at most 4,096 bytes. Anything else is `400 bad_request` and nothing is
  written. A pattern starting with `.` only matters while Show hidden files is on; it is allowed.
- **Writing** follows the earlier writer's rules
  ([decisions.md](decisions.md#config-writes-toml_edit-auths-lock-temp-file-and-rename-re-stat-before-rename)),
  on the fs lane with a permit of its own, and one at a time under the running config's lock, which a
  reload takes too (the daemon is `config.toml`'s only writer; the runtime lock keeps a second daemon
  out): canonicalize the config path so a symlinked
  `config.toml` (a dotfiles checkout) is written at its target; refuse a dangling link or an unwritable
  target with `409 config_read_only`; edit only the two keys with `toml_edit`, keeping comments, order
  and every other key; write `<name>.tmp` beside it with the original's mode (0600 for a new file),
  re-stat the original and rename, retrying up to 3 times if it changed, then `503 busy`. A file that exists but doesn't
  parse is never written: `503 config_unavailable`. A missing file is created with only the keys set,
  its directory with mode 0700 if absent (this covers a `--config` path deleted after startup).
- **`POST /settings/reload`** reloads as SIGHUP does and answers `{ settings: ServerSettings,
  restartNeeded: [string] }`, or `503 config_unavailable` with the parse error, the running config
  unchanged. A save on a file that changed by hand since it was loaded first reloads it (so the save
  never overwrites a hand edit with stale values), and fails the same way if it doesn't parse.
- **Concurrent saves:** the last write wins. The client sends one save at a time per server and draws
  the answer, so its own taps can't reorder; two devices saving at the same moment can lose one change,
  which Settings' next open shows. Accepted: one user, rare, visible.
- **Logging:** a write at `info`, naming the keys changed, not their values.

## Errors

JSON `{"error": "<code>"}`, from the shared `HttpError` type ([auth.md](auth.md#endpoints)).
The auth middleware also uses this body for `forbidden`, `auth_required`,
`auth_unavailable`, `bad_origin`, `node_refused`, `not_enrolled` and
`identity_unavailable`; axum JSON rejections use `bad_request` or `too_large`.

| Status | `error` | Cause |
|---|---|---|
| 400 | `bad_request` | a path that is relative, too long, has a NUL, doesn't decode, or canonicalizes to non-UTF-8; a bad query value; an upload body that stalled past the idle timeout or broke (the client went away) |
| 401 | `not_enrolled` | the browser's current Tailscale node has no enrolled device row |
| 403 | `denied` | `EACCES` or `EPERM`; an upload into a folder that is read-only or not writable (`EROFS` too) |
| 403 | `bad_origin` | Browser Origin, forwarded host or fetch metadata does not match the canonical Serve origin |
| 403 | `node_refused` | The current Tailscale node fails a node-lane rule; includes the refusal reason |
| 404 | `not_found` | `ENOENT`, `ENOTDIR` while resolving, `ELOOP` at open |
| 409 | `not_a_directory`, `not_a_file` | the wrong kind for the route; a FIFO, socket or device is `not_a_file`; an upload when `uploads_dir` isn't an absolute or `~/` path, or the upload's `dir` or `uploads_dir` isn't a directory |
| 409 | `memory_backed` | on Linux, an upload destination directory on tmpfs or ramfs; its pages would remain charged to muxen's unit while the file exists |
| 409 | `config_read_only` | `config.toml`, or a directory on its way, is a dangling link or can't be written |
| 413 | `too_large` | an upload over the cap |
| 416 | `bad_range` | a range starting past the end |
| 503 | `busy` | no slot within the wait, too many waiting, or the upload slot taken; `Retry-After: 1` |
| 503 | `config_unavailable` | `/settings`: `config.toml` exists but can't be read or parsed; `detail` says where (`line 3, column 7`) |
| 503 | `identity_unavailable` | LocalAPI could not establish the current Tailscale identity |
| 507 | `no_space` | `ENOSPC` or `EDQUOT` during an upload |
| 500 | `internal` | any other I/O error, including an upload's rename on a filesystem with no no-replace support; the cause is logged, never sent |

## Limits and the memory ceiling

File I/O runs on the four-thread fs lane in the 8-thread blocking pool
([plan.md](plan.md#resource-budget)). A slow disk can stall the file manager but cannot
consume auth's two threads. Every wait but the upload flush has a deadline; at most 8
callers wait across fs slots and blocking work. Nothing is held between requests: no
listing cache, no search index, no cursor, no open descriptor.

**Shutdown must not wait on a stream.** `http::serve` gives its connection tasks a
2 s grace, then calls `JoinSet::abort_all` and joins the aborted tasks before it
returns. A stalled raw response would otherwise retain its `Ctx` and `HubHandle`;
because another handle would remain alive, the hub could not infer that all HTTP
clients were gone and close its control clients. `main` therefore calls
`HubHandle::stop` explicitly after `serve` returns
([daemon-core.md §4.7](daemon-core.md#47-public-interface)). A SIGTERM with a paused
raw stream then ends in 2.0 s with exit 0.

| Item | Bound | MB |
|---|---|---|
| directory scan | 1 × (1 MiB of names + 5,000 × 32 B) | 1.2 |
| search walk | 1 × (1 MiB queue + one `getdents` buffer + 50 matches × 4 KiB) | 1.3 |
| raw responses | 2 × (64 KiB chunk + channel + 16 KiB hyper write buffer) | 1.0 |
| upload | 1 × (16 KiB hyper read buffer + 64 KiB chunk + 2 MiB of dirty pages between flushes) | 2.2 |
| listing JSON | one page, 200 entries | 0.1 |
| **file API, excluding raw responses** | scan, search, upload and listing page | **4.8** |

Raw responses and kernel socket buffers have separate rows in the daemon's ceiling in
[daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling). HTTP/1 buffers are
bounded to 16 KiB each by its accept loop. Page cache is charged to the unit too. Clean
pages are reclaimable, so they don't count toward the unreclaimable ceiling; at
`MemoryMax` the kernel reclaims them before it kills. The unit sets no `MemoryHigh`,
since a lower soft limit would stall allocation. The `DONTNEED` calls above keep the
file API's share small. An upload's dirty pages can't be reclaimed until written,
which is why they have a row and why the flush interval is 2 MiB, not larger.

## Logging

- **Writes at `info`, by action and canonical path:** an upload's final path and
  size (a `dir` upload too).
- **Refusals** (`denied`) at `warn` with the path
  asked for.
- **Reads** (listings, raw ranges) at `debug` only: one video is dozens of requests. A search
  logs its root, entries read and `stopped` at `debug`; never `q`.
- **Never** file contents, upload bytes, the client's upload `name` beyond its
  extension, or `config.toml`'s text (a parse error logs the line and column; auth
  logs the line).

## Module shape

`src/fs/` knows nothing of axum; `src/http/fs.rs` holds thin handlers that parse the
request, take slots, call into `fs` and build responses. The pure parts are tested
without a disk.

| File | Contents |
|---|---|
| `fs/mod.rs` | `FsError` with its status and code, `expand` for `~/` |
| `fs/open.rs` | `fs::open`, `fs::check_dir`, the platform descriptor-path lookup |
| `fs/slots.rs` | scan, search, raw-response and upload permits, with waits counted against the fs lane |
| `fs/list.rs` | the scan; pure sort and page |
| `fs/search/mod.rs` | the walk, the cache-tag probe and the best 50 |
| `fs/search/matcher.rs` | pure: query parsing, glob and fuzzy scoring, hits, result order, the skip patterns |
| `fs/raw.rs` | pure `parse_range` and `If-Range`; the chunk producer; ETags come from `files::Stamp` |
| `fs/mime.rs` | the extension table |
| `fs/upload.rs` | pure name generation; part file, flush, rename, the in-flight record and its cleanup |
| `config/live.rs` | the running config's live keys, the reload, the save under its lock, "changed since loaded" |
| `config/write.rs` | the save's pieces: validation, the target, `toml_edit`, the temp file and rename |
| `http/settings.rs` | `/settings` and `/settings/reload` |

Wire types go in `src/proto/fs.rs` (`src/proto/settings.rs` for `/settings`) and are generated for TypeScript like the WebSocket
messages ([daemon-core.md §5.5](daemon-core.md#55-type-generation)); Swift hand-writes
only the upload response. New dependency: axum's `query` feature. Tests run `fs::open` against a temp tree with symlinks, `..`, a FIFO and a non-UTF-8
name, and swap a component for a symlink between canonicalize and open to exercise
step 4.

## v2: what this must not preclude

Edit, new file and rename ([plan.md](plan.md#file-manager)) come as `PUT
/fs/file/{*path}` (`If-Match` the ETag above; `412 changed` if it moved) and `POST
/fs/create` and `/fs/rename` (`409 exists`). All go through `fs::open(…, Parent)`.
`Want::Parent` is built with the first of these routes, not before. It checks the
**parent directory** as in steps 1 to 4, returns its descriptor, and requires the last
component to be a plain name (no `/`, not `.` or `..`). Every write
is then relative to that descriptor (`openat` with `O_CREAT | O_EXCL | O_NOFOLLOW`; a
temp file, `fsync` and `renameat` for saves; `RENAME_NOREPLACE` for renames), so a write goes where the
descriptor is. The ETag, the URL-path form, the error codes
and the upload's part-file-then-rename shape carry over; resumable uploads extend the
part file at an offset.

## Open risks

- **AVPlayer with an Authorization header:** `AVURLAssetHTTPHeaderFieldsKey` is an
  undocumented key that Apple staff on the developer forums call unsupported. The
  file-manager spike checks it on iOS 26. Fallbacks: an
  `AVAssetResourceLoaderDelegate` on a custom scheme, where native fetches the ranges
  itself with the Bearer header, or the short-lived media ticket in
  [ios-shell.md](ios-shell.md#web-content-security).
- **`sandbox` and CORS on custom-scheme responses** are unverified on iOS 26
  ([ios-shell.md](ios-shell.md#open-risks)). The type allowlist holds without them.
- **The memory ceiling sits near the unit's limit** once the file API and kernel socket
  buffers are counted ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)).
  The budget run must read the unit's `memory.peak`, which counts kernel buffers and
  page cache, not the daemon's RSS.
- **Unit-tested only on macOS.** The fs tests pass on the Mac (APFS, 2026-11-05): the
  `F_GETPATH` descriptor-path lookup, the `RENAME_EXCL` no-replace rename and search's
  `O_NOFOLLOW_ANY` walk. None has served a phone from a Mac LaunchAgent yet, and CI builds
  macOS only at release, so rerun the fs tests on the Mac after changing them. On a platform
  that is neither Linux nor Apple the descriptor-path lookup fails closed.
- **How many concurrent ranges AVFoundation opens** per video decides whether 2 raw
  slots are enough; the spike records it.
