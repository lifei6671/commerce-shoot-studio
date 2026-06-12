use std::path::PathBuf;

use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::services::task_runner::recover_interrupted_tasks;
use crate::storage::file_store::WorkspacePaths;
use crate::storage::migrations::run_workspace_migrations;
use crate::storage::sqlite::WorkspaceDatabase;

pub struct AppState {
    workspace_paths: WorkspacePaths,
    database: WorkspaceDatabase,
}

impl AppState {
    pub async fn initialize(app_handle: &tauri::AppHandle) -> AppResult<Self> {
        let workspace_root = app_handle
            .path()
            .app_data_dir()
            .map_err(|_| AppError::WorkspaceUnavailable)?;
        Self::initialize_with_workspace(workspace_root).await
    }

    pub async fn initialize_with_workspace(workspace_root: PathBuf) -> AppResult<Self> {
        let workspace_paths = WorkspacePaths::new(workspace_root);
        workspace_paths.ensure()?;

        let database = WorkspaceDatabase::connect(&workspace_paths.database_path()).await?;
        run_workspace_migrations(&workspace_paths, &database).await?;
        recover_interrupted_tasks(&database).await?;

        Ok(Self {
            workspace_paths,
            database,
        })
    }

    pub fn workspace_paths(&self) -> &WorkspacePaths {
        &self.workspace_paths
    }

    pub fn database(&self) -> &WorkspaceDatabase {
        &self.database
    }
}

#[cfg(test)]
mod tests {
    use sqlx::Row;

    use super::*;
    use crate::domain::task::APP_UNEXPECTED_SHUTDOWN;

    #[tokio::test]
    async fn initialize_creates_database_and_runs_startup_recovery() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let state = AppState::initialize_with_workspace(temp_dir.path().to_path_buf())
            .await
            .expect("initialize");

        let mut writer = state.database().writer().await;
        sqlx::query(
            "INSERT INTO generation_tasks (
                id,
                status,
                provider,
                model_id,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json
            ) VALUES ('task-running', 'queued', 'openai', 'gpt-image-1', '{}', '{}', '{}', '[]')",
        )
        .execute(&mut *writer)
        .await
        .expect("insert task");
        drop(writer);

        drop(state);

        let restarted = AppState::initialize_with_workspace(temp_dir.path().to_path_buf())
            .await
            .expect("restart");
        let row = sqlx::query(
            "SELECT status, error_code FROM generation_tasks WHERE id = 'task-running'",
        )
        .fetch_one(restarted.database().pool())
        .await
        .expect("fetch task");

        assert_eq!(row.get::<String, _>("status"), "failed");
        assert_eq!(
            row.get::<Option<String>, _>("error_code"),
            Some(APP_UNEXPECTED_SHUTDOWN.to_string())
        );
    }
}
