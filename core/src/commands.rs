//! `#[tauri::command]` handlers — the frontend's API.
//!
//! File system access is restricted to the workspace and to files the user explicitly
//! picked (open/save dialogs, drag-and-drop, Finder / the `kayet` command, the restored
//! last file).

// Tauri commands must take their arguments (State, AppHandle, WebviewWindow, …) by value.
#![allow(clippy::needless_pass_by_value)]

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

use crate::config::{self, Config};
use crate::fs_ops::{self, canonical};
use crate::markdown;
use crate::recovery;
use crate::search::{self, Match};
use crate::workspace::{self, Entry, FsWatcher};

type CmdResult<T> = Result<T, String>;

pub struct AppState {
    pub config: Mutex<Config>,
    pub workspace: Mutex<PathBuf>,
    pub watcher: Mutex<Option<FsWatcher>>,
    /// Paths explicitly chosen by the user outside the workspace.
    pub allowed: Mutex<HashSet<PathBuf>>,
    /// Non-blocking notice shown once by the frontend (e.g. workspace fallback).
    pub notice: Mutex<Option<String>>,
    pub opened: Mutex<OpenQueue>,
}

/// A file and/or folder the user opened kayet with from Finder or the `kayet` command.
#[derive(Clone, Default, Serialize)]
pub struct Opened {
    file: Option<String>,
    folder: Option<String>,
}

/// Open requests arriving before the frontend is ready are held until it takes them at
/// startup (`take_opened`); later ones are emitted as `open://requested`.
#[derive(Default)]
pub struct OpenQueue {
    ready: bool,
    pending: Opened,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

impl AppState {
    pub fn new(config: Config, workspace: &Path, notice: Option<String>) -> Self {
        let mut allowed = HashSet::new();
        if let Some(last) = &config.session.last_file {
            allowed.insert(canonical(Path::new(last)));
        }
        Self {
            config: Mutex::new(config),
            workspace: Mutex::new(canonical(workspace)),
            watcher: Mutex::new(None),
            allowed: Mutex::new(allowed),
            notice: Mutex::new(notice),
            opened: Mutex::default(),
        }
    }

    /// Returns the canonical path if it is inside the workspace or was picked by the user.
    fn authorize(&self, path: &str) -> CmdResult<PathBuf> {
        let p = canonical(Path::new(path));
        if p.starts_with(&*lock(&self.workspace)) || lock(&self.allowed).contains(&p) {
            Ok(p)
        } else {
            Err(format!("access denied: {}", p.display()))
        }
    }

    pub fn allow(&self, app: &AppHandle, path: &Path) -> PathBuf {
        let p = canonical(path);
        lock(&self.allowed).insert(p.clone());
        if let Some(dir) = p.parent() {
            let _ = app.asset_protocol_scope().allow_directory(dir, true);
        }
        p
    }

    /// Handles files / folders opened from Finder or the `kayet` command. kayet shows one
    /// document at a time, so the first file is opened and the last folder becomes the
    /// workspace.
    pub fn open_paths(&self, app: &AppHandle, paths: &[PathBuf]) {
        let mut request = Opened::default();
        for p in paths {
            if p.is_dir() {
                request.folder = Some(path_string(&self.allow(app, p)));
            } else if p.is_file() && request.file.is_none() {
                request.file = Some(path_string(&self.allow(app, p)));
            }
        }
        if request.file.is_none() && request.folder.is_none() {
            return;
        }
        let mut queue = lock(&self.opened);
        if queue.ready {
            drop(queue);
            let _ = app.emit("open://requested", request);
        } else {
            let pending = &mut queue.pending;
            pending.file = request.file.or(pending.file.take());
            pending.folder = request.folder.or(pending.folder.take());
        }
    }

    /// Recent files that still exist, most recent first; missing ones are forgotten.
    fn recent_files(&self) -> Vec<String> {
        let mut cfg = lock(&self.config);
        let before = cfg.session.recent_files.len();
        cfg.session.recent_files.retain(|p| Path::new(p).is_file());
        let recent = cfg.session.recent_files.clone();
        drop(cfg);
        if recent.len() != before {
            self.save_config();
        }
        recent
    }

    /// Rebuilds File → Open Recent.
    pub fn refresh_recent_menu(&self, app: &AppHandle) {
        crate::menu::set_recent_items(app, &self.recent_files());
    }

    /// Opens the `index`-th entry of File → Open Recent.
    pub fn open_recent(&self, app: &AppHandle, index: usize) {
        let path = lock(&self.config).session.recent_files.get(index).cloned();
        if let Some(path) = path.map(PathBuf::from) {
            if path.is_file() {
                self.open_paths(app, &[path]);
            } else {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                let _ = app.emit("notice", format!("“{name}” no longer exists."));
            }
        }
        self.refresh_recent_menu(app);
    }

