# src/fs: what to know before editing

`AGENTS.md` has the rules the code relies on; [fs.md](../../../docs/design/fs.md) is the route contract. This
file holds the mechanism and the reasons the code can't show.

## `fs::open`

In order: **shape** (absolute, `~` or `~/…`, at most 4,096 bytes, no NUL, else `bad_request`); **canonicalize**
with `realpath` (every symlink and `..` resolved against the real tree; a canonical path that isn't UTF-8 is
`bad_request`); **`lstat`** refuses any kind but regular file or directory, then open with `O_RDONLY |
O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | O_NOCTTY` (plus `O_DIRECTORY` for `Dir`; `O_NONBLOCK` keeps a FIFO from
blocking the thread), `fstat` re-checks the kind, and `ELOOP` here means the last component became a symlink
after the canonicalize: `not_found`; then **read the descriptor's real path** (`/proc/self/fd/N`, or
`rustix::fs::getpath` on macOS), so a component swapped between steps is reported where the file really is.
Callers get the descriptor, never a path to open again. `check_dir` (for `newWindow` and `newSession` `dir`)
runs step 1 then `stat` following links, on the dir lane with a 300 ms wait; it reads no config, so a broken
`config.toml` never blocks a new window.

## Listing

One scan through the descriptor under the scan slot: names and `d_type` up to the scan cap (every entry read
counts, hidden ones included, so a directory of dotfiles is cut off like a full one), `fstatat` following links
only for `DT_LNK` and `DT_UNKNOWN` (a symlinked directory must sort as a directory; a `stat` per entry would be
5,000 syscalls on an overloaded disk), sort directories first then ASCII-case-folded name then bytes, take the
page, `fstatat` that page for size and time. Paging is by offset over a fresh scan with no cursor, so a
changing directory can repeat or skip an entry. Non-UTF-8 names list with U+FFFD and `utf8: false`.

## Search walk

Breadth first, one directory open at a time, streaming names and `d_type` through the matcher and keeping the
best 50 in a sorted list. The queue is one byte buffer of relative paths (offsets counted) capped at 1 MiB;
when full the walk stops queueing and answers `stopped: "queue"`. At most two descriptors are open (the root
and the one being read; a third for a cache-tag probe), and a capped walk has covered everything to some depth,
so a short path is never missed for a deep one. Directories open only through `open::Beneath`
(`openat2` with `RESOLVE_BENEATH | NO_SYMLINKS | NO_XDEV`, falling back to `openat` with `O_NOFOLLOW` plus a
device check before Linux 5.6; on macOS `O_NOFOLLOW_ANY` and a device check), so a symlinked directory is
matched but never entered and no walk wanders into `/proc`, a network mount or another disk. An entry whose
relative path would pass 4,096 bytes isn't matched or queued. `fstatat` (not following) only for `DT_UNKNOWN`.

