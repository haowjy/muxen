//! The file API's limits (fs.md "Constants", "Limits and the memory ceiling"): 1 scan,
//! 1 search, 1 delete, 2 raw responses, 1 upload, 1 save, 1 settings read or write, waited for in the fs lane's queue (`crate::blocking`), so a
//! slow disk stalls the file manager without holding memory or starving auth and pastes
//! of threads. Blocking calls run on `lane`; a slot's work runs through `Slot::run`, which moves
//! the slot's permit into the lane work.

use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::FsError;
use crate::blocking::{Lane, Slot};

const SCANS: usize = 1;
const SEARCHES: usize = 1;
const DELETES: usize = 1;
const RAW_RESPONSES: usize = 2;
const UPLOADS: usize = 1;
const SAVES: usize = 1;
const SETTINGS: usize = 1;

/// Daemon-wide, shared by every fs request.
#[derive(Debug)]
pub struct Slots {
    /// The fs lane: every blocking call, `lane.try_run(work).await?`.
    pub lane: Lane,
    /// One directory listing at a time.
    pub scan: Slot,
    /// A search walk: its own, so a listing never waits behind a walk. An aborted search
    /// frees it only when its walk ends.
    pub search: Slot,
    /// A delete: a big folder holds one fs thread, not all of them, and it runs to its end
    /// whether or not the request is still there.
    pub delete: Slot,
    /// A raw response's producer holds one until its body ends: it spans many lane calls,
    /// one per chunk, so it uses `acquire`.
    pub raw: Slot,
    upload: Arc<Semaphore>,
    /// A save (`PUT /fs/file`): its own, so a long upload never makes it `busy`. Taken
    /// before the body is read, then moved into the lane work, so the slot bounds both the
    /// buffered body and the one fixed temp name per folder.
    pub save: Slot,
    /// `/settings` (fs.md "Server settings"): one read, save or reload at a time, so a
    /// save stuck on a hung disk holds one fs thread.
    pub settings: Slot,
}

impl Slots {
    pub fn new(lane: Lane) -> Self {
        Self {
            scan: lane.slot(SCANS),
            search: lane.slot(SEARCHES),
            delete: lane.slot(DELETES),
            raw: lane.slot(RAW_RESPONSES),
            upload: Arc::new(Semaphore::new(UPLOADS)),
            save: lane.slot(SAVES),
            settings: lane.slot(SETTINGS),
            lane,
        }
    }

    /// The upload slot, or `busy` at once: native sends one upload at a time.
    pub fn upload(&self) -> Result<OwnedSemaphorePermit, FsError> {
        self.upload
            .clone()
            .try_acquire_owned()
            .map_err(|_| FsError::Busy)
    }
}
