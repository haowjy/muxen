//! The pieces of Settings' writes to `config.toml` (fs.md "Server settings");
//! `LiveConfig::save` puts them together under its lock. A symlinked file is written at its
//! target; only `search_skip` and `uploads_dir` change, with `toml_edit` keeping comments,
//! order and unknown keys; the text goes through `files::Temp` with the file's mode.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

use rustix::io::Errno;
use thiserror::Error;
use toml_edit::{Array, DocumentMut, Item, Value};

use super::{Config, ConfigError};
use crate::files::{Dir, Stamp, Temp};
use crate::proto::settings::{Patch, SettingsChange};

/// Writes retried when the file changed under one, before `busy`.
pub(super) const TRIES: usize = 3;
/// Validation (fs.md "Server settings").
const MAX_PATTERNS: usize = 64;
const MAX_PATTERN: usize = 255;
const MAX_UPLOADS_DIR: usize = 4096;

#[derive(Debug, Error)]
pub enum SaveError {
    #[error("bad request")]
    BadRequest,
    #[error("config.toml kept changing while it was written")]
    Busy,
    #[error("config.toml can't be written: {0}")]
    ReadOnly(io::Error),
    /// The file exists and doesn't parse: it is never written.
    #[error(transparent)]
    Unavailable(#[from] ConfigError),
    #[error(transparent)]
    Internal(io::Error),
}

/// No fs thread or settings slot in time: the same answer as a save that kept losing.
impl From<crate::blocking::Busy> for SaveError {
    fn from(crate::blocking::Busy: crate::blocking::Busy) -> Self {
        Self::Busy
    }
}

/// `change` as it will be written, or `BadRequest`: duplicate patterns dropped, order
/// kept.
pub fn validated(change: SettingsChange) -> Result<SettingsChange, SaveError> {
    let search_skip = match change.search_skip {
        Patch::Set(patterns) => {
            let mut kept: Vec<String> = Vec::with_capacity(patterns.len());
            for pattern in patterns {
                let bad = pattern.is_empty()
                    || pattern.len() > MAX_PATTERN
                    || pattern.contains(['/', '\0'])
                    || pattern.chars().all(|c| c == '*');
                if bad {
                    return Err(SaveError::BadRequest);
                }
                if !kept.contains(&pattern) {
                    kept.push(pattern);
                }
            }
            if kept.len() > MAX_PATTERNS {
                return Err(SaveError::BadRequest);
            }
            Patch::Set(kept)
        }
        other => other,
    };
    if let Patch::Set(dir) = &change.uploads_dir {
        let shaped = dir.starts_with("~/") || Path::new(dir).is_absolute();
        if !shaped || dir.len() > MAX_UPLOADS_DIR || dir.contains('\0') {
            return Err(SaveError::BadRequest);
        }
    }
    Ok(SettingsChange {
        search_skip,
        uploads_dir: change.uploads_dir,
    })
}

/// The file a save writes: the canonical target, opened through its directory.
pub(super) struct Target {
    pub(super) path: PathBuf,
    dir: Dir,
    name: OsString,
    temp_name: OsString,
}

impl Target {
    /// `path`'s target (`target`), its directory opened.
    pub(super) fn open(path: &Path) -> Result<Self, SaveError> {
        let path = target(path)?;
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Err(SaveError::Internal(io::Error::other(
                "config.toml has no name",
            )));
        };
        let dir = Dir::open(parent).map_err(write_error)?;
        // The rename would replace a file Jimmy made read-only; the spec refuses it.
        dir.check_writable(name).map_err(write_error)?;
        let name = name.to_owned();
        let mut temp_name = name.clone();
        temp_name.push(".tmp");
        Ok(Self {
            path,
            dir,
            name,
            temp_name,
        })
    }

    /// The file as it is now; a missing file is an empty one, mode 0600.
    pub(super) fn read(&self) -> Result<Before, SaveError> {
        let unreadable = |source| ConfigError::Io {
            path: self.path.clone(),
            source,
        };
        let Some(opened) = self.dir.read(&self.name).map_err(unreadable)? else {
            return Ok(Before {
                text: String::new(),
                stamp: None,
                mode: 0o600,
            });
        };
        let meta = opened.metadata().map_err(SaveError::Internal)?;
        let text = io::read_to_string(&opened).map_err(unreadable)?;
        Ok(Before {
            text,
            stamp: Some(Stamp::of(&meta)),
            mode: meta.permissions().mode() & 0o7777,
        })
    }

