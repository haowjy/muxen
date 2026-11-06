//! `POST /fs/create`, `/fs/rename` and `/fs/delete` (fs.md): one name in a folder, relative to the
//! folder's descriptor.

use std::os::fd::{AsFd, BorrowedFd};
use std::path::Path;

use rustix::fs::{AtFlags, Dir, FileType, Mode, OFlags, RenameFlags};
use rustix::io::Errno;
use rustix::path::Arg;
use tracing::info;

use super::{Beneath, FsError, MAX_PATH, Opened, Want, open};
use crate::proto::fs::{CreateKind, CreateRequest, DeleteRequest, RenameRequest};

/// A folder deeper than this under the one deleted is refused.
const DELETE_DEPTH: usize = 64;
/// `remove`'s own "too deep": an errno nothing it calls returns for a folder.
const TOO_DEEP: Errno = Errno::MLINK;
/// Names read from a folder before they are removed. A folder is read again from its start after
/// each batch: macOS can skip names when a folder changes under `readdir`.
const DELETE_BATCH: usize = 256;

/// The refusal for what the kernel said.
fn refused(errno: Errno) -> FsError {
    match errno {
        // Whatever holds the name, a dangling link included.
        Errno::EXIST => FsError::Exists,
        // A mount below, or `TOO_DEEP`.
        Errno::XDEV | TOO_DEEP => FsError::Denied,
        errno => FsError::io(errno.into()),
    }
}

/// One name in a folder, as a client typed it. The kernel takes it relative to the descriptor, so
/// a name with a `/` or a `..` would reach another folder.
fn plain(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\0'])
}

/// `name`'s folder, opened. The kernel takes a name as given, so this checks it first.
fn folder(dir: &str, name: &str, home: &Path) -> Result<Opened, FsError> {
    if !plain(name) {
        return Err(FsError::BadRequest);
    }
    open(dir, home, Want::Dir)
}

/// `name` would have a path no route could open: a longer one could be made, but not reached.
fn too_long(dir: &Opened, name: &str) -> Result<(), FsError> {
    if dir.path.len() + 1 + name.len() > MAX_PATH {
        return Err(FsError::BadRequest);
    }
    Ok(())
}

/// Home and muxen's state directory, and every folder above them, can't be renamed or deleted: the
/// daemon's own files are in there, and a client can reach them by a path no menu recognises
/// (through a link). Compared by identity, so no spelling of the path gets past it.
fn refuse_holders(dir: &Opened, name: &str, kept: [&Path; 2]) -> Result<(), FsError> {
    let Ok(target) = rustix::fs::statat(&dir.file, name, AtFlags::SYMLINK_NOFOLLOW) else {
        return Ok(()); // what comes next reports it
    };
    let holds = kept
        .into_iter()
        .flat_map(Path::ancestors)
        .filter_map(|held| rustix::fs::stat(held).ok())
        .any(|held| held.st_dev == target.st_dev && held.st_ino == target.st_ino);
    if holds {
        return Err(FsError::Denied);
    }
    Ok(())
}

/// Blocks: run it on the fs lane. Modes are the umask's, as in a shell: no file here is special.
pub fn create(request: &CreateRequest, home: &Path) -> Result<(), FsError> {
    let CreateRequest { dir, name, kind } = request;
    let dir = folder(dir, name, home)?;
    too_long(&dir, name)?;
    match kind {
        CreateKind::File => {
            let flags =
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC;
            rustix::fs::openat(&dir.file, name.as_str(), flags, Mode::from(0o666)).map(drop)
        }
        CreateKind::Dir => rustix::fs::mkdirat(&dir.file, name.as_str(), Mode::from(0o777)),
    }
    .map_err(refused)?;
    info!(dir = dir.path, name, "created");
    Ok(())
}

/// Blocks: run it on the fs lane. A link is renamed, not what it points to. It never replaces
/// anything, and there is no fallback where the filesystem can't promise that.
pub fn rename(request: &RenameRequest, home: &Path, state: &Path) -> Result<(), FsError> {
    let RenameRequest { dir, name, to } = request;
    if !plain(to) {
        return Err(FsError::BadRequest);
    }
    let dir = folder(dir, name, home)?;
    too_long(&dir, to)?;
    refuse_holders(&dir, name, [home, state])?;
    rustix::fs::renameat_with(
        &dir.file,
        name.as_str(),
        &dir.file,
        to.as_str(),
        RenameFlags::NOREPLACE,
    )
    .map_err(refused)?;
    info!(dir = dir.path, name, to, "renamed");
    Ok(())
}

/// Blocks: run it on the fs lane, under the delete slot, since a folder may be big. Permanent, and
/// a failure leaves what was already removed gone. A link is removed, never followed, and
/// a mount below, or a folder past `DELETE_DEPTH`, stops the delete. Logged here: a big delete
/// outlives a request that goes away.
pub fn delete(request: &DeleteRequest, home: &Path, state: &Path) -> Result<(), FsError> {
    let DeleteRequest { dir, name } = request;
    let dir = folder(dir, name, home)?;
    refuse_holders(&dir, name, [home, state])?;
    let beneath = Beneath::new(&dir.file).map_err(FsError::io)?;
    remove(&beneath, dir.file.as_fd(), name.as_str(), 0).map_err(refused)?;
    info!(dir = dir.path, name, "deleted");
    Ok(())
}

/// Removes `name` from `parent`, a folder with all it holds.
fn remove(
    beneath: &Beneath,
    parent: BorrowedFd<'_>,
    name: impl Arg + Copy,
    depth: usize,
) -> rustix::io::Result<()> {
    let stat = rustix::fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW)?;
    if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
        return rustix::fs::unlinkat(parent, name, AtFlags::empty());
    }
    if depth == DELETE_DEPTH {
        return Err(TOO_DEEP);
    }
    // `rm -r` would go on into a mount.
    let mut names = Dir::new(beneath.open(parent, name)?)?;
    loop {
        names.rewind();
        let batch = names
            .by_ref()
            .map(|entry| entry.map(|entry| entry.file_name().to_owned()))
            .filter(|name| !matches!(name.as_ref().map(|name| name.to_bytes()), Ok(b"." | b"..")))
            .take(DELETE_BATCH)
            .collect::<rustix::io::Result<Vec<_>>>()?;
        if batch.is_empty() {
            break;
        }
        for entry in &batch {
            // Something else got there first. Only the name the client gave may answer `not_found`.
            match remove(beneath, names.fd()?, entry.as_c_str(), depth + 1) {
                Ok(()) | Err(Errno::NOENT) => {}
                Err(errno) => return Err(errno),
            }
        }
    }
    drop(names);
    rustix::fs::unlinkat(parent, name, AtFlags::REMOVEDIR)
}
