use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::generation::{GenerationTaskKind, WorkspaceKind};
use commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase;
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::generation::{
    CreateGenerationTaskInput, GenerationService,
};
use commerce_shoot_studio_lib::services::startup_recovery::StartupRecoveryService;
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn cleanup_temp_files_removes_orphan_files_but_keeps_tmp_directory() {
    let workspace_dir = initialized_workspace("tmp-cleanup");
    let tmp_dir = workspace_dir.join("cache/tmp");
    fs::write(tmp_dir.join("download.tmp"), b"partial").expect("write temp file");
    fs::create_dir_all(tmp_dir.join("nested")).expect("create nested temp dir");
    fs::write(tmp_dir.join("nested/chunk.tmp"), b"chunk").expect("write nested temp file");
    let service = StartupRecoveryService::new(WorkspaceFileSystem::new());

    let result = service
        .cleanup_orphan_temp_files(&workspace_dir)
        .expect("cleanup should succeed");

    assert_eq!(result.deleted_temp_files, 2);
    assert!(
        tmp_dir.is_dir(),
        "tmp directory itself must remain available"
    );
    assert!(
        fs::read_dir(&tmp_dir)
            .expect("read tmp dir")
            .next()
            .is_none(),
        "tmp directory should be empty after cleanup",
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn recover_running_tasks_is_noop_before_task_tables_exist() {
    let workspace_dir = initialized_workspace("task-recovery-noop");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    let service = StartupRecoveryService::new(WorkspaceFileSystem::new());

    let result = service
        .recover_interrupted_tasks(database.connection())
        .expect("missing task tables should be treated as no-op in M0");

    assert_eq!(result.interrupted_tasks, 0);

    remove_workspace(&workspace_dir);
}

#[test]
fn recover_running_tasks_marks_them_interrupted_and_writes_event() {
    let workspace_dir = initialized_workspace("task-recovery-running");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(
            &workspace_dir,
            CreateGenerationTaskInput {
                idempotency_key: Some("recover-running-1".to_string()),
                workspace: WorkspaceKind::Scene,
                kind: GenerationTaskKind::ImageGeneration,
                title: "异常恢复任务".to_string(),
                prompt_plan_id: None,
                input: None,
                input_assets: Vec::new(),
            },
        )
        .expect("task should create");
    let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
    database
        .connection()
        .execute(
            "UPDATE generation_tasks SET status = 'running', stage = 'calling-provider' WHERE id = ?1",
            [&task.id],
        )
        .expect("mark task running");
    let service = StartupRecoveryService::new(WorkspaceFileSystem::new());

    let result = service
        .recover_interrupted_tasks(database.connection())
        .expect("running tasks should recover");
    let recovered = generation_service
        .get_task(&workspace_dir, &task.id)
        .expect("task should reload");
    let event_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM task_events WHERE task_id = ?1 AND event_type = 'task.interrupted'",
            [&task.id],
            |row| row.get(0),
        )
        .expect("event count should query");

    assert_eq!(result.interrupted_tasks, 1);
    assert_eq!(recovered.status.as_str(), "interrupted");
    assert_eq!(recovered.stage.as_str(), "failed");
    assert_eq!(
        recovered.error.as_ref().map(|error| error.code.as_str()),
        Some("TASK_INTERRUPTED")
    );
    assert_eq!(event_count, 1);

    remove_workspace(&workspace_dir);
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
    std::env::temp_dir().join(format!("commerce-shoot-studio-recovery-{label}-{nanos}"))
}

fn remove_workspace(path: &Path) {
    let _ = fs::remove_dir_all(path);
}
