//! Crash recovery: a backup of the unsaved buffer in `~/.kayet/recovery/`.
//!
//! The frontend writes the backup while the document has unsaved changes and removes it
//! once they are saved or discarded, and on a clean close. A backup still present at
//! launch therefore means kayet did not exit cleanly, and it is offered for restoring.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config;
use crate::fs_ops;

/// An unsaved buffer; `path` is `None` for an untitled document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Backup {
    pub path: Option<String>,
    pub text: String,
}

/// `~/.kayet/recovery/buffer.json`
pub fn backup_path() -> PathBuf {
    config::kayet_dir().join("recovery").join("buffer.json")
}

pub fn write(file: &Path, backup: &Backup) -> io::Result<()> {
    let json = serde_json::to_string(backup).map_err(io::Error::other)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    fs_ops::write_atomic(file, &json)
}

/// Reads the backup, if there is one. An unreadable backup is reported and left in place.
pub fn read(file: &Path) -> Option<Backup> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(e) => {
            if e.kind() != io::ErrorKind::NotFound {
                eprintln!("kayet: cannot read {}: {e}", file.display());
            }
            return None;
        }
    };
    match serde_json::from_str(&text) {
        Ok(backup) => Some(backup),
        Err(e) => {
            eprintln!("kayet: invalid recovery file {}: {e}", file.display());
            None
        }
    }
}

pub fn clear(file: &Path) -> io::Result<()> {
    match fs::remove_file(file) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("recovery").join("buffer.json");
        assert_eq!(read(&file), None);
        let backup = Backup {
            path: Some("/tmp/a.md".into()),
            text: "one\r\ntwo \u{1F600}".into(),
        };
        write(&file, &backup).unwrap();
        assert_eq!(read(&file), Some(backup));
        let untitled = Backup {
            path: None,
            text: "draft".into(),
        };
        write(&file, &untitled).unwrap();
        assert_eq!(read(&file), Some(untitled));
        clear(&file).unwrap();
        assert_eq!(read(&file), None);
        clear(&file).unwrap();
    }

    #[test]
    fn invalid_backup_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("buffer.json");
        fs::write(&file, "not json").unwrap();
        assert_eq!(read(&file), None);
        assert!(file.exists());
    }
}
