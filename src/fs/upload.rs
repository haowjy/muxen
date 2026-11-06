//! `POST /fs/upload` (fs.md): the body streams into a 0600 part file (`files::Temp`) in
//! the destination folder (`uploads_dir` unless the request names one), flushed every
//! 2 MiB, then renamed without replacing to a name the daemon chooses. Only the client
//! name's extension is used. A part file is deleted on any failure. The daemon keeps the
//! path of the one in-flight part file in a record file (`upload-part` in its state
//! directory); a part file a dead daemon left is deleted from that record, at startup or by
//! the next upload. The upload slot is held exactly while a part file may exist.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::os::unix::ffi::OsStringExt as _;
use std::os::unix::fs::{DirBuilderExt as _, FileExt as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use bytes::Bytes;
use futures_util::{Stream, StreamExt as _};
use tokio::sync::OwnedSemaphorePermit;
use tracing::{debug, info};

use super::{FsError, Opened, Want, expand, open};
use crate::blocking::Lane;
use crate::files::{Dir, Temp, random_name};
use crate::proto::fs::Uploaded;

/// Larger uploads get `413 too_large`.
pub const MAX_UPLOAD: u64 = 128 << 20;
/// Waiting this long for a body byte aborts the upload.
const IDLE: Duration = Duration::from_secs(30);
/// Body bytes are written in chunks of this size...
const CHUNK: usize = 64 * 1024;
/// ...and every this many are `fdatasync`ed and their pages dropped, so the upload's
/// dirty pages, charged to the unit and unreclaimable until written, stay small on a
/// disk the unit reaches at idle I/O priority.
const FLUSH_EVERY: u64 = 2 << 20;
/// Nothing else in muxen names a file like this.
const PART_PREFIX: &str = ".muxen-upload-";
const PART_SUFFIX: &str = ".part";
/// Name clashes tried before giving up: four random characters clash rarely.
const RENAME_TRIES: usize = 16;

/// The folder an upload lands in: `dest` (`~`, `~/…` or absolute; it must exist), else
/// `uploads_dir` (the running config's), created 0700 if missing and then opened after creating it, so a folder
/// that didn't exist a moment ago still counts. Blocks.
pub fn open_dir(uploads_dir: &str, home: &Path, dest: Option<&str>) -> Result<Opened, FsError> {
    let opened = match dest {
        Some(dest) => open(dest, home, Want::Dir)?,
        None => open_uploads_dir(uploads_dir, home)?,
    };
    if memory_backed(&opened.file)? {
        return Err(FsError::MemoryBacked);
    }
    Ok(opened)
}

fn open_uploads_dir(uploads_dir: &str, home: &Path) -> Result<Opened, FsError> {
    let dir = expand(uploads_dir, home).ok_or(FsError::NotADirectory)?;
    // A failure shows up in the open below.
    let _ = std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir);
    // One that can't be resolved is not a directory, whatever the open says.
    open(uploads_dir, home, Want::Dir).map_err(|error| match error {
        FsError::BadRequest | FsError::NotFound => FsError::NotADirectory,
        other => other,
    })
}

/// Upload pages would remain charged to muxen while the file lives on tmpfs/ramfs.
#[cfg(target_os = "linux")]
fn memory_backed(dir: &File) -> Result<bool, FsError> {
    const TMPFS_MAGIC: u32 = 0x0102_1994;
    const RAMFS_MAGIC: u32 = 0x8584_58f6;

    let stats = rustix::fs::fstatfs(dir).map_err(|error| FsError::io(error.into()))?;
    let kind = stats.f_type as u32;
    Ok(kind == TMPFS_MAGIC || kind == RAMFS_MAGIC)
}

#[cfg(not(target_os = "linux"))]
fn memory_backed(_dir: &File) -> Result<bool, FsError> {
    Ok(false)
}

/// What the daemon calls the file.
#[derive(Debug, Clone, Copy)]
pub enum Naming<'a> {
    /// `YYYYMMDD-HHMMSSZ-xxxx.<ext>`, the extension from the client's file name.
    Upload(&'a str),
    /// `pasted-YYYYMMDD-HHMMSSZ.txt`, then `-2`, `-3`… on a clash.
    PastedText,
}

