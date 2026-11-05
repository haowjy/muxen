//! Files' Search (fs.md "GET /fs/search"): a breadth-first walk below one folder, one
//! directory open at a time, that streams every name it reads through the matcher and keeps
//! the best 50. Nothing is kept between requests. The matcher is pure: a fuzzy alignment in
//! the style of fzf's v1, or a glob once the query has `*` or `?`.

use std::cmp::Ordering;
use std::collections::VecDeque;
use std::io;
use std::os::fd::OwnedFd;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::time::{Duration, Instant};

use rustix::fs::{AtFlags, Dir, FileType, Mode, OFlags};
use rustix::io::Errno;

use super::list::{self, Filter, fold_cmp};
use super::{MAX_PATH, Opened};
use crate::proto::fs::{EntryKind, Match, Search, Stopped};

/// Matches answered.
pub const MATCHES: usize = 50;
/// The longest `q`, in bytes.
pub const MAX_QUERY: usize = 256;
/// Directories neither matched nor entered, at any depth (the root excepted).
const SKIPPED: [&str; 3] = [".git", "node_modules", "target"];
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

/// The matches below `root` for `pattern`, best first. Only an error on the root itself
/// fails; a directory below it that can't be opened or read is skipped. A set `cancel`
/// ends the walk at its next check, as the deadline does. Blocks.
pub fn search(
    root: &Opened,
    pattern: &Pattern,
    filter: Filter,
    caps: &Caps,
    cancel: &AtomicBool,
) -> io::Result<Search> {
    let deadline = Instant::now() + caps.time;
    let over = || cancel.load(AtomicOrdering::Relaxed) || Instant::now() >= deadline;
    let below = Below::new(root)?;
    let mut queue = Queue::new(caps.queue);
    let mut best = Best::new(pattern.is_glob());
    // The relative path of the directory being read ("" at the root), and of each entry.
    let (mut current, mut path) = (Vec::new(), String::new());
    let mut read = 0;
    let mut stopped = None;
    let mut at_root = true;
    'walk: loop {
        let prefix = std::str::from_utf8(&current).expect("queued from a str");
        let opened = below
            .open(if at_root { "." } else { prefix })
            .and_then(|fd| Ok(Dir::new(fd)?));
        let mut entries = match opened {
            Ok(entries) => Some(entries),
            Err(error) if at_root => return Err(error),
            Err(_) => None,
        };
        while let Some(entry) = entries.as_mut().and_then(Dir::read) {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) if at_root => return Err(error.into()),
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
            path.clear();
            if !at_root {
                path.push_str(prefix);
                path.push('/');
            }
            path.push_str(name);
            let file_type = match entry.file_type() {
                // A filesystem without `d_type`.
                FileType::Unknown => {
                    let stat =
                        rustix::fs::statat(&root.file, path.as_str(), AtFlags::SYMLINK_NOFOLLOW);
                    match stat {
                        Ok(stat) => FileType::from_raw_mode(stat.st_mode),
                        Err(_) => continue,
                    }
                }
                known => known,
            };
            let dir = file_type == FileType::Directory;
            if dir && SKIPPED.contains(&name) {
                continue;
            }
            if let Some(rank) = pattern.rank(&path) {
                best.offer(rank, &path, file_type);
            }
            // No route could open a longer path.
            if dir && root.path.len() + 1 + path.len() <= MAX_PATH {
                queue.push(&path);
            }
        }
        if !queue.pop_into(&mut current) {
            break;
        }
        at_root = false;
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
    dev: u64,
    /// `openat2` exists (Linux 5.6 on).
    #[cfg(target_os = "linux")]
    openat2: std::cell::Cell<bool>,
}

impl<'a> Below<'a> {
    fn new(root: &'a Opened) -> io::Result<Self> {
        Ok(Self {
            root,
            dev: device(&root.file)?,
            #[cfg(target_os = "linux")]
            openat2: std::cell::Cell::new(true),
        })
    }

