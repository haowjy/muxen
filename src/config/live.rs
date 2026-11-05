//! The running config (fs.md "The uploads folder"): `config.toml` is read at startup and
//! again only on a reload, which applies the live keys (`uploads_dir`, `search_skip`) at
//! once and reports the restart-only keys that changed. Uploads and Search read the copy
//! here, never the file.

use std::sync::{Mutex, MutexGuard, PoisonError};

use tracing::{info, warn};

use super::{Config, ConfigError, ConfigFile, DEFAULT_SEARCH_SKIP, DEFAULT_UPLOADS_DIR};
use crate::files::Stamp;

/// The keys a reload applies, as the file has them: `None` is no key, the default.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveKeys {
    pub uploads_dir: Option<String>,
    pub search_skip: Option<Vec<String>>,
}

impl LiveKeys {
    fn of(config: &Config) -> Self {
        Self {
            uploads_dir: config.uploads_dir.clone(),
            search_skip: config.search_skip.clone(),
        }
    }

    pub fn uploads_dir(&self) -> &str {
        self.uploads_dir.as_deref().unwrap_or(DEFAULT_UPLOADS_DIR)
    }

    pub fn search_skip(&self) -> Vec<String> {
        self.search_skip
            .clone()
            .unwrap_or_else(|| DEFAULT_SEARCH_SKIP.map(str::to_owned).to_vec())
    }
}

#[derive(Debug)]
pub struct LiveConfig {
    file: ConfigFile,
    /// What the daemon started with: a restart-only key is compared against it.
    started: Config,
    running: Mutex<Running>,
    /// Held across a reload's or a save's read and adoption, so neither adopts a file the
    /// other has since replaced.
    changing: Mutex<()>,
}

#[derive(Debug)]
struct Running {
    keys: LiveKeys,
    /// The file as last loaded or written (`None`: there was none).
    stamp: Option<Stamp>,
}

impl LiveConfig {
    /// `started` was read from `file` when it had `stamp`.
    pub fn new(file: ConfigFile, started: Config, stamp: Option<Stamp>) -> Self {
        Self {
            file,
            running: Mutex::new(Running {
                keys: LiveKeys::of(&started),
                stamp,
            }),
            started,
            changing: Mutex::new(()),
        }
    }

    pub fn file(&self) -> &ConfigFile {
        &self.file
    }

    /// The config the daemon started with; its restart-only keys are the running ones.
    pub fn started(&self) -> &Config {
        &self.started
    }

    /// The running live keys. Doesn't touch the file.
    pub fn keys(&self) -> LiveKeys {
        self.running().keys.clone()
    }

    /// Whether the file differs from what was last loaded or written: a hand edit not yet
    /// reloaded. Blocks.
    pub fn file_changed(&self) -> bool {
        self.file.stamp() != self.running().stamp
    }

    /// Reads and parses the whole file; if it parses, applies the live keys and answers
    /// the restart-only keys that differ from the running ones. If it doesn't, nothing
    /// changes. Blocks.
    pub fn reload(&self) -> Result<Vec<&'static str>, ConfigError> {
        let _changing = self.changing();
        match self.file.read() {
            Ok((config, stamp)) => Ok(self.adopt(&config, stamp, "config.toml reloaded")),
            Err(error) => {
                warn!(%error, "config.toml not reloaded: the running config stays");
                Err(error)
            }
        }
    }

    /// Held by a save from its read to its `adopt`.
    pub(super) fn changing(&self) -> MutexGuard<'_, ()> {
        self.changing.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The file's stamp as last loaded or written.
    pub(super) fn loaded_stamp(&self) -> Option<Stamp> {
        self.running().stamp
    }

    /// `config`, just read or written with `stamp`, becomes the running config's live
    /// keys; the restart-only keys that differ are answered and logged as `event`, with
    /// the live keys that changed (never their values), not applied.
    pub(super) fn adopt(
        &self,
        config: &Config,
        stamp: Option<Stamp>,
        event: &'static str,
    ) -> Vec<&'static str> {
        let keys = LiveKeys::of(config);
        let mut running = self.running();
        let changed: Vec<&str> = [
            ("uploads_dir", running.keys.uploads_dir != keys.uploads_dir),
            ("search_skip", running.keys.search_skip != keys.search_skip),
        ]
        .into_iter()
        .filter_map(|(key, changed)| changed.then_some(key))
        .collect();
        *running = Running { keys, stamp };
        drop(running);
        let restart = restart_needed(&self.started, config);
        info!(?changed, restart_needed = ?restart, "{event}");
        restart
    }

    fn running(&self) -> MutexGuard<'_, Running> {
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The keys that apply only at a restart and differ between `running` and `file`.
fn restart_needed(running: &Config, file: &Config) -> Vec<&'static str> {
    let (a, b) = (running, file);
    [
        ("name", a.name != b.name),
        (
            "memory_budget_mib",
            a.memory_budget_mib != b.memory_budget_mib,
        ),
        ("tmux.program", a.tmux.program != b.tmux.program),
        ("tmux.socket_name", a.tmux.socket_name != b.tmux.socket_name),
        ("tmux.socket_path", a.tmux.socket_path != b.tmux.socket_path),
        ("complete.history", a.complete.history != b.complete.history),
        ("complete.path", a.complete.path != b.complete.path),
        (
            "complete.carapace",
            a.complete.carapace != b.complete.carapace,
        ),
    ]
    .into_iter()
    .filter_map(|(key, differs)| differs.then_some(key))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::test_tree::Tree;

    #[test]
    fn a_reload_applies_live_keys_and_reports_the_rest_and_a_broken_one_changes_nothing() {
        let tree = Tree::new("live");
        tree.write("config.toml", b"uploads_dir = \"/a\"\n");
        let file = ConfigFile::resolve(Some(&tree.path("config.toml"))).expect("a path");
        let (started, stamp) = file.read().expect("parses");
        let live = LiveConfig::new(file, started, stamp);
        assert!(!live.file_changed());

        // A hand edit does nothing until a reload.
        tree.write(
            "config.toml",
            b"uploads_dir = \"/b\"\nsearch_skip = []\nmemory_budget_mib = 99\n",
        );
        assert!(live.file_changed());
        assert_eq!(live.keys().uploads_dir(), "/a");
        assert_eq!(live.reload().expect("parses"), ["memory_budget_mib"]);
        let reloaded = LiveKeys {
            uploads_dir: Some("/b".into()),
            search_skip: Some(Vec::new()),
        };
        assert_eq!(live.keys(), reloaded);
        assert!(!live.file_changed());

        tree.write("config.toml", b"uploads_dir = \"/c\"\nsearch_skip = [\n");
        let broken = live.reload().expect_err("doesn't parse");
        assert!(
            matches!(
                broken,
                ConfigError::Parse {
                    line: 2,
                    column: 16,
                    ..
                }
            ),
            "{broken}"
        );
        assert_eq!(live.keys(), reloaded);
        assert!(live.file_changed());
    }
}
