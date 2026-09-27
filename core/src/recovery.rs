//! Crash recovery: a backup of the unsaved buffers in `~/.kayet/recovery/`.
//!
//! The frontend writes the backup while any tab has unsaved changes and removes it once
//! they are all saved or discarded, and on a clean close. A backup still present at
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

/// The backup file: a list of buffers, or a single one as written before tabs.
#[derive(Deserialize)]
#[serde(untagged)]
enum Stored {
    Many(Vec<Backup>),
    One(Backup),
}

pub fn write(file: &Path, backups: &[Backup]) -> io::Result<()> {
    let json = serde_json::to_string(backups).map_err(io::Error::other)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    fs_ops::write_atomic(file, &json)
}

/// Reads the backed up buffers (none if there is no backup). An unreadable backup is
/// reported and left in place.
pub fn read(file: &Path) -> Vec<Backup> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(e) => {
            if e.kind() != io::ErrorKind::NotFound {
                eprintln!("kayet: cannot read {}: {e}", file.display());
            }
            return Vec::new();
        }
    };
    match serde_json::from_str(&text) {
        Ok(Stored::Many(backups)) => backups,
        Ok(Stored::One(backup)) => vec![backup],
        Err(e) => {
            eprintln!("kayet: invalid recovery file {}: {e}", file.display());
            Vec::new()
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
        assert_eq!(read(&file), []);
        let backups = [
            Backup {
                path: Some("/tmp/a.md".into()),
                text: "one\r\ntwo \u{1F600}".into(),
            },
            Backup {
                path: None,
                text: "draft".into(),
            },
        ];
        write(&file, &backups).unwrap();
        assert_eq!(read(&file), backups);
        write(&file, &backups[1..]).unwrap();
        assert_eq!(read(&file), backups[1..]);
        clear(&file).unwrap();
        assert_eq!(read(&file), []);
        clear(&file).unwrap();
    }

    #[test]
    fn single_buffer_backup_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("buffer.json");
        fs::write(&file, r#"{"path":null,"text":"draft"}"#).unwrap();
        assert_eq!(
            read(&file),
            [Backup {
                path: None,
                text: "draft".into()
            }]
        );
    }

    #[test]
    fn invalid_backup_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("buffer.json");
        fs::write(&file, "not json").unwrap();
        assert_eq!(read(&file), []);
        assert!(file.exists());
    }
}
