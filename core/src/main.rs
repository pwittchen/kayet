// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chrome;
mod cli;
mod commands;
mod config;
mod fs_ops;
mod markdown;
mod menu;
mod recovery;
mod search;
mod workspace;

use serde::Serialize;
use tauri::{
    DragDropEvent, Emitter, LogicalPosition, LogicalSize, Manager, Theme, WebviewWindow, Window,
    WindowEvent,
};

use commands::AppState;

#[derive(Clone, Serialize)]
struct Dropped {
    path: String,
}

fn main() {
    let config = config::load_from(&config::config_path());
    let (workspace, fell_back) = workspace::resolve(&config.workspace.path);
    let notice = fell_back.then(|| {
        format!(
            "Workspace {} no longer exists — using the default workspace.",
            config.workspace.path
        )
    });
    let mut config = config;
    if fell_back {
        config.workspace.path = config::contract_tilde(&workspace);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(config, &workspace, notice))
        .menu(menu::build)
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .setup(|app| {
            let state = app.state::<AppState>();
            state.save_config();
            state.start_watcher(app.handle());
            if let Some(last) = &state.config.lock().unwrap().session.last_file
                && let Some(dir) = std::path::Path::new(last).parent()
            {
                let _ = app.asset_protocol_scope().allow_directory(dir, true);
            }

            let window = app
                .get_webview_window("main")
                .expect("main window is defined in tauri.conf.json");
            restore_geometry(&window, &state);
            chrome::set_traffic_lights_visible(&window, false);
            window.show()?;
            if commands::bench_dir().is_some() {
                // A window hidden behind others gets no frames, which stalls the benchmark.
                window.set_focus()?;
            }
            Ok(())
        })
        .on_window_event(on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::config_file,
            commands::reload_config,
            commands::get_workspace,
            commands::set_workspace,
            commands::reset_workspace,
            commands::take_notice,
            commands::take_opened,
            commands::install_cli,
            commands::list_dir,
            commands::list_files,
            commands::search_workspace,
            commands::read_file,
            commands::write_file,
            commands::save_image,
            commands::write_recovery,
            commands::clear_recovery,
            commands::load_recovery,
            commands::create_file,
            commands::create_dir,
            commands::rename,
            commands::trash,
            commands::reveal,
            commands::open_external,
            commands::render_markdown,
            commands::set_chrome_visible,
            commands::set_syntax_menu,
            commands::open_file_dialog,
            commands::save_file_dialog,
            commands::pick_workspace,
            commands::confirm_unsaved,
            commands::confirm_save,
            commands::confirm_restore,
            commands::confirm_trash,
            commands::show_context_menu,
            commands::bench_dir,
            commands::bench_report,
        ])
        .build(tauri::generate_context!())
        .expect("error while building kayet")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<_> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                app.state::<AppState>().open_paths(app, &paths);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if let Some(w) = app.get_webview_window(window.label()) {
                remember_geometry(&w, &state);
            }
        }
        WindowEvent::Destroyed => state.save_config(),
        WindowEvent::ThemeChanged(theme) => {
            let name = if *theme == Theme::Dark {
                "dark"
            } else {
                "light"
            };
            let _ = app.emit("theme://changed", name);
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            if let Some(file) = paths.iter().find(|p| p.is_file()) {
                let path = state.allow(app, file);
                let _ = app.emit(
                    "file://dropped",
                    Dropped {
                        path: path.to_string_lossy().into_owned(),
                    },
                );
            }
        }
        _ => {}
    }
}

fn restore_geometry(window: &WebviewWindow, state: &AppState) {
    let geometry = state.config.lock().unwrap().window.clone();
    let _ = window.set_size(LogicalSize::new(geometry.width, geometry.height));
    if geometry.has_position() {
        let _ = window.set_position(LogicalPosition::new(geometry.x, geometry.y));
    } else {
        let _ = window.center();
    }
}

fn remember_geometry(window: &WebviewWindow, state: &AppState) {
    let special = window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || window.is_maximized().unwrap_or(false);
    if special || !window.is_visible().unwrap_or(false) {
        return;
    }
    let (Ok(scale), Ok(pos), Ok(size)) = (
        window.scale_factor(),
        window.outer_position(),
        window.inner_size(),
    ) else {
        return;
    };
    let pos = pos.to_logical::<i32>(scale);
    let size = size.to_logical::<u32>(scale);
    let mut cfg = state.config.lock().unwrap();
    cfg.window.x = pos.x;
    cfg.window.y = pos.y;
    cfg.window.width = size.width;
    cfg.window.height = size.height;
}
