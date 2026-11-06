//! `POST /fs/create` (fs.md): an empty file or a new folder, relative to the folder's descriptor.

use std::path::Path;

use rustix::fs::{Mode, OFlags};
use rustix::io::Errno;

use super::{FsError, MAX_PATH, Want, open};
use crate::proto::fs::{CreateKind, CreateRequest, Created};

/// One name in a folder, as a client typed it. The kernel takes it relative to the descriptor, so
/// a name with a `/` or a `..` would reach another folder.
fn plain(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\0'])
}

/// Blocks: run it on the fs lane. Modes are the umask's, as in a shell: no file here is special.
pub fn create(request: &CreateRequest, home: &Path) -> Result<Created, FsError> {
    let CreateRequest { dir, name, kind } = request;
    if !plain(name) {
        return Err(FsError::BadRequest);
    }
    let dir = open(dir, home, Want::Dir)?;
    let path = format!("{}/{name}", dir.path.trim_end_matches('/'));
    // A longer path could be made here, and then no route could open it.
    if path.len() > MAX_PATH {
        return Err(FsError::BadRequest);
    }
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
