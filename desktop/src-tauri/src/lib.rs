pub mod commands;
pub mod domain;
pub mod error;
pub mod providers;
pub mod services;
pub mod state;
pub mod storage;

use state::AppState;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

use crate::services::system_settings::{default_workspace_root, load_system_settings};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state =
                tauri::async_runtime::block_on(async move { AppState::initialize(&handle).await })?;
            app.manage(state);
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
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::CloseRequested { .. }) {
                return;
            }
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
