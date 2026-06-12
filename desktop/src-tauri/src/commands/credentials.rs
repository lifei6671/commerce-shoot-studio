use crate::error::AppResult;
use crate::services::credential_service::{ProviderCredentialService, ProviderCredentialStatus};

#[tauri::command]
pub async fn set_provider_api_key(provider: String, api_key: String) -> AppResult<()> {
    ProviderCredentialService::system()
        .set_provider_api_key(&provider, &api_key)
        .await
}

#[tauri::command]
pub async fn get_provider_credential_status(
    provider: String,
) -> AppResult<ProviderCredentialStatus> {
    ProviderCredentialService::system()
        .get_provider_credential_status(&provider)
        .await
}
