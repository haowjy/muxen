//! `PUT /fs/file/{*path}` (fs.md): a file's new bytes in place of its old, if it is still the
//! version the client read. The body is buffered (at most 1 MiB, under the save slot), then
//! one fs-lane call resolves the file, checks that a swap changes nothing the user didn't
//! ask for, and lands the bytes through `files::Target`.

use std::fs::File;
use std::io::Read as _;
use std::os::unix::fs::MetadataExt as _;
use std::path::Path;

use bytes::Bytes;
use futures_util::Stream;
use tracing::debug;

use super::upload::next_chunk;
use super::{FsError, Want, open};
use crate::files::{Dir, Stamp, Target};

/// A larger body is `413 too_large`.
pub const MAX_SAVE: usize = 1 << 20;
/// The temporary file's name in every folder a save touches. A file of this name there is
/// replaced by the next save, so none is saved itself.
const TEMP_NAME: &str = ".muxen-save";
/// A `*` save re-reads the file when a writer beats its rename, this many times.
const TRIES: usize = 3;

/// The `If-Match` of a save.
#[derive(Debug, PartialEq, Eq)]
pub enum IfMatch {
    /// `*`: whatever is there.
    Any,
    /// One strong ETag, as `GET /fs/raw` sent it.
    Tag(String),
}

impl IfMatch {
    /// `*` or one quoted tag; `None` for anything else (a list, a weak tag).
    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        if value == "*" {
            return Some(Self::Any);
        }
        let inner = value.strip_prefix('"')?.strip_suffix('"')?;
        (!inner.contains(['"', ','])).then(|| Self::Tag(value.to_owned()))
    }
}

/// The body, at most `limit` bytes; over it is `too_large`. A body that stalls or breaks is
/// `bad_request` (`upload::next_chunk`).
pub async fn read_body<S, E>(mut body: S, limit: usize) -> Result<Vec<u8>, FsError>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    let mut read = Vec::new();
    while let Some(bytes) = next_chunk(&mut body).await? {
        if read.len() + bytes.len() > limit {
            return Err(FsError::TooLarge);
        }
        read.extend_from_slice(&bytes);
    }
    Ok(read)
}

/// Writes `body` as the file at `path` and answers its new stamp. Blocks: run it on the fs
/// lane, holding the save slot.
///
/// - The file must exist (`open`, so a link saves to its target) and be a regular file.
/// - A swap changes who else sees the old file, so these are `denied` and nothing is written:
///   a file with another hard link, one owned by another user, one this user can't write (a
///   read-only file or folder).
/// - The stamp from the open must be the one `if_match` names, and is checked again at the
///   rename. If it isn't, `changed`, unless the file already holds exactly `body`: the
///   answer to an earlier save was lost, and this one is its retry.
/// - The new file has the old one's mode.
pub fn save(path: &str, home: &Path, if_match: &IfMatch, body: &[u8]) -> Result<Stamp, FsError> {
    let tries = if *if_match == IfMatch::Any { TRIES } else { 1 };
    for _ in 0..tries {
        match attempt(path, home, if_match, body) {
            Err(FsError::Changed) if tries > 1 => {}
            done => return done,
        }
    }
    Err(FsError::Changed)
}

fn attempt(path: &str, home: &Path, if_match: &IfMatch, body: &[u8]) -> Result<Stamp, FsError> {
    let opened = open(path, home, Want::File)?;
    let meta = &opened.meta;
    let stamp = Stamp::of(meta);
    if meta.nlink() > 1 || meta.uid() != rustix::process::geteuid().as_raw() {
        return Err(FsError::Denied);
    }
    let canonical = Path::new(&opened.path);
    let (Some(parent), Some(name)) = (canonical.parent(), canonical.file_name()) else {
        return Err(FsError::NotAFile);
    };
    if name == TEMP_NAME {
        return Err(FsError::Denied);
    }
    let stale = matches!(if_match, IfMatch::Tag(tag) if *tag != stamp.etag());
    if stale {
        return if holds(&opened.file, meta.len(), body)? {
            debug!(path = %opened.path, "a save's retry: the file already holds the body");
            Ok(stamp)
        } else {
            Err(FsError::Changed)
        };
    }
    let parent = parent.to_str().ok_or(FsError::BadRequest)?;
    let dir = Dir::from(open(parent, home, Want::Dir)?.file);
    let target = Target::new(dir, name, TEMP_NAME.as_ref());
    target.check_writable().map_err(FsError::io)?;
    target
        .replace_if(meta.mode() & 0o7777, body, Some(stamp))
        .map_err(FsError::io)?
        .ok_or(FsError::Changed)
}

/// Whether `file`, `size` bytes at its open, is exactly `body`. Reads at most one byte more
/// than `body` is long.
fn holds(file: &File, size: u64, body: &[u8]) -> Result<bool, FsError> {
    if size != body.len() as u64 {
        return Ok(false);
    }
    let mut read = Vec::with_capacity(body.len() + 1);
    file.take(body.len() as u64 + 1)
        .read_to_end(&mut read)
        .map_err(FsError::io)?;
    Ok(read == body)
}
