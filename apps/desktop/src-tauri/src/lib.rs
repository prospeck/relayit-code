//! RelayIt desktop shell.
//!
//! Responsibilities (kept deliberately small — the brain lives in the Node "core" sidecar):
//! - read or create the 32-byte master key in the OS keychain and hand it to core over stdin
//! - start core, learn its port + per-launch token, and expose them to the UI
//! - keep running in the tray so routines and the morning brief work with the window closed
//! - the ⌥Space / Alt+Space Quick Ask window

mod core_process;
mod keychain;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
pub struct CoreState {
    pub endpoint: Mutex<Option<core_process::Endpoint>>,
    pub child: Mutex<Option<std::process::Child>>,
    pub error: Mutex<Option<String>>,
}

#[tauri::command]
fn core_endpoint(state: tauri::State<CoreState>) -> Result<Option<core_process::Endpoint>, String> {
    if let Some(e) = state.error.lock().unwrap().clone() {
        return Err(e);
    }
    Ok(state.endpoint.lock().unwrap().clone())
}

#[tauri::command]
fn hide_quick_ask(app: AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn open_main(app: AppHandle, path: String) {
    hide_quick_ask(app.clone());
    show_main(&app, Some(&path));
}

fn show_main(app: &AppHandle, path: Option<&str>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(p) = path {
            let safe: String = p.chars().filter(|c| c.is_ascii_alphanumeric() || "/_-".contains(*c)).collect();
            let _ = w.eval(&format!("window.location.hash = '#/{}'", safe));
        }
    }
}

fn toggle_quick(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

pub fn run() {
    let quick_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app, None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &quick_shortcut && event.state() == ShortcutState::Pressed {
                        toggle_quick(app);
                    }
                })
                .build(),
        )
        .manage(CoreState::default())
        .invoke_handler(tauri::generate_handler![core_endpoint, hide_quick_ask, open_main])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Master key → core sidecar.
            match keychain::master_key() {
                Ok(key) => {
                    if let Err(e) = core_process::spawn(&handle, &key) {
                        *app.state::<CoreState>().error.lock().unwrap() = Some(format!("Couldn't start RelayIt's engine: {e}"));
                    }
                }
                Err(e) => {
                    *app.state::<CoreState>().error.lock().unwrap() =
                        Some(format!("RelayIt couldn't access the system keychain, so it can't protect your keys: {e}"));
                }
            }

            // Tray: RelayIt keeps working with the window closed.
            let open = MenuItem::with_id(app, "open", "Open RelayIt", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quick", "Quick Ask…", true, Some("Alt+Space"))?;
            let brief = MenuItem::with_id(app, "brief", "Morning brief", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit RelayIt", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quick, &brief, &PredefinedMenuItem::separator(app)?, &quit])?;
            TrayIconBuilder::with_id("relayit")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .tooltip("RelayIt")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app, None),
                    "quick" => toggle_quick(app),
                    "brief" => {
                        show_main(app, Some("today"));
                        let _ = app.emit("relayit://brief", ());
                    }
                    "quit" => {
                        core_process::stop(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle(), None);
                    }
                })
                .build(app)?;

            if let Err(e) = app.global_shortcut().register(quick_shortcut) {
                eprintln!("[relayit] couldn't register Quick Ask shortcut: {e}");
            }

            // Quick Ask hides when it loses focus, like Spotlight.
            if let Some(q) = app.get_webview_window("quick") {
                let qh = q.clone();
                q.on_window_event(move |e| {
                    if let WindowEvent::Focused(false) = e {
                        let _ = qh.hide();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it; RelayIt keeps running in the tray.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building RelayIt");

    app.run(|app, event| match event {
        RunEvent::Exit => core_process::stop(app),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app, None),
        _ => {}
    });
}
