//! App updates: looks up the latest kayet release on GitHub and, when it is newer than the
//! running app, offers to install it (the frontend asks, see `ui/updates.ts`). Installing downloads the release's `.dmg`, checks that
//! the app inside is signed by the same Developer ID team as the running one, swaps the app
//! bundle in place and lets the frontend restart kayet (after asking about unsaved changes).
//!
//! Network and disk work goes through the system's `curl`, `hdiutil`, `codesign` and `ditto`,
//! so no HTTP client is compiled in.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;

/// The latest published (non-draft, non-prerelease) release.
const LATEST_RELEASE: &str = "https://api.github.com/repos/pwittchen/kayet/releases/latest";

/// Recent published releases, for the changelog (What's New).
const RELEASES: &str = "https://api.github.com/repos/pwittchen/kayet/releases";

/// How many releases the changelog shows at most.
const MAX_CHANGELOG: usize = 20;

/// Delay before the first automatic check, so it never competes with startup.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
/// How often a long-running kayet checks again.
const CHECK_INTERVAL: Duration = Duration::from_hours(24);

/// Set while a check or an install is in progress, so they never overlap.
static BUSY: AtomicBool = AtomicBool::new(false);

/// The newer release last offered to the frontend, until it answers (see `answer`).
static OFFERED: Mutex<Option<Release>> = Mutex::new(None);

/// What a check found, emitted as `update://checked` for the frontend to show. Automatic
/// checks only report `Available`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Checked {
    /// A newer release: the frontend offers Update, Skip This Version or Later.
    Available {
        version: String,
        current: String,
    },
    UpToDate {
        current: String,
    },
    Failed {
        error: String,
    },
}

