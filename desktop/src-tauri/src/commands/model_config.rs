use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::model_config::{
    LocalModelConfigView, ModelConfigService, ModelImageSizeOptions, ProviderProfileView,
    ProviderTestResult, SaveLocalModelConfigInput, SetDefaultModelConfigInput,
};

#[tauri::command]
pub fn model_config_list_configs() -> Result<Vec<LocalModelConfigView>, String> {
    ModelConfigService::new()
        .list_configs(&default_workspace_directory())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_config_get_config(config_id: String) -> Result<LocalModelConfigView, String> {
    ModelConfigService::new()
        .get_config(&default_workspace_directory(), &config_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_config_list_image_size_options(
    capability_id: String,
) -> Result<ModelImageSizeOptions, String> {
    ModelConfigService::new()
        .list_image_size_options(&default_workspace_directory(), &capability_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_config_save_config(
    input: SaveLocalModelConfigInput,
) -> Result<LocalModelConfigView, String> {
    ModelConfigService::new()
        .save_config(&default_workspace_directory(), input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_config_set_default_config(
    input: SetDefaultModelConfigInput,
) -> Result<LocalModelConfigView, String> {
    ModelConfigService::new()
        .set_default_config(&default_workspace_directory(), input)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_config_delete_config(config_id: String) -> Result<(), String> {
    ModelConfigService::new()
        .delete_config(&default_workspace_directory(), &config_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_config_list_provider_profiles() -> Result<Vec<ProviderProfileView>, String> {
    ModelConfigService::new()
        .list_provider_profiles()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn model_config_test_config(config_id: String) -> Result<ProviderTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ModelConfigService::new()
            .test_config(&default_workspace_directory(), &config_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Provider 连接测试任务执行失败：{error}"))?
}
