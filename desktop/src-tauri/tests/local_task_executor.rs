use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::generation::{
    GenerationTaskKind, GenerationTaskStage, GenerationTaskStatus, WorkspaceKind,
};
use commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase;
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::generation::{
    CreateGenerationTaskInput, GenerationService,
};
use commerce_shoot_studio_lib::services::local_task_executor::LocalTaskExecutor;
use commerce_shoot_studio_lib::services::model_config::{
    ModelConfigService, SaveLocalModelConfigInput, SetDefaultModelConfigInput,
};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn run_next_executes_oldest_queued_task_with_model_gateway_and_events() {
    let workspace_dir = initialized_workspace("local-executor-success");
    let generation_service = GenerationService::new();
    let first = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-exec-1"))
        .expect("first task should create");
    let second = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-exec-2"))
        .expect("second task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let executed = generation_service
        .get_task(&workspace_dir, &first.id)
        .expect("executed task should reload");
    let pending = generation_service
        .get_task(&workspace_dir, &second.id)
        .expect("pending task should reload");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    let invocation_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM model_invocations WHERE id = ?1 AND capability_id = 'scene-image-generation'",
            [result.invocation_id.as_deref().expect("invocation id")],
            |row| row.get(0),
        )
        .expect("invocation count should query");

    assert_eq!(result.task_id, first.id);
    assert_eq!(executed.status, GenerationTaskStatus::Succeeded);
    assert_eq!(executed.stage, GenerationTaskStage::Completed);
    assert_eq!(pending.status, GenerationTaskStatus::Queued);
    assert_eq!(invocation_count, 1);
    assert_eq!(
        task_event_count(&workspace_dir, &first.id, "task.provider-called"),
        1
    );
    assert_eq!(
        task_event_count(&workspace_dir, &first.id, "task.succeeded"),
        1
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_persists_generated_result_asset_for_scene_task() {
    let workspace_dir = initialized_workspace("local-executor-generated-asset");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-generated-asset"))
        .expect("task should create");

    LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should run")
        .expect("queued task should exist");
    let detail = generation_service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("task detail should load");

    assert_eq!(detail.output_assets.len(), 1);
    let output = &detail.output_assets[0];
    assert_eq!(output.role, "output");
    assert_eq!(output.sort_order, 0);
    assert_eq!(output.asset.kind.as_str(), "generated");
    assert_eq!(output.asset.mime_type, "image/png");
    assert_eq!(output.asset.lifecycle.as_str(), "active");
    assert_eq!(output.asset.width, Some(1));
    assert_eq!(output.asset.height, Some(1));
    assert!(output.asset.relative_path.starts_with("assets/generated/"));
    assert!(workspace_dir
        .join(relative_path_to_platform(&output.asset.relative_path))
        .is_file());
    assert_eq!(
        task_event_count(&workspace_dir, &task.id, "task.result-saved"),
        1
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_returns_none_when_queue_is_empty() {
    let workspace_dir = initialized_workspace("local-executor-empty");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should inspect queue");

    assert!(result.is_none());

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_respects_single_local_concurrency() {
    let workspace_dir = initialized_workspace("local-executor-concurrency");
    let generation_service = GenerationService::new();
    generation_service
        .create_task(&workspace_dir, create_scene_task("scene-running-1"))
        .expect("first task should create");
    generation_service
        .create_task(&workspace_dir, create_scene_task("scene-running-2"))
        .expect("second task should create");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    database
        .connection()
        .execute(
            "UPDATE generation_tasks SET status = 'running', stage = 'calling-provider' WHERE idempotency_key = 'scene-running-1'",
            [],
        )
        .expect("mark running");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should inspect queue");
    let queued_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM generation_tasks WHERE status = 'queued'",
            [],
            |row| row.get(0),
        )
        .expect("queued count should query");

    assert!(result.is_none());
    assert_eq!(queued_count, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn run_next_marks_task_failed_when_model_capability_is_unavailable() {
    let workspace_dir = initialized_workspace("local-executor-model-unavailable");
    let model_service = ModelConfigService::new();
    let config = model_service
        .save_config(
            &workspace_dir,
            SaveLocalModelConfigInput {
                id: None,
                capability_id: "scene-image-generation".to_string(),
                provider_profile_id: "openai".to_string(),
                display_name: "OpenAI 场景图".to_string(),
                execution_mode: "sync".to_string(),
                model: "gpt-image-test".to_string(),
                endpoint_path: Some("/v1/images/generations".to_string()),
                enabled: true,
            },
        )
        .expect("config should save");
    model_service
        .set_default_config(
            &workspace_dir,
            SetDefaultModelConfigInput {
                capability_id: "scene-image-generation".to_string(),
                config_id: config.id,
            },
        )
        .expect("default config should switch");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(&workspace_dir, create_scene_task("scene-failed-1"))
        .expect("task should create");

    let result = LocalTaskExecutor::new()
        .run_next(&workspace_dir)
        .expect("executor should handle provider failure")
        .expect("task should be attempted");
    let failed = generation_service
        .get_task(&workspace_dir, &task.id)
        .expect("failed task should reload");

    assert_eq!(result.task_id, task.id);
    assert!(result.invocation_id.is_none());
    assert_eq!(failed.status, GenerationTaskStatus::Failed);
    assert_eq!(failed.stage, GenerationTaskStage::Failed);
    assert_eq!(
        failed.error.as_ref().map(|error| error.code.as_str()),
        Some("MODEL_CAPABILITY_UNAVAILABLE")
    );
    assert_eq!(task_event_count(&workspace_dir, &task.id, "task.failed"), 1);

    remove_workspace(&workspace_dir);
}

fn create_scene_task(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Scene,
        kind: GenerationTaskKind::ImageGeneration,
        title: "场景图任务".to_string(),
        prompt_plan_id: None,
        input: Some(serde_json::json!({
            "prompt": "白色摄影棚，柔光",
        })),
        input_assets: Vec::new(),
    }
}

fn task_event_count(workspace_dir: &Path, task_id: &str, event_type: &str) -> i64 {
    let database = WorkspaceDatabase::open(workspace_dir).expect("database should open");
    database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM task_events WHERE task_id = ?1 AND event_type = ?2",
            (task_id, event_type),
            |row| row.get(0),
        )
        .expect("event count should query")
}

fn initialized_workspace(label: &str) -> PathBuf {
    let workspace_dir = unique_temp_workspace(label);
    WorkspaceService::new(WorkspaceFileSystem::new())
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    workspace_dir
}

fn unique_temp_workspace(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("commerce-shoot-studio-{label}-{nanos}"))
}

fn remove_workspace(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

fn relative_path_to_platform(relative_path: &str) -> PathBuf {
    relative_path.split('/').collect()
}
