//! `POST /fs/create`, `/fs/rename` and `/fs/delete` (fs.md): one name in a folder, relative to the
//! folder's descriptor.

use std::ffi::{CStr, CString};
use std::os::fd::{AsFd, BorrowedFd};
use std::path::{Path, PathBuf};

use rustix::fs::{AtFlags, Dir, FileType, Mode, OFlags, RenameFlags};
use rustix::io::Errno;

use super::{Beneath, FsError, MAX_PATH, Opened, Want, open};
use crate::config;
use crate::proto::fs::{CreateKind, CreateRequest, Created, DeleteRequest, RenameRequest};

/// A folder deeper than this under the one deleted is refused. Each level holds two descriptors.
const DELETE_DEPTH: usize = 64;
/// Names read from a folder before they are removed. A folder is read again from its start after
/// each batch: macOS can skip names when a folder changes under `readdir`.
const DELETE_BATCH: usize = 256;

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

/// `name`'s path in `dir`. A longer one could be made, and then no route could open it.
fn path_of(dir: &Opened, name: &str) -> Result<String, FsError> {
    let path = format!("{}/{name}", dir.path.trim_end_matches('/'));
    if path.len() > MAX_PATH {
        return Err(FsError::BadRequest);
    }
    Ok(path)
}

/// Blocks: run it on the fs lane. Modes are the umask's, as in a shell: no file here is special.
pub fn create(request: &CreateRequest, home: &Path) -> Result<Created, FsError> {
    let CreateRequest { dir, name, kind } = request;
    let dir = folder(dir, name, home)?;
    let path = path_of(&dir, name)?;
    let made = match kind {
        CreateKind::File => {
            let flags =
                OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC;
            rustix::fs::openat(&dir.file, name.as_str(), flags, Mode::from(0o666)).map(drop)
        }
        CreateKind::Dir => rustix::fs::mkdirat(&dir.file, name.as_str(), Mode::from(0o777)),
    };
    match made {
        Ok(()) => Ok(Created { path }),
        // Whatever holds the name, a dangling link included.
        Err(Errno::EXIST) => Err(FsError::Exists),
        Err(Errno::NAMETOOLONG) => Err(FsError::BadRequest),
        Err(errno) => Err(FsError::write(errno.into())),
    }
}

/// Blocks: run it on the fs lane. A link is renamed, not what it points to. It never replaces
/// anything, and there is no fallback where the filesystem can't promise that.
pub fn rename(request: &RenameRequest, home: &Path) -> Result<(), FsError> {
    let RenameRequest { dir, name, to } = request;
    if !plain(to) {
        return Err(FsError::BadRequest);
    }
    let dir = folder(dir, name, home)?;
    path_of(&dir, to)?;
    refuse_holders(&dir, name, home)?;
    let renamed = rustix::fs::renameat_with(
        &dir.file,
        name.as_str(),
        &dir.file,
        to.as_str(),
        RenameFlags::NOREPLACE,
    );
    match renamed {
        Ok(()) => Ok(()),
        Err(Errno::EXIST) => Err(FsError::Exists),
        Err(Errno::NAMETOOLONG) => Err(FsError::BadRequest),
        Err(errno) => Err(FsError::write(errno.into())),
    }
}

/// Home and muxen's state directory, and every folder above them, can't be renamed or deleted: the
/// daemon's own files are in there, and a client can reach them by a path no menu recognises
/// (through a link). Compared by identity, so no spelling of the path gets past it.
fn refuse_holders(dir: &Opened, name: &str, home: &Path) -> Result<(), FsError> {
    let Ok(target) = rustix::fs::statat(&dir.file, name, AtFlags::SYMLINK_NOFOLLOW) else {
        return Ok(()); // what comes next reports it
    };
    let state = config::state_dir().unwrap_or_else(|_| PathBuf::new());
    let holds = [home, state.as_path()]
        .into_iter()
        .flat_map(Path::ancestors)
        .filter_map(|held| rustix::fs::stat(held).ok())
        .any(|held| held.st_dev == target.st_dev && held.st_ino == target.st_ino);
    if holds { Err(FsError::Denied) } else { Ok(()) }
}

/// Blocks: run it on the fs lane, under the delete slot, since a folder may be big. Permanent, and
/// a failure leaves what was already removed gone. A link is removed, never followed, and
/// a mount below, or a folder past `DELETE_DEPTH`, stops the delete.
pub fn delete(request: &DeleteRequest, home: &Path) -> Result<(), FsError> {
    let DeleteRequest { dir, name } = request;
    let dir = folder(dir, name, home)?;
    refuse_holders(&dir, name, home)?;
    let name = CString::new(name.as_str()).map_err(|_| FsError::BadRequest)?;
    let beneath = Beneath::new(&dir.file).map_err(FsError::write)?;
    match remove(&beneath, dir.file.as_fd(), &name, 0) {
        Ok(()) => Ok(()),
        Err(Errno::NAMETOOLONG) => Err(FsError::BadRequest),
        Err(Errno::XDEV | Errno::MLINK) => Err(FsError::Denied),
        Err(errno) => Err(FsError::write(errno.into())),
    }
}

/// Removes `name` from `parent`, a folder with all it holds.
fn remove(
    beneath: &Beneath,
    parent: BorrowedFd<'_>,
    name: &CStr,
    depth: usize,
) -> rustix::io::Result<()> {
    let stat = rustix::fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW)?;
    if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
        return rustix::fs::unlinkat(parent, name, AtFlags::empty());
    }
    if depth == DELETE_DEPTH {
        return Err(Errno::MLINK);
    }
    // `rm -r` would go on into a mount.
    let folder = beneath.open(parent, name)?;
    let mut names = Dir::read_from(&folder)?;
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
            match remove(beneath, folder.as_fd(), entry, depth + 1) {
                Ok(()) | Err(Errno::NOENT) => {}
                Err(errno) => return Err(errno),
            }
        }
    }
    drop(names);
    rustix::fs::unlinkat(parent, name, AtFlags::REMOVEDIR)
}