/// Emitted as `update://failed` when installing fails; the frontend offers the download page.
#[derive(Debug, Clone, Serialize)]
pub struct InstallFailed {
    pub error: String,
    pub version: String,
    pub page: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Release {
    /// Version without the leading `v`, e.g. `0.2.0`.
    pub version: String,
    /// The release's GitHub page.
    pub page: String,
    /// Download URL of the release's `.dmg` for this Mac's architecture, if it has one.
    pub dmg: Option<String>,
}

/// One release's notes for the changelog view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChangelogEntry {
    /// Version without the leading `v`, e.g. `0.2.0`.
    pub version: String,
    /// The release notes (Markdown), empty when the release has none.
    pub body: String,
    /// The release's GitHub page.
    pub page: String,
    /// When the release was published (ISO 8601), empty when unknown.
    pub published_at: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
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

/// Looks for a newer release and emits what it found as `update://checked`. A `manual` check
/// (Check for Updates…) also reports that kayet is up to date or that the check failed, and
/// ignores a skipped version. Blocks on the network, so call it off the main thread.
pub fn check(app: &AppHandle, manual: bool) {
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let checked = run_check(app, manual);
    BUSY.store(false, Ordering::SeqCst);
    if let Some(checked) = checked {
        let _ = app.emit("update://checked", checked);
    }
}

fn run_check(app: &AppHandle, manual: bool) -> Option<Checked> {
    let current = app.package_info().version.to_string();
    let release = match latest_release() {
        Ok(release) => release,
        Err(e) => {
            eprintln!("kayet: update check failed: {e}");
            return manual.then_some(Checked::Failed { error: e });
        }
    };
    if !is_newer(&release.version, &current) {
        return manual.then_some(Checked::UpToDate { current });
    }
    let skipped = app
        .state::<AppState>()
        .config
        .lock()
        .ok()
        .and_then(|c| c.session.skipped_version.clone());
    if !manual && skipped.as_deref() == Some(release.version.as_str()) {
        return None;
    }
    let version = release.version.clone();
    if let Ok(mut offered) = OFFERED.lock() {
        *offered = Some(release);
    }
    Some(Checked::Available { version, current })
}

/// The user's answer to the offered release: `"update"` installs it (blocking, so call it
/// off the main thread), `"skip"` stops automatic checks from offering it again, anything
/// else (Later) does nothing.
pub fn answer(app: &AppHandle, answer: &str) {
    let Some(release) = OFFERED.lock().ok().and_then(|mut o| o.take()) else {
        return;
    };
    match answer {
        "update" => {
            if BUSY.swap(true, Ordering::SeqCst) {
                return;
            }
            update(app, &release);
            BUSY.store(false, Ordering::SeqCst);
        }
        "skip" => {
            let state = app.state::<AppState>();
            if let Ok(mut cfg) = state.config.lock() {
                cfg.session.skipped_version = Some(release.version);
            }
            state.save_config();
        }
        _ => {}
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
        Err(error) => {
            eprintln!("kayet: update failed: {error}");
            let _ = app.emit(
                "update://failed",
                InstallFailed {
                    error,
                    version: release.version.clone(),
                    page: release.page.clone(),
                },
            );
        }
    }
}

fn open_page(url: &str) {
    if let Err(e) = tauri_plugin_opener::open_url(url, None::<&str>) {
        eprintln!("kayet: cannot open {url}: {e}");
    }
}

/// Fetches JSON from the GitHub API through the system `curl` (no HTTP client is bundled).
fn fetch_json(url: &str) -> Result<String, String> {
    run(Command::new("/usr/bin/curl").args([
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
        url,
    ]))
}

/// Fetches the latest release from the GitHub API.
fn latest_release() -> Result<Release, String> {
    parse_release(&fetch_json(LATEST_RELEASE)?, std::env::consts::ARCH)
}

/// Fetches the recent published releases for the changelog, newest first.
pub fn releases() -> Result<Vec<ChangelogEntry>, String> {
    parse_releases(&fetch_json(&format!(
        "{RELEASES}?per_page={MAX_CHANGELOG}"
    ))?)
}

fn parse_releases(json: &str) -> Result<Vec<ChangelogEntry>, String> {
    let releases: Vec<GitHubRelease> =
        serde_json::from_str(json).map_err(|e| format!("unexpected response: {e}"))?;
    let mut entries: Vec<ChangelogEntry> = releases
        .into_iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| {
            let version = r.tag_name.trim_start_matches('v').to_string();
            parse_version(&version)?;
            Some(ChangelogEntry {
                version,
                body: r.body.unwrap_or_default(),
                page: r.html_url,
                published_at: r.published_at.unwrap_or_default(),
            })
        })
        .collect();
    entries.truncate(MAX_CHANGELOG);
    Ok(entries)
}

