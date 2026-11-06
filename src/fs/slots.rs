//! The file API's limits (fs.md "Constants", "Limits and the memory ceiling"): 1 scan,
//! 1 search, 1 delete, 2 raw responses, 1 upload, 1 settings read or write, waited for in the fs lane's queue (`crate::blocking`), so a
//! slow disk stalls the file manager without holding memory or starving auth and pastes
//! of threads. Blocking calls run on `lane`; a slot's work runs through its method, which moves
//! the slot into the lane work.

use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::FsError;
use crate::blocking::{Busy, Lane, PermitPool};

const SCANS: usize = 1;
const SEARCHES: usize = 1;
const DELETES: usize = 1;
const RAW_RESPONSES: usize = 2;
const UPLOADS: usize = 1;
const SETTINGS: usize = 1;

/// Daemon-wide, shared by every fs request.
#[derive(Debug)]
pub struct Slots {
    /// The fs lane: every blocking call, `lane.run(work).await??`.
    pub lane: Lane,
    scan: PermitPool,
    search: PermitPool,
    delete: PermitPool,
    raw: PermitPool,
    upload: Arc<Semaphore>,
    settings: PermitPool,
}

impl Slots {
    pub fn new(lane: Lane) -> Self {
        Self {
            scan: lane.permits(SCANS),
            search: lane.permits(SEARCHES),
            delete: lane.permits(DELETES),
            raw: lane.permits(RAW_RESPONSES),
            upload: Arc::new(Semaphore::new(UPLOADS)),
            settings: lane.permits(SETTINGS),
            lane,
        }
    }

    /// `work`, one directory listing, on the lane under the scan slot.
    pub async fn scan<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Busy> {
        self.scan.run(&self.lane, work).await
    }

    /// `work`, a search walk, under the search slot: its own, so a listing never waits
    /// behind a walk. An aborted search frees it only when its walk ends.
    pub async fn search<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Busy> {
        self.search.run(&self.lane, work).await
    }

    /// `work`, a delete, under the delete slot: a big folder holds one fs thread, not all of
    /// them, and it runs to its end whether or not the request is still there.
    pub async fn delete<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Busy> {
        self.delete.run(&self.lane, work).await
    }

    /// `work` under the settings slot (`/settings`, fs.md "Server settings"): one read,
    /// save or reload at a time, so a save stuck on a hung disk holds one fs thread.
    pub async fn settings<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, Busy> {
        self.settings.run(&self.lane, work).await
    }

    /// A raw-response slot, held by the response's producer until it ends: it spans
    /// many lane calls, one per chunk.
    pub async fn raw(&self) -> Result<OwnedSemaphorePermit, FsError> {
        Ok(self.raw.acquire().await?)
    }

    /// The upload slot, or `busy` at once: native sends one upload at a time.
    pub fn upload(&self) -> Result<OwnedSemaphorePermit, FsError> {
        self.upload
            .clone()
            .try_acquire_owned()
            .map_err(|_| FsError::Busy)
    }
}
