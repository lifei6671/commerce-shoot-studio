pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod services;

use crate::services::desktop_runtime::{handle_main_window_event, setup_system_tray};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_macos_locale();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            setup_system_tray(app)?;
            Ok(())
        })
        .on_window_event(handle_main_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::ai_assist::ai_assist_product_selling_points,
            commands::ai_assist::ai_assist_product_selling_points_stream,
            commands::ai_assist::ai_assist_viral_style_analysis,
            save_generated_asset,
            commands::assets::asset_delete,
            commands::assets::asset_get,
            commands::assets::asset_import_images,
            commands::assets::asset_list,
            commands::assets::asset_reveal,
            commands::capability::capability_get_capability,
            commands::capability::capability_list_capabilities,
            commands::generation::generation_cancel_task,
            commands::generation::generation_create_task,
            commands::generation::generation_delete_task,
            commands::generation::generation_get_task,
            commands::generation::generation_get_task_detail,
            commands::generation::generation_list_tasks,
            commands::generation::generation_retry_task,
            commands::model_config::model_config_delete_config,
            commands::model_config::model_config_get_config,
            commands::model_config::model_config_list_configs,
            commands::model_config::model_config_list_provider_profiles,
            commands::model_config::model_config_save_config,
            commands::model_config::model_config_set_default_config,
            commands::model_config::model_config_test_config,
            commands::runtime_info::runtime_info,
            commands::secrets::secret_delete,
            commands::secrets::secret_get_status,
            commands::secrets::secret_reveal,
            commands::secrets::secret_save,
            commands::secrets::secret_test_provider_connection,
            commands::settings::settings_get,
            commands::settings::settings_play_notification_sound,
            commands::settings::settings_save,
            commands::shell::shell_choose_directory,
            commands::shell::shell_notify,
            commands::shell::shell_reveal_path,
            commands::workspace::workspace_get_status,
            commands::workspace::workspace_get_storage_usage,
            commands::workspace::workspace_initialize,
            commands::workspace::workspace_run_garbage_collection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running commerce-shoot-studio");
}

#[tauri::command]
fn save_generated_asset(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn configure_macos_locale() {
    std::env::set_var("AppleLanguages", "(zh-Hans, en)");
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_locale() {}
