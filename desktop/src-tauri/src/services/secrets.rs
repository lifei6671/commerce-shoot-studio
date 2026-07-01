use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::infrastructure::database::{DatabaseError, WorkspaceDatabase};
use crate::services::model_config::{provider_profile, ProviderProfile, ProviderTestResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub configured: bool,
    pub storage: String,
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretScope {
    pub provider_profile_id: String,
    pub capability_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    Validation(String),
    Database(String),
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(message) | Self::Database(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for SecretError {}

#[derive(Debug, Clone, Copy, Default)]
pub struct SecretService;

impl SecretService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_secret_status(
        &self,
        workspace_directory: &Path,
        scope: SecretScope,
    ) -> Result<SecretStatus, SecretError> {
        let database = open_database(workspace_directory)?;
        let profile = provider_profile(&scope.provider_profile_id).ok_or_else(|| {
            SecretError::Validation("provider_profile_id 不在内置 allowlist 中。".to_string())
        })?;
        let stored = load_secret_status(
            &database,
            &scope.provider_profile_id,
            scope.capability_id.as_deref(),
        )?;
        Ok(secret_status_for_profile(
            profile,
            stored,
            scope.capability_id.as_deref().unwrap_or(""),
        ))
    }

    pub fn save_secret(
        &self,
        workspace_directory: &Path,
        scope: SecretScope,
        value: String,
    ) -> Result<SecretStatus, SecretError> {
        if value.trim().is_empty() {
            return Err(SecretError::Validation("API Key 不能为空。".to_string()));
        }
        if provider_profile(&scope.provider_profile_id).is_none() {
            return Err(SecretError::Validation(
                "provider_profile_id 不在内置 allowlist 中。".to_string(),
            ));
        }
        let database = open_database(workspace_directory)?;
        let capability_id = normalized_capability_id(scope.capability_id.as_deref());
        database.connection().execute(
            "
            INSERT INTO model_secrets (id, provider_profile_id, capability_id, secret_value, updated_at)
            VALUES (?1, ?2, ?3, ?4, datetime('now'))
            ON CONFLICT(provider_profile_id, capability_id) DO UPDATE SET
                secret_value = excluded.secret_value,
                version = model_secrets.version + 1,
                updated_at = datetime('now')
            WHERE model_secrets.secret_value <> excluded.secret_value
            ",
            params![create_secret_id(), scope.provider_profile_id, capability_id, value],
        )?;
        self.get_secret_status(workspace_directory, scope)
    }

    pub fn reveal_secret(
        &self,
        workspace_directory: &Path,
        scope: SecretScope,
    ) -> Result<String, SecretError> {
        if provider_profile(&scope.provider_profile_id).is_none() {
            return Err(SecretError::Validation(
                "provider_profile_id 不在内置 allowlist 中。".to_string(),
            ));
        }

        let database = open_database(workspace_directory)?;
        load_secret_value(
            &database,
            &scope.provider_profile_id,
            scope.capability_id.as_deref(),
        )?
        .ok_or_else(|| SecretError::Validation("API Key 未配置。".to_string()))
    }

    pub fn delete_secret(
        &self,
        workspace_directory: &Path,
        scope: SecretScope,
    ) -> Result<(), SecretError> {
        let database = open_database(workspace_directory)?;
        database.connection().execute(
            "DELETE FROM model_secrets WHERE provider_profile_id = ?1 AND capability_id = ?2",
            params![
                scope.provider_profile_id,
                normalized_capability_id(scope.capability_id.as_deref())
            ],
        )?;
        Ok(())
    }

    pub fn test_provider_connection(
        &self,
        workspace_directory: &Path,
        scope: SecretScope,
    ) -> Result<ProviderTestResult, SecretError> {
        let status = self.get_secret_status(workspace_directory, scope)?;
        Ok(ProviderTestResult {
            ok: status.configured,
            message: Some(if status.configured {
                "Provider 凭据可用。".to_string()
            } else {
                "Provider 凭据未配置。".to_string()
            }),
            elapsed_ms: Some(0),
        })
    }
}

pub fn secret_status_for_profile(
    profile: &ProviderProfile,
    stored: Option<SecretStatus>,
    _capability_id: &str,
) -> SecretStatus {
    if !profile.requires_secret {
        return SecretStatus {
            configured: true,
            storage: "sqlite-local".to_string(),
            last_updated_at: None,
        };
    }

    stored.unwrap_or(SecretStatus {
        configured: false,
        storage: "sqlite-local".to_string(),
        last_updated_at: None,
    })
}

fn load_secret_status(
    database: &WorkspaceDatabase,
    provider_profile_id: &str,
    capability_id: Option<&str>,
) -> Result<Option<SecretStatus>, SecretError> {
    database
        .connection()
        .query_row(
            "
            SELECT updated_at
            FROM model_secrets
            WHERE provider_profile_id = ?1 AND capability_id = ?2
            ",
            params![provider_profile_id, normalized_capability_id(capability_id)],
            |row| {
                Ok(SecretStatus {
                    configured: true,
                    storage: "sqlite-local".to_string(),
                    last_updated_at: row.get(0)?,
                })
            },
        )
        .optional()
        .map_err(SecretError::from)
}

fn load_secret_value(
    database: &WorkspaceDatabase,
    provider_profile_id: &str,
    capability_id: Option<&str>,
) -> Result<Option<String>, SecretError> {
    database
        .connection()
        .query_row(
            "
            SELECT secret_value
            FROM model_secrets
            WHERE provider_profile_id = ?1 AND capability_id = ?2
            ",
            params![provider_profile_id, normalized_capability_id(capability_id)],
            |row| row.get(0),
        )
        .optional()
        .map_err(SecretError::from)
}

fn open_database(workspace_directory: &Path) -> Result<WorkspaceDatabase, SecretError> {
    WorkspaceDatabase::open(workspace_directory).map_err(SecretError::from)
}

fn normalized_capability_id(value: Option<&str>) -> String {
    value.unwrap_or("").to_string()
}

fn create_secret_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("secret_{nanos}")
}

impl From<DatabaseError> for SecretError {
    fn from(source: DatabaseError) -> Self {
        Self::Database(source.to_string())
    }
}

impl From<rusqlite::Error> for SecretError {
    fn from(source: rusqlite::Error) -> Self {
        Self::Database(DatabaseError::from(source).to_string())
    }
}
