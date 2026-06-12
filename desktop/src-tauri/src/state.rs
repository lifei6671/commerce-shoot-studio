use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::Manager;
use tokio::sync::Mutex;

use crate::domain::task::{CreateGenerationTaskSnapshotRequest, LocalGenerationTask};
use crate::error::{AppError, AppResult};
use crate::services::task_runner::{create_generation_task_snapshot, recover_interrupted_tasks};
use crate::storage::file_store::WorkspacePaths;
use crate::storage::migrations::run_workspace_migrations;
use crate::storage::sqlite::WorkspaceDatabase;

#[derive(Debug, Clone)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone)]
struct RunningGenerationTask {
    task_id: String,
    cancellation_token: CancellationToken,
}

#[derive(Debug, Default)]
struct GenerationTaskRuntimeState {
    start_lock: Mutex<()>,
    running_task: Mutex<Option<RunningGenerationTask>>,
}

pub struct AppState {
    workspace_paths: WorkspacePaths,
    database: WorkspaceDatabase,
    generation_task_runtime: GenerationTaskRuntimeState,
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
            generation_task_runtime: GenerationTaskRuntimeState::default(),
        })
    }

    pub fn workspace_paths(&self) -> &WorkspacePaths {
        &self.workspace_paths
    }

    pub fn database(&self) -> &WorkspaceDatabase {
        &self.database
    }

    pub async fn start_generation_task(
        &self,
        request: CreateGenerationTaskSnapshotRequest,
    ) -> AppResult<LocalGenerationTask> {
        let _start_guard = self.generation_task_runtime.start_lock.lock().await;

        if let Some(task_id) = self.running_generation_task_id().await {
            return Err(AppError::TaskAlreadyRunning(task_id));
        }

        let task = create_generation_task_snapshot(&self.database, request).await?;
        let cancellation_token = CancellationToken::new();
        let running_task = RunningGenerationTask {
            task_id: task.id.clone(),
            cancellation_token,
        };

        let mut active_task = self.generation_task_runtime.running_task.lock().await;
        *active_task = Some(running_task);
        Ok(task)
    }

    pub async fn running_generation_task_id(&self) -> Option<String> {
        self.generation_task_runtime
            .running_task
            .lock()
            .await
            .as_ref()
            .map(|task| task.task_id.clone())
    }

    pub async fn generation_cancellation_token(&self, task_id: &str) -> Option<CancellationToken> {
        self.generation_task_runtime
            .running_task
            .lock()
            .await
            .as_ref()
            .filter(|task| task.task_id == task_id)
            .map(|task| task.cancellation_token.clone())
    }

    pub async fn cancel_generation_task(&self, task_id: &str) -> AppResult<()> {
        let Some(token) = self.generation_cancellation_token(task_id).await else {
            return Err(AppError::InvalidInput(format!(
                "generation task {task_id} is not running"
            )));
        };
        token.cancel();
        Ok(())
    }

    pub async fn clear_generation_task(&self, task_id: &str) -> bool {
        let mut active_task = self.generation_task_runtime.running_task.lock().await;
        if active_task
            .as_ref()
            .is_some_and(|task| task.task_id == task_id)
        {
            *active_task = None;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
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

    #[tokio::test]
    async fn start_generation_task_registers_cancels_and_clears_token() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let state = AppState::initialize_with_workspace(temp_dir.path().to_path_buf())
            .await
            .expect("initialize");

        let task = state
            .start_generation_task(test_generation_request("task_active"))
            .await
            .expect("start task");

        assert_eq!(
            state.running_generation_task_id().await,
            Some(task.id.clone())
        );
        let token = state
            .generation_cancellation_token(&task.id)
            .await
            .expect("token");
        assert!(!token.is_cancelled());

        state
            .cancel_generation_task(&task.id)
            .await
            .expect("cancel task");
        assert!(token.is_cancelled());

        assert!(state.clear_generation_task(&task.id).await);
        assert_eq!(state.running_generation_task_id().await, None);
        assert!(state.generation_cancellation_token(&task.id).await.is_none());
    }

    #[tokio::test]
    async fn start_generation_task_rejects_second_running_task() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let state = AppState::initialize_with_workspace(temp_dir.path().to_path_buf())
            .await
            .expect("initialize");

        let first = state
            .start_generation_task(test_generation_request("task_first"))
            .await
            .expect("first task");

        let second = state
            .start_generation_task(test_generation_request("task_second"))
            .await;

        assert!(matches!(
            second,
            Err(AppError::TaskAlreadyRunning(task_id)) if task_id == first.id
        ));

        let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM generation_tasks")
            .fetch_one(state.database().pool())
            .await
            .expect("task count");
        assert_eq!(task_count, 1);
    }

    fn test_generation_request(id: &str) -> CreateGenerationTaskSnapshotRequest {
        CreateGenerationTaskSnapshotRequest {
            id: Some(id.to_string()),
            combination_id: None,
            provider: "openai".to_string(),
            model_id: "gpt-image-1".to_string(),
            request_summary_json: Some(json!({"provider": "openai"})),
            input_snapshot_json: json!({}),
            final_prompt_snapshot_json: json!({"user": "prompt"}),
            model_config_snapshot_json: json!({"modelId": "gpt-image-1"}),
            asset_snapshot_json: json!([]),
            input_assets: vec![],
            output_count: 1,
        }
    }
}