/// Parses the latest release; `arch` (`aarch64` or `x86_64`) picks the `.dmg` built for it
/// (`kayet-macos-<arch>.dmg`), so an update never swaps in an app for the other architecture.
fn parse_release(json: &str, arch: &str) -> Result<Release, String> {
    let release: GitHubRelease =
        serde_json::from_str(json).map_err(|e| format!("unexpected response: {e}"))?;
    let version = release.tag_name.trim_start_matches('v').to_string();
    if parse_version(&version).is_none() {
        return Err(format!("unexpected release tag {}", release.tag_name));
    }
    let dmg_name = format!("kayet-macos-{arch}.dmg");
    let dmg = release
        .assets
        .into_iter()
        .find(|a| a.name.eq_ignore_ascii_case(&dmg_name))
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
    fn check_results_serialize_for_the_frontend() {
        let json = |c: &Checked| serde_json::to_string(c).unwrap();
        assert_eq!(
            json(&Checked::Available {
                version: "0.2.0".into(),
                current: "0.1.0".into()
            }),
            r#"{"kind":"available","version":"0.2.0","current":"0.1.0"}"#
        );
        assert_eq!(
            json(&Checked::UpToDate {
                current: "0.1.0".into()
            }),
            r#"{"kind":"up-to-date","current":"0.1.0"}"#
        );
    }

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
                {"name": "kayet-macos-x86_64.dmg", "browser_download_url": "https://example.com/intel.dmg"},
                {"name": "kayet-macos-aarch64.dmg", "browser_download_url": "https://example.com/arm.dmg"}
            ]
        }"#;
        assert_eq!(
            parse_release(json, "aarch64").unwrap(),
            Release {
                version: "0.2.0".into(),
                page: "https://github.com/pwittchen/kayet/releases/tag/v0.2.0".into(),
                dmg: Some("https://example.com/arm.dmg".into()),
            }
        );
        assert_eq!(
            parse_release(json, "x86_64").unwrap().dmg.as_deref(),
            Some("https://example.com/intel.dmg")
        );
    }

    #[test]
    fn release_without_a_dmg_for_this_arch() {
        // Releases before Intel builds only carry the Apple Silicon .dmg.
        let json = r#"{
            "tag_name": "v0.2.0",
            "html_url": "https://x",
            "assets": [{"name": "kayet-macos-aarch64.dmg", "browser_download_url": "https://x/arm.dmg"}]
        }"#;
        assert_eq!(parse_release(json, "x86_64").unwrap().dmg, None);
    }

    #[test]
    fn changelog_body_is_carried_through() {
        let json = r#"[{"tag_name": "v0.2.0", "html_url": "https://x", "body": "- Fixed it"}]"#;
        assert_eq!(parse_releases(json).unwrap()[0].body, "- Fixed it");
        let json = r#"[{"tag_name": "v0.2.0", "html_url": "https://x", "body": null}]"#;
        assert_eq!(parse_releases(json).unwrap()[0].body, "");
        let json = r#"[{"tag_name": "v0.2.0", "html_url": "https://x"}]"#;
        assert_eq!(parse_releases(json).unwrap()[0].body, "");
    }

    #[test]
    fn changelog_keeps_order_and_drops_drafts_and_prereleases() {
        let json = r#"[
            {"tag_name": "v0.3.0", "html_url": "https://x/3", "body": "three", "published_at": "2026-01-03T00:00:00Z"},
            {"tag_name": "v0.4.0-beta", "html_url": "https://x/4", "body": "beta", "prerelease": true},
            {"tag_name": "v0.2.0", "html_url": "https://x/2", "body": null, "draft": true},
            {"tag_name": "nightly", "html_url": "https://x/n", "body": "bad tag"},
            {"tag_name": "v0.1.0", "html_url": "https://x/1"}
        ]"#;
        assert_eq!(
            parse_releases(json).unwrap(),
            [
                ChangelogEntry {
                    version: "0.3.0".into(),
                    body: "three".into(),
                    page: "https://x/3".into(),
                    published_at: "2026-01-03T00:00:00Z".into(),
                },
                ChangelogEntry {
                    version: "0.1.0".into(),
                    body: String::new(),
                    page: "https://x/1".into(),
                    published_at: String::new(),
                },
            ]
        );
        assert!(parse_releases("{}").is_err());
        assert_eq!(parse_releases("[]").unwrap(), []);
    }

    #[test]
    fn changelog_is_capped() {
        let items: Vec<String> = (0..25)
            .map(|i| {
                format!(
                    r#"{{"tag_name": "v0.0.{}", "html_url": "https://x/{}"}}"#,
                    25 - i,
                    25 - i
                )
            })
            .collect();
        let entries = parse_releases(&format!("[{}]", items.join(","))).unwrap();
        assert_eq!(entries.len(), MAX_CHANGELOG);
        assert_eq!(entries[0].version, "0.0.25");
    }

    #[test]
    fn release_without_dmg_or_with_odd_tag() {
        let json = r#"{"tag_name": "v0.3.0", "html_url": "https://x"}"#;
        assert_eq!(parse_release(json, "aarch64").unwrap().dmg, None);
        let json = r#"{"tag_name": "nightly", "html_url": "https://x", "assets": []}"#;
        assert!(parse_release(json, "aarch64").is_err());
        assert!(parse_release("{}", "aarch64").is_err());
    }
}
