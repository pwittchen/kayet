//! Application menu. Custom items are forwarded to the frontend as `menu` events carrying
//! the item id; the frontend owns all editor actions.

use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

const VIEW: &str = "view";
const SYNTAX: &str = "toggle-syntax";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        MenuItem::with_id(app, id, label, true, accel)
    };
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = Submenu::with_items(
        app,
        "kayet",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About kayet"), Some(AboutMetadata::default()))?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            // Custom quit so unsaved changes can be confirmed first.
            &item("quit", "Quit kayet", Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new", "New", Some("CmdOrCtrl+N"))?,
            &item("open", "Open…", Some("CmdOrCtrl+O"))?,
            &item("open-workspace", "Open Workspace…", Some("CmdOrCtrl+Shift+O"))?,
            &item("reset-workspace", "Reset to Default Workspace", None)?,
            &sep()?,
            &item("save", "Save", Some("CmdOrCtrl+S"))?,
            &item("save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?,
            &sep()?,
            &item("close-file", "Close File", None)?,
            &item("close", "Close Window", Some("CmdOrCtrl+W"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &item("undo", "Undo", Some("CmdOrCtrl+Z"))?,
            &item("redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &sep()?,
            &item("find", "Find…", Some("CmdOrCtrl+F"))?,
            &item("replace", "Replace…", Some("CmdOrCtrl+Alt+F"))?,
        ],
    )?;

    let view = Submenu::with_id_and_items(
        app,
        VIEW,
        "View",
        true,
        &[
            &item("toggle-tree", "Toggle File Tree", Some("CmdOrCtrl+\\"))?,
            &item("toggle-preview", "Toggle Preview", Some("CmdOrCtrl+Shift+P"))?,
            &item("cycle-theme", "Cycle Theme", Some("CmdOrCtrl+Shift+L"))?,
            &item("toggle-chrome", "Keep Title Bar Visible", Some("CmdOrCtrl+."))?,
            &item("toggle-zen", "Zen Mode", Some("CmdOrCtrl+Shift+J"))?,
            // Enabled by the frontend only while a code file is open.
            &CheckMenuItem::with_id(app, SYNTAX, "Syntax Highlighting", false, true, None::<&str>)?,
            &sep()?,
            &item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
            &item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
}

/// Updates the View → Syntax Highlighting item.
pub fn set_syntax_item<R: Runtime>(app: &AppHandle<R>, enabled: bool, checked: bool) {
    let Some(view) = app.menu().and_then(|m| m.get(VIEW)) else {
        return;
    };
    let Some(item) = view.as_submenu().and_then(|v| v.get(SYNTAX)) else {
        return;
    };
    if let Some(check) = item.as_check_menuitem() {
        let _ = check.set_enabled(enabled);
        let _ = check.set_checked(checked);
    }
}
