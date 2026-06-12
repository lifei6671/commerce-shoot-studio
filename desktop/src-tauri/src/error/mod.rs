use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("storage error: {0}")]
    Storage(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("workspace path is unavailable")]
    WorkspaceUnavailable,
    #[error("{0}")]
    InvalidInput(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let code = match self {
            AppError::Storage(_) => "STORAGE_ERROR",
            AppError::Migration(_) => "MIGRATION_ERROR",
            AppError::Io(_) => "IO_ERROR",
            AppError::WorkspaceUnavailable => "WORKSPACE_UNAVAILABLE",
            AppError::InvalidInput(_) => "INVALID_INPUT",
        };

        CommandError {
            code,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
