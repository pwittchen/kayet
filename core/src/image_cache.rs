//! Remote images for the preview and exports, downloaded once into `~/.kayet/cache/images/`.
//!
//! The web view doesn't show images from the web itself, so the frontend asks for a local
//! copy of every `http(s)` image and shows that through the asset protocol. Downloads go
//! through the system's `curl` (like `update`). A copy is named after a hash of its URL, with
//! the extension of its content type, and is reused from then on.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::config;

/// Largest image downloaded (the same limit as for images embedded into an HTML export).
const MAX_SIZE: &str = "20971520";

/// Downloads started, to give each one its own temporary file.
static DOWNLOADS: AtomicU64 = AtomicU64::new(0);

/// Image types a download may be, as `(extension, MIME type)`.
const TYPES: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
    ("ico", "image/vnd.microsoft.icon"),
];

/// `~/.kayet/cache/images`
pub fn dir() -> PathBuf {
    config::kayet_dir().join("cache").join("images")
}

/// Returns the local copy of the image at `url`, downloading it into `dir` first if needed.
pub fn fetch(dir: &Path, url: &str) -> Result<PathBuf, String> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("http://") {
        return Err(format!("not a web image: {url}"));
    }
    let stem = format!("{:016x}", fnv1a(url.as_bytes()));
    if let Some(path) = cached(dir, &stem) {
        return Ok(path);
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let n = DOWNLOADS.fetch_add(1, Ordering::Relaxed);
    let part = dir.join(format!(".{stem}-{}-{n}.part", std::process::id()));
    let out = Command::new("/usr/bin/curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            "=http,https",
            "--proto-redir",
            "=http,https",
            "--max-time",
            "30",
            "--max-filesize",
            MAX_SIZE,
            "--user-agent",
            "kayet",
            "--write-out",
            "%{content_type}",
            "--output",
        ])
        .arg(&part)
        .arg(url)
        .output()
        .map_err(|e| e.to_string());
    let result = out.and_then(|out| {
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        let content_type = String::from_utf8_lossy(&out.stdout);
        let ext = extension(&content_type, url)
            .ok_or_else(|| format!("{url} is not an image ({})", content_type.trim()))?;
        let path = dir.join(format!("{stem}.{ext}"));
        fs::rename(&part, &path).map_err(|e| e.to_string())?;
        Ok(path)
    });
    let _ = fs::remove_file(&part);
    result
}

/// An earlier download of the image named `stem`.
fn cached(dir: &Path, stem: &str) -> Option<PathBuf> {
    TYPES
        .iter()
        .map(|(ext, _)| dir.join(format!("{stem}.{ext}")))
        .find(|p| p.is_file())
}

/// File extension for a download: by its content type, or else by the URL's own extension
/// (for servers that send images as `application/octet-stream`).
fn extension(content_type: &str, url: &str) -> Option<&'static str> {
    let mime = content_type.split(';').next()?.trim().to_ascii_lowercase();
    if let Some((ext, _)) = TYPES.iter().find(|(_, m)| *m == mime) {
        return Some(ext);
    }
    let path = url.split(['?', '#']).next()?;
    let ext = path.rsplit_once('.')?.1.to_ascii_lowercase();
    let ext = if ext == "jpeg" { "jpg".into() } else { ext };
    TYPES.iter().find(|(e, _)| *e == ext).map(|(e, _)| *e)
}

/// 64-bit FNV-1a: a hash that stays the same across Rust versions, for stable file names.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable() {
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[test]
    fn extension_by_content_type_then_url() {
        assert_eq!(extension("image/png", "https://x/a"), Some("png"));
        assert_eq!(
            extension("image/svg+xml; charset=utf-8\n", "https://x/a"),
            Some("svg")
        );
        assert_eq!(
            extension("application/octet-stream", "https://x/a.JPEG?s=1"),
            Some("jpg")
        );
        assert_eq!(extension("text/html", "https://x/page"), None);
        assert_eq!(extension("text/html", "https://x.png/page"), None);
    }

    #[test]
    fn reuses_earlier_downloads_and_rejects_other_schemes() {
        let dir = tempfile::tempdir().unwrap();
        let url = "https://example.com/logo.png";
        let copy = dir
            .path()
            .join(format!("{:016x}.png", fnv1a(url.as_bytes())));
        fs::write(&copy, b"png").unwrap();
        assert_eq!(fetch(dir.path(), url).unwrap(), copy);
        assert!(fetch(dir.path(), "file:///etc/passwd").is_err());
        assert!(fetch(dir.path(), "/etc/passwd").is_err());
    }
}
