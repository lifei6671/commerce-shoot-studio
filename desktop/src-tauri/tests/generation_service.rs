use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::generation::{
    GenerationError, GenerationTaskKind, GenerationTaskStatus, WorkspaceKind,
};
use commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase;
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::assets::{AssetService, ImportImagesInput};
use commerce_shoot_studio_lib::services::generation::{
    CreateGenerationTaskInput, GenerationService, GenerationTaskInputAssetInput,
    GenerationTaskQuery, RetryGenerationTaskInput,
};
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn create_task_reuses_existing_non_failed_task_for_same_idempotency_key() {
    let workspace_dir = initialized_workspace("task-idempotency");
    let service = GenerationService::new();
    let input = create_input("scene-click-1");

    let first = service
        .create_task(&workspace_dir, input.clone())
        .expect("first task should create");
    let second = service
        .create_task(&workspace_dir, input)
        .expect("second task should reuse existing queued task");
    let page = service
        .list_tasks(&workspace_dir, GenerationTaskQuery::default())
        .expect("tasks should list");

    assert_eq!(first.id, second.id);
    assert_eq!(page.total, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn create_task_requires_retry_when_idempotency_key_matches_failed_task() {
    let workspace_dir = initialized_workspace("task-failed-idempotency");
    let service = GenerationService::new();
    let task = service
        .create_task(&workspace_dir, create_input("failed-click-1"))
        .expect("task should create");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    database
        .connection()
        .execute(
            "UPDATE generation_tasks SET status = 'failed', stage = 'failed' WHERE id = ?1",
            [&task.id],
        )
        .expect("mark failed");

    let result = service.create_task(&workspace_dir, create_input("failed-click-1"));

    match result.expect_err("failed idempotency key should not create or reuse") {
        GenerationError::RetryRequired(error) => {
            assert_eq!(error.code, "TASK_RETRY_REQUIRED");
            assert!(error.retryable);
        }
        other => panic!("unexpected error: {other}"),
    }

    remove_workspace(&workspace_dir);
}

#[test]
fn retry_task_creates_new_task_with_retry_link_and_next_attempt() {
    let workspace_dir = initialized_workspace("task-retry");
    let service = GenerationService::new();
    let original = service
        .create_task(&workspace_dir, create_input("retry-click-1"))
        .expect("task should create");

    let retry = service
        .retry_task(
            &workspace_dir,
            RetryGenerationTaskInput {
                task_id: original.id.clone(),
            },
        )
        .expect("retry should create a new task");

    assert_ne!(retry.id, original.id);
    assert_eq!(
        retry.retry_of_task_id.as_deref(),
        Some(original.id.as_str())
    );
    assert_eq!(retry.attempt_no, 2);
    assert_eq!(retry.status, GenerationTaskStatus::Queued);

    remove_workspace(&workspace_dir);
}

#[test]
fn cancel_task_updates_status_and_writes_event() {
    let workspace_dir = initialized_workspace("task-cancel");
    let service = GenerationService::new();
    let task = service
        .create_task(&workspace_dir, create_input("cancel-click-1"))
        .expect("task should create");

    let cancelled = service
        .cancel_task(&workspace_dir, &task.id)
        .expect("queued task should cancel");
    let event_count = task_event_count(&workspace_dir, &task.id, "task.cancelled");

    assert_eq!(cancelled.status, GenerationTaskStatus::Cancelled);
    assert_eq!(event_count, 1);

    remove_workspace(&workspace_dir);
}

#[test]
fn cancel_task_does_not_write_cancel_event_for_terminal_task() {
    let workspace_dir = initialized_workspace("task-cancel-terminal");
    let service = GenerationService::new();
    let task = service
        .create_task(&workspace_dir, create_input("cancel-terminal-click-1"))
        .expect("task should create");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    database
        .connection()
        .execute(
            "UPDATE generation_tasks SET status = 'succeeded', stage = 'completed' WHERE id = ?1",
            [&task.id],
        )
        .expect("mark task succeeded");

    let result = service.cancel_task(&workspace_dir, &task.id);
    let event_count = task_event_count(&workspace_dir, &task.id, "task.cancelled");

    assert!(result.is_err());
    assert_eq!(event_count, 0);

    remove_workspace(&workspace_dir);
}

#[test]
fn delete_task_hides_history_without_removing_row() {
    let workspace_dir = initialized_workspace("task-delete");
    let service = GenerationService::new();
    let task = service
        .create_task(&workspace_dir, create_input("delete-click-1"))
        .expect("task should create");

    service
        .delete_task(&workspace_dir, &task.id)
        .expect("task should hide");

    let page = service
        .list_tasks(&workspace_dir, GenerationTaskQuery::default())
        .expect("visible tasks should list");
    let loaded = service
        .get_task(&workspace_dir, &task.id)
        .expect("hidden task row should still exist");

    assert_eq!(page.total, 0);
    assert_eq!(loaded.id, task.id);

    remove_workspace(&workspace_dir);
}

#[test]
fn create_task_links_input_assets_and_promotes_them_to_active() {
    let workspace_dir = initialized_workspace("task-input-assets");
    let source_file = workspace_dir.join("source.png");
    fs::write(&source_file, png_fixture_bytes(4, 4)).expect("write fixture");
    let asset = AssetService::new()
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: commerce_shoot_studio_lib::domain::assets::AssetKind::Source,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("asset should import")
        .remove(0);
    let service = GenerationService::new();

    let task = service
        .create_task(
            &workspace_dir,
            CreateGenerationTaskInput {
                input_assets: vec![GenerationTaskInputAssetInput {
                    asset_id: asset.id.clone(),
                    role: "source".to_string(),
                    sort_order: 0,
                }],
                ..create_input("input-asset-click-1")
            },
        )
        .expect("task should create");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    let relation_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM generation_task_input_assets WHERE task_id = ?1 AND asset_id = ?2",
            (&task.id, &asset.id),
            |row| row.get(0),
        )
        .expect("relation count should query");
    let lifecycle: String = database
        .connection()
        .query_row(
            "SELECT lifecycle FROM assets WHERE id = ?1",
            [&asset.id],
            |row| row.get(0),
        )
        .expect("asset lifecycle should query");

    assert_eq!(relation_count, 1);
    assert_eq!(lifecycle, "active");

    remove_workspace(&workspace_dir);
}

#[test]
fn garbage_collection_keeps_assets_referenced_by_tasks() {
    let workspace_dir = initialized_workspace("task-input-assets-gc");
    let source_file = workspace_dir.join("source.png");
    fs::write(&source_file, png_fixture_bytes(4, 4)).expect("write fixture");
    let asset_service = AssetService::new();
    let asset = asset_service
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: commerce_shoot_studio_lib::domain::assets::AssetKind::Source,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("asset should import")
        .remove(0);
    let asset_path = workspace_dir.join(asset.relative_path.split('/').collect::<PathBuf>());
    GenerationService::new()
        .create_task(
            &workspace_dir,
            CreateGenerationTaskInput {
                input_assets: vec![GenerationTaskInputAssetInput {
                    asset_id: asset.id.clone(),
                    role: "source".to_string(),
                    sort_order: 0,
                }],
                ..create_input("gc-active-asset-click-1")
            },
        )
        .expect("task should create");

    let result = asset_service
        .run_garbage_collection(&workspace_dir)
        .expect("gc should run");

    assert_eq!(result.deleted_files, 0);
    assert_eq!(result.reclaimed_bytes, 0);
    assert!(asset_path.is_file());

    remove_workspace(&workspace_dir);
}

#[test]
fn get_task_detail_returns_assets_outputs_and_events() {
    let workspace_dir = initialized_workspace("task-detail");
    let source_file = workspace_dir.join("source.png");
    fs::write(&source_file, png_fixture_bytes(8, 8)).expect("write fixture");
    let asset = AssetService::new()
        .import_images(
            &workspace_dir,
            ImportImagesInput {
                kind: commerce_shoot_studio_lib::domain::assets::AssetKind::Source,
                paths: vec![source_file.to_string_lossy().to_string()],
            },
        )
        .expect("asset should import")
        .remove(0);
    let service = GenerationService::new();
    let task = service
        .create_task(
            &workspace_dir,
            CreateGenerationTaskInput {
                input_assets: vec![GenerationTaskInputAssetInput {
                    asset_id: asset.id.clone(),
                    role: "source".to_string(),
                    sort_order: 0,
                }],
                ..create_input("detail-click-1")
            },
        )
        .expect("task should create");

    let detail = service
        .get_task_detail(&workspace_dir, &task.id)
        .expect("task detail should load");

    assert_eq!(detail.task.id, task.id);
    assert_eq!(detail.input_assets.len(), 1);
    assert_eq!(detail.input_assets[0].asset.id, asset.id);
    assert_eq!(detail.input_assets[0].role, "source");
    assert!(detail.output_assets.is_empty());
    assert!(detail
        .events
        .iter()
        .any(|event| event.event_type == "task.created"));

    remove_workspace(&workspace_dir);
}

fn create_input(idempotency_key: &str) -> CreateGenerationTaskInput {
    CreateGenerationTaskInput {
        idempotency_key: Some(idempotency_key.to_string()),
        workspace: WorkspaceKind::Scene,
        kind: GenerationTaskKind::ImageGeneration,
        title: "场景图任务".to_string(),
        prompt_plan_id: None,
        input: None,
        input_assets: Vec::new(),
    }
}

fn png_fixture_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes
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