impl Naming<'_> {
    /// The names to try in turn: a clash moves to the next.
    fn candidates(self, now: SystemTime) -> io::Result<Vec<String>> {
        match self {
            Self::Upload(client_name) => {
                let extension = extension(client_name);
                (0..RENAME_TRIES)
                    .map(|_| final_name(now, &extension))
                    .collect()
            }
            Self::PastedText => {
                let stem = format!("pasted-{}", utc_stamp(now));
                let first = format!("{stem}.txt");
                let rest = (2..=RENAME_TRIES).map(|n| format!("{stem}-{n}.txt"));
                Ok(std::iter::once(first).chain(rest).collect())
            }
        }
    }
}

/// Writes `body` into a part file in `dir` and renames it to its final name. `limit` is
/// the size cap; `record` is the in-flight record file. Takes one fs thread per chunk
/// written. `slot` is the upload slot: it moves into the part file and is released only
/// once the part file is gone and its record cleared.
pub async fn receive<S, E>(
    lane: &Lane,
    slot: OwnedSemaphorePermit,
    dir: Opened,
    record: &Path,
    naming: Naming<'_>,
    limit: u64,
    body: S,
) -> Result<Uploaded, FsError>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    let dir_path = dir.path.clone();
    let create_path = dir_path.clone();
    let (dir, part_lane, record) = (Dir::from(dir.file), lane.clone(), record.to_owned());
    let part = lane
        .try_run(move || Part::create(&dir, &create_path, part_lane, record, slot))
        .await?;
    let file = part.file.clone();
    match copy(lane, file, limit, body).await {
        Ok(size) => {
            let name = part.land(naming.candidates(SystemTime::now())).await?;
            Ok(Uploaded {
                path: format!("{}/{name}", dir_path.trim_end_matches('/')),
                size,
            })
        }
        Err(error) => {
            part.remove().await;
            Err(error)
        }
    }
}

/// The body into `file`, 64 KiB at a time. Returns its size.
async fn copy<S, E>(lane: &Lane, file: Arc<File>, limit: u64, mut body: S) -> Result<u64, FsError>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    let mut chunk = Vec::with_capacity(CHUNK);
    let mut written = 0;
    let mut flushed = 0;
    loop {
        // Only time spent waiting for the body counts toward the idle timeout.
        let next = tokio::time::timeout(IDLE, body.next()).await;
        let mut bytes = match next {
            Err(_) => {
                debug!("an upload went idle: aborted");
                return Err(FsError::BadRequest);
            }
            Ok(None) => break,
            Ok(Some(Err(cause))) => {
                debug!(%cause, "an upload's body failed: aborted");
                return Err(FsError::BadRequest);
            }
            Ok(Some(Ok(bytes))) => bytes,
        };
        let total = written + (chunk.len() + bytes.len()) as u64;
        if total > limit {
            return Err(FsError::TooLarge);
        }
        while !bytes.is_empty() {
            let take = (CHUNK - chunk.len()).min(bytes.len());
            chunk.extend_from_slice(&bytes.split_to(take));
            if chunk.len() == CHUNK {
                let flush = written + CHUNK as u64 - flushed >= FLUSH_EVERY;
                chunk = write(lane, &file, chunk, written, flush).await?;
                written += CHUNK as u64;
                if flush {
                    flushed = written;
                }
            }
        }
    }
    let size = written + chunk.len() as u64;
    if !chunk.is_empty() {
        write(lane, &file, chunk, written, false).await?;
    }
    Ok(size)
}

/// Writes `chunk` at `at` on an fs thread and hands the emptied buffer back.
async fn write(
    lane: &Lane,
    file: &Arc<File>,
    mut chunk: Vec<u8>,
    at: u64,
    flush: bool,
) -> Result<Vec<u8>, FsError> {
    let file = file.clone();
    lane.run(move || {
        file.write_all_at(&chunk, at).map_err(FsError::io)?;
        if flush {
            // The one wait with no deadline: a slow disk slows the upload to its pace.
            file.sync_data().map_err(FsError::io)?;
            #[cfg(target_os = "linux")]
            let _ = rustix::fs::fadvise(&*file, 0, None, rustix::fs::Advice::DontNeed);
        }
        chunk.clear();
        Ok(chunk)
    })
    .await?
}

