use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::workspace::WorkspaceError;
use crate::domain::workspace::{WorkspaceRepairResult, WorkspaceStatus};
use crate::infrastructure::database::{DatabaseError, WorkspaceDatabase};
use crate::infrastructure::filesystem::{default_workspace_directory, WorkspaceFileSystem};
use crate::services::settings::{SettingsService, SettingsServiceError};
use crate::services::startup_recovery::{StartupRecoveryError, StartupRecoveryService};

#[derive(Debug, Clone)]
pub struct InitializeWorkspaceInput {
    pub workspace_directory: PathBuf,
}

#[derive(Debug)]
pub enum WorkspaceServiceError {
    Workspace(WorkspaceError),
    Database(DatabaseError),
    Settings(SettingsServiceError),
    StartupRecovery(StartupRecoveryError),
    Io(std::io::Error),
}

impl std::fmt::Display for WorkspaceServiceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WorkspaceServiceError::Workspace(source) => write!(formatter, "{source}"),
            WorkspaceServiceError::Database(source) => write!(formatter, "{source}"),
            WorkspaceServiceError::Settings(source) => write!(formatter, "{source}"),
            WorkspaceServiceError::StartupRecovery(source) => write!(formatter, "{source}"),
            WorkspaceServiceError::Io(source) => {
                write!(formatter, "读取工作区存储占用失败：{source}")
            }
        }
    }
}

impl std::error::Error for WorkspaceServiceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            WorkspaceServiceError::Workspace(source) => Some(source),
            WorkspaceServiceError::Database(source) => Some(source),
            WorkspaceServiceError::Settings(source) => Some(source),
            WorkspaceServiceError::StartupRecovery(source) => Some(source),
            WorkspaceServiceError::Io(source) => Some(source),
        }
    }
}

impl From<WorkspaceError> for WorkspaceServiceError {
    fn from(source: WorkspaceError) -> Self {
        WorkspaceServiceError::Workspace(source)
    }
}

impl From<DatabaseError> for WorkspaceServiceError {
    fn from(source: DatabaseError) -> Self {
        WorkspaceServiceError::Database(source)
    }
}

impl From<StartupRecoveryError> for WorkspaceServiceError {
    fn from(source: StartupRecoveryError) -> Self {
        WorkspaceServiceError::StartupRecovery(source)
    }
}

impl From<SettingsServiceError> for WorkspaceServiceError {
    fn from(source: SettingsServiceError) -> Self {
        WorkspaceServiceError::Settings(source)
    }
}

impl From<std::io::Error> for WorkspaceServiceError {
    fn from(source: std::io::Error) -> Self {
        WorkspaceServiceError::Io(source)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceStorageUsage {
    pub asset_bytes: u64,
    pub cache_bytes: u64,
    pub export_bytes: u64,
    pub log_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct WorkspaceService {
    file_system: WorkspaceFileSystem,
}

impl WorkspaceService {
    pub fn new(file_system: WorkspaceFileSystem) -> Self {
        Self { file_system }
    }

    pub fn default_workspace_directory(&self) -> PathBuf {
        default_workspace_directory()
    }

    pub fn initialize_workspace(
        &self,
        input: InitializeWorkspaceInput,
    ) -> Result<WorkspaceStatus, WorkspaceServiceError> {
        self.file_system
            .create_required_directories(&input.workspace_directory)?;
        let database = WorkspaceDatabase::open(&input.workspace_directory)?;
        SettingsService::new().ensure_initialized_settings(&input.workspace_directory)?;
        let recovery = StartupRecoveryService::new(self.file_system.clone());
        recovery.recover_interrupted_tasks(database.connection())?;
        recovery.cleanup_orphan_temp_files(&input.workspace_directory)?;

        Ok(WorkspaceStatus {
            initialized: true,
            warnings: self.workspace_warnings(&input.workspace_directory),
            workspace_directory: input.workspace_directory,
        })
    }

    pub fn get_workspace_status(&self, workspace_directory: PathBuf) -> WorkspaceStatus {
        let initialized = workspace_directory.is_dir()
            && workspace_directory.join("workspace.db").is_file()
            && self
                .file_system
                .missing_required_directories(&workspace_directory)
                .is_empty();

        WorkspaceStatus {
            initialized,
            warnings: self.workspace_warnings(&workspace_directory),
            workspace_directory,
        }
    }

    pub fn repair_workspace(
        &self,
        workspace_directory: &PathBuf,
    ) -> Result<WorkspaceRepairResult, WorkspaceServiceError> {
        let missing_before_repair = self
            .file_system
            .missing_required_directories(workspace_directory);
        let database_existed = workspace_directory.join("workspace.db").is_file();
        let created = self
            .file_system
            .create_required_directories(workspace_directory)?;
        WorkspaceDatabase::open(workspace_directory)?;

        let mut messages: Vec<String> = created
            .into_iter()
            .map(|relative_directory| format!("已补齐工作区目录：{relative_directory}"))
            .collect();

        if !database_existed {
            messages.push("已重新创建 workspace.db 并执行 SQLite 初始化。".to_string());
        }

        Ok(WorkspaceRepairResult {
            repaired: !missing_before_repair.is_empty() || !messages.is_empty(),
            messages,
        })
    }

    pub fn get_storage_usage(
        &self,
        workspace_directory: &Path,
    ) -> Result<WorkspaceStorageUsage, WorkspaceServiceError> {
        let asset_bytes = directory_size(&workspace_directory.join("assets"))?;
        let cache_bytes = directory_size(&workspace_directory.join("cache"))?;
        let export_bytes = directory_size(&workspace_directory.join("exports"))?;
        let log_bytes = directory_size(&workspace_directory.join("logs"))?;

        Ok(WorkspaceStorageUsage {
            asset_bytes,
            cache_bytes,
            export_bytes,
            log_bytes,
            total_bytes: asset_bytes + cache_bytes + export_bytes + log_bytes,
        })
    }

    fn workspace_warnings(&self, workspace_directory: &PathBuf) -> Vec<String> {
        if self
            .file_system
            .is_cloud_sync_directory(workspace_directory)
        {
            return vec![
                "当前工作区疑似位于云同步目录，SQLite WAL 文件可能被同步进程锁定。".to_string(),
            ];
        }

        Vec::new()
    }
}

fn directory_size(path: &Path) -> Result<u64, WorkspaceServiceError> {
    if !path.exists() {
        return Ok(0);
    }

    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Ok(0);
    }

    let mut total = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        total += directory_size(&entry.path())?;
    }
    Ok(total)
}
