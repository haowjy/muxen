# File API: listing, raw reads, uploads

`src/fs/` serves the phone's file manager: directory listings, file bytes with Range
for the viewers and the native video player, and photo uploads. It reads any path the daemon's user can read: there is no scope.
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
| raw responses at once | 2 | wait |
| uploads at once | 1 | `503 busy` at once |
| fs lane | 4 of the runtime's 8 blocking threads; includes scan and raw-response slot waits | wait up to 10 s |
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

Uploads go to `uploads_dir` in `config.toml` (default `~/tether-uploads`), absolute or
starting with `~/`. A missing absolute path is created by the next upload; one that is
neither absolute nor `~/` makes every upload answer `409 not_a_directory`. There are no
favorites and no route that writes `config.toml`: Jimmy edits it by hand
([decisions.md](decisions.md#no-favorites-2026-10-30)).

**Uploads re-read `uploads_dir` on every request**, as auth re-reads `auth.toml`
([auth.md](auth.md#state-on-disk)): the file is small, so a hand edit applies to the next
upload with no watcher, cache or restart. They read the path `Config::load` resolved at
startup (`--config`, else the default), kept in `App`, with the same rule: a missing
default file means the defaults. A file that exists but can't be read or parsed **fails
closed**: uploads answer `503 config_unavailable`. Listing and raw reads don't read the
config. The other config keys are still read once, at startup.

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
as tether or registering as its service worker.

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

`POST /fs/upload?name=<the client's file name>`; the body is the file's bytes, not
multipart or JSON. axum's default body limit is off on this route; the handler checks
the cap against `Content-Length` up front, when sent, and against the running count.

1. Take the upload slot (none free: `503 busy` at once).
2. Create `uploads_dir` (0700) if missing, then resolve it and `fs::open(…, Dir)`
   it, so a directory that didn't exist when the config was read still counts. An `uploads_dir` that can't be resolved to a directory (neither absolute
   nor `~/`, or not a directory) answers `409 not_a_directory`.
   On Linux, `fstatfs` on the opened directory descriptor rejects tmpfs and ramfs with
   `409 memory_backed` before a `.part` file is created. On macOS there is no cgroup
   memory limit, so this filesystem-type refusal is not applied.
3. Name the file `YYYYMMDD-HHMMSSZ-xxxx.<ext>`: UTC (no time-zone crate), 4 random
   base32 characters, and the extension of `name`, lowercased, if it is 1 to 8 ASCII
   alphanumerics, else `bin`. Nothing else of `name` is used, so it can't carry a
   path, a shell metacharacter or a hidden name into the folder.
4. Create `.tether-upload-<random>.part` relative to the directory's descriptor with
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

If cleanup cannot get a thread from the fs lane, a `.part` file is left behind; startup
sweeps stale part files from the `uploads_dir` read at startup (uploads re-read the file on
every request, so a later edit isn't swept until the next start).
6. Answer `201 { path, size }`, `path` the absolute canonical path, which native
   inserts, quoted, into the tab ([ios-shell.md](ios-shell.md#files-and-sharing)).

On the cap, the idle timeout, a client disconnect or a write error, the part file is
deleted. A body that stalls for the idle timeout, or that breaks because the client
disconnected, answers `400 bad_request`: the body failed, and the client is usually
gone to read it. At startup, after the runtime lock is held and both sockets are
established (as for the paste directory), the daemon deletes leftover
`.tether-upload-*.part` files in `uploads_dir`; nothing else in
tether uses that prefix.

## Errors

JSON `{"error": "<code>"}`, from the shared `HttpError` type ([auth.md](auth.md#endpoints)).
The auth middleware also uses this body for `forbidden`, `auth_required`,
`auth_unavailable`, `bad_origin`, `node_refused`, `not_enrolled` and
`identity_unavailable`; axum JSON rejections use `bad_request` or `too_large`.

| Status | `error` | Cause |
|---|---|---|
| 400 | `bad_request` | a path that is relative, too long, has a NUL, doesn't decode, or canonicalizes to non-UTF-8; a bad query value; an upload body that stalled past the idle timeout or broke (the client went away) |
| 401 | `not_enrolled` | the browser's current Tailscale node has no enrolled device row |
| 403 | `denied` | `EACCES` or `EPERM` |
| 403 | `bad_origin` | Browser Origin, forwarded host or fetch metadata does not match the canonical Serve origin |
| 403 | `node_refused` | The current Tailscale node fails a node-lane rule; includes the refusal reason |
| 404 | `not_found` | `ENOENT`, `ENOTDIR` while resolving, `ELOOP` at open |
| 409 | `not_a_directory`, `not_a_file` | the wrong kind for the route; a FIFO, socket or device is `not_a_file`; an upload when `uploads_dir` isn't an absolute or `~/` path or isn't a directory |
| 409 | `memory_backed` | on Linux, an upload destination directory on tmpfs or ramfs; its pages would remain charged to tether's unit while the file exists |
| 413 | `too_large` | an upload over the cap |
| 416 | `bad_range` | a range starting past the end |
| 503 | `busy` | no slot within the wait, too many waiting, or the upload slot taken; `Retry-After: 1` |
| 503 | `config_unavailable` | `config.toml` exists but can't be read or parsed |
| 503 | `identity_unavailable` | LocalAPI could not establish the current Tailscale identity |
| 507 | `no_space` | `ENOSPC` or `EDQUOT` during an upload |
| 500 | `internal` | any other I/O error, including an upload's rename on a filesystem with no no-replace support; the cause is logged, never sent |

## Limits and the memory ceiling

File I/O runs on the four-thread fs lane in the 8-thread blocking pool
([plan.md](plan.md#resource-budget)). A slow disk can stall the file manager but cannot
consume auth's two threads. Every wait but the upload flush has a deadline; at most 8
callers wait across fs slots and blocking work. Nothing is held between requests: no
listing cache, no cursor, no open descriptor.

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
| raw responses | 2 × (64 KiB chunk + channel + 16 KiB hyper write buffer) | 1.0 |
| upload | 1 × (16 KiB hyper read buffer + 64 KiB chunk + 2 MiB of dirty pages between flushes) | 2.2 |
| listing JSON | one page, 200 entries | 0.1 |
| **file API, excluding raw responses** | scan, upload and listing page | **3.5** |

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
  size.
- **Refusals** (`denied`) at `warn` with the path
  asked for.
- **Reads** (listings, raw ranges) at `debug` only: one video is dozens of requests.
- **Never** file contents, upload bytes, the client's upload `name` beyond its
  extension, or `config.toml`'s text (a parse error logs the line number, as auth
  does).

## Module shape

`src/fs/` knows nothing of axum; `src/http/fs.rs` holds thin handlers that parse the
request, take slots, call into `fs` and build responses. The pure parts are tested
without a disk.

| File | Contents |
|---|---|
| `fs/mod.rs` | the `uploads_dir` read, `FsError` with its status and code |
| `fs/open.rs` | `fs::open`, `fs::check_dir`, the platform descriptor-path lookup |
| `fs/slots.rs` | scan, raw-response and upload permits, with waits counted against the fs lane |
| `fs/list.rs` | the scan; pure sort and page |
| `fs/raw.rs` | pure `parse_range` and `If-Range`; the chunk producer; ETags come from `files::Stamp` |
| `fs/mime.rs` | the extension table |
| `fs/upload.rs` | pure name generation; part file, flush, rename, startup sweep |

Wire types go in `src/proto/fs.rs` and are generated for TypeScript like the WebSocket
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
- **Untested on macOS.** The `F_GETPATH` descriptor-path lookup and the `RENAME_EXCL`
  no-replace rename are written but have been neither built nor run: no Apple target is
  installed on the dev box, and CI builds macOS only at release. Run the fs tests on the
  Mac before relying on them there. On a platform that is neither Linux nor Apple the
  descriptor-path lookup fails closed.
- **How many concurrent ranges AVFoundation opens** per video decides whether 2 raw
  slots are enough; the spike records it.
