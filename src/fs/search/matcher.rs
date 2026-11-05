//! Search's matcher (fs.md "GET /fs/search"): pure, no I/O. A fuzzy alignment in the style of
//! fzf's v1, or a glob once the query has `*` or `?`; `order` ranks the results.

use std::cmp::Ordering;

use crate::fs::list::fold_cmp;

/// The longest `q`, in bytes.
pub const MAX_QUERY: usize = 256;

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

    pub(super) fn is_glob(&self) -> bool {
        matches!(self, Self::Glob(_))
    }

    /// Lower ranks better; `None`: no match.
    pub(super) fn rank(&self, path: &str) -> Option<i32> {
        match self {
            Self::Fuzzy(fuzzy) => fuzzy.score(path, None).map(|score| -score),
            Self::Glob(glob) => glob.matches(path, None).then(|| depth(path)),
        }
    }

    /// The runs of `path` that matched, in UTF-16 code units.
    pub(super) fn hits(&self, path: &str) -> Vec<[u16; 2]> {
        let mut hits = Vec::new();
        match self {
            Self::Fuzzy(fuzzy) => drop(fuzzy.score(path, Some(&mut hits))),
            Self::Glob(glob) => drop(glob.matches(path, Some(&mut hits))),
        }
        utf16_runs(path, hits)
    }
}

/// Fuzzy: score, then the shorter path, then bytes. Glob: depth, then the last segment with
/// ASCII case folded, then bytes. `rank` is lower for better in both.
pub(super) fn order(glob: bool, (a_rank, a): (i32, &str), (b_rank, b): (i32, &str)) -> Ordering {
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

pub(super) fn last_segment(path: &str) -> &str {
    &path[last_start(path)..]
}

/// The byte where the last segment starts.
fn last_start(path: &str) -> usize {
    path.rfind('/').map_or(0, |slash| slash + 1)
}

fn depth(path: &str) -> i32 {
    i32::try_from(path.bytes().filter(|&byte| byte == b'/').count()).unwrap_or(i32::MAX)
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

/// The server's search skip patterns (fs.md "Skipped"): a folder whose name one matches is
/// listed but not entered. Each is a name, or a glob with `*` and `?` over the name alone,
/// compared exactly. One with a `/` (only a hand edit can write it) matches no name.
#[derive(Debug)]
pub struct Skip(Vec<Glob>);

impl Skip {
    pub fn new(patterns: &[String]) -> Self {
        Self(
            patterns
                .iter()
                .filter(|pattern| !pattern.is_empty() && !pattern.contains('/'))
                .map(|pattern| Glob::parse(pattern, false))
                .collect(),
        )
    }

    pub(super) fn skips(&self, name: &str) -> bool {
        self.0.iter().any(|glob| glob.matches(name, None))
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
    use super::*;

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
        let mut ranked: Vec<(i32, &str)> = paths
            .iter()
            .filter_map(|path| Some((pattern.rank(path)?, *path)))
            .collect();
        ranked.sort_by(|&a, &b| order(pattern.is_glob(), a, b));
        ranked.into_iter().map(|(_, path)| path).collect()
    }

    #[test]
    fn skip_patterns_match_the_whole_name_exactly() {
        let skip = Skip::new(&[
            "build".into(),
            "*.egg-info".into(),
            "[x]".into(),
            "a/b".into(),
        ]);
        for (name, skipped) in [
            ("build", true),
            ("Build", false),
            ("builds", false),
            ("pkg.egg-info", true),
            ("egg-info", false),
            ("[x]", true),
            ("x", false),
            ("b", false),
        ] {
            assert_eq!(skip.skips(name), skipped, "{name}");
        }
        assert!(Skip::new(&["**".into()]).skips("anything"));
        assert!(!Skip::new(&[]).skips("node_modules"));
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
}
