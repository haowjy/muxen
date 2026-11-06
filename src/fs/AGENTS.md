# fs

The file API's core ([fs.md](../../docs/design/fs.md)): `open`, listings, search, raw
reads, uploads, and creates, renames and deletes (`entry.rs`). Plain functions over files re-read per
request; no cache, no cursor, no descriptor kept between requests. It knows nothing of
axum: `http/fs.rs` parses requests, takes slots and builds responses. `mod.rs` holds
`FsError`; `slots.rs` the limits and the fs lane; the rest one route family
each (`search/` splits the pure matcher from the walk).

Rules the code relies on, which are easy to break:

- A client's path reaches the disk only through `open`, which returns a descriptor and
  its real path (`/proc/self/fd` on Linux, `F_GETPATH` on macOS). There is no scope: any
  path the daemon's user can read opens, as in the terminal. Read and write through that descriptor (`pread`, `statat`, `openat`,
  `renameat`), never by joining a path and opening it again. Path completion
  (`src/complete/`) opens through it too, and reads names
  with `list::Scan`; `check_shape` is also `/complete`'s `cwd` check.
- Every blocking call runs on the fs lane (`Slots::lane`, see `src/blocking.rs`), which
  moves the thread's permit into the closure; the scan, search and raw slots wait in that
  lane's queue. Work under a slot goes through the slot's method (`Slots::scan`, `search`,
  `settings`, i.e. `PermitPool::run`), which moves the slot into the lane work too: a
  request dropped mid-call frees nothing until its work ends. Never hold a slot in the
  handler around `lane.run`. Only the raw producer holds its slot itself, across chunks. clippy forbids `spawn_blocking`, and tokio's `fs` feature is off
  (`tokio::fs::File`'s buffer grows to 2 MiB). Take an fs thread last and release it
  before waiting for any other slot.
- Search opens each directory below its root only through `search::Below`, relative to the
  root's descriptor: `openat2` with `RESOLVE_BENEATH | NO_SYMLINKS | NO_XDEV` on Linux,
  `O_NOFOLLOW_ANY` and a device check on macOS. One directory is open at a time (two
  descriptors with the root's, three during its `CACHEDIR.TAG` probe), and the walk runs
  under `Slots::search`, so an aborted search can't overlap the next.
  A skipped folder (a `search_skip` pattern, a cache tag) is offered to the matcher and
  never queued; the root is never skipped. The matcher lives only here: the client
  draws `hits` and never matches.
- An upload's `dir` opens through `fs::open` like a read; without it, uploads land in the
  running config's `uploads_dir` (`App::config`, `src/config/live.rs`). Nothing here reads
  `config.toml`: it is read at startup and on a reload only.
- The in-flight part file is recorded in `upload-part` (state dir); `upload::reap` takes the record inline (state dir only) and deletes the file it named on the fs lane, not awaited, at startup and before each upload, never failing either. User folders are touched only from lane work, never inline or under the slot. No folder is scanned. That is safe only because the upload slot lives in `Part` until its cleanup has cleared the record, and the runtime lock keeps a second daemon out.
- Every file written whole goes through `files::Temp` (`src/files.rs`): an upload's part file (`land`, never replacing), auth's files, and Settings' `config.toml` (`replace_if`, `src/config/`). Linux uploads reject
  tmpfs/ramfs with `memory_backed` from the opened destination descriptor before the
  part file exists. `Temp` isn't deleted
  on drop, since a drop may happen on the runtime thread: a part file is discarded on
  the fs lane, and every "has this file changed" check is a `files::Stamp`.
- `DONTNEED` must cover whole folios: the raw producer drops from the response's first
  byte to the current position, and the upload drops the whole file after each
  `fdatasync`. A chunk-sized drop drops nothing (readahead builds large folios).
- Every wait has a deadline (slot waits, the raw stall, the upload's idle body) except
  the upload's `fdatasync`. A part file is deleted on every failure, including a
  request dropped mid-body (`Part`'s `Drop`).
- Logs carry paths, sizes and codes, never file contents, upload bytes, the client's
  upload name, or `config.toml`'s text: a parse error is logged by line and column, never
  by the parser's message, which quotes the text.

Tests: `open.rs` (links, FIFOs, the swapped component), `list.rs`, `search/matcher.rs`
(globs, fuzzy ranking, hits), `search/mod.rs` (the best 50; the walk's skips, caps and errors
on a temp tree), `raw.rs`
(Range, ETag), `mime.rs` (the allowlist), `upload.rs`; `tests/http_fs.rs` and `tests/http_auth.rs` over a real socket.
