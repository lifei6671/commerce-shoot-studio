use serde::Serialize;

use crate::domain::generation::{GenerationError, GenerationTask, GenerationTaskDetail};
use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::generation::{
    CreateGenerationTaskInput, DeleteGenerationResultImageInput, GenerationService,
    GenerationTaskPage, GenerationTaskQuery, ReplaceGenerationResultImageInput,
    RetryGenerationTaskInput,
};
use crate::services::local_task_executor::{LocalTaskExecutionResult, LocalTaskExecutor};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationTaskPageDto {
    items: Vec<GenerationTask>,
    page: i64,
    page_size: i64,
    total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationCommandError {
    code: String,
    message: String,
    retryable: bool,
}

#[tauri::command]
pub fn generation_create_task(
    input: CreateGenerationTaskInput,
) -> Result<GenerationTask, GenerationCommandError> {
    GenerationService::new()
        .create_task(&default_workspace_directory(), input)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_retry_task(
    input: RetryGenerationTaskInput,
) -> Result<GenerationTask, GenerationCommandError> {
    GenerationService::new()
        .retry_task(&default_workspace_directory(), input)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_cancel_task(task_id: String) -> Result<GenerationTask, GenerationCommandError> {
    GenerationService::new()
        .cancel_task(&default_workspace_directory(), &task_id)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_delete_task(task_id: String) -> Result<(), GenerationCommandError> {
    GenerationService::new()
        .delete_task(&default_workspace_directory(), &task_id)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_replace_result_image(
    input: ReplaceGenerationResultImageInput,
) -> Result<(), GenerationCommandError> {
    GenerationService::new()
        .replace_result_image(&default_workspace_directory(), input)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_delete_result_image(
    input: DeleteGenerationResultImageInput,
) -> Result<(), GenerationCommandError> {
    GenerationService::new()
        .delete_result_image(&default_workspace_directory(), input)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_get_task(task_id: String) -> Result<GenerationTask, GenerationCommandError> {
    GenerationService::new()
        .get_task(&default_workspace_directory(), &task_id)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_get_task_detail(
    task_id: String,
) -> Result<GenerationTaskDetail, GenerationCommandError> {
    GenerationService::new()
        .get_task_detail(&default_workspace_directory(), &task_id)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub fn generation_list_tasks(
    query: Option<GenerationTaskQuery>,
) -> Result<GenerationTaskPageDto, GenerationCommandError> {
    GenerationService::new()
        .list_tasks(&default_workspace_directory(), query.unwrap_or_default())
        .map(GenerationTaskPageDto::from)
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub async fn generation_run_next_task(
) -> Result<Option<LocalTaskExecutionResult>, GenerationCommandError> {
    LocalTaskExecutor::background()
        .start_next_async(&default_workspace_directory())
        .map_err(GenerationCommandError::from)
}

#[tauri::command]
pub async fn generation_run_task(
    task_id: String,
) -> Result<Option<LocalTaskExecutionResult>, GenerationCommandError> {
    LocalTaskExecutor::background()
        .start_task_async(&default_workspace_directory(), &task_id)
        .map_err(GenerationCommandError::from)
}

impl From<GenerationTaskPage> for GenerationTaskPageDto {
    fn from(page: GenerationTaskPage) -> Self {
        Self {
            items: page.items,
            page: page.page,
            page_size: page.page_size,
            total: page.total,
        }
    }
}

impl From<GenerationError> for GenerationCommandError {
    fn from(error: GenerationError) -> Self {
        match error {
            GenerationError::RetryRequired(normalized) => Self {
                code: normalized.code,
                message: normalized.message,
                retryable: normalized.retryable,
            },
            GenerationError::NotFound(_) => Self {
                code: "VALIDATION_ERROR".to_string(),
                message: error.to_string(),
                retryable: false,
            },
            GenerationError::Validation(_) | GenerationError::InvalidValue(_) => Self {
                code: "VALIDATION_ERROR".to_string(),
                message: error.to_string(),
                retryable: false,
            },
            GenerationError::Database(_) | GenerationError::Serde(_) => Self {
                code: "UNKNOWN_ERROR".to_string(),
                message: error.to_string(),
                retryable: false,
            },
        }
    }
}