    pub fn clear_recent(&self, app: &AppHandle) {
        lock(&self.config).session.recent_files.clear();
        self.save_config();
        self.refresh_recent_menu(app);
    }

    pub fn save_config(&self) {
        let cfg = lock(&self.config).clone();
        if let Err(e) = config::save_to(&config::config_path(), &cfg) {
            eprintln!("kayet: failed to save config: {e}");
        }
    }

    pub fn start_watcher(&self, app: &AppHandle) {
        let root = lock(&self.workspace).clone();
        let _ = app.asset_protocol_scope().allow_directory(&root, true);
        let mut watcher = lock(&self.watcher);
        *watcher = None; // stop the old watcher before starting a new one
        match FsWatcher::start(app.clone(), &root) {
            Ok(w) => *watcher = Some(w),
            Err(e) => eprintln!("kayet: cannot watch {}: {e}", root.display()),
        }
    }

    fn switch_workspace(&self, app: &AppHandle, path: &Path) -> String {
        let path = canonical(path);
        lock(&self.workspace).clone_from(&path);
        lock(&self.config).workspace.path = config::contract_tilde(&path);
        self.save_config();
        self.start_watcher(app);
        path_string(&path)
    }
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Config {
    lock(&state.config).clone()
}

/// Persists the configuration. Window geometry and the workspace path are owned by the
/// backend (see `set_workspace`) and are kept as they are.
#[tauri::command]
pub fn set_config(state: State<'_, AppState>, cfg: Config) {
    {
        let mut current = lock(&state.config);
        let window = current.window.clone();
        let path = current.workspace.path.clone();
        let recent = std::mem::take(&mut current.session.recent_files);
        *current = cfg;
        current.window = window;
        current.workspace.path = path;
        current.session.recent_files = recent;
    }
    state.save_config();
}

/// Returns the config file path (creating the file if missing) and allows access to it.
#[tauri::command]
pub fn config_file(app: AppHandle, state: State<'_, AppState>) -> String {
    let path = config::config_path();
    if !path.exists() {
        state.save_config();
    }
    path_string(&state.allow(&app, &path))
}

/// Re-reads the config file after the user edited it. Window geometry, the workspace path
/// and the session are owned by the running app and are kept as they are.
#[tauri::command]
pub fn reload_config(state: State<'_, AppState>) -> CmdResult<Config> {
    let text = std::fs::read_to_string(config::config_path()).map_err(err)?;
    let cfg = config::parse(&text).map_err(|e| format!("Invalid config: {}", e.message()))?;
    let mut current = lock(&state.config);
    let window = current.window.clone();
    let path = current.workspace.path.clone();
    let session = current.session.clone();
    *current = cfg;
    current.window = window;
    current.workspace.path = path;
    current.session = session;
    Ok(current.clone())
}

#[tauri::command]
pub fn get_workspace(state: State<'_, AppState>) -> String {
    path_string(&lock(&state.workspace))
}

/// Changes the workspace to a folder previously picked by the user, or to the default one.
#[tauri::command]
pub fn set_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<String> {
    let p = canonical(Path::new(&path));
    let default = canonical(&workspace::default_workspace());
    if p != default && !lock(&state.allowed).contains(&p) {
        return Err(format!("access denied: {}", p.display()));
    }
    if !p.is_dir() {
        return Err(format!("{} is not a folder", p.display()));
    }
    Ok(state.switch_workspace(&app, &p))
}

#[tauri::command]
pub fn reset_workspace(app: AppHandle, state: State<'_, AppState>) -> CmdResult<String> {
    let default = workspace::default_workspace();
    std::fs::create_dir_all(&default).map_err(err)?;
    Ok(state.switch_workspace(&app, &default))
}

#[tauri::command]
pub fn take_notice(state: State<'_, AppState>) -> Option<String> {
    lock(&state.notice).take()
}

/// Records a file the user opened for File → Open Recent.
#[tauri::command]
pub fn add_recent(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let p = state.authorize(&path)?;
    lock(&state.config).session.push_recent(path_string(&p));
    state.save_config();
    state.refresh_recent_menu(&app);
    Ok(())
}

/// Recent files that still exist, most recent first (for the command palette).
#[tauri::command]
pub fn recent_files(state: State<'_, AppState>) -> Vec<String> {
    state.recent_files()
}

/// Allows opening a recent file picked in the command palette; returns its canonical path.
#[tauri::command]
pub fn allow_recent(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let recent = lock(&state.config).session.recent_files.contains(&path);
    if !recent || !Path::new(&path).is_file() {
        return Err(format!("{path} is not a recent file"));
    }
    Ok(path_string(&state.allow(&app, Path::new(&path))))
}

/// Returns what kayet was launched to open (if anything); later requests arrive as events.
#[tauri::command]
pub fn take_opened(state: State<'_, AppState>) -> Opened {
    let mut queue = lock(&state.opened);
    queue.ready = true;
    std::mem::take(&mut queue.pending)
}

/// Installs the `kayet` shell command. Returns its path, or None if the user cancelled.
#[tauri::command]
pub async fn install_cli(app: AppHandle) -> CmdResult<Option<String>> {
    let script = app.path().resource_dir().map_err(err)?.join("kayet");
    Ok(crate::cli::install(&script)?.then(|| crate::cli::LINK.to_string()))
}

#[tauri::command]
pub async fn list_dir(state: State<'_, AppState>, path: String) -> CmdResult<Vec<Entry>> {
    let p = state.authorize(&path)?;
    let show_hidden = lock(&state.config).workspace.show_hidden_files;
    workspace::list_dir(&p, show_hidden).map_err(err)
}

/// Every file in the workspace (recursively), for the file finder.
#[tauri::command]
pub async fn list_files(state: State<'_, AppState>) -> CmdResult<Vec<String>> {
    let root = lock(&state.workspace).clone();
    let show_hidden = lock(&state.config).workspace.show_hidden_files;
    Ok(workspace::list_files(
        &root,
        show_hidden,
        workspace::MAX_FILES,
    ))
}

/// Lines containing `query` across the workspace, for workspace-wide search.
#[tauri::command]
pub async fn search_workspace(state: State<'_, AppState>, query: String) -> CmdResult<Vec<Match>> {
    let root = lock(&state.workspace).clone();
    let show_hidden = lock(&state.config).workspace.show_hidden_files;
    tauri::async_runtime::spawn_blocking(move || {
        search::search(&root, &query, show_hidden, search::MAX_RESULTS)
    })
    .await
    .map_err(err)
}

/// Reads a file and starts watching it for external changes.
#[tauri::command]
pub async fn read_file(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let p = state.authorize(&path)?;
    let text = fs_ops::read_file(&p).map_err(err)?;
    if let Some(w) = lock(&state.watcher).as_mut() {
        w.watch_file(&p);
    }
    Ok(text)
}

#[tauri::command]
pub async fn write_file(
    state: State<'_, AppState>,
    path: String,
    contents: String,
) -> CmdResult<()> {
    let p = state.authorize(&path)?;
    fs_ops::write_atomic(&p, &contents).map_err(err)
}

/// Saves an image pasted into a document next to it. The image bytes are the raw request
/// body; the document path and the file extension come in percent-encoded headers.
/// Returns the new file's name, which is its path relative to the document.
#[tauri::command]
pub async fn save_image(state: State<'_, AppState>, request: Request<'_>) -> CmdResult<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    let header = |name: &str| -> CmdResult<String> {
        let value = request
            .headers()
            .get(name)
            .ok_or_else(|| format!("missing {name} header"))?;
        percent_decode(value.as_bytes()).map_err(err)
    };
    let document = state.authorize(&header("kayet-document")?)?;
    let path = fs_ops::save_beside(&document, &header("kayet-extension")?, bytes).map_err(err)?;
    Ok(path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default())
}

fn percent_decode(bytes: &[u8]) -> Result<String, std::str::Utf8Error> {
    percent_encoding::percent_decode(bytes)
        .decode_utf8()
        .map(std::borrow::Cow::into_owned)
}

/// Backs up the unsaved buffer for crash recovery. The path is only recorded if the
/// buffer may be written there, since it is allowed again when the backup is restored.
#[tauri::command]
pub async fn write_recovery(
    state: State<'_, AppState>,
    path: Option<String>,
    contents: String,
) -> CmdResult<()> {
    let path = path
        .and_then(|p| state.authorize(&p).ok())
        .map(|p| path_string(&p));
    let backup = recovery::Backup {
        path,
        text: contents,
    };
    recovery::write(&recovery::backup_path(), &backup).map_err(err)
}

/// Removes the crash recovery backup once the buffer was saved, discarded or closed.
#[tauri::command]
pub async fn clear_recovery() -> CmdResult<()> {
    recovery::clear(&recovery::backup_path()).map_err(err)
}

/// Returns the backup left behind by a session that did not exit cleanly, if any.
#[tauri::command]
pub fn load_recovery(app: AppHandle, state: State<'_, AppState>) -> Option<recovery::Backup> {
    let mut backup = recovery::read(&recovery::backup_path())?;
    if let Some(p) = &backup.path {
        backup.path = Some(path_string(&state.allow(&app, Path::new(p))));
    }
    Some(backup)
}

#[tauri::command]
pub async fn create_file(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let p = state.authorize(&path)?;
    fs_ops::create_file(&p).map_err(err)?;
    Ok(path_string(&p))
}

#[tauri::command]
pub async fn create_dir(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let p = state.authorize(&path)?;
    fs_ops::create_dir(&p).map_err(err)?;
    Ok(path_string(&p))
}

#[tauri::command]
pub async fn rename(state: State<'_, AppState>, from: String, to: String) -> CmdResult<String> {
    let from = state.authorize(&from)?;
    let to = state.authorize(&to)?;
    fs_ops::rename(&from, &to).map_err(err)?;
    Ok(path_string(&to))
}

#[tauri::command]
pub async fn trash(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let p = state.authorize(&path)?;
    if p == *lock(&state.workspace) {
        return Err("cannot trash the workspace itself".into());
    }
    fs_ops::trash(&p)
}

#[tauri::command]
pub async fn reveal(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let p = state.authorize(&path)?;
    tauri_plugin_opener::reveal_item_in_dir(p).map_err(err)
}

/// Opens web / mail links in the default application.
#[tauri::command]
pub async fn open_external(url: String) -> CmdResult<()> {
    let lower = url.to_ascii_lowercase();
    if !["http://", "https://", "mailto:"]
        .iter()
        .any(|s| lower.starts_with(s))
    {
        return Err(format!("refusing to open {url}"));
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(err)
}

/// Renders sanitized HTML; `base` is the directory relative links are resolved against.
#[tauri::command]
pub async fn render_markdown(text: String, base: Option<String>) -> String {
    markdown::render(&text, base.as_deref().map(Path::new))
}

/// Renders sanitized HTML for export (see `markdown::render_export`).
#[tauri::command]
pub async fn render_export(text: String, base: Option<String>) -> String {
    markdown::render_export(&text, base.as_deref().map(Path::new))
}

/// Largest image embedded into an HTML export.
const MAX_EMBEDDED_IMAGE: u64 = 20 * 1024 * 1024;

/// Reads an image the preview may show (so it can be embedded into an HTML export) as raw bytes.
#[tauri::command]
pub async fn read_image(app: AppHandle, path: String) -> CmdResult<tauri::ipc::Response> {
    let p = canonical(Path::new(&path));
    let image = p.extension().is_some_and(|ext| {
        let ext = ext.to_string_lossy().to_ascii_lowercase();
        [
            "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico",
        ]
        .contains(&ext.as_str())
    });
    if !image || !app.asset_protocol_scope().is_allowed(&p) {
        return Err(format!("access denied: {}", p.display()));
    }
    if std::fs::metadata(&p).map_err(err)?.len() > MAX_EMBEDDED_IMAGE {
        return Err(format!("{} is too large to embed", p.display()));
    }
    Ok(tauri::ipc::Response::new(std::fs::read(&p).map_err(err)?))
}

/// Prints the rendered document the frontend prepared for printing into a PDF at `path`.
#[tauri::command]
pub async fn export_pdf(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<()> {
    let p = state.authorize(&path)?;
    tauri::async_runtime::spawn_blocking(move || crate::export::pdf(&window, &p))
        .await
        .map_err(err)?
}

/// Shows or hides the native traffic lights together with the hover title bar.
#[tauri::command]
pub fn set_chrome_visible(window: WebviewWindow, visible: bool) {
    crate::chrome::set_traffic_lights_visible(&window, visible);
}

#[tauri::command]
pub fn set_menu_check(app: AppHandle, id: &str, enabled: bool, checked: bool) {
    crate::menu::set_check_item(&app, id, enabled, checked);
}

#[tauri::command]
pub fn set_export_enabled(app: AppHandle, enabled: bool) {
    crate::menu::set_export_enabled(&app, enabled);
}

#[tauri::command]
pub async fn open_file_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Option<String>> {
    let dir = lock(&state.workspace).clone();
    let picked = app.dialog().file().set_directory(dir).blocking_pick_file();
    Ok(picked
        .and_then(|f| f.into_path().ok())
        .map(|p| path_string(&state.allow(&app, &p))))
}

#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
    directory: Option<String>,
    file_name: String,
) -> CmdResult<Option<String>> {
    let dir = directory
        .map(PathBuf::from)
        .filter(|d| d.is_dir())
        .unwrap_or_else(|| lock(&state.workspace).clone());
    let picked = app
        .dialog()
        .file()
        .set_directory(dir)
        .set_file_name(file_name)
        .blocking_save_file();
    Ok(picked
        .and_then(|f| f.into_path().ok())
        .map(|p| path_string(&state.allow(&app, &p))))
}

/// Lets the user pick a new workspace folder and switches to it.
#[tauri::command]
pub async fn pick_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Option<String>> {
    let dir = lock(&state.workspace).clone();
    let picked = app
        .dialog()
        .file()
        .set_directory(dir)
        .blocking_pick_folder();
    let Some(path) = picked.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    Ok(Some(state.switch_workspace(&app, &path)))
}

/// Native "unsaved changes" prompt. Returns `"save"`, `"discard"` or `"cancel"`.
#[tauri::command]
pub async fn confirm_unsaved(app: AppHandle, name: String) -> String {
    let result = app
        .dialog()
        .message("Your changes will be lost if you don't save them.")
        .title(format!("Do you want to save the changes made to “{name}”?"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            "Save".into(),
            "Don't Save".into(),
            "Cancel".into(),
        ))
        .blocking_show_with_result();
    match result {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(label) if label == "Save" => "save",
        MessageDialogResult::Custom(label) if label == "Don't Save" => "discard",
        _ => "cancel",
    }
    .into()
}

/// Native "save changes?" prompt. Returns true if the user confirmed.
#[tauri::command]
pub async fn confirm_save(app: AppHandle, name: String) -> bool {
    let result = app
        .dialog()
        .message("Your changes will be written to disk.")
        .title(format!("Do you want to save the changes made to “{name}”?"))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Save".into(),
            "Cancel".into(),
        ))
        .blocking_show_with_result();
    match result {
        MessageDialogResult::Ok => true,
        MessageDialogResult::Custom(label) => label == "Save",
        _ => false,
    }
}

