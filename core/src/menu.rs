//! Application menu. Custom items are forwarded to the frontend as `menu` events carrying
//! the item id; the frontend owns all editor actions.

use std::path::Path;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

use tauri::{AppHandle, Runtime};

use crate::config::contract_tilde;

const FILE: &str = "file";
const RECENT: &str = "open-recent";
const VIEW: &str = "view";
const SYNTAX: &str = "toggle-syntax";
const SPELL: &str = "toggle-spell-check";
const ZEN: &str = "toggle-zen";
const CODE_MODE: &str = "toggle-code-mode";
const EXPORT_HTML: &str = "export-html";
const EXPORT_PDF: &str = "export-pdf";

/// Menu id prefix of the File → Open Recent entries, followed by the entry's index.
pub const RECENT_PREFIX: &str = "recent:";
/// Menu id of File → Open Recent → Clear Menu.
pub const CLEAR_RECENT: &str = "clear-recent";
/// Menu id of kayet → About kayet.
pub const ABOUT: &str = "about";

/// Credits of the About panel: version, project website, source code and author. The charset is
/// explicit because the HTML importer would otherwise decode the bytes as Latin-1.
const ABOUT_CREDITS: &str = concat!(
    "<meta charset=\"utf-8\">\
    <style>p { font: 11px -apple-system; text-align: center; margin: 0 0 6px }</style>\
    <p>version ",
    env!("CARGO_PKG_VERSION"),
    "</p>\
    <p><a href=\"https://getkayet.app\">getkayet.app</a></p>\
    <p><a href=\"https://github.com/pwittchen/kayet\">Source code on GitHub</a></p>\
    <p>made by Piotr Wittchen</p>\
    <p><a href=\"https://wittchen.io\">wittchen.io</a></p>"
);

