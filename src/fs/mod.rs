//! The file API's core (fs.md): `fs::open`, listings, raw reads and uploads. Knows nothing of axum;
//! `http/fs.rs` parses requests, takes slots and builds responses. Every path a client sends reaches the disk through
//! `open`, which returns a descriptor and the canonical path it was opened at.

use std::io;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::blocking::Busy;
use crate::config::ConfigError;

pub mod list;
pub mod mime;
mod open;
pub mod raw;
mod slots;
pub mod upload;

pub use open::{Opened, Want, check_dir, check_shape, open};
pub use slots::Slots;

/// A path in a request: absolute, UTF-8, no NUL, at most this long.
pub const MAX_PATH: usize = 4096;

#[derive(Debug, Error)]
pub enum FsError {
    #[error("bad request")]
    BadRequest,
    #[error("permission denied")]
    Denied,
    #[error("not found")]
    NotFound,
    #[error("not a directory")]
    NotADirectory,
    #[error("not a file")]
    NotAFile,
    #[error("can't upload to a memory-backed filesystem")]
    MemoryBacked,
    #[error("too large")]
    TooLarge,
    /// The range starts at or past the end of a file this long.
    #[error("range past the end")]
    BadRange { size: u64 },
    #[error("busy")]
    Busy,
    #[error(transparent)]
    ConfigUnavailable(#[from] ConfigError),
    #[error("no space left")]
    NoSpace,
    /// Logged, never sent.
    #[error(transparent)]
    Internal(io::Error),
}

impl FsError {
    /// An I/O error while resolving or opening a path.
    pub fn io(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => Self::NotFound,
            io::ErrorKind::PermissionDenied => Self::Denied,
            _ if error.raw_os_error() == Some(rustix::io::Errno::LOOP.raw_os_error()) => {
                Self::NotFound
            }
            _ => Self::Internal(error),
        }
    }
}

impl From<Busy> for FsError {
    fn from(Busy: Busy) -> Self {
        Self::Busy
    }
}

/// An entry as written: absolute, or `~/` for `$HOME`; anything else is ignored.
pub fn expand(stored: &str, home: &Path) -> Option<PathBuf> {
    match stored.strip_prefix("~/") {
        Some(rest) => Some(home.join(rest)),
        None if Path::new(stored).is_absolute() => Some(PathBuf::from(stored)),
        None => None,
    }
}

/// Temporary directory trees for the fs tests.
#[cfg(test)]
pub(crate) mod test_tree {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A canonical temporary directory, removed on drop.
    pub struct Tree(PathBuf);

    impl Tree {
        pub fn new(name: &str) -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let dir =
                std::env::temp_dir().join(format!("tether-fs-{}-{name}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("a temp dir");
            Self(std::fs::canonicalize(&dir).expect("canonical"))
        }

        pub fn path(&self, relative: &str) -> PathBuf {
            if relative.is_empty() {
                self.0.clone()
            } else {
                self.0.join(relative)
            }
        }

        pub fn str(&self, relative: &str) -> String {
            self.path(relative).to_str().expect("UTF-8").to_owned()
        }

        pub fn mkdir(&self, relative: &str) {
            std::fs::create_dir_all(self.path(relative)).expect("a dir");
        }

        pub fn write(&self, relative: &str, bytes: &[u8]) {
            std::fs::write(self.path(relative), bytes).expect("written");
        }

        pub fn root(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