    /// `text` in place of the file if it is still as `before` was; `None` if it has
    /// changed since. The new file has `before`'s mode.
    pub(super) fn replace_if(
        &self,
        before: &Before,
        text: &str,
    ) -> Result<Option<Stamp>, SaveError> {
        let temp = Temp::create(&self.dir, &self.temp_name, before.mode).map_err(write_error)?;
        temp.replace_if(&self.name, text.as_bytes(), before.stamp)
            .map_err(write_error)
    }
}

/// `before` with `change` applied, and the config it parses to; `None` if the text
/// comes out the same.
pub(super) fn edited(
    path: &Path,
    before: &str,
    change: &SettingsChange,
) -> Result<Option<(String, Config)>, SaveError> {
    let mut doc: DocumentMut = before.parse().map_err(|_| ConfigError::Parse {
        path: path.to_owned(),
        line: 0,
        column: 0,
    })?;
    edit(&mut doc, change);
    let text = doc.to_string();
    if text == before {
        return Ok(None);
    }
    let written = Config::parse(path, &text).map_err(|error| {
        SaveError::Internal(io::Error::other(format!("the edit doesn't parse: {error}")))
    })?;
    Ok(Some((text, written)))
}

/// Applies `change` to `doc`, leaving every other key, comment and table as it was.
fn edit(doc: &mut DocumentMut, change: &SettingsChange) {
    let was_empty = doc.is_empty();
    match &change.search_skip {
        Patch::Keep => {}
        Patch::Remove => drop(doc.remove("search_skip")),
        Patch::Set(patterns) => set_list(doc, "search_skip", patterns),
    }
    match &change.uploads_dir {
        Patch::Keep => {}
        Patch::Remove => drop(doc.remove("uploads_dir")),
        Patch::Set(dir) => set_string(doc, "uploads_dir", dir),
    }
    // A file of only comments holds them as the document's trailing text, which a new key
    // would go above: they move before the first key, so the header stays on top.
    let first = doc.iter().next().map(|(key, _)| key.to_owned());
    if let (true, Some(first)) = (was_empty, first) {
        let header = doc.trailing().as_str().unwrap_or_default().to_owned();
        if let Some(mut key) = doc.key_mut(&first) {
            key.leaf_decor_mut().set_prefix(header);
        }
        doc.set_trailing("");
    }
}

// In `toml_edit`, the comment after an array entry's comma is the next entry's prefix
// (or the array's trailing text after the last entry): a prefix is the tail of the line
// before, up to its newline, then the entry's own lines. Adding and removing entries
// moves those line tails, so a comment stays on the line it was written on.

/// Makes `key` the list `wanted`: the entries no longer wanted are removed and the new
/// ones appended, laid out like the rest, so a hand-written list keeps its comments. A
/// list that would come out in another order is written afresh.
fn set_list(doc: &mut DocumentMut, key: &str, wanted: &[String]) {
    let Some(list) = doc.get_mut(key).and_then(Item::as_array_mut) else {
        doc.insert(key, Item::Value(Value::Array(Array::from_iter(wanted))));
        return;
    };
    remove_entries(list, |entry| !wanted.iter().any(|kept| kept == entry));
    let present: Vec<String> = list
        .iter()
        .filter_map(|entry| entry.as_str().map(str::to_owned))
        .collect();
    for entry in wanted {
        if !present.contains(entry) {
            append(list, entry);
        }
    }
    let now: Vec<&str> = list.iter().filter_map(Value::as_str).collect();
    if now != wanted {
        let decor = list.decor().clone();
        *list = Array::from_iter(wanted);
        *list.decor_mut() = decor;
    }
}

/// Appends to `list`, laid out like the entries before it.
fn append(list: &mut Array, text: &str) {
    let trailing = list.trailing().as_str().unwrap_or_default().to_owned();
    let last = list.iter().last().map(prefix);
    let multi_line =
        trailing.contains('\n') || list.iter().any(|entry| prefix(entry).contains('\n'));
    let mut entry = Value::from(text);
    if multi_line {
        // With no comma after the last entry, the line break before `]` is that entry's
        // suffix, not the array's trailing text: move it there, so the new entry goes
        // after the comma, on a line of its own.
        let suffix = list.iter().last().map(suffix).unwrap_or_default();
        if let Some(last) = list.iter_mut().last() {
            last.decor_mut().set_suffix("");
        }
        let trailing = format!("{suffix}{trailing}");
        let indent = last.as_deref().map_or("  ", own_lines);
        entry
            .decor_mut()
            .set_prefix(format!("{}{indent}", line_tail(&trailing)));
        list.set_trailing(format!("\n{}", own_lines(&trailing)));
    } else if last.is_some() {
        entry.decor_mut().set_prefix(" ");
    }
    list.push_formatted(entry);
}