/// Native "restore unsaved changes?" prompt shown at launch after an unclean exit.
/// Returns true if the user chose to restore them.
#[tauri::command]
pub async fn confirm_restore(app: AppHandle, name: String) -> bool {
    let result = app
        .dialog()
        .message("kayet didn't quit normally. If you don't restore them, the changes will be lost.")
        .title(format!("Restore unsaved changes to “{name}”?"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restore".into(),
            "Discard".into(),
        ))
        .blocking_show_with_result();
    match result {
        MessageDialogResult::Ok => true,
        MessageDialogResult::Custom(label) => label == "Restore",
        _ => false,
    }
}

/// Native "move to Trash?" prompt. Returns true if the user confirmed.
#[tauri::command]
pub async fn confirm_trash(app: AppHandle, name: String) -> bool {
    let result = app
        .dialog()
        .message("You can restore it from the Trash later.")
        .title(format!("Move “{name}” to the Trash?"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Move to Trash".into(),
            "Cancel".into(),
        ))
        .blocking_show_with_result();
    match result {
        MessageDialogResult::Ok => true,
        MessageDialogResult::Custom(label) => label == "Move to Trash",
        _ => false,
    }
}

#[derive(Deserialize)]
pub struct ContextMenuItem {
    /// `None` renders a separator.
    id: Option<String>,
    #[serde(default)]
    label: String,
}

/// Shows a native context menu; the chosen item arrives as a `menu` event with its id.
#[tauri::command]
pub fn show_context_menu(
    app: AppHandle,
    window: WebviewWindow,
    items: Vec<ContextMenuItem>,
) -> CmdResult<()> {
    let menu = Menu::new(&app).map_err(err)?;
    for item in items {
        match item.id {
            Some(id) => menu
                .append(&MenuItem::with_id(&app, id, item.label, true, None::<&str>).map_err(err)?)
                .map_err(err)?,
            None => menu
                .append(&PredefinedMenuItem::separator(&app).map_err(err)?)
                .map_err(err)?,
        }
    }
    window.popup_menu(&menu).map_err(err)
}

/// Directory with the benchmark fixtures when kayet runs under `scripts/bench.mjs`
/// (`KAYET_BENCH` is set); the frontend then measures itself and reports back.
#[tauri::command]
pub fn bench_dir() -> Option<String> {
    std::env::var("KAYET_BENCH").ok().filter(|d| !d.is_empty())
}

/// Prints the benchmark results as one JSON line on stdout and quits.
#[tauri::command]
pub fn bench_report(app: AppHandle, report: serde_json::Value) {
    println!("kayet-bench {report}");
    app.exit(0);
}
