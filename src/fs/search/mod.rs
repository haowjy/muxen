//! Files' Search (fs.md "GET /fs/search"): a breadth-first walk below one folder, one
//! directory open at a time, that streams every name it reads through the matcher
//! (`matcher.rs`, pure) and keeps the best 50. Nothing is kept between requests; the skip
//! patterns come from the running config.

use std::cmp::Ordering;
use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, Read as _};
use std::os::fd::{AsFd, OwnedFd};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::time::{Duration, Instant};

use rustix::fs::{AtFlags, Dir, FileType, Mode, OFlags};

use super::list::{self, Filter};
use super::{Beneath, MAX_PATH, Opened};
use crate::config::LiveConfig;
use crate::proto::fs::{EntryKind, Match, Search, Stopped};

mod matcher;

pub use matcher::{Pattern, Skip};
use matcher::{last_segment, order};

/// Matches answered.
pub const MATCHES: usize = 50;
/// A cache directory's tag file and the bytes it must start with
/// (<https://bford.info/cachedir/>).
const CACHE_TAG: &str = "CACHEDIR.TAG";
const CACHE_SIGNATURE: &[u8; 43] = b"Signature: 8a477f597d28d172789f06886806bc55";
/// Entries between checks of the deadline and the cancel flag.
const CHECK_EVERY: u32 = 1024;

/// When a walk stops early.
#[derive(Debug, Clone, Copy)]
pub struct Caps {
    pub entries: u32,
    pub time: Duration,
    /// Bytes of relative paths still to read, their length prefixes counted.
    pub queue: usize,
}

/// fs.md "Constants".
pub const CAPS: Caps = Caps {
    entries: 100_000,
    time: Duration::from_millis(500),
    queue: 1 << 20,
};

/// The running config's `search_skip`.
pub fn skip(config: &LiveConfig) -> Skip {
    Skip::new(&config.keys().search_skip())
}

/// The matches below `root` for `pattern`, best first. Only an error on the root itself
/// fails; a directory below it that can't be opened or read is skipped. A directory `skip`
/// names, or one below the root tagged as a cache, is listed but not entered. A set `cancel`
/// ends the walk at its next check, as the deadline does. Blocks.
pub fn search(
    root: &Opened,
    pattern: &Pattern,
    filter: Filter,
    skip: &Skip,
    caps: &Caps,
    cancel: &AtomicBool,
) -> io::Result<Search> {
    let deadline = Instant::now() + caps.time;
    let over = || cancel.load(AtomicOrdering::Relaxed) || Instant::now() >= deadline;
    let below = Below::new(root)?;
    let mut queue = Queue::new(caps.queue);
    let mut best = Best::new(pattern.is_glob());
    // The relative path of the directory being read, and of each entry. The root is "",
    // which no directory below it can be.
    let (mut current, mut path) = (Vec::new(), String::new());
    let mut read = 0;
    let mut stopped = None;
    'walk: loop {
        let prefix = std::str::from_utf8(&current).expect("queued from a str");
        // The root is read whatever it holds.
        let opened = below.open(prefix).and_then(|fd| {
            if !prefix.is_empty() && cache_tagged(&fd) {
                return Ok(None);
            }
            Ok(Some(Dir::new(fd)?))
        });
        let mut entries = match opened {
            Ok(entries) => entries,
            Err(error) if prefix.is_empty() => return Err(error),
            Err(_) => None,
        };
        while let Some(entry) = entries.as_mut().and_then(Dir::read) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) if prefix.is_empty() => return Err(error.into()),
                Err(_) => break,
            };
            let name = entry.file_name().to_bytes();
            if name == b"." || name == b".." {
                continue;
            }
            if read == caps.entries {
                stopped = Some(Stopped::Entries);
                break 'walk;
            }
            read += 1;
            if read % CHECK_EVERY == 0 && over() {
                stopped = Some(Stopped::Time);
                break 'walk;
            }
            if !filter.hidden && name.starts_with(b".") {
                continue;
            }
            // Its path couldn't be sent back.
            let Ok(name) = std::str::from_utf8(name) else {
                continue;
            };
            let file_type = match entry.file_type() {
                // A filesystem without `d_type`: relative to the folder being read, so no
                // component is resolved again.
                FileType::Unknown => {
                    let dir = entries.as_ref().expect("an entry was read from it");
                    let stat = dir
                        .fd()
                        .and_then(|fd| rustix::fs::statat(fd, name, AtFlags::SYMLINK_NOFOLLOW));
                    match stat {
                        Ok(stat) => FileType::from_raw_mode(stat.st_mode),
                        Err(_) => continue,
                    }
                }
                known => known,
            };
            path.clear();
            if !prefix.is_empty() {
                path.push_str(prefix);
                path.push('/');
            }
            path.push_str(name);
            // No route could open a longer path, so it is neither answered nor entered.
            if root.path.len() + 1 + path.len() > MAX_PATH {
                continue;
            }
            if let Some(rank) = pattern.rank(&path) {
                best.offer(rank, &path, file_type);
            }
            if file_type == FileType::Directory && !skip.skips(name) {
                queue.push(&path);
            }
        }
        if !queue.pop_into(&mut current) {
            break;
        }
        if over() {
            stopped = Some(Stopped::Time);
            break;
        }
    }
    if stopped.is_none() && queue.full {
        stopped = Some(Stopped::Queue);
    }
    let matches = best
        .found
        .into_iter()
        .map(|found| found.into_match(root, pattern))
        .collect();
    Ok(Search {
        path: root.path.clone(),
        matches,
        read,
        stopped,
    })
}

