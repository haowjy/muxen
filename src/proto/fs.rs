//! The `/fs/*` bodies (fs.md "Routes"). Errors are `ErrorBody`. Paths are
//! absolute UTF-8 strings; a name that isn't UTF-8 is listed but can't be sent back.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `GET /fs/list/{*path}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Listing {
    /// Canonical.
    pub path: String,
    /// Null only at `/`.
    pub parent: Option<String>,
    /// Entries scanned, after the hidden filter.
    pub total: u32,
    pub offset: u32,
    /// The directory has more entries than one scan reads.
    pub truncated: bool,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Entry {
    /// U+FFFD in place of bytes that aren't UTF-8.
    pub name: String,
    /// After following a symlink.
    pub kind: EntryKind,
    /// The entry itself is a symlink.
    pub link: bool,
    /// Files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub size: Option<u64>,
    /// Unix seconds; absent for `broken`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mtime: Option<i64>,
    /// Files: the type `/fs/raw` would send.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mime: Option<String>,
    /// `false` for a name that isn't UTF-8, which can't be opened; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub utf8: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Dir,
    File,
    /// A FIFO, socket or device.
    Other,
    /// A symlink whose target is missing or can't be reached.
    Broken,
}

/// `201` from `POST /fs/upload`. Swift mirrors it by hand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Uploaded {
    /// Absolute and canonical: native types it, quoted, into the tab.
    pub path: String,
    pub size: u64,
}

/// What `POST /fs/create` makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CreateKind {
    File,
    Dir,
}

/// `POST /fs/create`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CreateRequest {
    /// The folder (`~`, `~/…` or absolute).
    pub dir: String,
    /// A plain name, not a path.
    pub name: String,
    pub kind: CreateKind,
}

/// `201` from `POST /fs/create`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Created {
    /// Absolute and canonical.
    pub path: String,
}

/// `GET /fs/search/{*path}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Search {
    /// The canonical root.
    pub path: String,
    /// Best first, at most 50.
    pub matches: Vec<Match>,
    /// Entries read, skipped ones included.
    pub read: u32,
    /// The cap that ended the walk; null: it covered everything.
    pub stopped: Option<Stopped>,
}

/// A listing's entry, found below the search's root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Match {
    #[serde(flatten)]
    #[ts(flatten)]
    pub entry: Entry,
    /// Relative to the root, `/`-separated.
    pub path: String,
    /// `[start, end)` runs of `path` that matched, in UTF-16 code units.
    pub hits: Vec<[u16; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Stopped {
    /// 100,000 entries read.
    Entries,
    /// 500 ms.
    Time,
    /// The queue of folders still to read filled; folders past it weren't queued.
    Queue,
}
