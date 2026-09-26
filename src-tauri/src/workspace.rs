//! Workspace resolution, directory listing and file system watching.

use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::config::{self, kayet_dir};

pub const FS_CHANGED: &str = "fs://changed";

/// `~/.kayet/workspace`
pub fn default_workspace() -> PathBuf {
    kayet_dir().join("workspace")
}

/// Resolves the configured workspace path. Returns the path to use and whether it had to
/// fall back to the default because the configured one no longer exists.
pub fn resolve(configured: &str) -> (PathBuf, bool) {
    let path = config::expand_tilde(configured);
    if path.is_dir() {
        return (path, false);
    }
    let default = default_workspace();
    if let Err(e) = fs::create_dir_all(&default) {
        eprintln!("kayet: cannot create default workspace: {e}");
    }
    (default.clone(), path != default)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Lists a directory: directories first, then files, each alphabetical (case-insensitive).
pub fn list_dir(path: &Path, show_hidden: bool) -> io::Result<Vec<Entry>> {
    let mut entries: Vec<Entry> = fs::read_dir(path)?
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !show_hidden && name.starts_with('.') {
                return None;
            }
            // Follow symlinks so linked folders behave like folders.
            let is_dir = fs::metadata(e.path()).map(|m| m.is_dir()).unwrap_or(false);
            Some(Entry {
                name,
                path: e.path().to_string_lossy().into_owned(),
                is_dir,
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[derive(Clone, Serialize)]
struct FsChanged {
    paths: Vec<String>,
}

/// Watches the workspace recursively, plus the directory of an open file that lives outside
/// the workspace. Changes are coalesced and emitted to the frontend as `fs://changed`.
pub struct FsWatcher {
    watcher: notify::RecommendedWatcher,
    root: PathBuf,
    extra: Option<PathBuf>,
}

impl FsWatcher {
    pub fn start(app: AppHandle, root: &Path) -> notify::Result<Self> {
        let (tx, rx) = mpsc::channel::<notify::Event>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res
                && !matches!(event.kind, EventKind::Access(_))
            {
                let _ = tx.send(event);
            }
        })?;
        watcher.watch(root, RecursiveMode::Recursive)?;

        // Debounce thread: exits when the watcher (and with it the sender) is dropped.
        std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut paths = BTreeSet::new();
                paths.extend(first.paths);
                while let Ok(ev) = rx.recv_timeout(Duration::from_millis(100)) {
                    paths.extend(ev.paths);
                }
                let paths = paths
                    .into_iter()
                    .filter(|p| !p.to_string_lossy().ends_with(".kayet-tmp"))
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                if !paths.is_empty() {
                    let _ = app.emit(FS_CHANGED, FsChanged { paths });
                }
            }
        });

        Ok(Self {
            watcher,
            root: root.to_path_buf(),
            extra: None,
        })
    }

    /// Makes sure changes to `file` are reported even if it is outside the workspace.
    pub fn watch_file(&mut self, file: &Path) {
        let dir = file.parent().map(Path::to_path_buf);
        let wanted = dir.filter(|d| !d.starts_with(&self.root));
        if wanted == self.extra {
            return;
        }
        if let Some(old) = self.extra.take() {
            let _ = self.watcher.unwatch(&old);
        }
        if let Some(dir) = wanted
            && self.watcher.watch(&dir, RecursiveMode::NonRecursive).is_ok()
        {
            self.extra = Some(dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_dirs_first_case_insensitive_without_dotfiles() {
        let dir = tempfile::tempdir().unwrap();
        for f in ["b.md", "A.txt", ".hidden", "c.md"] {
            fs::write(dir.path().join(f), "").unwrap();
        }
        for d in ["zeta", "Alpha"] {
            fs::create_dir(dir.path().join(d)).unwrap();
        }
        let names = |show| {
            list_dir(dir.path(), show)
                .unwrap()
                .into_iter()
                .map(|e| e.name)
                .collect::<Vec<_>>()
        };
        assert_eq!(names(false), ["Alpha", "zeta", "A.txt", "b.md", "c.md"]);
        assert_eq!(names(true)[2], ".hidden");
    }

    #[test]
    fn resolve_keeps_existing_dir() {
        let dir = tempfile::tempdir().unwrap();
        let (path, fell_back) = resolve(dir.path().to_str().unwrap());
        assert_eq!(path, dir.path());
        assert!(!fell_back);
    }
}