- **Skipped, but listed:** names starting with `.` unless `hidden=1`; directories matching a `search_skip`
  pattern (a folder name or a glob with `*` and `?` over the name alone, compared exactly; the root is never
  skipped); and directories below the root tagged under the [Cache Directory Tagging
  spec](https://bford.info/cachedir/) (a regular file `CACHEDIR.TAG` whose first 43 bytes are `Signature:
  8a477f597d28d172789f06886806bc55`, probed by `openat` with `O_NOFOLLOW | O_NONBLOCK`; `ENOENT`, the usual
  answer, costs one lookup, about 1 µs). A skipped directory's own entry is matched like any other, so Search
  can find `node_modules` or `target` and a tap goes into it.
- Errors below the root (`EACCES`, `ENOENT`, `ELOOP`, `ENOTDIR`, `EXDEV`, `EIO`) skip that directory; only a
  root error fails the request. The deadline (500 ms) and the cancel flag are checked every 1,024 entries and
  between directories; a stalled filesystem call can't be interrupted. The handler's guard sets the cancel flag
  when the response future is dropped. The search slot's permit moves into the lane closure, so aborted
  searches never overlap. The walk doesn't change its thread's priority: an unprivileged thread can't lower its
  nice again (`RLIMIT_NICE` is 0), so a lane thread would stay deprioritised.
- Cost measured on pop-os (warm): 67,000 entries in 60 to 73 ms; 100,000 entries 75 to 140 ms of one core,
  180 to 330 ms under `CPUQuota=50%`. The probe is 6 to 25 ms of that. Its negative dentries are reclaimable
  kernel memory charged to the unit.

**Matching** works on the relative path's scalar values (root name not included); ASCII letters are
case-folded only while `q` has no ASCII uppercase (smart case); names aren't Unicode-normalised.
- *Glob* (`q` has `*` or `?`): `*` any run within a segment, `?` one scalar, `**` any run of whole segments,
  zero included (`src/**/main.rs` matches `src/main.rs`; a `**` not bounded by `/` or the ends is a `*`);
  everything else literal, no escape. A pattern without `/` matches the last segment, anchored; with `/`, the
  whole relative path. Iterative with two backtrack points, never recursive. Rank by depth, last segment
  (case folded), bytes.
- *Fuzzy:* `q` split on spaces; every term must be a subsequence, aligned first in the last segment and then
  across the path with fzf's v1 alignment (leftmost forward match, backward pass to the shortest window). The
  score adds bonuses at a segment or word start, for adjacency and for the last segment, and subtracts gaps;
  terms are independent and may share scalars; the path's score is the sum less a fixed amount per folder
  level so nearer files rank first; ties go to the shorter path then bytes. Hit runs are computed again for the
  final 50 only (the walk keeps scores), in UTF-16 units because that is how JS indexes a string. `fstatat`
  (following links) runs on those 50 only.

## Raw reads

A producer task `pread`s 64 KiB chunks (each on the fs lane) into a channel of capacity 1 feeding the body; a
send that waits past 30 s drops the channel with an error, aborting the response and freeing the slot (a paused
player would otherwise hold its slot, and shutdown, forever). For files over 8 MiB, after each chunk it calls
`posix_fadvise(DONTNEED)` on everything from the response's first byte to the current position: the kernel
reads ahead in large folios and a folio that extends past a 64 KiB range survives a drop of that range (a
per-chunk drop left a whole 1 GiB download cached on Linux 7.1, ext4). Not the end of the file: dropping ahead
evicts the readahead. Linux only. `ETag` is `files::Stamp` of the open's `fstat` (`"<ino>-<size>-<mtime_ns>"`
hex); `Content-Length` comes from that `fstat`, and a file that shrinks under the stream aborts the response.
Range: one range only; a list or an unparsable header is ignored (RFC 9110 §14.2); a range starting at or past
the end is `416` with `Content-Range: bytes */<size>`; the 416 carries no `ETag`. An `If-Range` that isn't the
ETag ignores the range. No `304`: nothing on the phone caches these. The daemon sets `nosniff`, `sandbox`,
`no-store` and same-origin CORP itself because the native player bypasses the scheme handler. AVFoundation
probes with `Range: bytes=0-1`, then reads ranges, and needs the `206`s, an exact `Content-Type` and an ETag
that stays put while the file does.

## Create, rename, delete (`entry.rs`)

All take `dir` and plain names (not empty, not `.` or `..`, no `/` or NUL, result at most 4,096 bytes), relative
to `dir`'s descriptor. Create: `openat` with `O_CREAT | O_EXCL | O_NOFOLLOW`, mode 0666, or `mkdirat` 0777,
under the umask, no fsync. Rename: `renameat` with `RENAME_NOREPLACE` (`renamex_np RENAME_EXCL` on macOS), no
fallback (`500 internal`); a link is renamed, not its target. Delete: a link is removed, never followed; a
folder is removed bottom-up through descriptors opened with `open::Beneath`, names read 256 at a time with the
folder read again from its start after each batch (bounded memory, and macOS can skip names in a folder
changing under `readdir`); it stops at a mount (bind mount included where `openat2` exists) and 64 levels down
with `403 denied`; any failure stops the delete and what was removed stays gone; a name below the one asked for
that vanishes meanwhile isn't a failure; it runs under the delete slot to its end even if the request goes away.
Neither rename nor delete touches home, muxen's state directory or a folder above either (`403 denied`,
compared by device and inode so a path through a link meets it too).

## Upload

Slot first (none free: `503 busy` at once). Without `dir`: create `uploads_dir` (0700) if missing, then resolve
and `open` it. On Linux `fstatfs` on the destination descriptor rejects tmpfs and ramfs with `409
memory_backed` before a part file exists (not applied on macOS, which has no cgroup memory limit). The final
name is `YYYYMMDD-HHMMSSZ-xxxx.<ext>` (UTC, no time-zone crate; 4 random base32 chars; the lowercased
extension of `name` if 1 to 8 ASCII alphanumerics, else `bin`; nothing else of `name` is used, so it can't
carry a path, shell metacharacter or hidden name). `text=1` names it `pasted-YYYYMMDD-HHMMSSZ.txt`, then `-2`,
`-3`. The body streams to `.muxen-upload-<random>.part` (0600, `O_CREAT | O_EXCL | O_NOFOLLOW`), written chunk
by chunk on the fs lane; every 1 MiB `fdatasync` then `DONTNEED` (the flush is the one wait without a deadline:
on a slow disk it slows the upload to the disk's pace, the backpressure wanted; the idle timeout counts only
waiting for the body). At the end a no-replace rename to the final name (a clash gets a new suffix); no final
`fsync` (a photo lost to a power cut is re-sent). The cap, the idle timeout, a disconnect or a write error
delete the part file; a stalled or broken body answers `400 bad_request`. The part file's path is recorded in
`upload-part` (state directory) before it is created; the slot moves into the part file and is released only
after the file is renamed or deleted and the record cleared. At startup and at the next upload the daemon
reads and deletes the record, then deletes the named file on the fs lane unawaited if it is still a regular
file named `.muxen-upload-*.part` (a hung mount fills a thread, not the start; if the lane is saturated the
delete is dropped unrun and the `info` log line is the only trace). Nothing in cleanup fails an upload; no
folder is scanned (sweeping the upload's own folder left stale files in folders never uploaded to again).

## Save (`PUT /fs/file`)

Slot before the body is read (a slow body holds the one slot, not memory, and a minutes-long upload never makes
a save `busy`); over 1 MiB is `413`. On the fs lane under the slot: `open(path, File)` (must exist; a link saves
to its target and stays a link). Refuse with `403 denied`, writing nothing, a file with another hard link (the
other name would keep the old text), owned by another user (the owner would change) or not writable
(`faccessat(W_OK)`, then the temp file's creation, `EROFS` included); those files are edited in the terminal.
The new file keeps the old permissions without setuid/setgid/sticky. The ETag from the open must equal
`If-Match` (`*` always passes); if not, and the file isn't already byte-identical to the body (read at most
body length plus one byte, only when sizes match), `412 changed`; if identical, `204` with the current ETag, so
a save whose answer was lost doesn't read as a conflict. Write through `files::Target`: `.muxen-save` in the
file's folder (one fixed name so a leftover is removed by the next save there; `{name}.tmp` would delete a
user's `notes.txt.tmp`; a file with that name is never saved), `fsync`, a second stamp check against the folder
entry (closing the race with a writer that got in after the open: `412`, temp deleted), `renameat`, a directory
`fsync`. A `*` save re-reads and retries up to 3 times. Never write in place: a crash or full disk would leave
a torn file.

## Config write (`src/config/`)

Settings saves run on the fs lane with their own permit, one at a time under the running config's lock (a reload
takes it too; the daemon is `config.toml`'s only writer): canonicalize the config path so a symlinked file (a
dotfiles checkout) is written at its target; refuse a dangling link or unwritable target with `409
config_read_only`; edit only the two keys with `toml_edit`, keeping comments, order and every other key; write
`<name>.tmp` with the original's mode (0600 new), re-stat and rename, retrying up to 3 times if it changed, then
`503 busy`. A file that exists but doesn't parse is never written (`503 config_unavailable`). A missing file is
created with only the keys set, its directory 0700 if absent. A save on a file changed by hand since load
reloads it first so it never overwrites a hand edit with stale values. `restartNeeded` is kept with the running
config. Concurrent saves from two devices: the last write wins (accepted: one user, rare, visible).

## Memory

The fs lane is 4 of the runtime's 8 blocking threads; 8 callers may wait across fs slots; every wait but the
upload flush has a deadline. The upload's 1 MiB flush interval is as large as the ceiling allows: the save's
buffer took the other MiB, and an 8 MiB interval held up to 8.2 MB dirty in a measured 120 MiB upload.