    fn open(&self, relative: &str) -> io::Result<OwnedFd> {
        let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC;
        #[cfg(target_os = "linux")]
        if self.openat2.get() {
            use rustix::fs::ResolveFlags;
            let resolve = ResolveFlags::BENEATH | ResolveFlags::NO_SYMLINKS | ResolveFlags::NO_XDEV;
            match rustix::fs::openat2(&self.root.file, relative, flags, Mode::empty(), resolve) {
                Err(Errno::NOSYS) => self.openat2.set(false),
                opened => return Ok(opened?),
            }
        }
        // `O_NOFOLLOW_ANY` refuses a link in any component; the `O_NOFOLLOW` fallback only
        // in the last, which the walk never queues.
        #[cfg(target_vendor = "apple")]
        let flags = flags | OFlags::NOFOLLOW_ANY;
        #[cfg(not(target_vendor = "apple"))]
        let flags = flags | OFlags::NOFOLLOW;
        let fd = rustix::fs::openat(&self.root.file, relative, flags, Mode::empty())?;
        if device(&fd)? != self.dev {
            return Err(Errno::XDEV.into());
        }
        Ok(fd)
    }
}

/// `stat`'s `st_dev`, whose type differs by platform.
#[allow(clippy::unnecessary_cast, clippy::useless_conversion)]
fn device(fd: impl std::os::fd::AsFd) -> io::Result<u64> {
    Ok(rustix::fs::fstat(fd)?.st_dev as u64)
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

/// Fuzzy: score, then the shorter path, then bytes. Glob: depth, then the last segment with
/// ASCII case folded, then bytes. `rank` is lower for better in both.
fn order(glob: bool, (a_rank, a): (i32, &str), (b_rank, b): (i32, &str)) -> Ordering {
    a_rank
        .cmp(&b_rank)
        .then_with(|| {
            if glob {
                fold_cmp(last_segment(a).as_bytes(), last_segment(b).as_bytes())
            } else {
                a.len().cmp(&b.len())
            }
        })
        .then_with(|| a.cmp(b))
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

fn last_segment(path: &str) -> &str {
    &path[last_start(path)..]
}

/// The byte where the last segment starts.
fn last_start(path: &str) -> usize {
    path.rfind('/').map_or(0, |slash| slash + 1)
}

fn depth(path: &str) -> i32 {
    i32::try_from(path.bytes().filter(|&byte| byte == b'/').count()).unwrap_or(i32::MAX)
}

/// A parsed `q`.
#[derive(Debug)]
pub enum Pattern {
    Fuzzy(Fuzzy),
    Glob(Glob),
}

impl Pattern {
    /// `None`: empty, too long, or nothing but spaces.
    pub fn parse(q: &str) -> Option<Self> {
        if q.is_empty() || q.len() > MAX_QUERY {
            return None;
        }
        // Smart case: an uppercase letter in `q` makes the whole query exact.
        let fold = !q.bytes().any(|byte| byte.is_ascii_uppercase());
        if q.contains(['*', '?']) {
            return Some(Self::Glob(Glob::parse(q, fold)));
        }
        let terms: Vec<Vec<char>> = q
            .split(' ')
            .filter(|term| !term.is_empty())
            .map(|term| term.chars().collect())
            .collect();
        (!terms.is_empty()).then_some(Self::Fuzzy(Fuzzy { terms, fold }))
    }

    fn is_glob(&self) -> bool {
        matches!(self, Self::Glob(_))
    }

    /// Lower ranks better; `None`: no match.
    fn rank(&self, path: &str) -> Option<i32> {
        match self {
            Self::Fuzzy(fuzzy) => fuzzy.score(path, None).map(|score| -score),
            Self::Glob(glob) => glob.matches(path, None).then(|| depth(path)),
        }
    }

    /// The runs of `path` that matched, in UTF-16 code units.
    fn hits(&self, path: &str) -> Vec<[u16; 2]> {
        let mut hits = Vec::new();
        match self {
            Self::Fuzzy(fuzzy) => drop(fuzzy.score(path, Some(&mut hits))),
            Self::Glob(glob) => drop(glob.matches(path, Some(&mut hits))),
        }
        utf16_runs(path, hits)
    }
}

fn same(fold: bool, text: char, pattern: char) -> bool {
    if fold {
        text.to_ascii_lowercase() == pattern
    } else {
        text == pattern
    }
}

/// Byte offsets of matched scalars, in any order, as `[start, end)` UTF-16 runs.
fn utf16_runs(path: &str, mut hits: Vec<usize>) -> Vec<[u16; 2]> {
    hits.sort_unstable();
    hits.dedup();
    let mut hits = hits.into_iter().peekable();
    let mut runs: Vec<[u16; 2]> = Vec::new();
    let mut at: u16 = 0;
    for (offset, scalar) in path.char_indices() {
        // A relative path is a few KiB at most.
        let width = scalar.len_utf16() as u16;
        if hits.next_if_eq(&offset).is_some() {
            match runs.last_mut() {
                Some(run) if run[1] == at => run[1] += width,
                _ => runs.push([at, at + width]),
            }
        }
        at += width;
    }
    runs
}

/// Space-separated terms, each a subsequence of the path.
#[derive(Debug)]
pub struct Fuzzy {
    terms: Vec<Vec<char>>,
    fold: bool,
}

/// Per matched scalar.
const MATCH: i32 = 16;
/// After `/`, or at the path's start.
const SEGMENT_START: i32 = 10;
/// After `_`, `-`, `.` or a space, or a lowercase-to-uppercase change.
const WORD_START: i32 = 8;
/// Right after the previous matched scalar.
const CONSECUTIVE: i32 = 4;
/// Matched in the last segment.
const LAST_SEGMENT: i32 = 2;
/// A gap between matched scalars costs this, then `GAP_EXTEND` per scalar past its first.
const GAP_START: i32 = 3;
const GAP_EXTEND: i32 = 1;
/// Per folder level of the path, once: nearer files rank first.
const DEPTH: i32 = 2;

impl Fuzzy {
    /// The sum of the terms' scores less the depth, or `None` if a term doesn't match.
    /// `hits` gets the byte offset of every matched scalar.
    fn score(&self, path: &str, mut hits: Option<&mut Vec<usize>>) -> Option<i32> {
        let last = last_start(path);
        let mut total = -DEPTH * depth(path);
        for term in &self.terms {
            let window = self
                .align(path, last, term)
                .or_else(|| self.align(path, 0, term))?;
            total += self.score_window(path, last, window, term, hits.as_deref_mut());
        }
        Some(total)
    }

    /// fzf v1: the leftmost subsequence match in `path[from..]`, then a backward pass from
    /// its end to the latest start, the shortest window ending there. Bytes, `[start, end)`.
    fn align(&self, path: &str, from: usize, term: &[char]) -> Option<(usize, usize)> {
        let text = &path[from..];
        let mut next = 0;
        let mut end = None;
        for (offset, scalar) in text.char_indices() {
            if same(self.fold, scalar, term[next]) {
                next += 1;
                if next == term.len() {
                    end = Some(offset + scalar.len_utf8());
                    break;
                }
            }
        }
        let end = end?;
        let mut start = 0;
        for (offset, scalar) in text[..end].char_indices().rev() {
            if same(self.fold, scalar, term[next - 1]) {
                next -= 1;
                if next == 0 {
                    start = offset;
                    break;
                }
            }
        }
        Some((from + start, from + end))
    }

    /// Scores the window's greedy forward match of `term`.
    fn score_window(
        &self,
        path: &str,
        last: usize,
        (start, end): (usize, usize),
        term: &[char],
        mut hits: Option<&mut Vec<usize>>,
    ) -> i32 {
        let mut score = 0;
        let mut before = path[..start].chars().next_back();
        let mut next = 0;
        let mut previous: Option<usize> = None;
        for (index, (offset, scalar)) in path[start..end].char_indices().enumerate() {
            if next < term.len() && same(self.fold, scalar, term[next]) {
                score += MATCH + boundary(before, scalar);
                if let Some(previous) = previous {
                    let gap = i32::try_from(index - previous - 1).unwrap_or(i32::MAX / 2);
                    score += match gap {
                        0 => CONSECUTIVE,
                        gap => -(GAP_START + (gap - 1) * GAP_EXTEND),
                    };
                }
                if start + offset >= last {
                    score += LAST_SEGMENT;
                }
                if let Some(hits) = hits.as_deref_mut() {
                    hits.push(start + offset);
                }
                previous = Some(index);
                next += 1;
            }
            before = Some(scalar);
        }
        score
    }
}

fn boundary(before: Option<char>, scalar: char) -> i32 {
    match before {
        None | Some('/') => SEGMENT_START,
        Some('_' | '-' | '.' | ' ') => WORD_START,
        Some(before) if before.is_ascii_lowercase() && scalar.is_ascii_uppercase() => WORD_START,
        Some(_) => 0,
    }
}

/// `*` within a segment, `?` one scalar of one, `**` whole segments; anchored at both ends,
/// against the last segment when the pattern has no `/`.
#[derive(Debug)]
pub struct Glob {
    tokens: Vec<Token>,
    segment_only: bool,
    fold: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Token {
    Literal(char),
    /// `?`.
    One,
    /// `*`, or a `**` not bounded by `/` or the pattern's ends.
    Star,
    /// `**/`: zero or more whole segments, each with its `/`.
    Segments,
    /// A trailing `**`: everything left.
    Rest,
}

impl Glob {
    fn parse(q: &str, fold: bool) -> Self {
        let scalars: Vec<char> = q.chars().collect();
        let mut tokens = Vec::new();
        let mut at = 0;
        while at < scalars.len() {
            let token = match scalars[at] {
                '*' => {
                    let run = scalars[at..].iter().take_while(|&&c| c == '*').count();
                    let after = at + run;
                    let left = at == 0 || scalars[at - 1] == '/';
                    let right = after == scalars.len() || scalars[after] == '/';
                    at = after;
                    match (run >= 2 && left && right, after == scalars.len()) {
                        (true, true) => Token::Rest,
                        (true, false) => {
                            at += 1; // the `/` belongs to `**/`
                            Token::Segments
                        }
                        (false, _) => Token::Star,
                    }
                }
                '?' => {
                    at += 1;
                    Token::One
                }
                literal => {
                    at += 1;
                    Token::Literal(if fold {
                        literal.to_ascii_lowercase()
                    } else {
                        literal
                    })
                }
            };
            tokens.push(token);
        }
        Self {
            segment_only: !scalars.contains(&'/'),
            tokens,
            fold,
        }
    }

    /// Iterative, with one backtrack point for `*` and one for `**/`; never recursive.
    /// `hits` gets the byte offsets the literals matched.
    fn matches(&self, path: &str, mut hits: Option<&mut Vec<usize>>) -> bool {
        let base = if self.segment_only {
            last_start(path)
        } else {
            0
        };
        let text = &path[base..];
        let next_at = |at: usize| text[at..].chars().next();
        // (token after it, where it resumes in `text`, hits kept).
        let mut star: Option<(usize, usize, usize)> = None;
        let mut segments: Option<(usize, usize, usize)> = None;
        let kept = |hits: &Option<&mut Vec<usize>>| hits.as_ref().map_or(0, |hits| hits.len());
        let (mut token, mut at) = (0, 0);
        loop {
            if let Some(&current) = self.tokens.get(token) {
                match (current, next_at(at)) {
                    (Token::Rest, _) => return true,
                    (Token::Segments, _) => {
                        segments = Some((token + 1, at, kept(&hits)));
                        star = None;
                        token += 1;
                        continue;
                    }
                    (Token::Star, _) => {
                        star = Some((token + 1, at, kept(&hits)));
                        token += 1;
                        continue;
                    }
                    (Token::One, Some(scalar)) if scalar != '/' => {
                        token += 1;
                        at += scalar.len_utf8();
                        continue;
                    }
                    (Token::Literal(literal), Some(scalar)) if same(self.fold, scalar, literal) => {
                        if let Some(hits) = hits.as_deref_mut() {
                            hits.push(base + at);
                        }
                        token += 1;
                        at += scalar.len_utf8();
                        continue;
                    }
                    _ => {}
                }
            } else if at == text.len() {
                return true;
            }
            // `*` takes one more scalar of its segment; failing that, `**/` one more segment.
            if let Some((resume, from, kept)) = star {
                if let Some(scalar) = next_at(from).filter(|&scalar| scalar != '/') {
                    let from = from + scalar.len_utf8();
                    star = Some((resume, from, kept));
                    (token, at) = (resume, from);
                    if let Some(hits) = hits.as_deref_mut() {
                        hits.truncate(kept);
                    }
                    continue;
                }
            }
            if let Some((resume, from, kept)) = segments {
                if let Some(slash) = text[from..].find('/') {
                    let from = from + slash + 1;
                    segments = Some((resume, from, kept));
                    star = None;
                    (token, at) = (resume, from);
                    if let Some(hits) = hits.as_deref_mut() {
                        hits.truncate(kept);
                    }
                    continue;
                }
            }
            return false;
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

    fn hits(q: &str, path: &str) -> Option<Vec<[u16; 2]>> {
        let pattern = parse(q);
        pattern.rank(path).map(|_| pattern.hits(path))
    }

    /// `paths` in rank order, unmatched ones left out.
    fn ranked<'a>(q: &str, paths: &[&'a str]) -> Vec<&'a str> {
        let pattern = parse(q);
        let mut best = Best::new(pattern.is_glob());
        for path in paths {
            if let Some(rank) = pattern.rank(path) {
                best.offer(rank, path, FileType::RegularFile);
            }
        }
        best.found
            .iter()
            .map(|found| {
                *paths
                    .iter()
                    .find(|path| **path == found.path)
                    .expect("offered")
            })
            .collect()
    }

    #[test]
    fn fuzzy_aligns_like_fzf_v1_and_ranks_starts_runs_and_nearness() {
        // Leftmost match, then tightened back from its end.
        assert_eq!(hits("ab", "axxab"), Some(vec![[3, 5]]));
        // The last segment first, even where the whole path matches sooner.
        assert_eq!(hits("ab", "ab/xaxb"), Some(vec![[4, 5], [6, 7]]));
        assert_eq!(hits("srcm", "src/main.rs"), Some(vec![[0, 3], [4, 5]]));
        assert_eq!(hits("zz", "src/main.rs"), None);
        assert_eq!(
            ranked(
                "main",
                &["a/b/main.rs", "src/domain.rs", "src/main.rs", "x/y/remain"]
            ),
            ["src/main.rs", "a/b/main.rs", "src/domain.rs", "x/y/remain"]
        );
        // Word starts and a camel hump beat a scattered match.
        assert_eq!(
            ranked("fb", &["xfxb", "foo_bar", "fooBar"]),
            ["fooBar", "foo_bar", "xfxb"]
        );
        // Ties: the shorter path, then bytes.
        assert_eq!(ranked("a", &["b/ab", "c/a", "b/a"]), ["b/a", "c/a", "b/ab"]);
    }

    #[test]
    fn fuzzy_terms_all_match_in_any_order_with_smart_case() {
        assert_eq!(hits("main src", "src/main.rs"), Some(vec![[0, 3], [4, 8]]));
        assert_eq!(hits("src main ", "src/main.rs"), Some(vec![[0, 3], [4, 8]]));
        // Terms may share scalars.
        assert_eq!(hits("ma ain", "main"), Some(vec![[0, 4]]));
        assert_eq!(hits("main lib", "src/main.rs"), None);
        assert!(Pattern::parse("   ").is_none());
        assert!(Pattern::parse("").is_none());
        assert!(Pattern::parse(&"a".repeat(MAX_QUERY + 1)).is_none());
        // Lowercase folds ASCII; an uppercase letter makes the query exact.
        assert!(hits("main", "MAIN.rs").is_some());
        assert!(hits("Main", "main.rs").is_none());
        assert!(hits("Main", "Main.rs").is_some());
        // Only ASCII folds, and nothing is normalised.
        assert!(hits("é", "É.txt").is_none());
        assert!(hits("e\u{301}", "\u{e9}.txt").is_none());
    }

    #[test]
    fn hits_are_utf16_runs() {
        // `é` is one unit, `😀` two.
        assert_eq!(hits("x", "é/😀x.txt"), Some(vec![[4, 5]]));
        assert_eq!(hits("😀x", "é/😀x.txt"), Some(vec![[2, 5]]));
        assert_eq!(hits("é😀", "é/😀x.txt"), Some(vec![[0, 1], [2, 4]]));
    }

    #[test]
    fn globs_match_segments_and_anchor() {
        let matched = |q: &str, path: &str| parse(q).rank(path).is_some();
        // No `/`: the whole last segment.
        assert!(matched("*.rs", "src/main.rs"));
        assert!(!matched("*.rs", "src/main.rsx"));
        assert!(!matched("ma*", "main/x.rs"));
        assert!(matched("m?in.rs", "src/main.rs"));
        assert!(matched("?.rs", "é.rs") && !matched("?.rs", "ab.rs"));
        // With `/`: the whole path; `*` and `?` stay within a segment.
        assert!(matched("src/*.rs", "src/main.rs"));
        assert!(!matched("src/*.rs", "src/a/main.rs"));
        assert!(!matched("src/*", "a/src/x"));
        assert!(!matched("s?c", "s/c") && !matched("s*c", "s/c"));
        // `**` is whole segments, zero included; unbounded it is a `*`.
        for path in ["src/main.rs", "src/a/main.rs", "src/a/b/main.rs"] {
            assert!(matched("src/**/main.rs", path), "{path}");
        }
        assert!(!matched("src/**/main.rs", "xsrc/main.rs"));
        assert!(!matched("src/**/main.rs", "src/amain.rs"));
        assert!(matched("**/main.rs", "main.rs") && matched("**/main.rs", "a/b/main.rs"));
        assert!(matched("src/**", "src/a/b") && !matched("src/**", "src"));
        assert!(matched("a**b", "axxb") && !matched("a/x**b", "a/x/b"));
        assert!(matched("**", "anything/at/all"));
        // Backtracking: `*` then `**/` both retry.
        assert!(matched("a*b/**/c*d", "axbyb/q/r/cxdyd"));
        assert!(!matched("a*b/**/c*d", "axbyb/q/r/cxdyx"));
        // `[` is literal; there's no escape.
        assert!(matched("[a]*", "[a]b") && !matched("[a]*", "ab"));
        // Smart case.
        assert!(matched("*.RS", "MAIN.RS") && !matched("*.RS", "main.rs"));
        assert!(matched("*.rs", "MAIN.RS"));
    }

    #[test]
    fn glob_hits_are_the_literals_and_rank_by_depth_then_name() {
        assert_eq!(hits("*.rs", "src/main.rs"), Some(vec![[8, 11]]));
        assert_eq!(
            hits("s*/**/m?in.rs", "src/a/main.rs"),
            Some(vec![[0, 1], [3, 4], [6, 7], [8, 13]])
        );
        assert_eq!(
            ranked(
                "*.rs",
                &["a/b/c.rs", "b/Z.rs", "b/a.rs", "z.rs", "a/A.rs", "a/a.rs"]
            ),
            ["z.rs", "a/A.rs", "a/a.rs", "b/a.rs", "b/Z.rs", "a/b/c.rs"]
        );
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
        let root = open(&tree.str(""), Path::new("/"), Want::Dir).expect("the root");
        let cancel = AtomicBool::new(false);
        search(&root, &parse(q), Filter { hidden }, caps, &cancel).expect("searched")
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
            "docs/target",
            ".hidden/main.rs",
            ".env",
            "node_modules/pkg/main.js",
            "target/debug/main",
            ".git/main",
        ] {
            tree.write(file, b"fn main() {}");
        }
        symlink(tree.path("src"), tree.path("linked")).expect("a link");
        symlink(tree.path("missing"), tree.path("broken")).expect("a link");
        tree
    }

    #[test]
    fn the_walk_skips_links_builds_and_dotfiles_and_answers_entries() {
        let tree = sample();
        let everything = walk(&tree, "**", false, &CAPS);
        assert_eq!(
            paths(&everything),
            [
                "broken",
                "docs",
                "docs/target",
                "linked",
                "src",
                "src/deep",
                "src/deep/main.rs",
                "src/main.rs"
            ]
        );
        // Skipped names count as read: 9 at the root, 2 + 1 + 1 below.
        assert_eq!((everything.read, everything.stopped), (13, None));
        let with_hidden = walk(&tree, "**", true, &CAPS);
        assert!(paths(&with_hidden).contains(&".hidden/main.rs"));
        assert!(paths(&with_hidden).contains(&".env"));
        assert!(
            !paths(&with_hidden)
                .iter()
                .any(|path| path.starts_with(".git"))
        );

        let found = walk(&tree, "main", false, &CAPS);
        assert_eq!(found.path, tree.str(""));
        assert_eq!(paths(&found), ["src/deep/main.rs", "src/main.rs"]);
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
        assert_eq!(paths(&timed), ["broken", "docs", "linked", "src"]);
        // Room for `docs` alone (2 + 4 bytes): it is read, `src` never queued.
        let queued = walk(&tree, "**", false, &caps(CAPS.entries, CAPS.time, 6));
        assert_eq!(queued.stopped, Some(Stopped::Queue));
        assert_eq!(
            paths(&queued),
            ["broken", "docs", "docs/target", "linked", "src"]
        );

        let root = open(&tree.str(""), Path::new("/"), Want::Dir).expect("the root");
        let cancelled = AtomicBool::new(true);
        let stopped = search(
            &root,
            &parse("**"),
            Filter { hidden: false },
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
        assert_eq!(paths(&found), ["src/main.rs"]);
        assert_eq!(found.stopped, None);
    }
}
