use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use serde_json::json;

use crate::domain::generation::{GenerationTaskStage, NormalizedTaskError};
use crate::domain::workspace::WorkspaceError;
use crate::infrastructure::database::DatabaseError;
use crate::infrastructure::filesystem::WorkspaceFileSystem;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartupRecoveryResult {
    pub interrupted_tasks: usize,
    pub deleted_temp_files: usize,
}

#[derive(Debug)]
pub enum StartupRecoveryError {
    Workspace(WorkspaceError),
    Database(DatabaseError),
}

impl std::fmt::Display for StartupRecoveryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StartupRecoveryError::Workspace(source) => write!(formatter, "{source}"),
            StartupRecoveryError::Database(source) => write!(formatter, "{source}"),
        }
    }
}

impl std::error::Error for StartupRecoveryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StartupRecoveryError::Workspace(source) => Some(source),
            StartupRecoveryError::Database(source) => Some(source),
        }
    }
}

impl From<WorkspaceError> for StartupRecoveryError {
    fn from(source: WorkspaceError) -> Self {
        StartupRecoveryError::Workspace(source)
    }
}

impl From<DatabaseError> for StartupRecoveryError {
    fn from(source: DatabaseError) -> Self {
        StartupRecoveryError::Database(source)
    }
}

#[derive(Debug, Clone)]
pub struct StartupRecoveryService {
    file_system: WorkspaceFileSystem,
}

impl StartupRecoveryService {
    pub fn new(file_system: WorkspaceFileSystem) -> Self {
        Self { file_system }
    }

    pub fn recover_interrupted_tasks(
        &self,
        connection: &Connection,
    ) -> Result<StartupRecoveryResult, StartupRecoveryError> {
        if !table_exists(connection, "generation_tasks")? {
            return Ok(StartupRecoveryResult {
                interrupted_tasks: 0,
                deleted_temp_files: 0,
            });
        }

        let running_task_ids = running_task_ids(connection)?;
        for task_id in &running_task_ids {
            let error = NormalizedTaskError {
                code: "TASK_INTERRUPTED".to_string(),
                message: "应用上次退出时任务仍在执行，已标记为中断。".to_string(),
                retryable: true,
                stage: Some(GenerationTaskStage::Failed),
                provider_status_code: None,
                provider_error_code: None,
            };
            let error_json = serde_json::to_string(&error).map_err(|source| {
                StartupRecoveryError::Database(DatabaseError::Sqlite(
                    rusqlite::Error::ToSqlConversionFailure(Box::new(source)),
                ))
            })?;
            connection
                .execute(
                    "
                    UPDATE generation_tasks
                    SET status = 'interrupted',
                        stage = 'failed',
                        error_json = ?1,
                        completed_at = COALESCE(completed_at, datetime('now')),
                        updated_at = datetime('now')
                    WHERE id = ?2 AND status = 'running'
                    ",
                    (error_json, task_id),
                )
                .map_err(DatabaseError::from)?;
            insert_recovery_event(connection, task_id)?;
        }

        Ok(StartupRecoveryResult {
            interrupted_tasks: running_task_ids.len(),
            deleted_temp_files: 0,
        })
    }

    pub fn cleanup_orphan_temp_files(
        &self,
        workspace_directory: &PathBuf,
    ) -> Result<StartupRecoveryResult, StartupRecoveryError> {
        self.file_system
            .create_required_directories(workspace_directory)?;
        let tmp_directory = workspace_directory.join("cache/tmp");
        let mut deleted_temp_files = 0;

        for entry in fs::read_dir(&tmp_directory).map_err(|source| WorkspaceError::Io {
            path: tmp_directory.clone(),
            source,
        })? {
            let entry = entry.map_err(|source| WorkspaceError::Io {
                path: tmp_directory.clone(),
                source,
            })?;
            let path = entry.path();

            if path.is_dir() {
                let removed_files = count_files_recursively(&path)?;
                fs::remove_dir_all(&path).map_err(|source| WorkspaceError::Io {
                    path: path.clone(),
                    source,
                })?;
                deleted_temp_files += removed_files;
                continue;
            }

            fs::remove_file(&path).map_err(|source| WorkspaceError::Io {
                path: path.clone(),
                source,
            })?;
            deleted_temp_files += 1;
        }

        Ok(StartupRecoveryResult {
            interrupted_tasks: 0,
            deleted_temp_files,
        })
    }
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool, StartupRecoveryError> {
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table_name],
            |row| row.get(0),
        )
        .map_err(DatabaseError::from)?;
    Ok(exists > 0)
}

fn running_task_ids(connection: &Connection) -> Result<Vec<String>, StartupRecoveryError> {
    let mut statement = connection
        .prepare("SELECT id FROM generation_tasks WHERE status = 'running' ORDER BY created_at ASC")
        .map_err(DatabaseError::from)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(DatabaseError::from)?;
    let mut task_ids = Vec::new();

    for row in rows {
        task_ids.push(row.map_err(DatabaseError::from)?);
    }

    Ok(task_ids)
}

fn insert_recovery_event(
    connection: &Connection,
    task_id: &str,
) -> Result<(), StartupRecoveryError> {
    let detail_json = json!({
        "normalized_error_code": "TASK_INTERRUPTED",
        "retryable": true,
    })
    .to_string();
    connection
        .execute(
            "
            INSERT INTO task_events (id, task_id, event_type, stage, detail_json)
            VALUES (?1, ?2, 'task.interrupted', 'failed', ?3)
            ",
            (create_recovery_event_id(task_id), task_id, detail_json),
        )
        .map_err(DatabaseError::from)?;
    Ok(())
}

fn create_recovery_event_id(task_id: &str) -> String {
    format!("event_recovery_{task_id}")
}

fn count_files_recursively(path: &PathBuf) -> Result<usize, StartupRecoveryError> {
    let mut count = 0;

    for entry in fs::read_dir(path).map_err(|source| WorkspaceError::Io {
        path: path.clone(),
        source,
    })? {
        let entry = entry.map_err(|source| WorkspaceError::Io {
            path: path.clone(),
            source,
        })?;
        let child_path = entry.path();

        if child_path.is_dir() {
            count += count_files_recursively(&child_path)?;
        } else {
            count += 1;
        }
    }

    Ok(count)
}
