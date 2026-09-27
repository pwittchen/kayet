//! The `kayet` shell command: a launcher script bundled in the app's resources
//! (`core/cli/kayet`) that "Install 'kayet' Command" symlinks into PATH.

use std::path::Path;

/// Where the command is installed; on PATH by default on macOS.
pub const LINK: &str = "/usr/local/bin/kayet";

/// Symlinks `script` to [`LINK`], asking for an administrator password if needed.
/// Returns false if the user cancelled the password prompt.
#[cfg(target_os = "macos")]
pub fn install(script: &Path) -> Result<bool, String> {
    if !script.is_file() {
        return Err(format!("{} is missing", script.display()));
    }
    let link = Path::new(LINK);
    match link_script(script, link) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => install_as_admin(script, link),
        Err(e) => Err(format!("cannot install {LINK}: {e}")),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install(_script: &Path) -> Result<bool, String> {
    Err("the kayet command is only available on macOS".into())
}

#[cfg(target_os = "macos")]
fn link_script(script: &Path, link: &Path) -> std::io::Result<()> {
    if let Some(dir) = link.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if link.symlink_metadata().is_ok() {
        std::fs::remove_file(link)?;
    }
    std::os::unix::fs::symlink(script, link)
}

#[cfg(target_os = "macos")]
fn install_as_admin(script: &Path, link: &Path) -> Result<bool, String> {
    let dir = link.parent().unwrap_or(Path::new("/"));
    let command = format!(
        "mkdir -p {} && ln -sf {} {}",
        sh_quote(&dir.to_string_lossy()),
        sh_quote(&script.to_string_lossy()),
        sh_quote(&link.to_string_lossy()),
    );
    let apple_script = format!(
        "do shell script {} with administrator privileges",
        applescript_string(&command)
    );
    let out = std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(apple_script)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(true);
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    if stderr.contains("(-128)") {
        return Ok(false); // "User canceled."
    }
    Err(format!("cannot install {LINK}: {}", stderr.trim()))
}

/// Quotes `s` as a single POSIX shell word.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Quotes `s` as an AppleScript string literal.
fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', r"\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_quoting() {
        assert_eq!(sh_quote("/Applications/kayet.app"), "'/Applications/kayet.app'");
        assert_eq!(sh_quote("it's here"), r"'it'\''s here'");
    }

    #[test]
    fn applescript_quoting() {
        assert_eq!(applescript_string(r#"ln -sf 'a"b\c'"#), r#""ln -sf 'a\"b\\c'""#);
    }
}