/// Opens directories below the root without following a symlink in any component or
/// leaving the root's filesystem.
struct Below<'a> {
    root: &'a Opened,
    beneath: Beneath,
}

impl<'a> Below<'a> {
    fn new(root: &'a Opened) -> io::Result<Self> {
        Ok(Self {
            root,
            beneath: Beneath::new(&root.file)?,
        })
    }

    /// `relative` is "" for the root itself.
    fn open(&self, relative: &str) -> io::Result<OwnedFd> {
        let relative = if relative.is_empty() { "." } else { relative };
        Ok(self.beneath.open(&self.root.file, relative)?)
    }
}

/// Whether `dir` holds a regular file `CACHEDIR.TAG` starting with the signature. Any
/// error means no tag. `O_NONBLOCK` keeps a FIFO of that name from blocking the open,
/// `O_NOCTTY` a tty from becoming the daemon's terminal.
fn cache_tagged(dir: impl AsFd) -> bool {
    let flags =
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC | OFlags::NOCTTY;
    let Ok(tag) = rustix::fs::openat(dir, CACHE_TAG, flags, Mode::empty()) else {
        return false;
    };
    let tag = File::from(tag);
    if !tag.metadata().is_ok_and(|meta| meta.is_file()) {
        return false;
    }
    let mut head = Vec::with_capacity(CACHE_SIGNATURE.len());
    let read = (&tag)
        .take(CACHE_SIGNATURE.len() as u64)
        .read_to_end(&mut head);
    read.is_ok() && head == CACHE_SIGNATURE
}

/// The directories still to read, breadth first: one ring of bytes, each relative path
/// after its 2-byte length. Once full it takes nothing more, so a walk that stops on it has
/// still covered every directory down to some depth.
struct Queue {
    bytes: VecDeque<u8>,
    cap: usize,
    full: bool,
}

impl Queue {
    fn new(cap: usize) -> Self {
        // Larger than any one push, so the ring grows by doubling and a full 1 MiB queue
        // holds exactly 1 MiB.
        Self {
            bytes: VecDeque::with_capacity(8 << 10),
            cap,
            full: false,
        }
    }

    fn push(&mut self, relative: &str) {
        let len = u16::try_from(relative.len()).expect("under MAX_PATH");
        if self.full || self.bytes.len() + 2 + relative.len() > self.cap {
            self.full = true;
            return;
        }
        self.bytes.extend(len.to_le_bytes());
        self.bytes.extend(relative.as_bytes());
    }

