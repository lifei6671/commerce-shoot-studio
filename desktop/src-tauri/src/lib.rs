pub mod commands;
pub mod domain;
pub mod error;
pub mod services;
pub mod state;
pub mod storage;

use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let state = AppState::initialize(&handle).await?;
                app.manage(state);
                Ok::<(), error::AppError>(())
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::assets::import_image,
            commands::combinations::save_image_combination,
            commands::combinations::get_image_combination,
            commands::combinations::list_image_combinations,
            commands::combinations::validate_combination,
            commands::models::list_model_definitions,
            commands::models::save_model_config,
            commands::models::get_model_config,
            commands::prompts::save_prompt_binding,
            commands::prompts::preview_resolved_prompt
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Commerce Shoot Studio");
}
