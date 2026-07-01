use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::model_config::ProviderTestResult;
use crate::services::secrets::{SecretScope, SecretService, SecretStatus};

#[tauri::command]
pub fn secret_get_status(scope: SecretScope) -> Result<SecretStatus, String> {
    SecretService::new()
        .get_secret_status(&default_workspace_directory(), scope)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_save(scope: SecretScope, value: String) -> Result<SecretStatus, String> {
    SecretService::new()
        .save_secret(&default_workspace_directory(), scope, value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_reveal(scope: SecretScope) -> Result<String, String> {
    SecretService::new()
        .reveal_secret(&default_workspace_directory(), scope)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_delete(scope: SecretScope) -> Result<(), String> {
    SecretService::new()
        .delete_secret(&default_workspace_directory(), scope)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_test_provider_connection(scope: SecretScope) -> Result<ProviderTestResult, String> {
    SecretService::new()
        .test_provider_connection(&default_workspace_directory(), scope)
        .map_err(|error| error.to_string())
}
