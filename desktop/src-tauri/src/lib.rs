pub mod commands;
pub mod domain;
pub mod error;
pub mod providers;
pub mod services;
pub mod state;
pub mod storage;

use state::AppState;
use tauri::tray::TrayIconBuilder;
#[cfg(not(target_os = "macos"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, SubmenuBuilder},
    Emitter,
};
use tauri::{Manager, WindowEvent};

#[cfg(not(target_os = "macos"))]
use crate::services::system_settings::{default_workspace_root, load_system_settings};

#[cfg(target_os = "macos")]
const MENU_OPEN_WORKBENCH_ID: &str = "open-workbench";
#[cfg(target_os = "macos")]
const MENU_OPEN_SYSTEM_SETTINGS_ID: &str = "open-system-settings";
#[cfg(target_os = "macos")]
const MENU_OPEN_MODEL_SETTINGS_ID: &str = "open-model-settings";
#[cfg(target_os = "macos")]
const MENU_OPEN_PROMPT_PRESET_CENTER_ID: &str = "open-prompt-preset-center";
#[cfg(target_os = "macos")]
const OPEN_WORKBENCH_EVENT: &str = "commerce-shoot-studio://open-workbench";
#[cfg(target_os = "macos")]
const OPEN_SYSTEM_SETTINGS_EVENT: &str = "commerce-shoot-studio://open-system-settings";
#[cfg(target_os = "macos")]
const OPEN_MODEL_SETTINGS_EVENT: &str = "commerce-shoot-studio://open-model-settings";
#[cfg(target_os = "macos")]
const OPEN_PROMPT_PRESET_CENTER_EVENT: &str = "commerce-shoot-studio://open-prompt-preset-center";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state =
                tauri::async_runtime::block_on(async move { AppState::initialize(&handle).await })?;
            app.manage(state);
            #[cfg(target_os = "macos")]
            configure_macos_menu(app)?;
            #[cfg(target_os = "macos")]
            configure_macos_status_item(app)?;
            #[cfg(not(target_os = "macos"))]
            configure_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::CloseRequested { .. }) {
                return;
            }
            #[cfg(target_os = "macos")]
            {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            #[cfg(not(target_os = "macos"))]
            {
                let app_handle = window.app_handle();
                let Ok(app_config_dir) = app_handle.path().app_config_dir() else {
                    return;
                };
                let Ok(default_workspace_root) = default_workspace_root(app_handle) else {
                    return;
                };
                let Ok(settings) = load_system_settings(&app_config_dir, &default_workspace_root)
                else {
                    return;
                };
                if settings.close_to_tray {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::assets::import_image,
            commands::assets::get_asset,
            commands::assets::list_assets,
            commands::assets::delete_asset,
            commands::assets::run_asset_garbage_collection,
            commands::combinations::save_image_combination,
            commands::combinations::get_image_combination,
            commands::combinations::list_image_combinations,
            commands::combinations::validate_combination,
            commands::credentials::set_provider_api_key,
            commands::credentials::get_provider_credential_status,
            commands::generation::start_generation,
            commands::generation::cancel_generation_task,
            commands::generation::get_generation_task_detail,
            commands::generation::get_latest_generation_task_by_combination,
            commands::generation::list_running_generation_tasks,
            commands::generation::list_recent_generation_tasks,
            commands::generation::list_generation_task_history,
            commands::generation::open_generation_result,
            commands::generation::retry_generation_task,
            commands::generation::rerun_generation_from_current_combination,
            commands::models::list_model_definitions,
            commands::models::save_model_config,
            commands::models::get_model_config,
            commands::prompts::save_prompt_binding,
            commands::prompts::get_prompt_binding,
            commands::prompts::preview_resolved_prompt,
            commands::prompts::list_prompt_templates,
            commands::prompts::list_prompt_presets,
            commands::prompts::save_prompt_preset,
            commands::prompts::list_prompt_preset_scenarios,
            commands::prompts::save_prompt_preset_scenario,
            commands::prompts::save_prompt_template,
            commands::prompts::delete_prompt_template,
            commands::prompts::restore_default_prompt_templates,
            commands::system_settings::get_system_settings,
            commands::system_settings::save_system_settings_command,
            commands::system_settings::get_cache_stats,
            commands::system_settings::clear_workspace_cache,
            commands::system_settings::test_proxy_connection
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Commerce Shoot Studio");
}

#[cfg(target_os = "macos")]
fn configure_macos_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("商拍工坊"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .build();

    let app_menu = SubmenuBuilder::new(app, "商拍工坊")
        .about_with_text("关于商拍工坊", Some(about_metadata))
        .separator()
        .text(MENU_OPEN_WORKBENCH_ID, "打开工作台")
        .text(MENU_OPEN_SYSTEM_SETTINGS_ID, "偏好设置...")
        .text(MENU_OPEN_MODEL_SETTINGS_ID, "模型设置")
        .text(MENU_OPEN_PROMPT_PRESET_CENTER_ID, "方案中心")
        .separator()
        .quit_with_text("退出商拍工坊")
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "文件")
        .close_window_with_text("关闭窗口")
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo_with_text("撤销")
        .redo_with_text("重做")
        .separator()
        .cut_with_text("剪切")
        .copy_with_text("复制")
        .paste_with_text("粘贴")
        .select_all_with_text("全选")
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "视图")
        .fullscreen_with_text("进入全屏")
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize_with_text("最小化")
        .maximize_with_text("缩放")
        .separator()
        .bring_all_to_front_with_text("前置全部窗口")
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app_handle, event| {
        handle_navigation_menu_event(app_handle, event.id().as_ref());
    });

    Ok(())
}

