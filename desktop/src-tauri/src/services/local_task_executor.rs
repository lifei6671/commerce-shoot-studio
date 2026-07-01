use std::path::Path;
use std::str::FromStr;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::domain::generation::{
    GenerationError, GenerationTaskKind, GenerationTaskStage, NormalizedTaskError, WorkspaceKind,
};
use crate::infrastructure::database::WorkspaceDatabase;
use crate::services::generation::insert_task_event;
use crate::services::model_gateway::{ModelGatewayRequest, ModelGatewayService};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTaskExecutionResult {
    pub task_id: String,
    pub invocation_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct LocalTaskExecutor {
    max_concurrent_tasks: usize,
}

impl LocalTaskExecutor {
    pub fn new() -> Self {
        Self {
            max_concurrent_tasks: 1,
        }
    }

    pub fn run_next(
        &self,
        workspace_directory: &Path,
    ) -> Result<Option<LocalTaskExecutionResult>, GenerationError> {
        if self.running_task_count(workspace_directory)? >= self.max_concurrent_tasks {
            return Ok(None);
        }

        let Some(task) = claim_next_queued_task(workspace_directory)? else {
            return Ok(None);
        };

        execute_claimed_task(workspace_directory, task).map(Some)
    }

    fn running_task_count(&self, workspace_directory: &Path) -> Result<usize, GenerationError> {
        let database = WorkspaceDatabase::open(workspace_directory)?;
        let count: i64 = database.connection().query_row(
            "SELECT COUNT(*) FROM generation_tasks WHERE status = 'running'",
            [],
            |row| row.get(0),
        )?;
        Ok(count.max(0) as usize)
    }
}

#[derive(Debug, Clone)]
struct ClaimedTask {
    id: String,
    workspace: WorkspaceKind,
    kind: GenerationTaskKind,
    input: serde_json::Value,
}

fn claim_next_queued_task(
    workspace_directory: &Path,
) -> Result<Option<ClaimedTask>, GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    let task = database
        .connection()
        .query_row(
            "
            SELECT id, workspace, kind, input_json
            FROM generation_tasks
            WHERE status = 'queued' AND hidden_at IS NULL
            ORDER BY datetime(created_at) ASC, id ASC
            LIMIT 1
            ",
            [],
            |row| {
                let workspace: String = row.get(1)?;
                let kind: String = row.get(2)?;
                let input_json: Option<String> = row.get(3)?;
                Ok(ClaimedTask {
                    id: row.get(0)?,
                    workspace: parse_generation_value(1, &workspace)?,
                    kind: parse_generation_value(2, &kind)?,
                    input: deserialize_input_json(3, input_json)?,
                })
            },
        )
        .optional()?;

    let Some(task) = task else {
        return Ok(None);
    };
    let updated = database.connection().execute(
        "
        UPDATE generation_tasks
        SET status = 'running',
            stage = 'validating',
            updated_at = datetime('now')
        WHERE id = ?1 AND status = 'queued'
        ",
        params![task.id],
    )?;
    if updated == 0 {
        return Ok(None);
    }
    insert_task_event(
        &database,
        &task.id,
        "task.started",
        Some(GenerationTaskStage::Validating),
        Some(json!({ "max_concurrent_tasks": 1 })),
    )?;

    Ok(Some(task))
}

fn execute_claimed_task(
    workspace_directory: &Path,
    task: ClaimedTask,
) -> Result<LocalTaskExecutionResult, GenerationError> {
    update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::CallingProvider,
        "task.provider-called",
        None,
    )?;
    let capability_id = capability_for_task(task.workspace, task.kind);
    let gateway_result = match ModelGatewayService::new().invoke(
        workspace_directory,
        ModelGatewayRequest {
            capability_id: capability_id.to_string(),
            input: task.input,
        },
    ) {
        Ok(result) => result,
        Err(source) => {
            let error = NormalizedTaskError {
                code: "MODEL_CAPABILITY_UNAVAILABLE".to_string(),
                message: source.to_string(),
                retryable: false,
                stage: Some(GenerationTaskStage::Failed),
                provider_status_code: None,
                provider_error_code: None,
            };
            mark_task_failed(workspace_directory, &task.id, &error)?;
            return Ok(LocalTaskExecutionResult {
                task_id: task.id,
                invocation_id: None,
            });
        }
    };
    let database = WorkspaceDatabase::open(workspace_directory)?;
    database.connection().execute(
        "
        UPDATE generation_tasks
        SET status = 'succeeded',
            stage = 'completed',
            completed_at = COALESCE(completed_at, datetime('now')),
            updated_at = datetime('now')
        WHERE id = ?1
        ",
        params![task.id],
    )?;
    insert_task_event(
        &database,
        &task.id,
        "task.succeeded",
        Some(GenerationTaskStage::Completed),
        Some(json!({
            "invocation_id": gateway_result.invocation_id,
            "provider_profile_id": gateway_result.provider_profile_id,
            "model": gateway_result.model,
        })),
    )?;

    Ok(LocalTaskExecutionResult {
        task_id: task.id,
        invocation_id: Some(gateway_result.invocation_id),
    })
}

fn mark_task_failed(
    workspace_directory: &Path,
    task_id: &str,
    error: &NormalizedTaskError,
) -> Result<(), GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    let error_json = serde_json::to_string(error)?;
    database.connection().execute(
        "
        UPDATE generation_tasks
        SET status = 'failed',
            stage = 'failed',
            error_json = ?1,
            completed_at = COALESCE(completed_at, datetime('now')),
            updated_at = datetime('now')
        WHERE id = ?2
        ",
        params![error_json, task_id],
    )?;
    insert_task_event(
        &database,
        task_id,
        "task.failed",
        Some(GenerationTaskStage::Failed),
        Some(json!({
            "normalized_error_code": error.code,
            "retryable": error.retryable,
        })),
    )?;
    Ok(())
}

fn update_stage(
    workspace_directory: &Path,
    task_id: &str,
    stage: GenerationTaskStage,
    event_type: &str,
    detail: Option<serde_json::Value>,
) -> Result<(), GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    database.connection().execute(
        "
        UPDATE generation_tasks
        SET stage = ?1,
            updated_at = datetime('now')
        WHERE id = ?2 AND status = 'running'
        ",
        params![stage.as_str(), task_id],
    )?;
    insert_task_event(&database, task_id, event_type, Some(stage), detail)?;
    Ok(())
}

fn capability_for_task(workspace: WorkspaceKind, kind: GenerationTaskKind) -> &'static str {
    match (workspace, kind) {
        (_, GenerationTaskKind::PromptPlan) => "prompt-plan",
        (_, GenerationTaskKind::ImageEdit) => "image-edit",
        (WorkspaceKind::Scene, GenerationTaskKind::ImageGeneration) => "scene-image-generation",
        (WorkspaceKind::Product, GenerationTaskKind::ImageGeneration) => {
            "product-detail-generation"
        }
        (WorkspaceKind::Clothing, GenerationTaskKind::ImageGeneration) => {
            "clothing-tryon-generation"
        }
    }
}

fn deserialize_input_json(
    column: usize,
    value: Option<String>,
) -> Result<serde_json::Value, rusqlite::Error> {
    value
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    column,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()
        .map(|value| value.unwrap_or_else(|| json!({})))
}

fn parse_generation_value<T>(column: usize, value: &str) -> Result<T, rusqlite::Error>
where
    T: FromStr<Err = GenerationError>,
{
    T::from_str(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}
