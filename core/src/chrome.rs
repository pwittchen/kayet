//! Native window chrome: showing/hiding the macOS traffic lights.

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
pub fn set_traffic_lights_visible(window: &WebviewWindow, visible: bool) {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let w = window.clone();
    // AppKit must only be touched from the main thread.
    let _ = window.run_on_main_thread(move || {
        let Ok(ptr) = w.ns_window() else { return };
        // SAFETY: Tauri hands out a valid NSWindow pointer for the lifetime of the window,
        // and we are on the main thread.
        let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.setHidden(!visible);
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn set_traffic_lights_visible(_window: &WebviewWindow, _visible: bool) {}
