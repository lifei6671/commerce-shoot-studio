use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

use ulid::Ulid;

use crate::domain::model::SaveModelConfigRequest;
use crate::domain::task::{
    CreateGenerationTaskSnapshotRequest, LocalGenerationTask, StartGenerationRequest,
};
use crate::error::{AppError, AppResult};
use crate::providers::openai_provider::OpenAiImageProvider;
use crate::services::assets::run_asset_gc;
use crate::services::credential_service::ProviderCredentialService;
use crate::services::system_settings::{
    build_proxy_client, default_workspace_root, load_system_settings, notify_generation_finished,
    run_system_maintenance,
};
use crate::services::task_runner::{
    cancel_generation_task_by_id, create_generation_task_snapshot, get_generation_task_by_id,
    recover_interrupted_tasks, rerun_generation_from_current_combination_with_provider,
    retry_generation_task_with_provider,
    run_generation_flow_with_task_id_observer_and_cancellation, GenerationTaskObserver,
};
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
    app_config_dir: PathBuf,
    workspace_paths: WorkspacePaths,
    database: WorkspaceDatabase,
    generation_task_runtime: GenerationTaskRuntimeState,
}

impl AppState {
    pub async fn initialize(app_handle: &tauri::AppHandle) -> AppResult<Self> {
        let default_workspace_root = default_workspace_root(app_handle)?;
        let app_config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|_| AppError::WorkspaceUnavailable)?;
        let settings = load_system_settings(&app_config_dir, &default_workspace_root)?;
        let state = Self::initialize_with_workspace_and_config(
            settings.workspace_root.clone().into(),
            app_config_dir,
        )
        .await?;
        run_system_maintenance(&state.database, &state.workspace_paths, &settings).await?;
        Ok(state)
    }

    pub async fn initialize_with_workspace(workspace_root: PathBuf) -> AppResult<Self> {
        Self::initialize_with_workspace_and_config(workspace_root.clone(), workspace_root).await
    }

    pub async fn initialize_with_workspace_and_config(
        workspace_root: PathBuf,
        app_config_dir: PathBuf,
    ) -> AppResult<Self> {
        let workspace_paths = WorkspacePaths::new(workspace_root);
        workspace_paths.ensure()?;

        let database = WorkspaceDatabase::connect(&workspace_paths.database_path()).await?;
        run_workspace_migrations(&workspace_paths, &database).await?;
        run_asset_gc(&database, &workspace_paths).await?;
        recover_interrupted_tasks(&database).await?;

        Ok(Self {
            app_config_dir,
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

    pub fn app_config_dir(&self) -> &PathBuf {
        &self.app_config_dir
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

    pub async fn run_generation(
        &self,
        request: StartGenerationRequest,
    ) -> AppResult<LocalGenerationTask> {
        self.run_generation_internal(request, None).await
    }

    pub async fn run_generation_with_events(
        &self,
        app_handle: tauri::AppHandle,
        request: StartGenerationRequest,
    ) -> AppResult<LocalGenerationTask> {
        let observer = |task: LocalGenerationTask| {
            emit_generation_task_events(&app_handle, &task);
        };
        self.run_generation_internal(request, Some(&observer)).await
    }

    pub async fn retry_generation_task(
        &self,
        source_task_id: &str,
    ) -> AppResult<LocalGenerationTask> {
        self.retry_generation_task_internal(source_task_id, None)
            .await
    }

    pub async fn retry_generation_task_with_events(
        &self,
        app_handle: tauri::AppHandle,
        source_task_id: &str,
    ) -> AppResult<LocalGenerationTask> {
        let observer = |task: LocalGenerationTask| {
            emit_generation_task_events(&app_handle, &task);
        };
        self.retry_generation_task_internal(source_task_id, Some(&observer))
            .await
    }

    async fn retry_generation_task_internal(
        &self,
        source_task_id: &str,
        observer: Option<GenerationTaskObserver<'_>>,
    ) -> AppResult<LocalGenerationTask> {
        let _start_guard = self.generation_task_runtime.start_lock.lock().await;

        if let Some(task_id) = self.running_generation_task_id().await {
            return Err(AppError::TaskAlreadyRunning(task_id));
        }

        let source_task = get_generation_task_by_id(&self.database, source_task_id)
            .await?
            .ok_or_else(|| {
                AppError::InvalidInput(format!("generation task {source_task_id} was not found"))
            })?;
        let api_key = ProviderCredentialService::system()
            .read_provider_api_key(&source_task.provider)
            .await?;
        let task_id = format!("generation_task_{}", Ulid::new());
        let cancellation_token = CancellationToken::new();
        {
            let mut active_task = self.generation_task_runtime.running_task.lock().await;
            *active_task = Some(RunningGenerationTask {
                task_id: task_id.clone(),
                cancellation_token: cancellation_token.clone(),
            });
        }
        let cancellation_checker = || cancellation_token.is_cancelled();

        let result = retry_generation_task_with_provider(
            &self.database,
            &self.workspace_paths,
            &self.openai_provider()?,
            &api_key,
            source_task_id,
            Some(task_id.clone()),
            observer,
            Some(&cancellation_checker),
        )
        .await;
        self.clear_generation_task(&task_id).await;
        result
    }

    pub async fn rerun_generation_from_current_combination(
        &self,
        combination_id: &str,
        model_config: SaveModelConfigRequest,
    ) -> AppResult<LocalGenerationTask> {
        self.rerun_generation_from_current_combination_internal(combination_id, model_config, None)
            .await
    }

    pub async fn rerun_generation_from_current_combination_with_events(
        &self,
        app_handle: tauri::AppHandle,
        combination_id: &str,
        model_config: SaveModelConfigRequest,
    ) -> AppResult<LocalGenerationTask> {
        let observer = |task: LocalGenerationTask| {
            emit_generation_task_events(&app_handle, &task);
        };
        self.rerun_generation_from_current_combination_internal(
            combination_id,
            model_config,
            Some(&observer),
        )
        .await
    }

    async fn rerun_generation_from_current_combination_internal(
        &self,
        combination_id: &str,
        model_config: SaveModelConfigRequest,
        observer: Option<GenerationTaskObserver<'_>>,
    ) -> AppResult<LocalGenerationTask> {
        let _start_guard = self.generation_task_runtime.start_lock.lock().await;

        if let Some(task_id) = self.running_generation_task_id().await {
            return Err(AppError::TaskAlreadyRunning(task_id));
        }

        let api_key = ProviderCredentialService::system()
            .read_provider_api_key(&model_config.provider)
            .await?;
        let task_id = format!("generation_task_{}", Ulid::new());
        let cancellation_token = CancellationToken::new();
        {
            let mut active_task = self.generation_task_runtime.running_task.lock().await;
            *active_task = Some(RunningGenerationTask {
                task_id: task_id.clone(),
                cancellation_token: cancellation_token.clone(),
            });
        }
        let cancellation_checker = || cancellation_token.is_cancelled();

        let result = rerun_generation_from_current_combination_with_provider(
            &self.database,
            &self.workspace_paths,
            &self.openai_provider()?,
            &api_key,
            combination_id,
            model_config,
            Some(task_id.clone()),
            observer,
            Some(&cancellation_checker),
        )
        .await;
        self.clear_generation_task(&task_id).await;
        result
    }

    async fn run_generation_internal(
        &self,
        request: StartGenerationRequest,
        observer: Option<GenerationTaskObserver<'_>>,
    ) -> AppResult<LocalGenerationTask> {
        let _start_guard = self.generation_task_runtime.start_lock.lock().await;

        if let Some(task_id) = self.running_generation_task_id().await {
            return Err(AppError::TaskAlreadyRunning(task_id));
        }

        let task_id = format!("generation_task_{}", Ulid::new());
        let provider = request
            .draft_model_config
            .as_ref()
            .map(|model| model.provider.clone())
            .unwrap_or_else(|| "openai".to_string());
        let api_key = ProviderCredentialService::system()
            .read_provider_api_key(&provider)
            .await?;

        let cancellation_token = CancellationToken::new();
        {
            let mut active_task = self.generation_task_runtime.running_task.lock().await;
            *active_task = Some(RunningGenerationTask {
                task_id: task_id.clone(),
                cancellation_token: cancellation_token.clone(),
            });
        }
        let cancellation_checker = || cancellation_token.is_cancelled();

        let result = run_generation_flow_with_task_id_observer_and_cancellation(
            &self.database,
            &self.workspace_paths,
            &self.openai_provider()?,
            &api_key,
            request,
            Some(task_id.clone()),
            observer,
            Some(&cancellation_checker),
        )
        .await;
        self.clear_generation_task(&task_id).await;
        result
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

    pub async fn cancel_generation_task(&self, task_id: &str) -> AppResult<LocalGenerationTask> {
        let Some(token) = self.generation_cancellation_token(task_id).await else {
            return Err(AppError::InvalidInput(format!(
                "generation task {task_id} is not running"
            )));
        };
        token.cancel();

        let task = get_generation_task_by_id(&self.database, task_id)
            .await?
            .ok_or_else(|| {
                AppError::InvalidInput(format!("generation task {task_id} was not found"))
            })?;
        let api_key = ProviderCredentialService::system()
            .read_provider_api_key(&task.provider)
            .await
            .unwrap_or_default();
        let provider = self.openai_provider()?;
        let task =
            cancel_generation_task_by_id(&self.database, &provider, &api_key, task_id).await?;
        self.clear_generation_task(task_id).await;
        Ok(task)
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

    fn openai_provider(&self) -> AppResult<OpenAiImageProvider> {
        let settings = load_system_settings(&self.app_config_dir, self.workspace_paths.root())?;
        Ok(OpenAiImageProvider::with_client(build_proxy_client(
            &settings,
        )?))
    }
}

fn emit_generation_task_events(app_handle: &tauri::AppHandle, task: &LocalGenerationTask) {
    let _ = app_handle.emit("generation://task-updated", task.clone());
    let terminal_event = match task.status.as_str() {
        "queued" => Some("generation://task-created"),
        "succeeded" => Some("generation://task-finished"),
        "failed" => Some("generation://task-failed"),
        "cancelled" => Some("generation://task-cancelled"),
        _ => None,
    };
    if let Some(event) = terminal_event {
        let _ = app_handle.emit(event, task.clone());
    }
    if matches!(task.status.as_str(), "succeeded" | "failed") {
        if let Ok(app_config_dir) = app_handle.path().app_config_dir() {
            notify_generation_finished(&app_config_dir, &task.status, &task.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use sqlx::Row;

    use super::*;
    use crate::domain::task::APP_UNEXPECTED_SHUTDOWN;
    use crate::services::task_runner::list_recent_generation_task_details;

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
                combination_snapshot_json,
                prompt_snapshot_json,
                model_snapshot_json,
                input_assets_snapshot_json,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json
            ) VALUES (
                'task-running',
                'queued',
                'openai',
                'gpt-image-1',
                '{}',
                '{}',
                '{}',
                '[]',
                '{}',
                '{}',
                '{}',
                '[]'
            )",
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
    async fn initialize_runs_asset_gc() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let state = AppState::initialize_with_workspace(temp_dir.path().to_path_buf())
            .await
            .expect("initialize");
        let orphan_relative_path = "assets/person/startup-orphan.png";
        let orphan_path = state.workspace_paths().root().join(orphan_relative_path);
        fs::create_dir_all(orphan_path.parent().expect("orphan parent")).expect("orphan parent");
        fs::write(&orphan_path, b"orphan").expect("orphan file");
        sqlx::query(
            "INSERT INTO asset_gc_queue (id, relative_path, reason)
             VALUES ('startup_gc', ?, 'delete_failed')",
        )
        .bind(orphan_relative_path)
        .execute(state.database().pool())
        .await
        .expect("gc row");
        drop(state);

        let restarted = AppState::initialize_with_workspace(temp_dir.path().to_path_buf())
            .await
            .expect("restart");

        assert!(!orphan_path.exists());
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM asset_gc_queue")
            .fetch_one(restarted.database().pool())
            .await
            .expect("gc count");
        assert_eq!(remaining, 0);
    }

    #[tokio::test]
    async fn initialize_recovered_task_is_listed_as_recent() {
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
                combination_snapshot_json,
                prompt_snapshot_json,
                model_snapshot_json,
                input_assets_snapshot_json,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json
            ) VALUES (
                'task-recovered-recent',
                'calling_model',
                'openai',
                'gpt-image-1',
                '{}',
                '{}',
                '{}',
                '[]',
                '{}',
                '{}',
                '{}',
                '[]'
            )",
        )
        .execute(&mut *writer)
        .await
        .expect("insert task");
        drop(writer);
        drop(state);

        let restarted = AppState::initialize_with_workspace(temp_dir.path().to_path_buf())
            .await
            .expect("restart");
        let recent = list_recent_generation_task_details(
            restarted.database(),
            restarted.workspace_paths(),
            10,
        )
        .await
        .expect("recent tasks");
        let recovered = recent
            .iter()
            .find(|detail| detail.task.id == "task-recovered-recent")
            .expect("recovered task");

        assert_eq!(recovered.task.status, "failed");
        let row = sqlx::query(
            "SELECT error_code FROM generation_tasks WHERE id = 'task-recovered-recent'",
        )
        .fetch_one(restarted.database().pool())
        .await
        .expect("task row");
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

        let cancelled =
            sqlx::query("SELECT status, cancel_mode FROM generation_tasks WHERE id = ?")
                .bind(&task.id)
                .fetch_one(state.database().pool())
                .await
                .expect("cancelled task");
        assert_eq!(cancelled.get::<String, _>("status"), "cancelled");
        assert_eq!(
            cancelled.get::<Option<String>, _>("cancel_mode").as_deref(),
            Some("remote_not_supported")
        );

        assert_eq!(state.running_generation_task_id().await, None);
        assert!(state
            .generation_cancellation_token(&task.id)
            .await
            .is_none());

        let next = state
            .start_generation_task(test_generation_request("task_after_cancel"))
            .await
            .expect("start after cancel");
        assert_eq!(next.id, "task_after_cancel");
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