/// Shows the standard macOS About panel with `ABOUT_CREDITS` (links clickable). Must run on the
/// main thread, as menu events do.
#[cfg(target_os = "macos")]
pub fn show_about() {
    use objc2::AnyThread;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSAboutPanelOptionApplicationIcon, NSAboutPanelOptionApplicationVersion,
        NSAboutPanelOptionCredits, NSAboutPanelOptionVersion, NSApplication,
        NSAttributedStringAppKitDocumentFormats, NSImage,
    };
    use objc2_foundation::{MainThreadMarker, NSAttributedString, NSData, NSDictionary, NSString};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let mut keys: Vec<&NSString> = Vec::new();
    let mut values: Vec<Retained<AnyObject>> = Vec::new();

    // Explicit so the panel shows the app icon even when running unbundled (`tauri dev`), where
    // macOS would fall back to a generic icon.
    let icon = NSData::with_bytes(include_bytes!("../icons/128x128@2x.png"));
    if let Some(icon) = NSImage::initWithData(NSImage::alloc(), &icon) {
        keys.push(unsafe { NSAboutPanelOptionApplicationIcon });
        values.push(icon.into());
    }
    let html = NSData::with_bytes(ABOUT_CREDITS.as_bytes());
    // SAFETY: `html` is valid HTML data and no document attributes are requested.
    let credits = unsafe {
        NSAttributedString::initWithHTML_documentAttributes(
            NSAttributedString::alloc(),
            &html,
            None,
        )
    };
    if let Some(credits) = credits {
        keys.push(unsafe { NSAboutPanelOptionCredits });
        values.push(credits.into());
    }
    // The panel's own version line reads "Version 0.3.3 (0.3.3)"; empty versions hide it, and the
    // version is shown in lowercase at the top of the credits instead.
    for key in [unsafe { NSAboutPanelOptionApplicationVersion }, unsafe {
        NSAboutPanelOptionVersion
    }] {
        keys.push(key);
        values.push(NSString::new().into());
    }

    let options = NSDictionary::from_retained_objects(&keys, &values);
    // SAFETY: every value has the type its About panel option key expects.
    unsafe {
        NSApplication::sharedApplication(mtm).orderFrontStandardAboutPanelWithOptions(&options);
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item =
        |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = Submenu::with_items(
        app,
        "kayet",
        true,
        &[
            // Custom instead of `PredefinedMenuItem::about`, whose credits are plain text: the
            // panel's links have to be clickable (see `show_about`).
            &item(ABOUT, "About kayet", None)?,
            &item("check-updates", "Check for Updates…", None)?,
            &sep()?,
            &item("open-settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &item("install-cli", "Install ‘kayet’ Command", None)?,
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

    let file = Submenu::with_id_and_items(
        app,
        FILE,
        "File",
        true,
        &[
            &item("new", "New", Some("CmdOrCtrl+N"))?,
            &item("new-tab", "New Tab", Some("CmdOrCtrl+T"))?,
            &item("open", "Open…", Some("CmdOrCtrl+O"))?,
            // Filled in by `set_recent_items`.
            &Submenu::with_id(app, RECENT, "Open Recent", true)?,
            &item("go-to-file", "Go to File…", Some("CmdOrCtrl+P"))?,
            &item(
                "open-workspace",
                "Open Workspace…",
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &item("reset-workspace", "Reset to Default Workspace", None)?,
            &sep()?,
            &item("save", "Save", Some("CmdOrCtrl+S"))?,
            &item("save-as", "Save As…", Some("CmdOrCtrl+Shift+S"))?,
            // Enabled by the frontend only while a Markdown file is open.
            &MenuItem::with_id(app, EXPORT_HTML, "Export as HTML…", false, None::<&str>)?,
            &MenuItem::with_id(app, EXPORT_PDF, "Export as PDF…", false, None::<&str>)?,
            &sep()?,
            &item("close-file", "Close File", Some("CmdOrCtrl+W"))?,
            &item("close", "Close Window", Some("CmdOrCtrl+Shift+W"))?,
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
            &item("replace", "Replace…", Some("CmdOrCtrl+R"))?,
            &item(
                "find-in-workspace",
                "Find in Workspace…",
                Some("CmdOrCtrl+Shift+F"),
            )?,
        ],
    )?;

    let view = view_menu(app)?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &sep()?,
            &item("prev-tab", "Show Previous Tab", Some("CmdOrCtrl+Shift+["))?,
            &item("next-tab", "Show Next Tab", Some("CmdOrCtrl+Shift+]"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
}

/// The View menu, which carries the Zen Mode, Code Editor Mode, Syntax Highlighting and Check
/// Spelling items updated by `set_check_item`.
fn view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let item =
        |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
    let sep = || PredefinedMenuItem::separator(app);

    Submenu::with_id_and_items(
        app,
        VIEW,
        "View",
        true,
        &[
            &item("palette", "Command Palette…", Some("CmdOrCtrl+K"))?,
            &sep()?,
            &item("toggle-tree", "Toggle File Tree", Some("CmdOrCtrl+\\"))?,
            &item(
                "toggle-preview",
                "Toggle Preview",
                Some("CmdOrCtrl+Shift+P"),
            )?,
            &item("cycle-theme", "Cycle Theme", Some("CmdOrCtrl+Shift+L"))?,
            &item(
                "toggle-chrome",
                "Keep Title Bar Visible",
                Some("CmdOrCtrl+."),
            )?,
            // Disabled by the frontend while code editor mode is on.
            &CheckMenuItem::with_id(app, ZEN, "Zen Mode", true, false, Some("CmdOrCtrl+Shift+J"))?,
            &CheckMenuItem::with_id(
                app,
                CODE_MODE,
                "Code Editor Mode",
                true,
                false,
                None::<&str>,
            )?,
            &item("toggle-cursor-blink", "Toggle Cursor Blink", None)?,
            // Enabled by the frontend only while a code file is open.
            &CheckMenuItem::with_id(
                app,
                SYNTAX,
                "Syntax Highlighting",
                false,
                true,
                None::<&str>,
            )?,
            // Enabled by the frontend only while a prose file is open (and not in code editor mode).
            &CheckMenuItem::with_id(app, SPELL, "Check Spelling", false, false, None::<&str>)?,
            &sep()?,
            &item("zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
            &item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item("zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )
}

/// Updates a View menu check item: Zen Mode (`toggle-zen`), Code Editor Mode
/// (`toggle-code-mode`), Syntax Highlighting (`toggle-syntax`) or Check Spelling
/// (`toggle-spell-check`); other ids are ignored.
pub fn set_check_item<R: Runtime>(app: &AppHandle<R>, id: &str, enabled: bool, checked: bool) {
    if ![ZEN, CODE_MODE, SYNTAX, SPELL].contains(&id) {
        return;
    }
    let Some(view) = app.menu().and_then(|m| m.get(VIEW)) else {
        return;
    };
    let Some(item) = view.as_submenu().and_then(|v| v.get(id)) else {
        return;
    };
    if let Some(check) = item.as_check_menuitem() {
        let _ = check.set_enabled(enabled);
        let _ = check.set_checked(checked);
    }
}

/// Enables or disables File → Export as HTML… / Export as PDF….
pub fn set_export_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    let Some(file) = app.menu().and_then(|m| m.get(FILE)) else {
        return;
    };
    let Some(file) = file.as_submenu() else {
        return;
    };
    for id in [EXPORT_HTML, EXPORT_PDF] {
        if let Some(item) = file.get(id).and_then(|i| i.as_menuitem().cloned()) {
            let _ = item.set_enabled(enabled);
        }
    }
}

/// Fills File → Open Recent with `paths` (most recent first), followed by Clear Menu.
pub fn set_recent_items<R: Runtime>(app: &AppHandle<R>, paths: &[String]) {
    let Some(file) = app.menu().and_then(|m| m.get(FILE)) else {
        return;
    };
    let Some(recent) = file
        .as_submenu()
        .and_then(|f| f.get(RECENT))
        .and_then(|r| r.as_submenu().cloned())
    else {
        return;
    };
    if let Err(e) = fill_recent(app, &recent, paths) {
        eprintln!("kayet: cannot update Open Recent: {e}");
    }
}

fn fill_recent<R: Runtime>(
    app: &AppHandle<R>,
    recent: &Submenu<R>,
    paths: &[String],
) -> tauri::Result<()> {
    for item in recent.items()? {
        recent.remove(&item)?;
    }
    for (i, label) in recent_labels(paths).into_iter().enumerate() {
        let id = format!("{RECENT_PREFIX}{i}");
        recent.append(&MenuItem::with_id(app, id, label, true, None::<&str>)?)?;
    }
    if !paths.is_empty() {
        recent.append(&PredefinedMenuItem::separator(app)?)?;
    }
    recent.append(&MenuItem::with_id(
        app,
        CLEAR_RECENT,
        "Clear Menu",
        !paths.is_empty(),
        None::<&str>,
    )?)
}

/// Labels recent files by name; files sharing a name get their folder appended.
fn recent_labels(paths: &[String]) -> Vec<String> {
    let name = |p: &String| {
        Path::new(p)
            .file_name()
            .map_or_else(|| p.clone(), |n| n.to_string_lossy().into_owned())
    };
    let names: Vec<String> = paths.iter().map(name).collect();
    paths
        .iter()
        .zip(&names)
        .map(|(path, n)| {
            if names.iter().filter(|m| *m == n).count() < 2 {
                return n.clone();
            }
            match Path::new(path).parent() {
                Some(dir) => format!("{n} — {}", contract_tilde(dir)),
                None => n.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_labels_disambiguate_same_names() {
        let paths = ["/a/notes.md", "/b/todo.txt", "/c/notes.md"].map(String::from);
        assert_eq!(
            recent_labels(&paths),
            ["notes.md — /a", "todo.txt", "notes.md — /c"]
        );
    }
}