    fn pop_into(&mut self, out: &mut Vec<u8>) -> bool {
        let (Some(low), Some(high)) = (self.bytes.pop_front(), self.bytes.pop_front()) else {
            return false;
        };
        let len = usize::from(u16::from_le_bytes([low, high]));
        out.clear();
        out.extend(self.bytes.drain(..len));
        true
    }
}

/// The best `MATCHES` so far, best first.
struct Best {
    glob: bool,
    found: Vec<Found>,
}

struct Found {
    rank: i32,
    path: String,
    /// From `d_type`, not following a link.
    file_type: FileType,
}

impl Best {
    fn new(glob: bool) -> Self {
        Self {
            glob,
            found: Vec::with_capacity(MATCHES + 1),
        }
    }

    fn offer(&mut self, rank: i32, path: &str, file_type: FileType) {
        let order = |found: &Found| order(self.glob, (found.rank, &found.path), (rank, path));
        if self
            .found
            .last()
            .is_some_and(|worst| self.found.len() == MATCHES && order(worst) == Ordering::Less)
        {
            return;
        }
        let at = self
            .found
            .partition_point(|found| order(found) == Ordering::Less);
        self.found.insert(
            at,
            Found {
                rank,
                path: path.to_owned(),
                file_type,
            },
        );
        self.found.truncate(MATCHES);
    }
}

