//! The menu bar: an icon with the open count as its title, a popover window (the front end at
//! `#tray`) under it on a left click, Open / Quit on a right click. Closing the main window
//! keeps Jotted here while "Keep running in the menu bar" is on (the front end says which).

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const TRAY: &str = "jotted";
const POPOVER: &str = "tray";
const POPOVER_SIZE: (f64, f64) = (380.0, 560.0);

// Menu bar glyphs: black on transparent, so macOS recolours them (template images) for light,
// dark and pressed states. Regenerate with scripts/gen-tray-icons.py.
const ICON_IDLE: &[u8] = include_bytes!("../icons/tray/idle.png");
const ICON_SYNCING: &[u8] = include_bytes!("../icons/tray/syncing.png");
const ICON_ATTENTION: &[u8] = include_bytes!("../icons/tray/attention.png");

/// The glyph for a tray state: "idle", "syncing" or "attention" (anything else is idle).
pub fn icon_bytes(state: &str) -> &'static [u8] {
    match state {
        "syncing" => ICON_SYNCING,
        "attention" => ICON_ATTENTION,
        _ => ICON_IDLE,
    }
}

fn glyph(state: &str) -> Option<Image<'static>> {
    Image::from_bytes(icon_bytes(state)).ok()
}

/// Whether closing the main window keeps the app in the menu bar (default on).
pub struct KeepRunning(pub AtomicBool);

impl Default for KeepRunning {
    fn default() -> Self {
        Self(AtomicBool::new(true))
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Jotted", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Jotted", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY)
        .tooltip("Jotted")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app, None),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                toggle_popover(tray.app_handle(), rect);
            }
        });
    if let Some(icon) = glyph("idle") {
        builder = builder.icon(icon).icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn popover(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(POPOVER) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("index.html#tray".into()))
        .title("Jotted")
        .inner_size(POPOVER_SIZE.0, POPOVER_SIZE.1)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // Transparent so the vibrancy below shows through the rounded corners (macOS needs
        // `macOSPrivateApi` for this: tauri.conf.json and the `macos-private-api` feature).
        .transparent(true)
        .visible(false)
        .build()?;
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Popover, Some(NSVisualEffectState::Active), Some(12.0));
    }
    let handle = window.clone();
    // A popover: it goes away when you click elsewhere.
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            let _ = handle.hide();
        }
    });
    Ok(window)
}

/// Where the popover goes: centred under the icon, kept inside the screen that holds it
/// (`screen_x`, `screen_w`: that screen's left edge and width). The menu bar icons sit at
/// the right, so the right edge is the one that matters most.
pub fn popover_position(icon_x: f64, icon_y: f64, icon_w: f64, icon_h: f64, scale: f64, screen_x: f64, screen_w: f64) -> (f64, f64) {
    let width = POPOVER_SIZE.0 * scale;
    let centred = icon_x + icon_w / 2.0 - width / 2.0;
    (centred.min(screen_x + screen_w - width).max(screen_x), icon_y + icon_h)
}

fn toggle_popover(app: &AppHandle, rect: Rect) {
    let Ok(window) = popover(app) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let at = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let screen = window
        .monitor_from_point(at.x, at.y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    let (screen_x, screen_w) = screen
        .map(|m| (m.position().x as f64, m.size().width as f64))
        .unwrap_or((0.0, f64::MAX / 4.0));
    let (x, y) = popover_position(at.x, at.y, size.width, size.height, scale, screen_x, screen_w);
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn show_main_window(app: &AppHandle, at: Option<String>) {
    if let Some(popover) = app.get_webview_window(POPOVER) {
        let _ = popover.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        if at.is_some() {
            let _ = app.emit_to("main", "jotted://navigate", at);
        }
    }
}

/// The main window's close button: hide it (Jotted stays in the menu bar), or quit.
pub fn on_main_close(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.app_handle().state::<KeepRunning>().0.load(Ordering::SeqCst) {
            api.prevent_close();
            let _ = window.hide();
        } else {
            window.app_handle().exit(0);
        }
    }
}

#[tauri::command]
pub fn set_tray_title(app: AppHandle, title: String) {
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_title(if title.is_empty() { None } else { Some(title) });
    }
}

/// The menu bar glyph: "idle", "syncing" or "attention".
#[tauri::command]
pub fn set_tray_state(app: AppHandle, state: String) {
    if let (Some(tray), Some(icon)) = (app.tray_by_id(TRAY), glyph(&state)) {
        let _ = tray.set_icon(Some(icon));
        // Setting an icon can drop the template flag; set it again so it keeps recolouring.
        let _ = tray.set_icon_as_template(true);
    }
}

/// Show or hide the Dock icon (macOS). Hidden, Jotted lives only in the menu bar.
#[tauri::command]
pub fn set_dock_icon(app: AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(visible);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);
}

#[tauri::command]
pub fn set_keep_running(app: AppHandle, on: bool) {
    app.state::<KeepRunning>().0.store(on, Ordering::SeqCst);
}

#[tauri::command]
pub fn show_main(app: AppHandle, at: Option<String>) {
    show_main_window(&app, at);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn puts_the_popover_under_the_icon() {
        // A 2x screen: icon at x=1000, 44 px wide, 48 px tall.
        let (x, y) = popover_position(1000.0, 0.0, 44.0, 48.0, 2.0, 0.0, 4000.0);
        assert_eq!((x, y), (1000.0 + 22.0 - 380.0, 48.0));
    }

    #[test]
    fn keeps_it_on_screen_at_the_left_edge() {
        assert_eq!(popover_position(10.0, 0.0, 20.0, 24.0, 1.0, 0.0, 1440.0).0, 0.0);
    }

    #[test]
    fn keeps_it_on_screen_at_the_right_edge() {
        // An icon 30 px from the right edge of a 1440 px screen: the popover's right edge is the screen's.
        assert_eq!(popover_position(1380.0, 0.0, 20.0, 24.0, 1.0, 0.0, 1440.0).0, 1440.0 - 380.0);
    }

    #[test]
    fn stays_on_a_second_screen() {
        // A screen to the right of the first, starting at x=1440.
        assert_eq!(popover_position(1450.0, 0.0, 20.0, 24.0, 1.0, 1440.0, 1440.0).0, 1440.0);
    }

    #[test]
    fn picks_a_glyph_per_state() {
        assert_ne!(icon_bytes("idle"), icon_bytes("syncing"));
        assert_ne!(icon_bytes("idle"), icon_bytes("attention"));
        assert_eq!(icon_bytes("nonsense"), icon_bytes("idle"));
    }
}
