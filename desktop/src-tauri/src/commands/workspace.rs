use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::domain::workspace::WorkspaceStatus;
use crate::infrastructure::filesystem::WorkspaceFileSystem;
use crate::services::assets::AssetService;
use crate::services::workspace::{InitializeWorkspaceInput, WorkspaceService};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatusDto {
    pub initialized: bool,
    pub workspace_directory: String,
    pub database_path: String,
    pub warnings: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GarbageCollectionResultDto {
    pub deleted_files: i64,
    pub reclaimed_bytes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStorageUsageDto {
    pub asset_bytes: u64,
    pub cache_bytes: u64,
    pub export_bytes: u64,
    pub log_bytes: u64,
    pub total_bytes: u64,
}

#[tauri::command]
pub fn workspace_get_status() -> WorkspaceStatusDto {
    let service = workspace_service();
    let workspace_directory = service.default_workspace_directory();
    WorkspaceStatusDto::from_status(service.get_workspace_status(workspace_directory))
}

#[tauri::command]
pub fn workspace_initialize(workspace_directory: String) -> Result<WorkspaceStatusDto, String> {
    let workspace_directory = PathBuf::from(workspace_directory);
    let status = workspace_service()
        .initialize_workspace(InitializeWorkspaceInput {
            workspace_directory,
        })
        .map_err(|error| error.to_string())?;

    Ok(WorkspaceStatusDto::from_status(status))
}

#[tauri::command]
pub fn workspace_run_garbage_collection() -> Result<GarbageCollectionResultDto, String> {
    let workspace_directory = workspace_service().default_workspace_directory();
    AssetService::new()
        .run_garbage_collection(&workspace_directory)
        .map(|result| GarbageCollectionResultDto {
            deleted_files: result.deleted_files,
            reclaimed_bytes: result.reclaimed_bytes,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_get_storage_usage() -> Result<WorkspaceStorageUsageDto, String> {
    let service = workspace_service();
    let workspace_directory = service.default_workspace_directory();
    service
        .get_storage_usage(&workspace_directory)
        .map(|usage| WorkspaceStorageUsageDto {
            asset_bytes: usage.asset_bytes,
            cache_bytes: usage.cache_bytes,
            export_bytes: usage.export_bytes,
            log_bytes: usage.log_bytes,
            total_bytes: usage.total_bytes,
        })
        .map_err(|error| error.to_string())
}

impl WorkspaceStatusDto {
    fn from_status(status: WorkspaceStatus) -> Self {
        let database_path = status.workspace_directory.join("workspace.db");

        Self {
            initialized: status.initialized,
            workspace_directory: status.workspace_directory.to_string_lossy().to_string(),
            database_path: database_path.to_string_lossy().to_string(),
            warnings: status.warnings,
            updated_at: current_timestamp_string(),
        }
    }
}

fn workspace_service() -> WorkspaceService {
    WorkspaceService::new(WorkspaceFileSystem::new())
}

fn current_timestamp_string() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => format!("unix:{}", duration.as_secs()),
        Err(_) => "unix:0".to_string(),
    }
}
