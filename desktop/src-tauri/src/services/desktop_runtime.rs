use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::settings::SettingsService;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

pub fn setup_system_tray(app: &mut tauri::App) -> Result<(), tauri::Error> {
    let show_item = MenuItem::with_id(app, "show-main-window", "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit-app", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    let mut builder = TrayIconBuilder::new()
        .tooltip("商拍工坊")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-main-window" => show_main_window(app),
            "quit-app" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

pub fn handle_main_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        if should_minimize_to_tray() {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn should_minimize_to_tray() -> bool {
    SettingsService::new()
        .get_settings(&default_workspace_directory())
        .map(|settings| settings.minimize_to_tray_on_close())
        .unwrap_or(false)
}
