//! `POST /fs/create`, `/fs/rename` and `/fs/delete` (fs.md): one name in a folder, relative to the
//! folder's descriptor.

use std::ffi::{CStr, CString};
use std::os::fd::{AsFd, BorrowedFd};
use std::path::Path;

use rustix::fs::{AtFlags, Dir, FileType, Mode, OFlags, RenameFlags, Stat};
use rustix::io::Errno;

use super::{FsError, MAX_PATH, Opened, Want, open};
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

/// Blocks: run it on the fs lane, under the delete slot, since a folder may be big. Permanent, and
/// a failure leaves what was already removed gone. A link is removed, never followed, and
/// a folder on another filesystem, or past `DELETE_DEPTH`, stops the delete.
pub fn delete(request: &DeleteRequest, home: &Path) -> Result<(), FsError> {
    let DeleteRequest { dir, name } = request;
    let dir = folder(dir, name, home)?;
    let name = CString::new(name.as_str()).map_err(|_| FsError::BadRequest)?;
    let removed =
        rustix::fs::fstat(&dir.file).and_then(|folder| remove(dir.file.as_fd(), &name, &folder, 0));
    match removed {
        Ok(()) => Ok(()),
        Err(Errno::NAMETOOLONG) => Err(FsError::BadRequest),
        Err(Errno::XDEV | Errno::MLINK) => Err(FsError::Denied),
        Err(errno) => Err(FsError::write(errno.into())),
    }
}

/// Removes `name` from `parent`, a folder with all it holds, on `top`'s filesystem.
fn remove(parent: BorrowedFd<'_>, name: &CStr, top: &Stat, depth: usize) -> rustix::io::Result<()> {
    let stat = rustix::fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW)?;
    if FileType::from_raw_mode(stat.st_mode) != FileType::Directory {
        return rustix::fs::unlinkat(parent, name, AtFlags::empty());
    }
    if depth == DELETE_DEPTH {
        return Err(Errno::MLINK);
    }
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let folder = rustix::fs::openat(parent, name, flags, Mode::empty())?;
    // `rm -r` would go on into a mount.
    if rustix::fs::fstat(&folder)?.st_dev != top.st_dev {
        return Err(Errno::XDEV);
    }
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
            remove(folder.as_fd(), entry, top, depth + 1)?;
        }
    }
    drop(names);
    rustix::fs::unlinkat(parent, name, AtFlags::REMOVEDIR)
}