/// Removes the entries `doomed` picks.
fn remove_entries(list: &mut Array, doomed: impl Fn(&str) -> bool) {
    // The line tail of the entry before a removed run, waiting for the next survivor.
    let mut carried: Option<String> = None;
    let mut index = 0;
    while let Some(entry) = list.get(index) {
        let text = prefix(entry);
        if entry.as_str().is_some_and(&doomed) {
            carried.get_or_insert_with(|| line_tail(&text).to_owned());
            list.remove(index);
            continue;
        }
        if let Some(tail) = carried.take() {
            let own = own_lines(&text);
            // A single-line array's first entry has no separator before it.
            let own = if index == 0 && !text.contains('\n') {
                own.trim_start()
            } else {
                own
            };
            if let Some(entry) = list.get_mut(index) {
                entry.decor_mut().set_prefix(format!("{tail}{own}"));
            }
        }
        index += 1;
    }
    if let Some(tail) = carried {
        let trailing = list.trailing().as_str().unwrap_or_default().to_owned();
        list.set_trailing(format!("{tail}{}", own_lines(&trailing)));
    }
}

fn prefix(entry: &Value) -> String {
    let prefix = entry.decor().prefix().and_then(|prefix| prefix.as_str());
    prefix.unwrap_or_default().to_owned()
}

fn suffix(entry: &Value) -> String {
    let suffix = entry.decor().suffix().and_then(|suffix| suffix.as_str());
    suffix.unwrap_or_default().to_owned()
}

/// The text up to and including the first newline: the line before's tail.
fn line_tail(text: &str) -> &str {
    text.find('\n').map_or("", |at| &text[..=at])
}

/// The text after the first newline: the entry's own lines and indent.
fn own_lines(text: &str) -> &str {
    text.find('\n').map_or(text, |at| &text[at + 1..])
}

/// Replaces `key`'s value, keeping a comment after the old one.
fn set_string(doc: &mut DocumentMut, key: &str, text: &str) {
    match doc.get_mut(key).and_then(Item::as_value_mut) {
        Some(value) => {
            let decor = value.decor().clone();
            *value = Value::from(text);
            *value.decor_mut() = decor;
        }
        None => {
            doc.insert(key, toml_edit::value(text));
        }
    }
}

/// The file to write: a symlink's target, so a dotfiles link stays a link. A missing
/// file is written where it was looked for, its directory created 0700. A link whose
/// target is missing, the file's or a directory's on the way, is refused and both are
/// left alone: renaming over it would replace the link with a copy, and following it
/// would create a file, or directories, wherever it points.
fn target(path: &Path) -> Result<PathBuf, SaveError> {
    let refuse = |why: &str| SaveError::ReadOnly(io::Error::other(why));
    match fs::canonicalize(path) {
        Ok(target) => Ok(target),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // Missing, yet there: a link to nothing.
            if fs::symlink_metadata(path).is_ok() {
                return Err(refuse("it is a symlink to nothing"));
            }
            let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
                return Err(SaveError::Internal(error));
            };
            // `mkdir` meets a dangling link to a directory as an entry that is there
            // but isn't a directory.
            let created = fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(dir);
            match created {
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    return Err(refuse(
                        "a directory on the way is a symlink to nothing or a file",
                    ));
                }
                created => created.map_err(write_error)?,
            }
            Ok(fs::canonicalize(dir).map_err(write_error)?.join(name))
        }
        Err(error) => Err(write_error(error)),
    }
}

/// The file as read, to change and to compare against before the rename: its text,
/// its stamp (`None`: missing) and its mode, which the new file gets exactly.
pub(super) struct Before {
    pub(super) text: String,
    pub(super) stamp: Option<Stamp>,
    mode: u32,
}

