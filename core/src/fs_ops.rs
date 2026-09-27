//! File system operations: read, atomic write, create, rename, trash.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};

pub fn read_file(path: &Path) -> io::Result<String> {
    let bytes = fs::read(path)?;
    String::from_utf8(bytes).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{} is not valid UTF-8", path.display()),
        )
    })
}

/// Writes `contents` to a temp file next to `path`, then renames it into place so readers
/// never observe a half-written file. Permissions of an existing file are preserved.
pub fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let tmp = dir.join(format!(".{}.kayet-tmp", name.to_string_lossy()));

    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        if let Ok(meta) = fs::metadata(path) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Creates an empty file; fails if it already exists.
pub fn create_file(path: &Path) -> io::Result<()> {
    OpenOptions::new().write(true).create_new(true).open(path)?;
    Ok(())
}

/// Creates a directory; fails if it already exists.
pub fn create_dir(path: &Path) -> io::Result<()> {
    fs::create_dir(path)
}

/// Renames / moves `from` to `to`; refuses to overwrite an existing entry.
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    // Allow case-only renames on case-insensitive file systems.
    let same_entry = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    if to.exists() && !same_entry {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("{} already exists", to.display()),
        ));
    }
    fs::rename(from, to)
}

/// Moves `path` to the system Trash.
pub fn trash(path: &Path) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        // NSFileManager avoids the Finder automation permission prompt.
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path).map_err(|e| e.to_string())
}

/// Lexically normalizes a path (resolves `.` and `..`) without touching the file system.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// Resolves symlinks for the existing part of `path`, keeping any non-existent tail.
pub fn canonical(path: &Path) -> PathBuf {
    let path = normalize(path);
    if let Ok(c) = fs::canonicalize(&path) {
        return c;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => canonical(parent).join(name),
        _ => path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_roundtrip_preserves_line_endings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.txt");
        write_atomic(&path, "one\r\ntwo\r\n").unwrap();
        assert_eq!(read_file(&path).unwrap(), "one\r\ntwo\r\n");
        write_atomic(&path, "three").unwrap();
        assert_eq!(read_file(&path).unwrap(), "three");
        let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn read_rejects_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bin");
        fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(
            read_file(&path).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn create_and_rename() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        create_file(&a).unwrap();
        assert!(create_file(&a).is_err());
        create_dir(&dir.path().join("sub")).unwrap();
        rename(&a, &b).unwrap();
        assert!(!a.exists() && b.exists());
        create_file(&a).unwrap();
        assert!(rename(&a, &b).is_err());
    }

    #[test]
    fn normalize_resolves_dots() {
        assert_eq!(
            normalize(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
    }
}