impl Found {
    /// The listing entry a result means: `stat` following links, relative to the root.
    fn into_match(self, root: &Opened, pattern: &Pattern) -> Match {
        let stat = rustix::fs::statat(&root.file, self.path.as_str(), AtFlags::empty()).ok();
        let link = self.file_type == FileType::Symlink;
        let kind = match (&stat, link) {
            (Some(stat), true) => list::kind(FileType::from_raw_mode(stat.st_mode)),
            (None, true) => EntryKind::Broken,
            (_, false) => list::kind(self.file_type),
        };
        let name = last_segment(&self.path).to_owned();
        Match {
            entry: list::described(name, kind, link, stat.as_ref()),
            hits: pattern.hits(&self.path),
            path: self.path,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt as _, symlink};
    use std::path::Path;

    use super::*;
    use crate::fs::test_tree::Tree;
    use crate::fs::{Want, open};

    fn parse(q: &str) -> Pattern {
        Pattern::parse(q).expect("a pattern")
    }

    #[test]
    fn only_the_best_fifty_are_kept() {
        let paths: Vec<String> = (0..120)
            .map(|n| format!("{}/main", "d/".repeat(n % 7) + &n.to_string()))
            .collect();
        let pattern = parse("main");
        let mut best = Best::new(false);
        for path in paths.iter().rev() {
            best.offer(
                pattern.rank(path).expect("a match"),
                path,
                FileType::RegularFile,
            );
        }
        let mut all: Vec<&String> = paths.iter().collect();
        all.sort_by(|a, b| {
            order(
                false,
                (pattern.rank(a).unwrap(), a),
                (pattern.rank(b).unwrap(), b),
            )
        });
        let kept: Vec<&String> = best.found.iter().map(|found| &found.path).collect();
        assert_eq!(kept, all[..MATCHES]);
    }

    fn walk(tree: &Tree, q: &str, hidden: bool, caps: &Caps) -> Search {
        walk_skipping(tree, q, hidden, &["node_modules"], caps)
    }

    fn walk_skipping(tree: &Tree, q: &str, hidden: bool, skip: &[&str], caps: &Caps) -> Search {
        let root = open(&tree.str(""), Path::new("/"), Want::Dir).expect("the root");
        let cancel = AtomicBool::new(false);
        let skip = Skip::new(&skip.iter().map(|&p| p.to_owned()).collect::<Vec<_>>());
        search(&root, &parse(q), Filter { hidden }, &skip, caps, &cancel).expect("searched")
    }

    fn paths(search: &Search) -> Vec<&str> {
        let mut paths: Vec<&str> = search.matches.iter().map(|m| m.path.as_str()).collect();
        paths.sort_unstable();
        paths
    }

    fn sample() -> Tree {
        let tree = Tree::new("search");
        for dir in [
            "src/deep",
            "src/build",
            "docs",
            ".hidden",
            "node_modules/pkg",
            "target/debug",
            ".git",
        ] {
            tree.mkdir(dir);
        }
        for file in [
            "src/main.rs",
            "src/deep/main.rs",
            "src/build/main.rs",
            "docs/target",
            ".hidden/main.rs",
            ".env",
            "node_modules/pkg/main.js",
            "target/debug/main",
            ".git/main",
        ] {
            tree.write(file, b"fn main() {}");
        }
        tree.write("src/build/CACHEDIR.TAG", TAG);
        symlink(tree.path("src"), tree.path("linked")).expect("a link");
        symlink(tree.path("missing"), tree.path("broken")).expect("a link");
        tree
    }

    const TAG: &[u8] = b"Signature: 8a477f597d28d172789f06886806bc55\n# a cache\n";

    #[test]
    fn the_walk_lists_skipped_folders_without_entering_them_and_answers_entries() {
        let tree = sample();
        let everything = walk(&tree, "**", false, &CAPS);
        assert_eq!(
            paths(&everything),
            [
                "broken",
                "docs",
                "docs/target",
                "linked",
                "node_modules",
                "src",
                "src/build",
                "src/deep",
                "src/deep/main.rs",
                "src/main.rs",
                "target",
                "target/debug",
                "target/debug/main"
            ]
        );
        // Hidden names count as read: 9 at the root, 3 + 1 + 1 + 1 + 1 below.
        assert_eq!((everything.read, everything.stopped), (16, None));
        // Hidden names are the only rule `hidden=1` lifts.
        let with_hidden = paths(&walk(&tree, "**", true, &CAPS)).join(" ");
        for found in [".hidden/main.rs", ".env", ".git/main"] {
            assert!(with_hidden.contains(found), "{found}: {with_hidden}");
        }
        for skipped in ["node_modules/", "src/build/"] {
            assert!(!with_hidden.contains(skipped), "{skipped}: {with_hidden}");
        }

        let found = walk(&tree, "main", false, &CAPS);
        assert_eq!(found.path, tree.str(""));
        assert_eq!(
            paths(&found),
            ["src/deep/main.rs", "src/main.rs", "target/debug/main"]
        );
        let main = &found.matches[0];
        assert_eq!(
            (main.path.as_str(), main.entry.name.as_str()),
            ("src/main.rs", "main.rs")
        );
        assert_eq!(
            (main.entry.kind, main.entry.link, main.entry.size),
            (EntryKind::File, false, Some(12))
        );
        assert_eq!(
            main.entry.mime.as_deref(),
            Some("text/plain; charset=utf-8")
        );
        assert_eq!(main.hits, [[4, 8]]);

        let link = |q: &str| walk(&tree, q, false, &CAPS).matches.remove(0).entry;
        let linked = link("linked");
        assert_eq!((linked.kind, linked.link), (EntryKind::Dir, true));
        assert!(linked.mtime.is_some());
        let broken = link("broken");
        assert_eq!(
            (broken.kind, broken.link, broken.mtime),
            (EntryKind::Broken, true, None)
        );
    }

    #[test]
    fn only_an_exact_cache_tag_in_a_regular_file_skips_a_folder() {
        let tree = Tree::new("tags");
        tree.write("CACHEDIR.TAG", TAG);
        let mut tags: Vec<(&str, Option<&[u8]>)> = vec![
            ("exact", Some(&TAG[..43])),
            ("longer", Some(TAG)),
            ("short", Some(&TAG[..42])),
            ("case", Some(b"signature: 8a477f597d28d172789f06886806bc55")),
            ("empty", Some(b"")),
            ("linked", None),
            ("fifo", None),
            ("folder", None),
        ];
        for (dir, tag) in &mut tags {
            tree.mkdir(dir);
            tree.write(&format!("{dir}/x"), b"");
            if let Some(tag) = tag {
                tree.write(&format!("{dir}/CACHEDIR.TAG"), tag);
            }
        }
        symlink(
            tree.path("exact/CACHEDIR.TAG"),
            tree.path("linked/CACHEDIR.TAG"),
        )
        .expect("a link");
        let fifo = std::process::Command::new("mkfifo")
            .arg(tree.path("fifo/CACHEDIR.TAG"))
            .status();
        assert!(fifo.expect("mkfifo ran").success());
        tree.mkdir("folder/CACHEDIR.TAG");
        // The root is read though it is tagged; only `exact` and `longer` aren't.
        let entered = walk(&tree, "*/x", false, &CAPS);
        assert_eq!(
            paths(&entered),
            [
                "case/x", "empty/x", "fifo/x", "folder/x", "linked/x", "short/x"
            ]
        );
    }

    #[test]
    fn patterns_match_a_folder_name_exactly() {
        let tree = Tree::new("patterns");
        for dir in [
            "pkg.egg-info",
            "Cache",
            "[ab]",
            "a",
            "n/node_modules",
            "n/node_modules2",
        ] {
            tree.mkdir(dir);
            tree.write(&format!("{dir}/x"), b"");
        }
        let entered = |skip: &[&str]| {
            let found = walk_skipping(&tree, "**/x", false, skip, &CAPS);
            paths(&found)
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            entered(&["*.egg-info", "cache", "[ab]", "node_modules", "n/x"]),
            ["Cache/x", "a/x", "n/node_modules2/x"]
        );
        // `a` and `n`.
        assert_eq!(entered(&["?"]), ["Cache/x", "[ab]/x", "pkg.egg-info/x"]);
        // `*` would skip every folder below the root; settings refuse it, a hand edit can write it.
        assert_eq!(entered(&["*"]), Vec::<String>::new());
        assert_eq!(entered(&[]).len(), 6);
    }

    #[test]
    fn caps_stop_the_walk_and_say_which() {
        let tree = sample();
        let caps = |entries, time, queue| Caps {
            entries,
            time,
            queue,
        };
        let capped = walk(&tree, "**", false, &caps(3, CAPS.time, CAPS.queue));
        assert_eq!((capped.read, capped.stopped), (3, Some(Stopped::Entries)));
        // Checked between directories: the root is read, nothing below it.
        let timed = walk(
            &tree,
            "**",
            false,
            &caps(CAPS.entries, Duration::ZERO, CAPS.queue),
        );
        assert_eq!((timed.read, timed.stopped), (9, Some(Stopped::Time)));
        assert_eq!(
            paths(&timed),
            ["broken", "docs", "linked", "node_modules", "src", "target"]
        );
        // Room for `docs` (2 + 4 bytes) alone: it is read, `docs/sub` never queued.
        let tree = Tree::new("queue");
        tree.mkdir("docs/sub/deeper");
        let queued = walk(&tree, "**", false, &caps(CAPS.entries, CAPS.time, 6));
        assert_eq!(queued.stopped, Some(Stopped::Queue));
        assert_eq!(paths(&queued), ["docs", "docs/sub"]);

        let root = open(&tree.str(""), Path::new("/"), Want::Dir).expect("the root");
        let cancelled = AtomicBool::new(true);
        let stopped = search(
            &root,
            &parse("**"),
            Filter { hidden: false },
            &Skip::new(&[]),
            &CAPS,
            &cancelled,
        );
        assert_eq!(stopped.expect("searched").stopped, Some(Stopped::Time));
    }

    #[test]
    fn a_folder_below_the_root_that_cant_be_read_is_skipped() {
        let tree = sample();
        let locked = tree.path("src/deep");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).expect("chmod");
        let found = walk(&tree, "main", false, &CAPS);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        assert_eq!(paths(&found), ["src/main.rs", "target/debug/main"]);
        assert_eq!(found.stopped, None);
    }
}
