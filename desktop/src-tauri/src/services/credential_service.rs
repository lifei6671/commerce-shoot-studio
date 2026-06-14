use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const KEYCHAIN_SERVICE: &str = "commerce-shoot-studio.provider-api-key";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCredentialStatus {
    pub provider: String,
    pub configured: bool,
    pub masked_key: Option<String>,
}

pub trait CredentialStore: Clone + Send + Sync + 'static {
    fn set_secret(&self, provider: &str, api_key: &str) -> AppResult<()>;
    fn get_secret(&self, provider: &str) -> AppResult<Option<String>>;
}

#[derive(Debug, Clone)]
pub struct ProviderCredentialService<S: CredentialStore = SystemCredentialStore> {
    store: S,
}

impl ProviderCredentialService<SystemCredentialStore> {
    pub fn system() -> Self {
        Self {
            store: SystemCredentialStore,
        }
    }
}

impl<S: CredentialStore> ProviderCredentialService<S> {
    pub fn new(store: S) -> Self {
        Self { store }
    }

    pub async fn set_provider_api_key(&self, provider: &str, api_key: &str) -> AppResult<()> {
        validate_fixed_provider(provider)?;
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AppError::InvalidInput("API key is required".to_string()));
        }
        self.store.set_secret(provider, api_key)
    }

    pub async fn read_provider_api_key(&self, provider: &str) -> AppResult<String> {
        validate_fixed_provider(provider)?;
        self.store.get_secret(provider)?.ok_or_else(|| {
            AppError::InvalidInput(format!("provider {provider} API key is not configured"))
        })
    }

    pub async fn get_provider_credential_status(
        &self,
        provider: &str,
    ) -> AppResult<ProviderCredentialStatus> {
        validate_fixed_provider(provider)?;
        let api_key = self.store.get_secret(provider)?;
        Ok(ProviderCredentialStatus {
            provider: provider.to_string(),
            configured: api_key.is_some(),
            masked_key: api_key.as_deref().map(mask_api_key),
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct InMemoryCredentialStore {
    secrets: Arc<Mutex<HashMap<String, String>>>,
}

impl CredentialStore for InMemoryCredentialStore {
    fn set_secret(&self, provider: &str, api_key: &str) -> AppResult<()> {
        self.secrets
            .lock()
            .map_err(|_| AppError::InvalidInput("credential store lock is poisoned".to_string()))?
            .insert(provider.to_string(), api_key.to_string());
        Ok(())
    }

    fn get_secret(&self, provider: &str) -> AppResult<Option<String>> {
        Ok(self
            .secrets
            .lock()
            .map_err(|_| AppError::InvalidInput("credential store lock is poisoned".to_string()))?
            .get(provider)
            .cloned())
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemCredentialStore;

impl CredentialStore for SystemCredentialStore {
    fn set_secret(&self, provider: &str, api_key: &str) -> AppResult<()> {
        set_system_secret(provider, api_key)
    }

    fn get_secret(&self, provider: &str) -> AppResult<Option<String>> {
        get_system_secret(provider)
    }
}

fn validate_fixed_provider(provider: &str) -> AppResult<()> {
    if matches!(provider, "openai" | "google" | "custom") {
        return Ok(());
    }
    Err(AppError::InvalidInput(format!(
        "provider {provider} is not supported"
    )))
}

fn mask_api_key(api_key: &str) -> String {
    let chars: Vec<char> = api_key.chars().collect();
    if chars.len() <= 8 {
        return "****".to_string();
    }
    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{prefix}...{suffix}")
}

#[cfg(target_os = "macos")]
fn set_system_secret(provider: &str, api_key: &str) -> AppResult<()> {
    let delete_status = Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            provider,
        ])
        .status()?;
    let _ = delete_status;

    let status = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            provider,
            "-w",
            api_key,
        ])
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "failed to store {provider} API key in system keychain"
        )))
    }
}

#[cfg(target_os = "macos")]
fn get_system_secret(provider: &str) -> AppResult<Option<String>> {
    let output = Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            provider,
            "-w",
        ])
        .output()?;

    if output.status.success() {
        let api_key = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if api_key.is_empty() {
            Ok(None)
        } else {
            Ok(Some(api_key))
        }
    } else {
        Ok(None)
    }
}

#[cfg(not(target_os = "macos"))]
fn set_system_secret(_provider: &str, _api_key: &str) -> AppResult<()> {
    Err(AppError::InvalidInput(
        "system keychain is only supported on macOS".to_string(),
    ))
}

#[cfg(not(target_os = "macos"))]
fn get_system_secret(_provider: &str) -> AppResult<Option<String>> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_api_key_keeps_only_edges() {
        assert_eq!(mask_api_key("placeholder-api-key-value"), "plac...alue");
        assert_eq!(mask_api_key("short"), "****");
    }

    #[tokio::test]
    async fn credential_status_accepts_supported_model_providers() {
        let service = ProviderCredentialService::new(InMemoryCredentialStore::default());

        for provider in ["openai", "google", "custom"] {
            service
                .set_provider_api_key(provider, "provider-api-key-value")
                .await
                .expect("set key");
            let status = service
                .get_provider_credential_status(provider)
                .await
                .expect("read status");
            assert_eq!(status.provider, provider);
            assert!(status.configured);
        }
    }
}
