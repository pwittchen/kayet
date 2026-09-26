//! Native window chrome: showing/hiding the macOS traffic lights.

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
pub fn set_traffic_lights_visible(window: &WebviewWindow, visible: bool) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use tauri::Manager;

    let inset = window
        .config()
        .app
        .windows
        .iter()
        .find(|c| c.label == window.label())
        .and_then(|c| c.traffic_light_position.as_ref())
        .map(|p| (p.x, p.y));
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
        // AppKit lays the buttons out again at their default spot when they are unhidden,
        // dropping the `trafficLightPosition` inset, so re-apply it.
        if visible && let Some((x, y)) = inset {
            inset_traffic_lights(ns_window, x, y);
        }
    });
}

/// Positions the traffic lights `x` points from the left and `y` points from the top,
/// mirroring how Tauri applies `trafficLightPosition` at window creation.
#[cfg(target_os = "macos")]
fn inset_traffic_lights(ns_window: &objc2_app_kit::NSWindow, x: f64, y: f64) {
    use objc2_app_kit::NSWindowButton;

    let buttons: Vec<_> = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .into_iter()
    .filter_map(|kind| ns_window.standardWindowButton(kind))
    .collect();
    let [close, miniaturize, ..] = buttons.as_slice() else { return };
    // SAFETY: called on the main thread; the window buttons live inside the titlebar
    // container view for the lifetime of the window.
    let container = unsafe { close.superview().and_then(|v| v.superview()) };
    let Some(container) = container else { return };

    let close_rect = close.frame();
    let mut container_rect = container.frame();
    container_rect.size.height = close_rect.size.height + y;
    container_rect.origin.y = ns_window.frame().size.height - container_rect.size.height;
    container.setFrame(container_rect);

    let spacing = miniaturize.frame().origin.x - close_rect.origin.x;
    for (i, button) in buttons.iter().enumerate() {
        let mut origin = button.frame().origin;
        origin.x = x + i as f64 * spacing;
        button.setFrameOrigin(origin);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_traffic_lights_visible(_window: &WebviewWindow, _visible: bool) {}
