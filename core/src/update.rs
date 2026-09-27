//! App updates: looks up the latest kayet release on GitHub and, when it is newer than the
//! running app, offers to install it. Installing downloads the release's `.dmg`, checks that
//! the app inside is signed by the same Developer ID team as the running one, swaps the app
//! bundle in place and lets the frontend restart kayet (after asking about unsaved changes).
//!
//! Network and disk work goes through the system's `curl`, `hdiutil`, `codesign` and `ditto`,
//! so no HTTP client is compiled in.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

use crate::commands::AppState;

/// The latest published (non-draft, non-prerelease) release.
const LATEST_RELEASE: &str = "https://api.github.com/repos/pwittchen/kayet/releases/latest";

/// Delay before the first automatic check, so it never competes with startup.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
/// How often a long-running kayet checks again.
const CHECK_INTERVAL: Duration = Duration::from_hours(24);

/// Set while a check (and a possible install) is in progress, so dialogs never pile up.
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, PartialEq, Eq)]
pub struct Release {
    /// Version without the leading `v`, e.g. `0.2.0`.
    pub version: String,
    /// The release's GitHub page.
    pub page: String,
    /// Download URL of the release's `.dmg`, if it has one.
    pub dmg: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

/// Checks for updates once a day in the background, starting shortly after launch, while
/// `[updates] check_automatically` is on. Development builds and benchmark runs never check.
pub fn start_background_checks(app: &AppHandle) {
    if cfg!(debug_assertions) || crate::commands::bench_dir().is_some() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_DELAY);
        loop {
            let enabled = app
                .state::<AppState>()
                .config
                .lock()
                .is_ok_and(|c| c.updates.check_automatically);
            if enabled {
                check(&app, false);
            }
            std::thread::sleep(CHECK_INTERVAL);
        }
    });
}

/// Looks for a newer release and offers to install it. A `manual` check (Check for Updates…)
/// also reports that kayet is up to date or that the check failed, and ignores a skipped
/// version. Blocks until the user has answered, so call it off the main thread.
pub fn check(app: &AppHandle, manual: bool) {
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    run_check(app, manual);
    BUSY.store(false, Ordering::SeqCst);
}

fn run_check(app: &AppHandle, manual: bool) {
    let current = app.package_info().version.to_string();
    let release = match latest_release() {
        Ok(release) => release,
        Err(e) => {
            eprintln!("kayet: update check failed: {e}");
            if manual {
                message(
                    app,
                    "Couldn't check for updates",
                    &e,
                    MessageDialogKind::Warning,
                );
            }
            return;
        }
    };
    if !is_newer(&release.version, &current) {
        if manual {
            message(
                app,
                "kayet is up to date",
                &format!("kayet {current} is the latest version."),
                MessageDialogKind::Info,
            );
        }
        return;
    }
    let state = app.state::<AppState>();
    let skipped = state
        .config
        .lock()
        .ok()
        .and_then(|c| c.session.skipped_version.clone());
    if !manual && skipped.as_deref() == Some(release.version.as_str()) {
        return;
    }
    match ask_to_update(app, &release.version, &current) {
        Answer::Update => update(app, &release),
        Answer::Skip => {
            if let Ok(mut cfg) = state.config.lock() {
                cfg.session.skipped_version = Some(release.version.clone());
            }
            state.save_config();
        }
        Answer::Later => {}
    }
}

enum Answer {
    Update,
    Skip,
    Later,
}

fn ask_to_update(app: &AppHandle, version: &str, current: &str) -> Answer {
    let result = app
        .dialog()
        .message(format!(
            "kayet {version} is available — you have {current}. kayet restarts to finish updating."
        ))
        .title("A new version of kayet is available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            "Update".into(),
            "Skip This Version".into(),
            "Later".into(),
        ))
        .blocking_show_with_result();
    match result {
        MessageDialogResult::Yes => Answer::Update,
        MessageDialogResult::No => Answer::Skip,
        MessageDialogResult::Custom(label) if label == "Update" => Answer::Update,
        MessageDialogResult::Custom(label) if label == "Skip This Version" => Answer::Skip,
        _ => Answer::Later,
    }
}