#[cfg(target_os = "macos")]
fn configure_macos_status_item(app: &mut tauri::App) -> tauri::Result<()> {
    let tray_menu = MenuBuilder::new(app)
        .text(MENU_OPEN_WORKBENCH_ID, "打开工作台")
        .text(MENU_OPEN_SYSTEM_SETTINGS_ID, "偏好设置...")
        .text(MENU_OPEN_MODEL_SETTINGS_ID, "模型设置")
        .text(MENU_OPEN_PROMPT_PRESET_CENTER_ID, "方案中心")
        .separator()
        .quit_with_text("退出商拍工坊")
        .build()?;

    let mut tray_builder = TrayIconBuilder::with_id("commerce-shoot-studio-status")
        .tooltip("商拍工坊")
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app_handle, event| {
            handle_navigation_menu_event(app_handle, event.id().as_ref());
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon).icon_as_template(false);
    }
    tray_builder.build(app)?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn handle_navigation_menu_event(app_handle: &tauri::AppHandle, menu_id: &str) {
    let Some(target_event) = (match menu_id {
        MENU_OPEN_WORKBENCH_ID => Some(OPEN_WORKBENCH_EVENT),
        MENU_OPEN_SYSTEM_SETTINGS_ID => Some(OPEN_SYSTEM_SETTINGS_EVENT),
        MENU_OPEN_MODEL_SETTINGS_ID => Some(OPEN_MODEL_SETTINGS_EVENT),
        MENU_OPEN_PROMPT_PRESET_CENTER_ID => Some(OPEN_PROMPT_PRESET_CENTER_EVENT),
        _ => None,
    }) else {
        return;
    };
    show_main_window(app_handle);
    let _ = app_handle.emit(target_event, ());
}

#[cfg(target_os = "macos")]
fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(not(target_os = "macos"))]
fn configure_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let icon = app.default_window_icon().cloned();
    let mut tray_builder = TrayIconBuilder::new().tooltip("商拍工坊");
    if let Some(icon) = icon {
        tray_builder = tray_builder.icon(icon);
    }
    tray_builder
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
