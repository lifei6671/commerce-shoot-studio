use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use commerce_shoot_studio_lib::domain::generation::{
    GenerationTaskKind, GenerationTaskStatus, WorkspaceKind,
};
use commerce_shoot_studio_lib::infrastructure::filesystem::WorkspaceFileSystem;
use commerce_shoot_studio_lib::services::generation::{
    CreateGenerationTaskInput, GenerationService,
};
use commerce_shoot_studio_lib::services::settings::SettingsService;
use commerce_shoot_studio_lib::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[test]
fn initialize_workspace_creates_required_directory_structure() {
    let workspace_dir = unique_temp_workspace("initialize");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());

    let status = service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");

    assert!(status.initialized);
    assert_eq!(status.workspace_directory, workspace_dir);
    assert!(status.warnings.is_empty());
    for relative_dir in required_workspace_dirs() {
        assert!(
            workspace_dir.join(relative_dir).is_dir(),
            "missing workspace directory: {relative_dir}",
        );
    }

    remove_workspace(&workspace_dir);
}

#[test]
fn initialize_workspace_creates_workspace_database() {
    let workspace_dir = unique_temp_workspace("initialize-db");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());

    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");

    assert!(
        workspace_dir.join("workspace.db").is_file(),
        "workspace initialization should create workspace.db before UI can enter main screen",
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn initialize_workspace_confirms_default_settings_paths() {
    let workspace_dir = unique_temp_workspace("initialize-settings");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());

    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    let settings = SettingsService::new()
        .get_settings(&workspace_dir)
        .expect("settings should load");

    assert_eq!(
        settings.workspace_directory(),
        Some(workspace_dir.to_string_lossy().as_ref())
    );
    assert_eq!(
        settings.output_directory(),
        Some(workspace_dir.join("exports").to_string_lossy().as_ref())
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn get_storage_usage_counts_workspace_directories() {
    let workspace_dir = unique_temp_workspace("storage-usage");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());

    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    fs::write(workspace_dir.join("assets/source/source.bin"), [0_u8; 3]).expect("write asset");
    fs::write(workspace_dir.join("cache/tmp/tmp.bin"), [0_u8; 5]).expect("write cache");
    fs::write(workspace_dir.join("exports/export.bin"), [0_u8; 7]).expect("write export");
    fs::write(workspace_dir.join("logs/app.log"), [0_u8; 11]).expect("write log");

    let usage = service
        .get_storage_usage(&workspace_dir)
        .expect("storage usage should load");

    assert_eq!(usage.asset_bytes, 3);
    assert_eq!(usage.cache_bytes, 5);
    assert_eq!(usage.export_bytes, 7);
    assert_eq!(usage.log_bytes, 11);
    assert_eq!(usage.total_bytes, 26);

    remove_workspace(&workspace_dir);
}

#[test]
fn initialize_workspace_recovers_running_tasks() {
    let workspace_dir = unique_temp_workspace("initialize-recovery");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());
    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    let generation_service = GenerationService::new();
    let task = generation_service
        .create_task(
            &workspace_dir,
            CreateGenerationTaskInput {
                idempotency_key: Some("workspace-recovery-1".to_string()),
                workspace: WorkspaceKind::Scene,
                kind: GenerationTaskKind::ImageGeneration,
                title: "启动恢复任务".to_string(),
                prompt_plan_id: None,
                input: None,
                input_assets: Vec::new(),
            },
        )
        .expect("task should create");
    commerce_shoot_studio_lib::infrastructure::database::WorkspaceDatabase::open(&workspace_dir)
        .expect("database should open")
        .connection()
        .execute(
            "UPDATE generation_tasks SET status = 'running', stage = 'calling-provider' WHERE id = ?1",
            [&task.id],
        )
        .expect("mark task running");

    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should reinitialize");
    let recovered = generation_service
        .get_task(&workspace_dir, &task.id)
        .expect("task should reload");

    assert_eq!(recovered.status, GenerationTaskStatus::Interrupted);

    remove_workspace(&workspace_dir);
}

#[test]
fn get_workspace_status_requires_workspace_database() {
    let workspace_dir = unique_temp_workspace("status-db");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());
    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    fs::remove_file(workspace_dir.join("workspace.db")).expect("remove workspace database");

    let status = service.get_workspace_status(workspace_dir.clone());

    assert!(!status.initialized);

    remove_workspace(&workspace_dir);
}

#[test]
fn repair_workspace_recreates_missing_directories() {
    let workspace_dir = unique_temp_workspace("repair");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());
    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    fs::remove_dir_all(workspace_dir.join("assets/generated"))
        .expect("remove generated assets dir");

    let repair_result = service
        .repair_workspace(&workspace_dir)
        .expect("workspace should repair");

    assert!(repair_result.repaired);
    assert!(workspace_dir.join("assets/generated").is_dir());
    assert!(
        repair_result
            .messages
            .iter()
            .any(|message| message.contains("assets/generated")),
        "repair should describe recreated directory",
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn repair_workspace_recreates_missing_database() {
    let workspace_dir = unique_temp_workspace("repair-db");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());
    service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize");
    fs::remove_file(workspace_dir.join("workspace.db")).expect("remove workspace database");

    let repair_result = service
        .repair_workspace(&workspace_dir)
        .expect("workspace should repair database");

    assert!(repair_result.repaired);
    assert!(workspace_dir.join("workspace.db").is_file());
    assert!(
        repair_result
            .messages
            .iter()
            .any(|message| message.contains("workspace.db")),
        "repair should describe recreated database",
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn initialize_workspace_warns_for_cloud_sync_directory() {
    let workspace_dir = unique_temp_workspace("OneDrive");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());

    let status = service
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory: workspace_dir.clone(),
        })
        .expect("workspace should initialize with warning");

    assert!(status.initialized);
    assert!(
        status
            .warnings
            .iter()
            .any(|warning| warning.contains("云同步目录")),
        "cloud sync workspace should return a visible warning",
    );

    remove_workspace(&workspace_dir);
}

#[test]
fn initialize_workspace_fails_when_required_directory_is_a_file() {
    let workspace_dir = unique_temp_workspace("file-conflict");
    fs::create_dir_all(workspace_dir.join("assets")).expect("create assets parent");
    fs::write(workspace_dir.join("assets/generated"), b"not a directory")
        .expect("write conflicting file");
    let service = WorkspaceService::new(WorkspaceFileSystem::new());

    let result = service.initialize_workspace(InitializeWorkspaceInput {
        workspace_directory: workspace_dir.clone(),
    });

    assert!(
        result.is_err(),
        "workspace initialization must fail fast when a required directory is occupied by a file",
    );

    remove_workspace(&workspace_dir);
}

fn required_workspace_dirs() -> [&'static str; 9] {
    [
        "assets/source",
        "assets/reference",
        "assets/model",
        "assets/generated",
        "assets/thumbnail",
        "cache/tmp",
        "exports",
        "logs",
        ".",
    ]
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