/// Installs `release` in place of the running app, or opens its download page when kayet
/// can't update itself (not a signed app bundle, run from a disk image, no `.dmg`).
fn update(app: &AppHandle, release: &Release) {
    let target = installed_bundle()
        .zip(release.dmg.as_deref())
        .and_then(|(bundle, dmg)| {
            let team = team_identifier(&bundle)?;
            Some((bundle, dmg, team))
        });
    let Some((bundle, dmg, team)) = target else {
        open_page(&release.page);
        return;
    };
    let _ = app.emit("notice", format!("Downloading kayet {}…", release.version));
    match install(dmg, &bundle, &team) {
        Ok(true) => {
            let _ = app.emit("update://installed", &release.version);
        }
        Ok(false) => {} // the administrator password prompt was cancelled
        Err(e) => {
            eprintln!("kayet: update failed: {e}");
            let result = app
                .dialog()
                .message(format!(
                    "{e}\n\nYou can download kayet {} instead.",
                    release.version
                ))
                .title("Couldn't install the update")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Download".into(),
                    "Cancel".into(),
                ))
                .blocking_show_with_result();
            let download = match result {
                MessageDialogResult::Ok => true,
                MessageDialogResult::Custom(label) => label == "Download",
                _ => false,
            };
            if download {
                open_page(&release.page);
            }
        }
    }
}

fn message(app: &AppHandle, title: &str, text: &str, kind: MessageDialogKind) {
    app.dialog()
        .message(text)
        .title(title)
        .kind(kind)
        .blocking_show();
}

fn open_page(url: &str) {
    if let Err(e) = tauri_plugin_opener::open_url(url, None::<&str>) {
        eprintln!("kayet: cannot open {url}: {e}");
    }
}

/// Fetches the latest release from the GitHub API.
fn latest_release() -> Result<Release, String> {
    let json = run(Command::new("/usr/bin/curl").args([
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--max-time",
        "20",
        "--header",
        "Accept: application/vnd.github+json",
        "--user-agent",
        "kayet",
        LATEST_RELEASE,
    ]))?;
    parse_release(&json)
}

fn parse_release(json: &str) -> Result<Release, String> {
    let release: GitHubRelease =
        serde_json::from_str(json).map_err(|e| format!("unexpected response: {e}"))?;
    let version = release.tag_name.trim_start_matches('v').to_string();
    if parse_version(&version).is_none() {
        return Err(format!("unexpected release tag {}", release.tag_name));
    }
    let dmg = release
        .assets
        .into_iter()
        .find(|a| {
            Path::new(&a.name)
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("dmg"))
        })
        .map(|a| a.browser_download_url);
    Ok(Release {
        version,
        page: release.html_url,
        dmg,
    })
}

/// Parses `X.Y.Z` (an optional leading `v` is ignored).
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let mut parts = version.trim_start_matches('v').split('.');
    let mut next = || parts.next()?.parse().ok();
    let parsed = (next()?, next()?, next()?);
    parts.next().is_none().then_some(parsed)
}

/// Whether `candidate` is a later version than `current`.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
    }
}

/// The running `.app` bundle, if kayet runs from one it can replace (not from a disk image or
/// App Translocation's read-only copy).
fn installed_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?;
    let is_app = bundle.extension().is_some_and(|e| e == "app");
    let path = bundle.to_string_lossy();
    let movable = !path.contains("/AppTranslocation/") && !path.starts_with("/Volumes/");
    (is_app && movable).then(|| bundle.to_path_buf())
}

/// The Developer ID team that signed `app`, or None if it isn't signed by one.
fn team_identifier(app: &Path) -> Option<String> {
    let out = Command::new("/usr/bin/codesign")
        .args(["--display", "--verbose=2"])
        .arg(app)
        .output()
        .ok()?;
    // codesign prints the signature details to stderr.
    let details = String::from_utf8_lossy(&out.stderr);
    details
        .lines()
        .find_map(|l| l.strip_prefix("TeamIdentifier="))
        .map(str::trim)
        .filter(|t| !t.is_empty() && *t != "not set")
        .map(String::from)
}