/// A part file with what its end must clear: the record that names it and the upload
/// slot. Every end runs on the fs lane and releases the slot last.
struct Held {
    temp: Temp,
    /// Names the part file while it exists.
    record: PathBuf,
    /// Released when this drops, after the cleanup.
    _slot: OwnedSemaphorePermit,
}

impl Held {
    /// Renames the part file to the first free name; a failure deletes it. Blocks.
    fn land(self, names: io::Result<Vec<String>>) -> io::Result<String> {
        let landed = match names {
            Ok(names) => self.temp.land(names),
            Err(error) => {
                self.temp.discard();
                Err(error)
            }
        };
        forget(&self.record);
        landed
    }

    /// Deletes the part file. Blocks.
    fn discard(self) {
        self.temp.discard();
        forget(&self.record);
    }
}

/// `.muxen-upload-<random>.part` in the destination folder, deleted unless it landed. The
/// delete runs on the fs lane, since the folder may sit on the slow disk; one that gets
/// no thread in time is left to the next `create`'s `reap`.
///
/// Holds the upload slot until its cleanup (delete, then clear the record) has run on the
/// lane, so a slot holder never races a cleanup still in flight.
struct Part {
    /// `None` once it landed or was deleted.
    held: Option<Held>,
    file: Arc<File>,
    lane: Lane,
}

impl Part {
    /// Deletes what a previous part file left, records this one's path, then creates it.
    /// Recording first means a crash between the two leaves a record of nothing. Safe to
    /// reap: the slot is held, and every cleanup releases it only after clearing the
    /// record, so no part file is live.
    fn create(
        dir: &Dir,
        dir_path: &str,
        lane: Lane,
        record: PathBuf,
        slot: OwnedSemaphorePermit,
    ) -> Result<Self, FsError> {
        reap(&lane, &record);
        let name = format!(
            "{PART_PREFIX}{}{PART_SUFFIX}",
            random_name(16).map_err(FsError::io)?
        );
        let path = Path::new(dir_path).join(&name);
        std::fs::write(&record, path.as_os_str().as_encoded_bytes()).map_err(FsError::Internal)?;
        let temp = Temp::create(dir, name.as_ref(), 0o600).map_err(|error| {
            forget(&record);
            FsError::io(error)
        })?;
        Ok(Self {
            file: temp.file().clone(),
            held: Some(Held {
                temp,
                record,
                _slot: slot,
            }),
            lane,
        })
    }

    /// Renames the part file to a free final name. A failure deletes it.
    async fn land(mut self, names: io::Result<Vec<String>>) -> Result<String, FsError> {
        let held = self.held.take().expect("a part file lands once");
        let landed = self
            .lane
            .try_run(move || held.land(names).map_err(FsError::Internal));
        landed.await
    }

    /// Deletes the part file before the response goes out.
    async fn remove(mut self) {
        if let Some(held) = self.held.take() {
            let _ = self.lane.run(move || held.discard()).await;
        }
    }
}

impl Drop for Part {
    /// A request dropped mid-upload (the client went away) still deletes its part file and
    /// clears the record, then frees the slot. A lane too busy to run it leaves both to
    /// the next `reap`; the slot is freed with the dropped closure.
    fn drop(&mut self) {
        if let Some(held) = self.held.take() {
            self.lane.spawn(move || held.discard());
        }
    }
}

/// The extension of the client's name, lowercased, if it is 1 to 8 ASCII
/// alphanumerics; else `bin`. Nothing else of the name reaches the folder.
pub fn extension(client_name: &str) -> String {
    let extension = client_name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| {
            (1..=8).contains(&extension.len())
                && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        });
    extension.map_or_else(|| "bin".to_owned(), str::to_ascii_lowercase)
}

/// `YYYYMMDD-HHMMSSZ-xxxx.<ext>`, in UTC.
fn final_name(now: SystemTime, extension: &str) -> io::Result<String> {
    Ok(format!(
        "{}-{}.{extension}",
        utc_stamp(now),
        random_name(4)?
    ))
}