/// A file Jimmy can't write (read-only filesystem, a link into `/nix/store`) is a
/// conflict, not a failure.
fn write_error(error: io::Error) -> SaveError {
    match error.raw_os_error().map(Errno::from_raw_os_error) {
        Some(Errno::ROFS | Errno::ACCESS | Errno::PERM) => SaveError::ReadOnly(error),
        _ => SaveError::Internal(error),
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;
    use crate::config::{ConfigFile, LiveConfig};
    use crate::fs::test_tree::Tree;

    const HAND_WRITTEN: &str = r#"# muxen's config, by hand.
name = "devbox" # the phone shows this

# Folders Search doesn't enter.
search_skip = [
  "node_modules", # npm
  "vendor",
]

uploads_dir = "~/inbox" # photos land here
future_key = { from = "a newer daemon" }

[tmux]
# The private server.
socket_name = "work"

[future_table]
answer = 42
"#;

    fn live(tree: &Tree, path: &str) -> LiveConfig {
        let file = ConfigFile::resolve(Some(&tree.path(path))).expect("a path");
        let (config, stamp) = file.read().unwrap_or_default();
        LiveConfig::new(file, config, stamp)
    }

    fn set(search_skip: Patch<Vec<String>>, uploads_dir: Patch<String>) -> SettingsChange {
        SettingsChange {
            search_skip,
            uploads_dir,
        }
    }

    fn list(items: &[&str]) -> Patch<Vec<String>> {
        Patch::Set(items.iter().map(|&item| item.to_owned()).collect())
    }

    #[test]
    fn a_save_keeps_comments_order_and_unknown_keys_and_applies_at_once() {
        let tree = Tree::new("write-keep");
        tree.write("config.toml", HAND_WRITTEN.as_bytes());
        let live = live(&tree, "config.toml");
        let read = || std::fs::read_to_string(tree.path("config.toml")).expect("read");

        let add = set(list(&["node_modules", "vendor", "dist"]), Patch::Keep);
        live.save(&add).expect("saved");
        let expected = HAND_WRITTEN.replace("  \"vendor\",\n]", "  \"vendor\",\n  \"dist\",\n]");
        assert_eq!(read(), expected);
        assert_eq!(
            live.keys().search_skip(),
            ["node_modules", "vendor", "dist"]
        );
        assert!(!live.file_changed());

        let remove = set(list(&["vendor", "dist"]), Patch::Set("/srv/up".into()));
        live.save(&remove).expect("saved");
        let text = read();
        assert!(
            text.contains("search_skip = [\n  \"vendor\",\n  \"dist\",\n]"),
            "{text}"
        );
        assert!(
            text.contains("uploads_dir = \"/srv/up\" # photos land here\n"),
            "{text}"
        );
        for kept in [
            "# muxen's config",
            "# the phone shows this",
            "# Folders Search doesn't enter.",
            "future_key",
            "[future_table]",
            "# The private server.",
        ] {
            assert!(text.contains(kept), "{kept}: {text}");
        }
        assert_eq!(live.keys().uploads_dir(), "/srv/up");

        // `null` removes a key; the default applies again.
        live.save(&set(Patch::Remove, Patch::Remove))
            .expect("saved");
        let text = read();
        assert!(
            !text.contains("search_skip") && !text.contains("uploads_dir"),
            "{text}"
        );
        assert_eq!(live.keys().search_skip(), ["node_modules"]);
        assert!(Config::parse(Path::new("config.toml"), &text).is_ok());
    }

    #[test]
    fn a_symlinked_config_is_written_at_its_target_and_a_dangling_one_is_refused() {
        let tree = Tree::new("write-link");
        tree.mkdir("dotfiles");
        tree.write("dotfiles/config.toml", b"# mine\n");
        symlink(tree.path("dotfiles/config.toml"), tree.path("config.toml")).expect("a link");
        let live = live(&tree, "config.toml");
        let change = set(list(&[]), Patch::Keep);
        live.save(&change).expect("saved");
        let link = std::fs::symlink_metadata(tree.path("config.toml")).expect("there");
        assert!(link.file_type().is_symlink());
        let text = std::fs::read_to_string(tree.path("dotfiles/config.toml")).expect("read");
        assert_eq!(text, "# mine\nsearch_skip = []\n");
        assert_eq!(live.keys().search_skip, Some(Vec::new()));
        assert!(!live.file_changed());

        symlink(tree.path("nowhere.toml"), tree.path("dangling.toml")).expect("a link");
        let dangling = self::live(&tree, "dangling.toml");
        let refused = dangling.save(&change);
        assert!(
            matches!(refused, Err(SaveError::ReadOnly(_))),
            "{refused:?}"
        );
        assert!(!tree.path("nowhere.toml").exists());
    }

    #[test]
    fn an_append_and_a_first_key_keep_the_layout() {
        let tree = Tree::new("write-layout");
        let read = || std::fs::read_to_string(tree.path("config.toml")).expect("read");
        // A multi-line list with no comma after its last entry.
        tree.write(
            "config.toml",
            b"search_skip = [\n  \"a\",\n  \"b\" # mine\n]\n",
        );
        let live = live(&tree, "config.toml");
        live.save(&set(list(&["a", "b", "c"]), Patch::Keep))
            .expect("saved");
        assert_eq!(
            read(),
            "search_skip = [\n  \"a\",\n  \"b\", # mine\n  \"c\"\n]\n"
        );

        // A file of only comments keeps them on top.
        tree.write("config.toml", b"# header\n# more\n");
        let live = self::live(&tree, "config.toml");
        live.save(&set(list(&["a"]), Patch::Keep)).expect("saved");
        assert_eq!(read(), "# header\n# more\nsearch_skip = [\"a\"]\n");
    }

    #[test]
    fn a_read_only_file_is_refused() {
        let tree = Tree::new("write-read-only");
        tree.write("config.toml", b"# mine\n");
        let path = tree.path("config.toml");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).expect("chmod");
        let live = live(&tree, "config.toml");
        let refused = live.save(&set(list(&["a"]), Patch::Keep));
        assert!(
            matches!(refused, Err(SaveError::ReadOnly(_))),
            "{refused:?}"
        );
        assert_eq!(std::fs::read_to_string(&path).expect("read"), "# mine\n");
    }

    #[test]
    fn a_missing_file_and_its_folder_are_created() {
        let tree = Tree::new("write-missing");
        let live = live(&tree, "muxen/config.toml");
        let change = set(Patch::Keep, Patch::Set("~/up".into()));
        live.save(&change).expect("saved");
        let meta = |path| std::fs::metadata(tree.path(path)).expect("there");
        assert_eq!(meta("muxen").permissions().mode() & 0o777, 0o700);
        assert_eq!(
            meta("muxen/config.toml").permissions().mode() & 0o777,
            0o600
        );
        let text = std::fs::read_to_string(tree.path("muxen/config.toml")).expect("read");
        assert_eq!(text, "uploads_dir = \"~/up\"\n");
        assert_eq!(live.keys().uploads_dir(), "~/up");
    }

    #[test]
    fn a_file_that_doesnt_parse_is_never_written() {
        let tree = Tree::new("write-broken");
        tree.write("config.toml", b"uploads_dir = \"/a\"\n");
        let live = live(&tree, "config.toml");
        let broken = b"uploads_dir = \"/a\"\nsearch_skip = [\n";
        tree.write("config.toml", broken);
        let refused = live.save(&set(list(&["x"]), Patch::Keep));
        assert!(
            matches!(
                refused,
                Err(SaveError::Unavailable(ConfigError::Parse { line: 2, .. }))
            ),
            "{refused:?}"
        );
        assert_eq!(
            std::fs::read(tree.path("config.toml")).expect("read"),
            broken
        );
        assert_eq!(live.keys().uploads_dir(), "/a");
    }

    #[test]
    fn a_save_after_a_hand_edit_reloads_first_and_keeps_it() {
        let tree = Tree::new("write-hand");
        tree.write("config.toml", b"uploads_dir = \"/a\"\n");
        let live = live(&tree, "config.toml");
        tree.write("config.toml", b"uploads_dir = \"/b\"\n# by hand\n");
        assert!(live.file_changed());
        live.save(&set(list(&["x"]), Patch::Keep)).expect("saved");
        let text = std::fs::read_to_string(tree.path("config.toml")).expect("read");
        assert_eq!(
            text,
            "uploads_dir = \"/b\"\nsearch_skip = [\"x\"]\n# by hand\n"
        );
        assert_eq!(live.keys().uploads_dir(), "/b");
        assert!(!live.file_changed());
    }

    #[test]
    fn a_change_is_validated() {
        let bad = |change| matches!(validated(change), Err(SaveError::BadRequest));
        for patterns in [
            vec![String::new()],
            vec!["a/b".into()],
            vec!["a\0".into()],
            vec!["**".into()],
            vec!["x".repeat(256)],
            (0..65).map(|n| n.to_string()).collect(),
        ] {
            assert!(bad(set(Patch::Set(patterns), Patch::Keep)));
        }
        for dir in ["relative", "~user/x", "/a\0"] {
            assert!(bad(set(Patch::Keep, Patch::Set(dir.into()))), "{dir}");
        }
        let kept = validated(set(
            list(&["b", "a", "b", ".git", "*.egg-info"]),
            Patch::Keep,
        ));
        assert_eq!(
            kept.expect("valid").search_skip,
            list(&["b", "a", ".git", "*.egg-info"])
        );
    }
}