/// Downloads the `.dmg` at `url`, verifies the app inside it and puts it in place of `bundle`.
/// Returns false if the user cancelled the administrator password prompt.
fn install(url: &str, bundle: &Path, team: &str) -> Result<bool, String> {
    let dir = std::env::temp_dir().join(format!("kayet-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _cleanup = RemoveOnDrop(dir.clone());

    let dmg = dir.join("kayet.dmg");
    run(Command::new("/usr/bin/curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-time",
            "600",
            "--output",
        ])
        .arg(&dmg)
        .arg(url))
    .map_err(|e| format!("Download failed: {e}"))?;

    let mount = dir.join("mount");
    run(Command::new("/usr/bin/hdiutil")
        .args([
            "attach",
            "-nobrowse",
            "-noautoopen",
            "-readonly",
            "-mountpoint",
        ])
        .arg(&mount)
        .arg(&dmg))
    .map_err(|e| format!("Can't open the disk image: {e}"))?;
    // Declared after `_cleanup`, so the image is detached before the folder is removed.
    let _detach = DetachOnDrop(mount.clone());

    let new_app = std::fs::read_dir(&mount)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .ok_or("The disk image contains no app.")?;
    run(Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&new_app))
    .map_err(|e| format!("The new version's signature is invalid: {e}"))?;
    if team_identifier(&new_app).as_deref() != Some(team) {
        return Err("The new version isn't signed by the kayet developer.".into());
    }
    replace_bundle(&new_app, bundle)
}

/// Copies `new_app` over `bundle`, restoring the old bundle if that fails. Asks for an
/// administrator password when the bundle's folder isn't writable.
fn replace_bundle(new_app: &Path, bundle: &Path) -> Result<bool, String> {
    let parent = bundle.parent().ok_or("The app has no parent folder.")?;
    let quote = |p: &Path| crate::cli::sh_quote(&p.to_string_lossy());
    let (new, target) = (quote(new_app), quote(bundle));
    let stage = quote(&parent.join(".kayet-update.app"));
    let old = quote(&parent.join(".kayet-old.app"));
    let script = format!(
        "set -e; owner=$(stat -f %u:%g {target}); rm -rf {stage} {old}; ditto {new} {stage}; \
         mv {target} {old}; \
         if mv {stage} {target}; then chown -R \"$owner\" {target} 2>/dev/null || true; rm -rf {old}; \
         else mv {old} {target}; exit 1; fi"
    );
    if writable(parent) {
        run(Command::new("/bin/sh").arg("-c").arg(&script)).map(|_| true)
    } else {
        crate::cli::run_as_admin(&script)
    }
    .map_err(|e| format!("Can't replace {}: {e}", bundle.display()))
}

fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".kayet-write-test-{}", std::process::id()));
    std::fs::create_dir(&probe).is_ok() && std::fs::remove_dir(&probe).is_ok()
}

/// Runs `command`, returning its stdout, or its stderr as the error.
fn run(command: &mut Command) -> Result<String, String> {
    let out = command.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

struct RemoveOnDrop(PathBuf);

impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct DetachOnDrop(PathBuf);

impl Drop for DetachOnDrop {
    fn drop(&mut self) {
        let _ = Command::new("/usr/bin/hdiutil")
            .args(["detach", "-force"])
            .arg(&self.0)
            .output();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_compared_numerically() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("v0.10.0", "0.9.9"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
        assert!(!is_newer("0.2", "0.1.0"));
        assert!(!is_newer("0.2.0-beta", "0.1.0"));
        assert!(!is_newer("0.2.0.1", "0.1.0"));
    }

    #[test]
    fn release_is_parsed() {
        let json = r#"{
            "tag_name": "v0.2.0",
            "html_url": "https://github.com/pwittchen/kayet/releases/tag/v0.2.0",
            "assets": [
                {"name": "notes.txt", "browser_download_url": "https://example.com/notes.txt"},
                {"name": "kayet-macos-aarch64.dmg", "browser_download_url": "https://example.com/kayet.dmg"}
            ]
        }"#;
        assert_eq!(
            parse_release(json).unwrap(),
            Release {
                version: "0.2.0".into(),
                page: "https://github.com/pwittchen/kayet/releases/tag/v0.2.0".into(),
                dmg: Some("https://example.com/kayet.dmg".into()),
            }
        );
    }

    #[test]
    fn release_without_dmg_or_with_odd_tag() {
        let json = r#"{"tag_name": "v0.3.0", "html_url": "https://x"}"#;
        assert_eq!(parse_release(json).unwrap().dmg, None);
        let json = r#"{"tag_name": "nightly", "html_url": "https://x", "assets": []}"#;
        assert!(parse_release(json).is_err());
        assert!(parse_release("{}").is_err());
    }
}