/// `YYYYMMDD-HHMMSSZ`, from RFC 3339 with the punctuation taken out.
fn utc_stamp(now: SystemTime) -> String {
    let digits: String = humantime::format_rfc3339_seconds(now)
        .to_string()
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    format!("{}-{}Z", &digits[..8], &digits[8..14])
}

fn is_part(name: &OsStr) -> bool {
    let name = name.as_encoded_bytes();
    name.starts_with(PART_PREFIX.as_bytes()) && name.ends_with(PART_SUFFIX.as_bytes())
}

/// Takes the unfinished-upload record (reads it, then deletes it, both in the state
/// directory) and deletes the part file it names on the fs lane, not awaited: the path may
/// sit on a hung mount, and that must fill an fs thread, not hold up the daemon's start or
/// an upload. Housekeeping: an error is only logged.
pub fn reap(lane: &Lane, record: &Path) {
    if let Some(recorded) = take_record(record) {
        // Logged before the spawn: a saturated lane drops the delete unrun, and the record is
        // already gone, so this line is the only trace of the file left behind.
        info!(path = %recorded.display(), "deleting an unfinished upload");
        lane.spawn(move || delete_part(&recorded));
    }
}

fn take_record(record: &Path) -> Option<PathBuf> {
    let recorded = match std::fs::read(record) {
        Ok(bytes) => PathBuf::from(OsString::from_vec(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
        Err(error) => {
            debug!(%error, "can't read the unfinished-upload record");
            return None;
        }
    };
    forget(record);
    Some(recorded)
}

/// Deletes `recorded` if it is still a regular file named like a part file. Blocks.
fn delete_part(recorded: &Path) {
    let part = recorded.is_absolute()
        && recorded.file_name().is_some_and(is_part)
        && std::fs::symlink_metadata(recorded).is_ok_and(|meta| meta.is_file());
    if part {
        match std::fs::remove_file(recorded) {
            Ok(()) => debug!(path = %recorded.display(), "deleted an unfinished upload"),
            Err(error) => {
                debug!(%error, path = %recorded.display(), "can't delete an unfinished upload")
            }
        }
    }
}

/// Deletes the record; an error is only logged.
fn forget(record: &Path) {
    match std::fs::remove_file(record) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => debug!(%error, "can't clear the unfinished-upload record"),
    }
}

#[cfg(test)]
mod tests {
    use std::time::UNIX_EPOCH;

    use futures_util::stream;

    use super::*;
    use crate::blocking::Lanes;
    use crate::fs::test_tree::Tree;

    fn dir(tree: &Tree) -> Opened {
        open(&tree.str(""), Path::new("/"), Want::Dir).expect("the folder")
    }

    /// The record file's path in a fresh state folder, which the test keeps alive.
    fn record(state: &Tree) -> PathBuf {
        state.path("upload-part")
    }

    fn slot() -> OwnedSemaphorePermit {
        Arc::new(tokio::sync::Semaphore::new(1))
            .try_acquire_owned()
            .expect("a permit")
    }

    fn body(chunks: Vec<Vec<u8>>) -> impl Stream<Item = Result<Bytes, io::Error>> + Unpin {
        stream::iter(chunks.into_iter().map(|chunk| Ok(Bytes::from(chunk))))
    }

    #[test]
    fn names_are_utc_stamped_with_only_the_extension_kept() {
        assert_eq!(extension("IMG_0001.JPG"), "jpg");
        assert_eq!(extension("photo.heic"), "heic");
        assert_eq!(extension("a.tar.gz"), "gz");
        for bad in [
            "noext",
            "x.",
            "x.toolongext",
            "x.j$g",
            "../../etc/passwd",
            "a.b/c",
            ".bashrc;rm",
        ] {
            assert_eq!(extension(bad), "bin", "{bad}");
        }
        assert_eq!(extension(".png"), "png");
        let at = UNIX_EPOCH + Duration::from_secs(1_792_651_205); // 2026-10-22T06:40:05Z
        let name = final_name(at, "jpg").expect("a name");
        let (stamp, rest) = name.split_at(17);
        assert_eq!(stamp, "20261022-064005Z-");
        let (suffix, extension) = rest.split_once('.').expect("an extension");
        assert_eq!(extension, "jpg");
        assert!(
            suffix.len() == 4
                && suffix
                    .bytes()
                    .all(|b| matches!(b, b'a'..=b'z' | b'2'..=b'7')),
            "{name}"
        );
    }

    #[tokio::test]
    async fn over_the_cap_the_part_file_is_deleted() {
        let (tree, state) = (Tree::new("upload-cap"), Tree::new("upload-cap-state"));
        let lane = Lanes::default().fs;
        let chunks = vec![vec![0; 70_000], vec![0; 70_000]];
        let refused = receive(
            &lane,
            slot(),
            dir(&tree),
            &record(&state),
            Naming::Upload("a.png"),
            100_000,
            body(chunks),
        )
        .await;
        assert!(matches!(refused, Err(FsError::TooLarge)), "{refused:?}");
        assert!(tree.names().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn an_idle_body_is_aborted_and_its_part_file_deleted() {
        let (tree, state) = (Tree::new("upload-idle"), Tree::new("upload-idle-state"));
        let lane = Lanes::default().fs;
        let stalled = body(vec![vec![0; 10]]).chain(stream::pending());
        let started = tokio::time::Instant::now();
        let refused = receive(
            &lane,
            slot(),
            dir(&tree),
            &record(&state),
            Naming::Upload("a.png"),
            MAX_UPLOAD,
            stalled,
        )
        .await;
        assert!(matches!(refused, Err(FsError::BadRequest)), "{refused:?}");
        assert!(started.elapsed() >= IDLE);
        assert!(tree.names().is_empty());
    }

    #[test]
    fn pasted_text_names_take_a_numeric_suffix_on_a_clash() {
        let at = UNIX_EPOCH + Duration::from_secs(1_792_651_205);
        let names: Vec<String> = Naming::PastedText.candidates(at).expect("names");
        assert_eq!(names[0], "pasted-20261022-064005Z.txt");
        assert_eq!(names[1], "pasted-20261022-064005Z-2.txt");
        assert_eq!(names.len(), RENAME_TRIES);
    }

    #[tokio::test]
    async fn pasted_text_lands_exactly_and_clears_the_record() {
        let (tree, state) = (Tree::new("upload-text"), Tree::new("upload-text-state"));
        let lane = Lanes::default().fs;
        let text = body(vec![b"hello\n".to_vec()]);
        let (dir, record) = (dir(&tree), record(&state));
        let saved = receive(
            &lane,
            slot(),
            dir,
            &record,
            Naming::PastedText,
            MAX_UPLOAD,
            text,
        )
        .await;
        let saved = saved.expect("saved");
        assert_eq!(saved.size, 6);
        assert_eq!(std::fs::read(&saved.path).expect("read"), b"hello\n");
        assert!(saved.path.contains("/pasted-") && saved.path.ends_with(".txt"));
        assert_eq!(tree.names().len(), 1, "{:?}", tree.names());
        assert!(!record.exists());
    }

    #[test]
    fn reap_deletes_only_the_recorded_part_file() {
        let (tree, state) = (Tree::new("reap"), Tree::new("reap-state"));
        let record = record(&state);
        tree.write(".muxen-upload-aaaa.part", b"left by a crash");
        tree.write(".muxen-upload-bbbb.part", b"another folder's, not recorded");
        tree.write("keep.part", b"not a part file's name");
        tree.mkdir(".muxen-upload-cccc.part");

        let reaps = |name: &str| {
            std::fs::write(&record, tree.str(name)).expect("a record");
            delete_part(&take_record(&record).expect("a record"));
            assert!(!record.exists(), "{name}: the record is cleared");
        };
        reaps("keep.part");
        reaps(".muxen-upload-cccc.part");
        reaps("missing/.muxen-upload-dddd.part");
        assert_eq!(
            tree.names(),
            [
                ".muxen-upload-aaaa.part",
                ".muxen-upload-bbbb.part",
                ".muxen-upload-cccc.part",
                "keep.part"
            ]
        );
        reaps(".muxen-upload-aaaa.part");
        assert_eq!(
            tree.names(),
            [
                ".muxen-upload-bbbb.part",
                ".muxen-upload-cccc.part",
                "keep.part"
            ]
        );
        assert!(take_record(&record).is_none()); // no record: nothing to do
    }
}
