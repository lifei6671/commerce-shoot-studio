use std::any::Any;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::str::FromStr;
use std::thread;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::domain::errors::{normalize_provider_http_error, normalize_provider_transport_error};
use crate::domain::generation::{
    GenerationError, GenerationTaskKind, GenerationTaskStage, NormalizedTaskError, WorkspaceKind,
};
use crate::infrastructure::database::WorkspaceDatabase;
use crate::services::assets::AssetService;
use crate::services::generation::insert_task_event;
use crate::services::model_config::{
    capability_requires_real_provider, default_config_for_capability, ModelConfigError,
};
use crate::services::model_gateway::{
    ModelGatewayRequest, ModelGatewayResult, ModelGatewayService,
};
use crate::services::prompt_registry::{
    render_prompt_for_roles, render_roleless_prompt, PromptTemplateId,
};

const PROVIDER_RESULT_TIMEOUT_SECONDS: u64 = 30;
const BACKGROUND_TASK_CONCURRENCY: usize = 4;
const PRODUCT_DETAIL_ITEM_CONCURRENCY: usize = 4;

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

enum ProductDetailItemExecution {
    Succeeded {
        index: usize,
        gateway_result: ModelGatewayResult,
    },
    Failed {
        index: usize,
        error: GenerationError,
    },
    Skipped,
}

#[derive(Debug)]
enum TaskModelInvocationError {
    Input(GenerationError),
    Local(GenerationError),
    Gateway(ModelConfigError),
}

impl std::fmt::Display for TaskModelInvocationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Input(source) | Self::Local(source) => write!(formatter, "{source}"),
            Self::Gateway(source) => write!(formatter, "{source}"),
        }
    }
}

impl LocalTaskExecutor {
    pub fn new() -> Self {
        Self {
            max_concurrent_tasks: 1,
        }
    }

    pub fn background() -> Self {
        Self {
            max_concurrent_tasks: BACKGROUND_TASK_CONCURRENCY,
        }
    }

    pub fn start_next(
        &self,
        workspace_directory: &Path,
    ) -> Result<Option<LocalTaskExecutionResult>, GenerationError> {
        if self.running_task_count(workspace_directory)? >= self.max_concurrent_tasks {
            return Ok(None);
        }

        let Some(task) = claim_next_queued_task(workspace_directory)? else {
            return Ok(None);
        };

        let task_id = task.id.clone();
        let workspace_directory = workspace_directory.to_path_buf();
        thread::spawn(move || {
            let task_id = task.id.clone();
            let execution_result = panic::catch_unwind(AssertUnwindSafe(|| {
                execute_claimed_task(&workspace_directory, task)
            }));
            let error_message = match execution_result {
                Ok(Ok(_)) => return,
                Ok(Err(source)) => source.to_string(),
                Err(payload) => format!(
                    "后台任务异常退出：{}",
                    panic_payload_message(payload.as_ref())
                ),
            };
            let error = NormalizedTaskError {
                code: "LOCAL_TASK_EXECUTION_FAILED".to_string(),
                message: error_message,
                retryable: true,
                stage: Some(GenerationTaskStage::Failed),
                provider_status_code: None,
                provider_error_code: None,
            };
            let _ = mark_task_failed(&workspace_directory, &task_id, &error);
        });

        Ok(Some(LocalTaskExecutionResult {
            task_id,
            invocation_id: None,
        }))
    }

    pub fn start_task(
        &self,
        workspace_directory: &Path,
        task_id: &str,
    ) -> Result<Option<LocalTaskExecutionResult>, GenerationError> {
        if self.running_task_count(workspace_directory)? >= self.max_concurrent_tasks {
            return Ok(None);
        }

        let Some(task) = claim_queued_task_by_id(workspace_directory, task_id)? else {
            return Ok(None);
        };

        let task_id = task.id.clone();
        let workspace_directory = workspace_directory.to_path_buf();
        thread::spawn(move || {
            let task_id = task.id.clone();
            let execution_result = panic::catch_unwind(AssertUnwindSafe(|| {
                execute_claimed_task(&workspace_directory, task)
            }));
            let error_message = match execution_result {
                Ok(Ok(_)) => return,
                Ok(Err(source)) => source.to_string(),
                Err(payload) => format!(
                    "后台任务异常退出：{}",
                    panic_payload_message(payload.as_ref())
                ),
            };
            let error = NormalizedTaskError {
                code: "LOCAL_TASK_EXECUTION_FAILED".to_string(),
                message: error_message,
                retryable: true,
                stage: Some(GenerationTaskStage::Failed),
                provider_status_code: None,
                provider_error_code: None,
            };
            let _ = mark_task_failed(&workspace_directory, &task_id, &error);
        });

        Ok(Some(LocalTaskExecutionResult {
            task_id,
            invocation_id: None,
        }))
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

    pub fn run_task(
        &self,
        workspace_directory: &Path,
        task_id: &str,
    ) -> Result<Option<LocalTaskExecutionResult>, GenerationError> {
        if self.running_task_count(workspace_directory)? >= self.max_concurrent_tasks {
            return Ok(None);
        }

        let Some(task) = claim_queued_task_by_id(workspace_directory, task_id)? else {
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

fn panic_payload_message(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "未知异常".to_string()
}

#[derive(Debug, Clone)]
struct ClaimedTask {
    id: String,
    workspace: WorkspaceKind,
    kind: GenerationTaskKind,
    input: serde_json::Value,
    input_assets: Vec<ClaimedTaskInputAsset>,
}

#[derive(Debug, Clone)]
struct ClaimedTaskInputAsset {
    asset_id: String,
    role: String,
    sort_order: i64,
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
                    input_assets: Vec::new(),
                })
            },
        )
        .optional()?;

    let Some(mut task) = task else {
        return Ok(None);
    };
    task.input_assets = claimed_task_input_assets(&database, &task.id)?;
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

fn claim_queued_task_by_id(
    workspace_directory: &Path,
    task_id: &str,
) -> Result<Option<ClaimedTask>, GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    let task = database
        .connection()
        .query_row(
            "
            SELECT id, workspace, kind, input_json
            FROM generation_tasks
            WHERE id = ?1 AND status = 'queued' AND hidden_at IS NULL
            LIMIT 1
            ",
            params![task_id],
            |row| {
                let workspace: String = row.get(1)?;
                let kind: String = row.get(2)?;
                let input_json: Option<String> = row.get(3)?;
                Ok(ClaimedTask {
                    id: row.get(0)?,
                    workspace: parse_generation_value(1, &workspace)?,
                    kind: parse_generation_value(2, &kind)?,
                    input: deserialize_input_json(3, input_json)?,
                    input_assets: Vec::new(),
                })
            },
        )
        .optional()?;

    let Some(mut task) = task else {
        return Ok(None);
    };
    task.input_assets = claimed_task_input_assets(&database, &task.id)?;
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

fn claimed_task_input_assets(
    database: &WorkspaceDatabase,
    task_id: &str,
) -> Result<Vec<ClaimedTaskInputAsset>, GenerationError> {
    let mut statement = database.connection().prepare(
        "
        SELECT asset_id, role, sort_order
        FROM generation_task_input_assets
        WHERE task_id = ?1
        ORDER BY sort_order ASC, asset_id ASC
        ",
    )?;
    let rows = statement.query_map(params![task_id], |row| {
        Ok(ClaimedTaskInputAsset {
            asset_id: row.get(0)?,
            role: row.get(1)?,
            sort_order: row.get(2)?,
        })
    })?;
    let mut assets = Vec::new();
    for row in rows {
        assets.push(row?);
    }
    Ok(assets)
}

fn execute_claimed_task(
    workspace_directory: &Path,
    task: ClaimedTask,
) -> Result<LocalTaskExecutionResult, GenerationError> {
    if !update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::CallingProvider,
        "task.provider-called",
        None,
    )? {
        return Ok(LocalTaskExecutionResult {
            task_id: task.id,
            invocation_id: None,
        });
    }
    if is_product_detail_image_task(&task) {
        return execute_product_detail_image_task(workspace_directory, task);
    }

    let gateway_results = match invoke_model_for_task(workspace_directory, &task) {
        Ok(results) => results,
        Err(source) => {
            let error = normalize_model_gateway_task_error(source);
            write_task_execution_diagnostic(task_execution_error_diagnostic(
                &task.id,
                capability_for_claimed_task(&task),
                &error,
            ));
            mark_task_failed(workspace_directory, &task.id, &error)?;
            return Ok(LocalTaskExecutionResult {
                task_id: task.id,
                invocation_id: None,
            });
        }
    };
    let first_invocation_id = gateway_results
        .first()
        .map(|result| result.invocation_id.clone());
    let persist_result = if task.kind == GenerationTaskKind::ListingCopy {
        persist_listing_copy_output(workspace_directory, &task, &gateway_results[0]).map(|_| 0)
    } else if is_clothing_scene_planning_task(&task) {
        persist_structured_model_output(workspace_directory, &task, &gateway_results[0]).map(|_| 0)
    } else if is_clothing_tryon_generation_task(&task) {
        Ok(0)
    } else {
        persist_generated_outputs(workspace_directory, &task, &gateway_results)
    };
    if let Err(_source) = persist_result {
        let error = normalized_persist_error(&task);
        write_task_execution_diagnostic(task_execution_error_diagnostic(
            &task.id,
            capability_for_claimed_task(&task),
            &error,
        ));
        mark_task_failed(workspace_directory, &task.id, &error)?;
        return Ok(LocalTaskExecutionResult {
            task_id: task.id,
            invocation_id: first_invocation_id,
        });
    }
    let invocation_ids = gateway_results
        .iter()
        .map(|result| result.invocation_id.clone())
        .collect::<Vec<_>>();
    mark_task_succeeded(workspace_directory, &task, &invocation_ids, None)?;

    Ok(LocalTaskExecutionResult {
        task_id: task.id,
        invocation_id: first_invocation_id,
    })
}

fn normalize_model_gateway_task_error(source: TaskModelInvocationError) -> NormalizedTaskError {
    let mut error = match source {
        TaskModelInvocationError::Gateway(ModelConfigError::ProviderHttp {
            status_code,
            provider_error_code,
        }) => normalize_provider_http_error(status_code, provider_error_code.as_deref()),
        TaskModelInvocationError::Gateway(ModelConfigError::ProviderTransport(kind)) => {
            normalize_provider_transport_error(kind)
        }
        TaskModelInvocationError::Gateway(source) => NormalizedTaskError {
            code: "MODEL_CAPABILITY_UNAVAILABLE".to_string(),
            message: source.to_string(),
            retryable: false,
            stage: None,
            provider_status_code: None,
            provider_error_code: None,
        },
        TaskModelInvocationError::Input(source) => NormalizedTaskError {
            code: "VALIDATION_ERROR".to_string(),
            message: source.to_string(),
            retryable: false,
            stage: None,
            provider_status_code: None,
            provider_error_code: None,
        },
        TaskModelInvocationError::Local(_) => NormalizedTaskError {
            code: "TASK_EXECUTION_ERROR".to_string(),
            message: "任务执行失败，请重试。".to_string(),
            retryable: true,
            stage: None,
            provider_status_code: None,
            provider_error_code: None,
        },
    };
    error.stage = Some(GenerationTaskStage::Failed);
    error
}

fn write_task_execution_diagnostic(payload: serde_json::Value) {
    eprintln!("[local-task-executor-diagnostic] {payload}");
}

fn task_execution_error_diagnostic(
    task_id: &str,
    capability_id: &str,
    error: &NormalizedTaskError,
) -> serde_json::Value {
    json!({
        "event": "task_execution_error",
        "taskId": task_id,
        "capabilityId": capability_id,
        "errorCode": error.code,
        "retryable": error.retryable,
        "providerStatusCode": error.provider_status_code,
        "providerErrorCode": error.provider_error_code,
    })
}

fn is_product_detail_image_task(task: &ClaimedTask) -> bool {
    task.workspace == WorkspaceKind::Product
        && task.kind == GenerationTaskKind::ImageGeneration
        && task
            .input
            .get("items")
            .and_then(serde_json::Value::as_array)
            .map(|items| !items.is_empty())
            .unwrap_or(false)
}

fn is_clothing_scene_planning_task(task: &ClaimedTask) -> bool {
    task.workspace == WorkspaceKind::Clothing
        && task.kind == GenerationTaskKind::ImageGeneration
        && task.input.get("kind").and_then(serde_json::Value::as_str)
            == Some("clothing-scene-planning")
}

fn is_clothing_tryon_generation_task(task: &ClaimedTask) -> bool {
    task.workspace == WorkspaceKind::Clothing
        && task.kind == GenerationTaskKind::ImageGeneration
        && task.input.get("kind").and_then(serde_json::Value::as_str)
            == Some("clothing-tryon-generation")
}

fn task_is_running(workspace_directory: &Path, task_id: &str) -> Result<bool, GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    let status = database
        .connection()
        .query_row(
            "SELECT status FROM generation_tasks WHERE id = ?1 AND hidden_at IS NULL",
            [task_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    Ok(status.as_deref() == Some("running"))
}

fn execute_product_detail_image_task(
    workspace_directory: &Path,
    task: ClaimedTask,
) -> Result<LocalTaskExecutionResult, GenerationError> {
    let task_input = task_input_with_asset_reference_images(workspace_directory, &task)?;
    let items = task_input
        .get("items")
        .and_then(serde_json::Value::as_array)
        .filter(|items| !items.is_empty())
        .cloned()
        .ok_or_else(|| GenerationError::Validation("商品详情图任务缺少 items。".to_string()))?;
    let capability_id = capability_for_task(task.workspace, task.kind);
    let mut first_invocation_id = None;
    let mut invocation_ids = Vec::new();
    let mut successful_results = Vec::new();
    let mut next_sort_order = 0usize;
    let mut saved_image_count = 0usize;
    let mut failed_item_count = 0usize;

    for batch in product_detail_input_batches(items.len(), PRODUCT_DETAIL_ITEM_CONCURRENCY) {
        let handles = batch
            .map(|index| {
                let workspace_directory = workspace_directory.to_path_buf();
                let task_id = task.id.clone();
                let task_input = task_input.clone();
                let item = items[index].clone();
                let item_count = items.len();
                (
                    index,
                    thread::spawn(move || {
                        execute_product_detail_item_provider_call(
                            &workspace_directory,
                            capability_id,
                            &task_id,
                            &task_input,
                            item,
                            index,
                            item_count,
                        )
                    }),
                )
            })
            .collect::<Vec<_>>();

        for (index, handle) in handles {
            let item_result =
                handle
                    .join()
                    .unwrap_or_else(|_| ProductDetailItemExecution::Failed {
                        index,
                        error: GenerationError::Validation(
                            "商品详情图子任务执行失败。".to_string(),
                        ),
                    });
            match item_result {
                ProductDetailItemExecution::Succeeded {
                    index,
                    gateway_result,
                } => {
                    if first_invocation_id.is_none() {
                        first_invocation_id = Some(gateway_result.invocation_id.clone());
                    }
                    invocation_ids.push(gateway_result.invocation_id.clone());
                    successful_results.push((index, gateway_result));
                }
                ProductDetailItemExecution::Failed { index, error } => {
                    eprintln!(
                        "[local-task-executor] product detail item failed task_id={} item_index={} error={}",
                        task.id, index, error
                    );
                    failed_item_count += 1;
                    insert_task_item_failed_event(workspace_directory, &task.id, index, error)?;
                }
                ProductDetailItemExecution::Skipped => {
                    return Ok(LocalTaskExecutionResult {
                        task_id: task.id.clone(),
                        invocation_id: first_invocation_id,
                    });
                }
            }
        }
    }
    successful_results.sort_by_key(|(index, _)| *index);
    for (index, gateway_result) in successful_results {
        let sort_order_start = product_detail_output_sort_order_start(next_sort_order, index);
        match persist_generated_gateway_result_outputs(
            workspace_directory,
            &task.id,
            &gateway_result,
            sort_order_start,
        ) {
            Ok(count) => {
                saved_image_count += count;
                next_sort_order = sort_order_start + count;
            }
            Err(source) => {
                eprintln!(
                    "[local-task-executor] product detail item persist failed task_id={} item_index={} error={}",
                    task.id, index, source
                );
                failed_item_count += 1;
                insert_task_item_failed_event(workspace_directory, &task.id, index, source)?;
            }
        }
    }

    if saved_image_count == 0 {
        let error = normalized_persist_error(&task);
        eprintln!(
            "[local-task-executor] product detail task saved no images task_id={} failed_item_count={} error={}",
            task.id,
            failed_item_count,
            error.message
        );
        mark_task_failed(workspace_directory, &task.id, &error)?;
        return Ok(LocalTaskExecutionResult {
            task_id: task.id,
            invocation_id: first_invocation_id,
        });
    }

    mark_task_succeeded(
        workspace_directory,
        &task,
        &invocation_ids,
        Some(json!({
            "image_count": saved_image_count,
            "failed_item_count": failed_item_count,
        })),
    )?;
    Ok(LocalTaskExecutionResult {
        task_id: task.id,
        invocation_id: first_invocation_id,
    })
}

fn execute_product_detail_item_provider_call(
    workspace_directory: &Path,
    capability_id: &'static str,
    task_id: &str,
    task_input: &serde_json::Value,
    item: serde_json::Value,
    index: usize,
    item_count: usize,
) -> ProductDetailItemExecution {
    let input = match product_detail_item_gateway_input(task_input, &item, index, item_count) {
        Ok(input) => input,
        Err(error) => {
            return ProductDetailItemExecution::Failed {
                index,
                error: GenerationError::Validation(error),
            };
        }
    };

    match task_is_running(workspace_directory, task_id) {
        Ok(true) => {}
        Ok(false) => return ProductDetailItemExecution::Skipped,
        Err(error) => return ProductDetailItemExecution::Failed { index, error },
    }

    match update_stage(
        workspace_directory,
        task_id,
        GenerationTaskStage::CallingProvider,
        "task.item-provider-called",
        Some(json!({
            "item_index": index,
            "item_count": item_count,
        })),
    ) {
        Ok(true) => {}
        Ok(false) => return ProductDetailItemExecution::Skipped,
        Err(error) => return ProductDetailItemExecution::Failed { index, error },
    }

    let gateway_result = match invoke_model_gateway(workspace_directory, capability_id, input) {
        Ok(gateway_result) => gateway_result,
        Err(error) => {
            return ProductDetailItemExecution::Failed {
                index,
                error: GenerationError::Validation(error.to_string()),
            };
        }
    };

    match update_stage(
        workspace_directory,
        task_id,
        GenerationTaskStage::PollingProvider,
        "task.item-provider-succeeded",
        Some(json!({
            "item_index": index,
            "item_count": item_count,
            "invocation_id": gateway_result.invocation_id.clone(),
        })),
    ) {
        Ok(true) => ProductDetailItemExecution::Succeeded {
            index,
            gateway_result,
        },
        Ok(false) => ProductDetailItemExecution::Skipped,
        Err(error) => ProductDetailItemExecution::Failed { index, error },
    }
}

fn product_detail_input_batches(
    input_count: usize,
    max_concurrency: usize,
) -> Vec<std::ops::Range<usize>> {
    if input_count == 0 {
        return Vec::new();
    }
    let batch_size = max_concurrency.max(1);
    let mut batches = Vec::new();
    let mut start = 0usize;
    while start < input_count {
        let end = (start + batch_size).min(input_count);
        batches.push(start..end);
        start = end;
    }
    batches
}

fn product_detail_output_sort_order_start(next_sort_order: usize, item_index: usize) -> usize {
    next_sort_order.max(item_index)
}

fn invoke_model_for_task(
    workspace_directory: &Path,
    task: &ClaimedTask,
) -> Result<Vec<ModelGatewayResult>, TaskModelInvocationError> {
    let capability_id = capability_for_claimed_task(task);
    let inputs =
        task_gateway_inputs(workspace_directory, task).map_err(TaskModelInvocationError::Input)?;
    invoke_gateway_inputs_for_task(
        workspace_directory,
        task,
        capability_id,
        inputs,
        |capability_id, input| invoke_model_gateway(workspace_directory, capability_id, input),
    )
}

fn invoke_gateway_inputs_for_task<F>(
    workspace_directory: &Path,
    task: &ClaimedTask,
    capability_id: &str,
    inputs: Vec<serde_json::Value>,
    mut invoke: F,
) -> Result<Vec<ModelGatewayResult>, TaskModelInvocationError>
where
    F: FnMut(&str, serde_json::Value) -> Result<ModelGatewayResult, ModelConfigError>,
{
    let mut results = Vec::with_capacity(inputs.len());
    let clothing_tryon = is_clothing_tryon_generation_task(task);
    let item_count = inputs.len();
    let mut next_sort_order = 0usize;
    for (index, input) in inputs.into_iter().enumerate() {
        if clothing_tryon
            && !task_is_running(workspace_directory, &task.id)
                .map_err(TaskModelInvocationError::Local)?
        {
            break;
        }
        if clothing_tryon
            && !update_stage(
                workspace_directory,
                &task.id,
                GenerationTaskStage::CallingProvider,
                "task.item-provider-called",
                Some(json!({
                    "item_index": index,
                    "item_count": item_count,
                })),
            )
            .map_err(TaskModelInvocationError::Local)?
        {
            break;
        }

        let gateway_result =
            invoke(capability_id, input).map_err(TaskModelInvocationError::Gateway)?;
        if clothing_tryon {
            if !update_stage(
                workspace_directory,
                &task.id,
                GenerationTaskStage::PollingProvider,
                "task.item-provider-succeeded",
                Some(json!({
                    "item_index": index,
                    "item_count": item_count,
                    "invocation_id": gateway_result.invocation_id.clone(),
                })),
            )
            .map_err(TaskModelInvocationError::Local)?
            {
                results.push(gateway_result);
                break;
            }
            let sort_order_start = product_detail_output_sort_order_start(next_sort_order, index);
            let saved_count = persist_generated_gateway_result_outputs(
                workspace_directory,
                &task.id,
                &gateway_result,
                sort_order_start,
            )
            .map_err(TaskModelInvocationError::Local)?;
            next_sort_order = sort_order_start + saved_count;
        }
        results.push(gateway_result);
    }
    Ok(results)
}

fn invoke_model_gateway(
    workspace_directory: &Path,
    capability_id: &str,
    input: serde_json::Value,
) -> Result<ModelGatewayResult, ModelConfigError> {
    let request = ModelGatewayRequest {
        capability_id: capability_id.to_string(),
        input,
    };
    let config = default_config_for_capability(workspace_directory, capability_id)?;
    if config.provider_profile_id == "mock-local" {
        if capability_requires_real_provider(capability_id) {
            return Err(ModelConfigError::Validation(
                "没有可用模型，请先在模型配置中为该能力配置并测试真实模型。".to_string(),
            ));
        }
        ModelGatewayService::new().invoke(workspace_directory, request)
    } else {
        ModelGatewayService::new().invoke_real_provider(workspace_directory, request)
    }
}

fn task_gateway_inputs(
    workspace_directory: &Path,
    task: &ClaimedTask,
) -> Result<Vec<serde_json::Value>, GenerationError> {
    let task_input = task_input_with_asset_reference_images(workspace_directory, task)?;
    if is_clothing_scene_planning_task(task) {
        return clothing_scene_planning_gateway_input(&task_input).map(|input| vec![input]);
    }
    if is_clothing_base_model_generation_task(task) {
        return clothing_base_model_gateway_input(&task_input).map(|input| vec![input]);
    }
    if is_clothing_tryon_generation_task(task) {
        let items = task_input
            .get("items")
            .and_then(serde_json::Value::as_array)
            .filter(|items| !items.is_empty())
            .ok_or_else(|| {
                GenerationError::Validation(
                    "服饰出图任务必须至少包含 1 个已选择的场景动作。".to_string(),
                )
            })?;
        return items
            .iter()
            .enumerate()
            .map(|(index, item)| clothing_tryon_item_gateway_input(&task_input, item, index))
            .collect();
    }
    if task.workspace == WorkspaceKind::Product && task.kind == GenerationTaskKind::ImageGeneration
    {
        if let Some(items) = task_input
            .get("items")
            .and_then(serde_json::Value::as_array)
        {
            if !items.is_empty() {
                return items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        product_detail_item_gateway_input(&task_input, item, index, items.len())
                            .map_err(GenerationError::Validation)
                    })
                    .collect();
            }
        }
    }

    Ok(vec![task_input])
}

fn clothing_scene_planning_gateway_input(
    task_input: &serde_json::Value,
) -> Result<serde_json::Value, GenerationError> {
    let (reference_image_roles, clothing_reference_labels, model_reference_label) =
        clothing_reference_prompt_values(task_input)?;
    let selected_scenes = task_input
        .get("selectedScenes")
        .and_then(serde_json::Value::as_array)
        .map(|scenes| {
            scenes
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("、")
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "未选择，需由 AI 根据服装特点规划 4 个场景".to_string());
    let custom_scene = read_prompt_field(task_input, "customScene", "无");
    let ai_recommended = task_input
        .get("aiRecommended")
        .and_then(serde_json::Value::as_bool)
        .map(|value| if value { "是" } else { "否" })
        .unwrap_or("否");
    let ratio = read_prompt_field(task_input, "ratio", "3:4");
    let replacement_pairs = [
        ("{{referenceImageRoles}}", reference_image_roles.as_str()),
        (
            "{{clothingReferenceLabels}}",
            clothing_reference_labels.as_str(),
        ),
        ("{{modelReferenceLabel}}", model_reference_label.as_str()),
        ("{{selectedScenes}}", selected_scenes.as_str()),
        ("{{customScene}}", custom_scene.as_str()),
        ("{{aiRecommended}}", ai_recommended),
        ("{{ratio}}", ratio.as_str()),
    ];

    let messages = render_prompt_for_roles(PromptTemplateId::ClothingScenePlanning)
        .map_err(|source| GenerationError::Validation(source.to_string()))?
        .into_iter()
        .map(|message| {
            let content = replace_prompt_placeholders(message.content, &replacement_pairs);
            json!({
                "role": message.role,
                "content": content,
            })
        })
        .collect::<Vec<_>>();
    let roleless_prompt = replace_prompt_placeholders(
        render_roleless_prompt(PromptTemplateId::ClothingScenePlanning)
            .map_err(|source| GenerationError::Validation(source.to_string()))?,
        &replacement_pairs,
    );

    let mut input = task_input.as_object().cloned().unwrap_or_default();
    input.insert(
        "prompt".to_string(),
        json!({
            "messages": messages,
            "rolelessPrompt": roleless_prompt,
        }),
    );
    input.insert("maxOutputTokens".to_string(), json!(3000));
    Ok(serde_json::Value::Object(input))
}

fn is_clothing_base_model_generation_task(task: &ClaimedTask) -> bool {
    task.workspace == WorkspaceKind::Clothing
        && task.kind == GenerationTaskKind::ImageGeneration
        && task.input.get("kind").and_then(serde_json::Value::as_str)
            == Some("clothing-base-model-generation")
}

fn clothing_gender_hair_prompt_description(gender: &str) -> &str {
    match gender {
        "男" => "男性化自然发型，以短发或中短发为主，头发长度不超过耳部和后颈，顶部保留适度层次和自然蓬松感，两侧与后部整洁利落，发际线和头发质感真实，发型符合人物年龄与日常身份；不使用长发、女性化编发、夸张造型、奇异发饰或舞台化发型。",
        "女" => "女性化自然发型，以中长发或长发为主，头发自然垂落或采用简洁的低马尾、自然盘发，具有柔和层次、自然发量和真实发丝质感，发型符合人物年龄与日常身份；不使用男性化极短发、夸张编发、复杂发饰、奇异造型或舞台化发型。",
        _ => gender,
    }
}

fn clothing_body_prompt_description(body: &str) -> &str {
    match body {
        "纤细" => "小至中等骨架，身体横向宽度较窄，肩部和胯部较窄，腰身纤细，四肢细长，体脂偏低，肌肉量较少，肌肉轮廓不明显，整体线条轻盈柔和；外观健康自然，不过度消瘦，肋骨不明显，无病态骨感，人体比例真实。",
        "苗条" => "小至中等骨架，体脂较低，腰腹平坦，腰线清晰，四肢较细，身体轮廓流畅，整体比例自然协调；身形轻盈但不过度纤弱，具有正常肌肉量，外观健康，不显干瘪，不突出骨骼，人体比例真实。",
        "精瘦" => "中等骨架，体脂较低，肌肉量适中，腰腹紧实，肩背、手臂和腿部具有清晰但不过分突出的肌肉线条，身体紧致有力量感；肌肉体积适中，不臃肿，不呈现健美运动员般的夸张肌肉，人体比例真实。",
        "匀称" | "标准" => "中等骨架，体脂和肌肉量适中，肩、腰、胯及四肢比例协调，身体左右对称，躯干与腿部比例自然，没有明显偏瘦、偏胖或局部过度发达；整体轮廓平衡自然，人体比例真实。",
        "健美" => "中等骨架，体脂偏低，肌肉量适中，身体紧实，肩背、腰腹、手臂和腿部均有清晰而美观的训练线条，腰腹平坦，姿态挺拔，整体富有力量感和健康感；肌肉分布均衡，不粗壮，不臃肿，不呈现专业健美运动员般的夸张体积，人体比例真实。",
        "运动型" => "中等至较大骨架，肩部较宽，腰腹紧实，肌肉量适中，肩背、核心、臀腿和四肢具有自然的运动训练痕迹，身体灵活、有爆发力和协调感；肌肉以实用、自然为主，不过度膨胀，不追求极低体脂或明显肌肉分离度，人体比例真实。",
        "肌肉型" | "肌肉" => "中等至较大骨架，体脂较低至适中，肌肉量明显，肩部宽阔，胸背厚实，手臂、腰腹、臀部和腿部肌肉轮廓清晰，整体具有强烈力量感；肌肉发达但分布均衡，不出现异常膨胀，不呈现不自然的极端比例，人体比例真实。",
        "壮硕" => "大骨架，肩背宽厚，胸腔和躯干体积较大，腰腹厚实，手臂和腿部粗壮，肌肉量较高，整体轮廓厚重、稳固，具有明显力量感和压迫感；身体结实而非单纯肥胖，肌肉与体脂自然分布，不过度夸张，不呈现漫画化体型，人体比例真实。",
        "结实" => "中等至较大骨架，身体轮廓厚实紧致，肩背、躯干和四肢具有适中的肌肉量，手臂和腿部有力量感，腰腹不松垮，体脂处于正常或略高水平；肌肉线条自然，不追求明显分离度，不显臃肿，也不过度健美化，人体比例真实。",
        "丰满" | "大码" => "中等至较大骨架，体脂中等偏高，胸部、胯部、臀部和四肢轮廓饱满，腰线仍然清晰可辨，身体曲线圆润柔和，脂肪分布自然均衡；整体丰润但不过度肥胖，不出现异常夸张的胸、腰、臀比例，不漫画化，人体比例真实。",
        "微胖" => "中等骨架，体脂略高，脸部、腰腹、臀部和四肢略显圆润，身体轮廓柔和，腰线较弱但仍可辨识，肌肉线条不明显，整体比例自然；仅有轻微脂肪感，不呈现明显腹部突出，不属于肥胖，不夸张圆润程度，人体比例真实。",
        _ => body,
    }
}

fn clothing_age_prompt_description(age: &str) -> &str {
    match age {
        "婴儿" => "约1岁的婴儿，处于婴儿期，面部高度稚嫩，额头较宽，脸颊具有婴儿特有的圆润感，眼睛相对较大，鼻子和下巴小巧，乳牙尚未完全长齐，皮肤细腻柔嫩，头发细软或较稀疏；具有明确的婴儿年龄特征，不呈现学龄儿童、青少年或成年人的成熟五官。",
        "儿童" => "约8岁的儿童，处于学龄儿童阶段，面部稚嫩，额头相对较宽，五官尚未完全发育成熟，鼻梁和下颌轮廓较柔和，脸部保留明显童真感，皮肤光滑细嫩，没有青春期或成年人的成熟面部特征；不婴儿化，不呈现青少年或成年人的成熟感。",
        "青少年" => "约16岁的青少年，处于青春期后期，面部仍带有稚嫩感，同时开始出现逐渐清晰的鼻梁、下颌和面部骨骼轮廓，五官接近成年人但尚未完全成熟，皮肤年轻，可能存在少量青春期皮肤纹理；具有明确的未成年青少年特征，不幼儿化，不呈现成熟成年人的年龄感。",
        "青年" => "约25岁的年轻成年人，面部发育完全，五官和骨骼轮廓清晰自然，皮肤紧致平滑，眼周、额头和嘴角没有明显皱纹，面部组织饱满而有弹性，头发状态年轻自然，整体呈现明确的成年感和青春活力；不呈现未成年人的稚嫩面容，也不呈现中年或老年特征。",
        "中年" => "约45岁的中年成年人，面部轮廓成熟，眼角、额头和嘴角具有轻微自然细纹，法令纹轻微可见，皮肤质感较青年时期更加成熟，眼周可能出现轻微松弛或疲态，头发可能夹杂少量灰白，整体呈现稳定、成熟的中年年龄感；不过度年轻化，也不呈现深度皱纹或明显老年特征。",
        "老年" => "约70岁的老年人，具有明确而自然的衰老特征，额头、眼角、眼下、嘴角和面颊存在较明显皱纹，法令纹较深，皮肤弹性下降并出现自然松弛，颈部和手部具有年龄纹理，头发大部分灰白或全白，发量可能减少；符合真实衰老规律，不极端苍老，不病态化，不使用夸张或漫画化的皱纹。",
        _ => age,
    }
}

fn clothing_ethnicity_prompt_description(ethnicity: &str) -> &str {
    match ethnicity {
        "欧美白人" => "具有欧洲族裔背景的白人人物，呈现自然真实的现代人物外貌，仅限定人物的欧洲族裔背景，不限定具体国家；族裔特征自然适度，不夸张五官，不自动添加金发碧眼等固定特征，不使用影视化或刻板化形象。",
        "中国人" => "中国汉族人物，呈现自然真实的现代人物外貌，仅限定人物的中国汉族身份；不自动添加传统服装、古典发型、武侠元素、红色装饰或其他中国文化符号，不夸张族裔特征，不使用刻板化形象。",
        "东亚人" => "东亚族裔人物，呈现自然真实的现代人物外貌，仅限定人物具有东亚族裔背景，不指定中国、日本或韩国等具体国籍；不夸张面部特征，不自动套用韩式审美、日系风格或动漫形象。",
        "东南亚人" => "东南亚族裔人物，呈现自然真实的现代人物外貌，仅限定人物具有东南亚族裔背景，不指定具体国家；肤色和五官符合真实人群的自然差异，不刻意加深肤色，不自动添加民族服饰、热带背景或旅游文化符号。",
        "非裔" => "具有非洲族裔背景的人物，呈现自然真实的现代人物外貌，仅限定人物的非洲族裔背景，不默认其为非裔美国人，也不指定具体非洲地区；肤色、五官和发型自然真实，不夸张，不漫画化，不使用刻板化形象。",
        "中东人" => "具有中东地区族裔背景的人物，呈现自然真实的现代人物外貌，仅限定人物具有中东地区背景，不指定阿拉伯、波斯、库尔德或土耳其等具体族群；不自动添加头巾、宗教服饰、传统长袍、沙漠或其他文化符号。",
        "拉丁裔" => "具有拉丁美洲背景的人物，呈现自然真实的现代人物外貌，仅限定人物的拉丁美洲地域与文化背景；不预设固定肤色、五官或单一人种，不自动添加热带服装、舞蹈元素或其他拉丁文化刻板符号。",
        _ => ethnicity,
    }
}

fn clothing_base_model_gateway_input(
    task_input: &serde_json::Value,
) -> Result<serde_json::Value, GenerationError> {
    let gender = read_prompt_field(task_input, "gender", "男");
    let gender_hair_description = clothing_gender_hair_prompt_description(&gender);
    let age = read_prompt_field(task_input, "age", "青年");
    let age_description = clothing_age_prompt_description(&age);
    let ethnicity = read_prompt_field(task_input, "ethnicity", "中国人");
    let ethnicity_description = clothing_ethnicity_prompt_description(&ethnicity);
    let body = read_prompt_field(task_input, "body", "标准");
    let body_description = clothing_body_prompt_description(&body);
    let appearance = read_prompt_field(task_input, "appearance", "无");
    let replacement_pairs = [
        ("{{gender}}", gender.as_str()),
        ("{{gender_hair}}", gender_hair_description),
        ("{{age}}", age_description),
        ("{{ethnicity}}", ethnicity_description),
        ("{{body}}", body_description),
        ("{{appearance}}", appearance.as_str()),
    ];

    let messages = render_prompt_for_roles(PromptTemplateId::ClothingBaseModelGeneration)
        .map_err(|source| GenerationError::Validation(source.to_string()))?
        .into_iter()
        .map(|message| {
            let content = replace_prompt_placeholders(message.content, &replacement_pairs);
            json!({
                "role": message.role,
                "content": content,
            })
        })
        .collect::<Vec<_>>();
    let roleless_prompt = replace_prompt_placeholders(
        render_roleless_prompt(PromptTemplateId::ClothingBaseModelGeneration)
            .map_err(|source| GenerationError::Validation(source.to_string()))?,
        &replacement_pairs,
    );

    let mut input = task_input.as_object().cloned().unwrap_or_default();
    input.insert(
        "prompt".to_string(),
        json!({
            "messages": messages,
            "rolelessPrompt": roleless_prompt,
        }),
    );
    input.insert("maxOutputTokens".to_string(), json!(2000));
    Ok(serde_json::Value::Object(input))
}

fn clothing_reference_prompt_values(
    task_input: &serde_json::Value,
) -> Result<(String, String, String), GenerationError> {
    const IMAGE_LABELS: [&str; 6] = ["A", "B", "C", "D", "E", "F"];
    let images = task_input
        .get("userImages")
        .and_then(serde_json::Value::as_array)
        .filter(|images| !images.is_empty())
        .ok_or_else(|| {
            GenerationError::Validation(
                "服饰任务必须至少包含 1 张服装参考图，并且恰好包含 1 张模特参考图。".to_string(),
            )
        })?;
    if images.len() > IMAGE_LABELS.len() {
        return Err(GenerationError::Validation(
            "服饰出图最多支持 6 张参考图。".to_string(),
        ));
    }

    let mut role_lines = Vec::with_capacity(images.len());
    let mut clothing_labels = Vec::new();
    let mut model_label = None;
    let mut model_count = 0usize;
    for (index, image) in images.iter().enumerate() {
        let label = IMAGE_LABELS[index];
        match image.get("role").and_then(serde_json::Value::as_str) {
            Some("source") | Some("reference") => {
                clothing_labels.push(label);
                role_lines.push(format!(
                    "参考图 {label}：服装参考图 {}。用于锁定服装设计。",
                    clothing_labels.len()
                ));
            }
            Some("model") => {
                model_count += 1;
                model_label = Some(label);
                role_lines.push(format!("参考图 {label}：模特参考图。用于锁定人物身份。"));
            }
            _ => role_lines.push(format!("参考图 {label}：辅助参考图。")),
        }
    }
    let Some(model_label) = model_label.filter(|_| model_count == 1) else {
        return Err(GenerationError::Validation(
            "服饰任务必须至少包含 1 张服装参考图，并且恰好 1 张模特参考图。".to_string(),
        ));
    };
    if clothing_labels.is_empty() {
        return Err(GenerationError::Validation(
            "服饰任务必须至少包含 1 张服装参考图，并且恰好 1 张模特参考图。".to_string(),
        ));
    }

    Ok((
        role_lines.join("\n"),
        format!("参考图 {}", clothing_labels.join("、")),
        format!("参考图 {model_label}"),
    ))
}

fn clothing_tryon_item_gateway_input(
    task_input: &serde_json::Value,
    item: &serde_json::Value,
    index: usize,
) -> Result<serde_json::Value, GenerationError> {
    let scene = required_string(item, "scene", "服饰出图 item 缺少 scene。")?;
    let scene_visual_anchor = required_string(
        item,
        "sceneVisualAnchor",
        "服饰出图 item 缺少 sceneVisualAnchor。",
    )?;
    let scene_prompt_segment = required_string(
        item,
        "scenePromptSegment",
        "服饰出图 item 缺少 scenePromptSegment。",
    )?;
    let camera_setup = item
        .get("cameraSetup")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            GenerationError::Validation("服饰出图 item 缺少 cameraSetup。".to_string())
        })?;
    let framing = camera_setup
        .get("framing")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| GenerationError::Validation("服饰出图 item 缺少 framing。".to_string()))?;
    let perspective = camera_setup
        .get("perspective")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            GenerationError::Validation("服饰出图 item 缺少 perspective。".to_string())
        })?;
    let shooting_position = camera_setup
        .get("shootingPosition")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            GenerationError::Validation("服饰出图 item 缺少 shootingPosition。".to_string())
        })?;
    let pose_action = required_string(item, "poseAction", "服饰出图 item 缺少 poseAction。")?;
    let ratio = item
        .get("ratio")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            task_input
                .get("ratio")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("3:4");
    let item_id = item
        .get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("pose-{}", index + 1));
    let (reference_image_roles, clothing_reference_labels, model_reference_label) =
        clothing_reference_prompt_values(task_input)?;
    let replacement_pairs = [
        ("{{referenceImageRoles}}", reference_image_roles.as_str()),
        (
            "{{clothingReferenceLabels}}",
            clothing_reference_labels.as_str(),
        ),
        ("{{modelReferenceLabel}}", model_reference_label.as_str()),
        ("{{scene}}", scene),
        ("{{sceneVisualAnchor}}", scene_visual_anchor),
        ("{{scenePromptSegment}}", scene_prompt_segment),
        ("{{ratio}}", ratio),
        ("{{framing}}", framing),
        ("{{perspective}}", perspective),
        ("{{shootingPosition}}", shooting_position),
        ("{{poseAction}}", pose_action),
    ];
    let messages = render_prompt_for_roles(PromptTemplateId::ClothingTryonGeneration)
        .map_err(|source| GenerationError::Validation(source.to_string()))?
        .into_iter()
        .map(|message| {
            let content = replace_prompt_placeholders(message.content, &replacement_pairs);
            json!({
                "role": message.role,
                "content": content,
            })
        })
        .collect::<Vec<_>>();
    let roleless_prompt = replace_prompt_placeholders(
        render_roleless_prompt(PromptTemplateId::ClothingTryonGeneration)
            .map_err(|source| GenerationError::Validation(source.to_string()))?,
        &replacement_pairs,
    );

    let mut input = task_input.as_object().cloned().unwrap_or_default();
    input.insert("itemId".to_string(), json!(item_id));
    input.insert("itemIndex".to_string(), json!(index));
    input.insert("ratio".to_string(), json!(ratio));
    input.insert(
        "prompt".to_string(),
        json!({
            "messages": messages,
            "rolelessPrompt": roleless_prompt,
        }),
    );
    Ok(serde_json::Value::Object(input))
}

fn required_string<'a>(
    value: &'a serde_json::Value,
    key: &str,
    message: &str,
) -> Result<&'a str, GenerationError> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| GenerationError::Validation(message.to_string()))
}

fn read_prompt_field(task_input: &serde_json::Value, key: &str, default_value: &str) -> String {
    task_input
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_value)
        .to_string()
}

fn replace_prompt_placeholders(mut content: String, replacement_pairs: &[(&str, &str)]) -> String {
    for (placeholder, value) in replacement_pairs {
        content = content.replace(placeholder, value);
    }
    content
}

fn task_input_with_asset_reference_images(
    workspace_directory: &Path,
    task: &ClaimedTask,
) -> Result<serde_json::Value, GenerationError> {
    let reference_assets = task
        .input_assets
        .iter()
        .filter(|asset| {
            asset.role == "source" || asset.role == "reference" || asset.role == "model"
        })
        .collect::<Vec<_>>();
    if reference_assets.is_empty() {
        return Ok(task.input.clone());
    }

    let asset_service = AssetService::new();
    let mut user_images = Vec::new();
    for input_asset in reference_assets {
        let asset = asset_service
            .get_asset(workspace_directory, &input_asset.asset_id)
            .map_err(|source| GenerationError::Validation(source.to_string()))?;
        let path = asset_service
            .asset_file_path(workspace_directory, &input_asset.asset_id)
            .map_err(|source| GenerationError::Validation(source.to_string()))?;
        let bytes = std::fs::read(&path)
            .map_err(|_| GenerationError::Validation("参考图资产读取失败。".to_string()))?;
        user_images.push(json!({
            "assetId": asset.id,
            "dataUrl": format!("data:{};base64,{}", asset.mime_type, encode_base64(&bytes)),
            "mimeType": asset.mime_type,
            "originalName": asset.original_name,
            "role": input_asset.role,
            "sortOrder": input_asset.sort_order,
        }));
    }

    let mut input = task.input.as_object().cloned().unwrap_or_default();
    input.insert(
        "userImages".to_string(),
        serde_json::Value::Array(user_images),
    );
    Ok(serde_json::Value::Object(input))
}

fn product_detail_item_gateway_input(
    task_input: &serde_json::Value,
    item: &serde_json::Value,
    index: usize,
    item_count: usize,
) -> Result<serde_json::Value, String> {
    let mut input = task_input.as_object().cloned().unwrap_or_default();
    let image_prompt = item
        .get("imagePrompt")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            item.get("image_prompt")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            item.get("sceneDescription")
                .and_then(serde_json::Value::as_str)
        })
        .ok_or_else(|| "商品详情图 item 缺少 imagePrompt。".to_string())?;
    let image_prompt = sanitize_image_generation_prompt_text(image_prompt);
    let copy_requirements = item
        .get("copyRequirements")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            item.get("copy_requirements")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
        })
        .map(str::trim);
    let combined_image_prompt = if let Some(copy_requirements) = copy_requirements {
        format!("{image_prompt}\n用户可修改文案要求：{copy_requirements}")
    } else {
        image_prompt
    };
    let image_type = item
        .get("imageType")
        .and_then(serde_json::Value::as_str)
        .or_else(|| item.get("image_type").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let design_spec = item
        .get("designSpec")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let ratio = item
        .get("ratio")
        .and_then(serde_json::Value::as_str)
        .or_else(|| task_input.get("ratio").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let title = item
        .get("title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("商品详情图");
    let platform = task_input
        .get("platform")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("电商平台");
    let market = task_input
        .get("market")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let language = task_input
        .get("language")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let target_language = item
        .get("targetLanguage")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(language);
    let locale_constraint = locale_visual_constraint(market, language);
    let product_selling_points = task_input
        .get("productSellingPoints")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let image_type_line = image_type
        .map(|value| format!("场景核心卖点：{value}\n"))
        .unwrap_or_default();
    let design_spec_line = design_spec
        .map(|value| format!("设计规范：\n{value}\n"))
        .unwrap_or_default();
    let ratio_line = ratio
        .map(|value| {
            format!("画面比例：{value}。必须按用户第一步选择的 {value} 比例生成，不得自行改成其它比例、方向或裁切规格。\n")
        })
        .unwrap_or_default();
    let original_fidelity_constraint = "原图忠实约束：用户上传原图是商品唯一视觉事实源；核心商品主体只能做光影、背景、构图、清晰度和额外画面文案层面的微调，禁止重绘、换款、换包装、改颜色、改结构、改 Logo、改图案、改比例或新增未提供配件。必须逐项保留参考图中商品主体的原始色块、渐变、纹理、缝线、轮廓、版型、比例、Logo 位置、胸前英文印花文字、包装上的原有印花文字、图案和图形；这些原有文字和图案属于商品外观事实，不是需要生成的新文案，不得翻译、重写、删除或弱化，不得遮挡、改色或替换。";
    let user_prompt = format!(
        "请基于上传的商品参考图生成「{title}」。目标平台：{platform}。目标市场：{market}。目标语言：{language}。当前模块目标语言：{target_language}。\n{locale_constraint}\n{ratio_line}商品卖点：{product_selling_points}\n{image_type_line}{design_spec_line}{original_fidelity_constraint}\n画面要求：{combined_image_prompt}\n保持商品主体、颜色、版型、原有印花文字和图案与参考图一致；图片中如需出现文字，必须严格按照用户可修改文案要求生成画面内文字、结构化信息和已启用标注；文字必须匹配当前模块目标语言，并且每一段文字必须完整使用中文双引号包裹，例如“使用场景”；不得生成未被中文双引号包裹的文字、与当前模块目标语言不一致的文字、随机字符、价格、销量、认证标识、新增未提供的品牌 Logo、二维码、说明牌或未列出的虚假参数。"
    );
    let system_prompt = "你是专业电商商品详情页图生图生成器。必须严格参考用户上传商品图，保持商品事实一致，不编造品牌、参数、价格、销量或认证标识。核心商品主体只能微调，不能重写、换款、换包装、改色、改变结构，不能翻译、重写、删除或弱化参考图商品上已有的印花文字、Logo、图案和渐变。图片中新增加的文字必须匹配用户指定的目标语言，并且每一段文字都必须使用中文双引号包裹。";
    let roleless_prompt = format!("【应用规则】\n{system_prompt}\n\n【用户任务】\n{user_prompt}");

    input.insert("items".to_string(), json!([item.clone()]));
    input.insert("currentItem".to_string(), item.clone());
    input.insert("itemIndex".to_string(), json!(index));
    input.insert("itemCount".to_string(), json!(item_count));
    input.insert("targetLanguage".to_string(), json!(target_language));
    if let Some(ratio) = ratio {
        input.insert("ratio".to_string(), json!(ratio));
    }
    input.insert(
        "prompt".to_string(),
        json!({
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": user_prompt,
                }
            ],
            "rolelessPrompt": roleless_prompt,
        }),
    );
    input.insert("maxOutputTokens".to_string(), json!(2000));

    Ok(serde_json::Value::Object(input))
}

fn sanitize_image_generation_prompt_text(value: &str) -> String {
    value
        .replace("预留文字安全区", "生成清晰可读文字的干净信息区")
        .replace("文字安全区", "清晰文字信息区")
        .replace(
            "只预留标题、副标题或参数信息区",
            "按用户可修改文案要求生成标题、副标题或参数信息区",
        )
        .replace(
            "不要求生图模型直接生成可读文字",
            "必须按照用户可修改文案要求生成清晰可读的画面内文字",
        )
        .replace("不直接生成可读文字", "生成清晰可读的画面内文字")
}

fn locale_visual_constraint(market: &str, language: &str) -> &'static str {
    let normalized_market = market.to_ascii_lowercase();
    let normalized_language = language.to_ascii_lowercase();
    let is_china_market = market.contains("中国")
        || normalized_market == "cn"
        || normalized_market == "china"
        || normalized_market.contains("mainland china");
    let is_chinese_language = language.contains("中文")
        || normalized_language == "zh"
        || normalized_language.starts_with("zh-")
        || normalized_language.contains("chinese");

    if is_china_market && is_chinese_language {
        return "国家与语言约束：如果画面中出现人物，必须是中国人或中国电商模特气质；新增画面文案、信息区文字和标注标签必须使用中文，不得新增英文或外文。参考图商品主体上已有英文、Logo、印花文字和图案不受目标语言影响，必须按原图原样保留，不得翻译、重写、删除或替换。";
    }
    if is_chinese_language {
        return "语言约束：新增画面文案、信息区文字和标注标签必须使用中文，不得新增英文或外文。参考图商品主体上已有英文、Logo、印花文字和图案不受目标语言影响，必须按原图原样保留，不得翻译、重写、删除或替换。";
    }
    "国家与语言约束：人物、场景和文字语言必须匹配目标市场与目标语言。"
}

fn persist_generated_outputs(
    workspace_directory: &Path,
    task: &ClaimedTask,
    gateway_results: &[ModelGatewayResult],
) -> Result<usize, GenerationError> {
    if !task_requires_generated_asset(task.kind) {
        return Ok(0);
    }

    let invocation_ids = gateway_results
        .iter()
        .map(|result| result.invocation_id.as_str())
        .collect::<Vec<_>>();
    if !update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::DownloadingResult,
        "task.result-downloading",
        Some(json!({ "invocation_ids": invocation_ids })),
    )? {
        return Ok(0);
    }
    let mut images = Vec::new();
    for gateway_result in gateway_results {
        images.extend(collect_generated_images(&gateway_result.output_json)?);
    }
    if images.is_empty() {
        return Err(GenerationError::Validation(
            "模型结果不包含可保存图片。".to_string(),
        ));
    }

    if !update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::SavingResult,
        "task.result-saving",
        Some(json!({ "image_count": images.len() })),
    )? {
        return Ok(0);
    }

    save_generated_images(workspace_directory, &task.id, &images, 0)?;
    let database = WorkspaceDatabase::open(workspace_directory)?;
    insert_task_event(
        &database,
        &task.id,
        "task.result-saved",
        Some(GenerationTaskStage::SavingResult),
        Some(json!({ "image_count": images.len() })),
    )?;

    Ok(images.len())
}

fn persist_generated_gateway_result_outputs(
    workspace_directory: &Path,
    task_id: &str,
    gateway_result: &ModelGatewayResult,
    sort_order_start: usize,
) -> Result<usize, GenerationError> {
    if !update_stage(
        workspace_directory,
        task_id,
        GenerationTaskStage::DownloadingResult,
        "task.result-downloading",
        Some(json!({ "invocation_id": gateway_result.invocation_id })),
    )? {
        return Ok(0);
    }
    let images = collect_generated_images(&gateway_result.output_json)?;
    if images.is_empty() {
        return Err(GenerationError::Validation(
            "模型结果不包含可保存图片。".to_string(),
        ));
    }

    if !update_stage(
        workspace_directory,
        task_id,
        GenerationTaskStage::SavingResult,
        "task.result-saving",
        Some(json!({
            "image_count": images.len(),
            "sort_order_start": sort_order_start,
        })),
    )? {
        return Ok(0);
    }
    save_generated_images(workspace_directory, task_id, &images, sort_order_start)?;
    let database = WorkspaceDatabase::open(workspace_directory)?;
    insert_task_event(
        &database,
        task_id,
        "task.result-saved",
        Some(GenerationTaskStage::SavingResult),
        Some(json!({
            "image_count": images.len(),
            "sort_order_start": sort_order_start,
        })),
    )?;
    Ok(images.len())
}

fn save_generated_images(
    workspace_directory: &Path,
    task_id: &str,
    images: &[GeneratedImage],
    sort_order_start: usize,
) -> Result<(), GenerationError> {
    let asset_service = AssetService::new();
    let database = WorkspaceDatabase::open(workspace_directory)?;
    for (offset, image) in images.iter().enumerate() {
        let sort_order = sort_order_start + offset;
        let asset = asset_service
            .save_generated_image(
                workspace_directory,
                &format!(
                    "generated-{}.{}",
                    sort_order + 1,
                    extension_for_mime_type(&image.mime_type)?
                ),
                &image.mime_type,
                &image.bytes,
            )
            .map_err(|_| GenerationError::Validation("生成结果保存失败。".to_string()))?;
        database.connection().execute(
            "
            INSERT INTO generation_assets (task_id, asset_id, role, sort_order)
            VALUES (?1, ?2, 'output', ?3)
            ",
            params![task_id, asset.id, sort_order as i64],
        )?;
    }
    Ok(())
}

fn persist_listing_copy_output(
    workspace_directory: &Path,
    task: &ClaimedTask,
    gateway_result: &ModelGatewayResult,
) -> Result<(), GenerationError> {
    if !update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::SavingResult,
        "task.output-saving",
        Some(json!({ "invocation_id": gateway_result.invocation_id })),
    )? {
        return Ok(());
    }
    let output = parse_listing_copy_output(gateway_result)?;
    let output_json = serde_json::to_string(&output)?;
    let database = WorkspaceDatabase::open(workspace_directory)?;
    database.connection().execute(
        "
        UPDATE generation_tasks
        SET output_json = ?1,
            updated_at = datetime('now')
        WHERE id = ?2
        ",
        params![output_json, task.id],
    )?;
    insert_task_event(
        &database,
        &task.id,
        "task.output-saved",
        Some(GenerationTaskStage::SavingResult),
        Some(json!({ "invocation_id": gateway_result.invocation_id })),
    )?;
    Ok(())
}

fn persist_structured_model_output(
    workspace_directory: &Path,
    task: &ClaimedTask,
    gateway_result: &ModelGatewayResult,
) -> Result<(), GenerationError> {
    let output = parse_structured_model_output(gateway_result)?;
    if is_clothing_scene_planning_task(task) {
        validate_clothing_scene_plan_output(task, &output)?;
    }
    if !update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::SavingResult,
        "task.output-saving",
        Some(json!({ "invocation_id": gateway_result.invocation_id })),
    )? {
        return Ok(());
    }
    let output_json = serde_json::to_string(&output)?;
    let database = WorkspaceDatabase::open(workspace_directory)?;
    database.connection().execute(
        "
        UPDATE generation_tasks
        SET output_json = ?1,
            updated_at = datetime('now')
        WHERE id = ?2
        ",
        params![output_json, task.id],
    )?;
    insert_task_event(
        &database,
        &task.id,
        "task.output-saved",
        Some(GenerationTaskStage::SavingResult),
        Some(json!({ "invocation_id": gateway_result.invocation_id })),
    )?;
    Ok(())
}

fn parse_structured_model_output(
    gateway_result: &ModelGatewayResult,
) -> Result<serde_json::Value, GenerationError> {
    if let Some(output_text) = gateway_result.output_text.as_deref() {
        let trimmed = output_text.trim();
        if let Ok(output) = serde_json::from_str(trimmed) {
            return Ok(output);
        }
        if let Some(candidate) = extract_first_json_object(trimmed) {
            return serde_json::from_str(candidate).map_err(|_| {
                GenerationError::Validation("模型规划结果不是有效 JSON。".to_string())
            });
        }
        return Err(GenerationError::Validation(
            "模型规划结果不是有效 JSON。".to_string(),
        ));
    }
    Ok(gateway_result.output_json.clone())
}

fn validate_clothing_scene_plan_output(
    task: &ClaimedTask,
    output: &serde_json::Value,
) -> Result<(), GenerationError> {
    let scenes = output
        .get("scenes")
        .and_then(serde_json::Value::as_array)
        .filter(|scenes| !scenes.is_empty())
        .ok_or_else(|| {
            GenerationError::Validation("服饰场景规划结果缺少非空 scenes 数组。".to_string())
        })?;
    let ai_recommended = task
        .input
        .get("aiRecommended")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let selected_scenes = task
        .input
        .get("selectedScenes")
        .and_then(serde_json::Value::as_array)
        .map(|selected_scenes| {
            selected_scenes
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|scene| !scene.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if (ai_recommended || selected_scenes.is_empty()) && scenes.len() != 4 {
        return Err(GenerationError::Validation(
            "服饰场景规划结果在 AI 推荐时必须包含 4 个 scenes。".to_string(),
        ));
    }
    if !ai_recommended && !selected_scenes.is_empty() {
        let output_scenes = scenes
            .iter()
            .enumerate()
            .map(|(scene_index, scene)| {
                required_string(
                    scene,
                    "scene",
                    &format!("服饰场景规划结果 scenes[{scene_index}] 缺少 scene。"),
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        let exactly_matches_selected = output_scenes.len() == selected_scenes.len()
            && selected_scenes
                .iter()
                .all(|selected| output_scenes.contains(selected))
            && output_scenes
                .iter()
                .all(|output| selected_scenes.contains(output));
        if !exactly_matches_selected {
            return Err(GenerationError::Validation(
                "服饰场景规划结果 scenes 必须与用户 selectedScenes 完全一致。".to_string(),
            ));
        }
    }
    for (scene_index, scene) in scenes.iter().enumerate() {
        required_string(
            scene,
            "scene",
            &format!("服饰场景规划结果 scenes[{scene_index}] 缺少 scene。"),
        )?;
        required_string(
            scene,
            "sceneVisualAnchor",
            &format!("服饰场景规划结果 scenes[{scene_index}] 缺少 sceneVisualAnchor。"),
        )?;
        required_string(
            scene,
            "scenePromptSegment",
            &format!("服饰场景规划结果 scenes[{scene_index}] 缺少 scenePromptSegment。"),
        )?;
        let poses = scene
            .get("recommendedPoses")
            .and_then(serde_json::Value::as_array)
            .filter(|poses| poses.len() == 4)
            .ok_or_else(|| {
                GenerationError::Validation(format!(
                    "服饰场景规划结果 scenes[{scene_index}].recommendedPoses 必须包含 4 个动作。"
                ))
            })?;
        for (pose_index, pose) in poses.iter().enumerate() {
            let camera_setup = pose
                .get("cameraSetup")
                .filter(|camera_setup| camera_setup.is_object())
                .ok_or_else(|| {
                    GenerationError::Validation(format!(
                        "服饰场景规划结果 scenes[{scene_index}].recommendedPoses[{pose_index}] 缺少 cameraSetup。"
                    ))
                })?;
            for field in ["framing", "perspective", "shootingPosition"] {
                required_string(
                    camera_setup,
                    field,
                    &format!(
                        "服饰场景规划结果 scenes[{scene_index}].recommendedPoses[{pose_index}].cameraSetup 缺少 {field}。"
                    ),
                )?;
            }
            required_string(
                pose,
                "poseAction",
                &format!(
                    "服饰场景规划结果 scenes[{scene_index}].recommendedPoses[{pose_index}] 缺少 poseAction。"
                ),
            )?;
        }
    }
    Ok(())
}

fn parse_listing_copy_output(
    gateway_result: &ModelGatewayResult,
) -> Result<serde_json::Value, GenerationError> {
    let output = if let Some(output_text) = gateway_result.output_text.as_deref() {
        parse_listing_copy_text_output(output_text)?
    } else {
        gateway_result.output_json.clone()
    };
    let Some(object) = output.as_object() else {
        return Err(GenerationError::Validation(
            "上架文案结果必须是 JSON 对象。".to_string(),
        ));
    };
    require_listing_copy_string(object, "title", "标题")?;
    require_listing_copy_array(object, "sellingPoints", "卖点")?;
    require_listing_copy_array(object, "promotionBenefits", "促销利益点")?;
    require_listing_copy_string(object, "detailCopy", "详情页文案")?;
    require_listing_copy_array(object, "searchKeywords", "搜索词")?;
    require_listing_copy_array(object, "attributeWords", "属性词")?;
    require_listing_copy_array(object, "mainImageGuidance", "主图内容指引")?;
    Ok(output)
}

fn parse_listing_copy_text_output(output_text: &str) -> Result<serde_json::Value, GenerationError> {
    let trimmed = output_text.trim();
    if let Ok(output) = serde_json::from_str(trimmed) {
        return Ok(output);
    }

    if let Some(candidate) = extract_first_json_object(trimmed) {
        return serde_json::from_str(candidate)
            .map_err(|_| GenerationError::Validation("上架文案结果不是有效 JSON。".to_string()));
    }

    Err(GenerationError::Validation(
        "上架文案结果不是有效 JSON。".to_string(),
    ))
}

fn extract_first_json_object(text: &str) -> Option<&str> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, character) in text.char_indices() {
        if start.is_none() {
            if character == '{' {
                start = Some(index);
                depth = 1;
            }
            continue;
        }

        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match character {
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match character {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let end = index + character.len_utf8();
                    return start.map(|start| &text[start..end]);
                }
            }
            _ => {}
        }
    }

    None
}

fn require_listing_copy_string(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    label: &str,
) -> Result<(), GenerationError> {
    let valid = object
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if valid {
        return Ok(());
    }
    Err(GenerationError::Validation(format!(
        "上架文案结果缺少{label}。"
    )))
}

fn require_listing_copy_array(
    object: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    label: &str,
) -> Result<(), GenerationError> {
    let valid = object
        .get(field)
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            !items.is_empty()
                && items.iter().all(|item| {
                    item.as_str()
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false)
                })
        })
        .unwrap_or(false);
    if valid {
        return Ok(());
    }
    Err(GenerationError::Validation(format!(
        "上架文案结果缺少{label}。"
    )))
}

#[derive(Debug, Clone)]
struct GeneratedImage {
    mime_type: String,
    bytes: Vec<u8>,
}

fn collect_generated_images(
    output_json: &serde_json::Value,
) -> Result<Vec<GeneratedImage>, GenerationError> {
    let Some(images) = output_json
        .get("images")
        .and_then(serde_json::Value::as_array)
    else {
        return Ok(Vec::new());
    };
    let mut results = Vec::new();
    for image in images {
        let mime_hint = image
            .get("mimeType")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("image/png");
        let generated =
            if let Some(data_url) = image.get("dataUrl").and_then(serde_json::Value::as_str) {
                decode_data_url_image(data_url, mime_hint)?
            } else if let Some(url) = image.get("url").and_then(serde_json::Value::as_str) {
                download_provider_result_image(url, mime_hint)?
            } else {
                return Err(GenerationError::Validation(
                    "模型图片结果缺少可下载地址。".to_string(),
                ));
            };
        results.push(generated);
    }
    Ok(results)
}

fn decode_data_url_image(
    data_url: &str,
    mime_hint: &str,
) -> Result<GeneratedImage, GenerationError> {
    let (metadata, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| GenerationError::Validation("模型图片 data URL 格式无效。".to_string()))?;
    if !metadata.ends_with(";base64") {
        return Err(GenerationError::Validation(
            "模型图片 data URL 必须使用 base64。".to_string(),
        ));
    }
    let mime_type = metadata
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .filter(|value| !value.is_empty())
        .unwrap_or(mime_hint)
        .to_string();
    ensure_supported_image_mime(&mime_type)?;
    Ok(GeneratedImage {
        mime_type,
        bytes: decode_base64(encoded)?,
    })
}

fn download_provider_result_image(
    url: &str,
    mime_hint: &str,
) -> Result<GeneratedImage, GenerationError> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(GenerationError::Validation(
            "模型图片结果地址必须是 HTTP(S)。".to_string(),
        ));
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(PROVIDER_RESULT_TIMEOUT_SECONDS))
        .build()
        .map_err(|_| GenerationError::Validation("生成结果下载客户端初始化失败。".to_string()))?;
    let response = client
        .get(url)
        .header(
            ACCEPT,
            "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        )
        .header(USER_AGENT, "commerce-shoot-studio/0.1 result-downloader")
        .send()
        .map_err(|source| {
            eprintln!(
                "[local-task-executor] generated image download request failed error={}",
                source
            );
            GenerationError::Validation("生成结果下载失败。".to_string())
        })?;
    if !response.status().is_success() {
        eprintln!(
            "[local-task-executor] generated image download returned non-success status={}",
            response.status()
        );
        return Err(GenerationError::Validation(
            "生成结果下载失败。".to_string(),
        ));
    }
    let mime_type = downloaded_image_mime_type(
        response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        mime_hint,
    )?;
    let bytes = response
        .bytes()
        .map_err(|_| GenerationError::Validation("生成结果读取失败。".to_string()))?
        .to_vec();
    Ok(GeneratedImage { mime_type, bytes })
}

fn downloaded_image_mime_type(
    content_type: Option<&str>,
    mime_hint: &str,
) -> Result<String, GenerationError> {
    let header_mime = content_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(mime_type) = header_mime {
        if ensure_supported_image_mime(mime_type).is_ok() {
            return Ok(mime_type.to_string());
        }
    }

    ensure_supported_image_mime(mime_hint)?;
    Ok(mime_hint.to_string())
}

fn decode_base64(input: &str) -> Result<Vec<u8>, GenerationError> {
    let mut output = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut padding_started = false;

    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            padding_started = true;
            continue;
        }
        if padding_started {
            return Err(GenerationError::Validation(
                "base64 填充字符后存在非法内容。".to_string(),
            ));
        }
        let value = base64_value(byte)?;
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
            buffer &= (1 << bits) - 1;
        }
    }

    Ok(output)
}

fn encode_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(((bytes.len() + 2) / 3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        let combined = ((first as u32) << 16) | ((second as u32) << 8) | third as u32;

        output.push(ALPHABET[((combined >> 18) & 0x3f) as usize] as char);
        output.push(ALPHABET[((combined >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            output.push(ALPHABET[((combined >> 6) & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(ALPHABET[(combined & 0x3f) as usize] as char);
        } else {
            output.push('=');
        }
    }
    output
}

fn base64_value(byte: u8) -> Result<u8, GenerationError> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(GenerationError::Validation(
            "base64 内容包含非法字符。".to_string(),
        )),
    }
}

fn task_requires_generated_asset(kind: GenerationTaskKind) -> bool {
    matches!(
        kind,
        GenerationTaskKind::ImageGeneration | GenerationTaskKind::ImageEdit
    )
}

fn normalized_persist_error(task: &ClaimedTask) -> NormalizedTaskError {
    if task.kind == GenerationTaskKind::ListingCopy {
        return NormalizedTaskError {
            code: "LISTING_COPY_OUTPUT_INVALID".to_string(),
            message: "上架文案结果不是有效结构化 JSON，请重试。".to_string(),
            retryable: true,
            stage: Some(GenerationTaskStage::Failed),
            provider_status_code: None,
            provider_error_code: None,
        };
    }

    if is_clothing_scene_planning_task(task) {
        return NormalizedTaskError {
            code: "CLOTHING_SCENE_PLAN_OUTPUT_INVALID".to_string(),
            message: "服饰场景规划结果不是有效结构化 JSON，或未满足场景与动作数量要求，请重试。"
                .to_string(),
            retryable: true,
            stage: Some(GenerationTaskStage::Failed),
            provider_status_code: None,
            provider_error_code: None,
        };
    }

    NormalizedTaskError {
        code: "DOWNLOAD_RESULT_FAILED".to_string(),
        message: "生成结果下载或保存失败，请稍后重试。".to_string(),
        retryable: true,
        stage: Some(GenerationTaskStage::Failed),
        provider_status_code: None,
        provider_error_code: None,
    }
}

fn ensure_supported_image_mime(mime_type: &str) -> Result<(), GenerationError> {
    extension_for_mime_type(mime_type).map(|_| ())
}

fn extension_for_mime_type(mime_type: &str) -> Result<&'static str, GenerationError> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        _ => Err(GenerationError::Validation(format!(
            "暂不支持的生成图片 MIME 类型：{mime_type}"
        ))),
    }
}

fn mark_task_succeeded(
    workspace_directory: &Path,
    task: &ClaimedTask,
    invocation_ids: &[String],
    extra_detail: Option<serde_json::Value>,
) -> Result<(), GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    let updated = database.connection().execute(
        "
        UPDATE generation_tasks
        SET status = 'succeeded',
            stage = 'completed',
            completed_at = COALESCE(completed_at, datetime('now')),
            updated_at = datetime('now')
        WHERE id = ?1 AND status = 'running'
        ",
        params![task.id],
    )?;
    if updated == 0 {
        return Ok(());
    }
    let mut detail = json!({
        "invocation_ids": invocation_ids,
    });
    if let Some(extra_detail) = extra_detail {
        if let (Some(detail), Some(extra)) = (detail.as_object_mut(), extra_detail.as_object()) {
            for (key, value) in extra {
                detail.insert(key.clone(), value.clone());
            }
        }
    }
    insert_task_event(
        &database,
        &task.id,
        "task.succeeded",
        Some(GenerationTaskStage::Completed),
        Some(detail),
    )?;
    Ok(())
}

fn insert_task_item_failed_event(
    workspace_directory: &Path,
    task_id: &str,
    item_index: usize,
    error: GenerationError,
) -> Result<(), GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    insert_task_event(
        &database,
        task_id,
        "task.item-failed",
        Some(GenerationTaskStage::CallingProvider),
        Some(json!({
            "item_index": item_index,
            "message": error.to_string(),
        })),
    )?;
    Ok(())
}

fn mark_task_failed(
    workspace_directory: &Path,
    task_id: &str,
    error: &NormalizedTaskError,
) -> Result<(), GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    let updated = database.connection().execute(
        "
        UPDATE generation_tasks
        SET status = 'failed',
            stage = 'failed',
            error_json = ?1,
            completed_at = COALESCE(completed_at, datetime('now')),
            updated_at = datetime('now')
        WHERE id = ?2 AND status = 'running'
        ",
        params![serde_json::to_string(error)?, task_id],
    )?;
    if updated == 0 {
        return Ok(());
    }
    insert_task_event(
        &database,
        task_id,
        "task.failed",
        Some(GenerationTaskStage::Failed),
        Some(json!({
            "normalized_error_code": error.code,
            "message": error.message,
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
) -> Result<bool, GenerationError> {
    let database = WorkspaceDatabase::open(workspace_directory)?;
    let updated = database.connection().execute(
        "
        UPDATE generation_tasks
        SET stage = ?1,
            updated_at = datetime('now')
        WHERE id = ?2 AND status = 'running'
        ",
        params![stage.as_str(), task_id],
    )?;
    if updated == 0 {
        return Ok(false);
    }
    insert_task_event(&database, task_id, event_type, Some(stage), detail)?;
    Ok(true)
}

fn capability_for_task(workspace: WorkspaceKind, kind: GenerationTaskKind) -> &'static str {
    match (workspace, kind) {
        (_, GenerationTaskKind::PromptPlan) => "prompt-plan",
        (_, GenerationTaskKind::ImageEdit) => "image-edit",
        (_, GenerationTaskKind::ListingCopy) => "listing-copy",
        (WorkspaceKind::Scene, GenerationTaskKind::ImageGeneration) => "scene-image-generation",
        (WorkspaceKind::Product, GenerationTaskKind::ImageGeneration) => {
            "product-detail-generation"
        }
        (WorkspaceKind::Clothing, GenerationTaskKind::ImageGeneration) => {
            "clothing-tryon-generation"
        }
    }
}

fn capability_for_claimed_task(task: &ClaimedTask) -> &'static str {
    if is_clothing_scene_planning_task(task) {
        return "clothing-scene-planning";
    }
    if is_clothing_base_model_generation_task(task) {
        return "clothing-base-model-generation";
    }
    capability_for_task(task.workspace, task.kind)
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

#[cfg(test)]
mod tests {
    use super::{
        capability_for_claimed_task, claim_next_queued_task, clothing_base_model_gateway_input,
        clothing_scene_planning_gateway_input, clothing_tryon_item_gateway_input,
        downloaded_image_mime_type, execute_claimed_task, invoke_gateway_inputs_for_task,
        mark_task_failed, mark_task_succeeded, normalize_model_gateway_task_error,
        normalized_persist_error, parse_listing_copy_output, persist_structured_model_output,
        product_detail_input_batches, product_detail_item_gateway_input,
        product_detail_output_sort_order_start, task_execution_error_diagnostic,
        task_gateway_inputs, task_input_with_asset_reference_images, task_is_running, update_stage,
        validate_clothing_scene_plan_output, ClaimedTask, TaskModelInvocationError,
        BACKGROUND_TASK_CONCURRENCY, PRODUCT_DETAIL_ITEM_CONCURRENCY,
    };
    use crate::domain::assets::AssetKind;
    use crate::domain::errors::ProviderTransportErrorKind;
    use crate::domain::generation::{
        GenerationTaskKind, GenerationTaskStage, GenerationTaskStatus, NormalizedTaskError,
        WorkspaceKind,
    };
    use crate::infrastructure::database::WorkspaceDatabase;
    use crate::infrastructure::filesystem::WorkspaceFileSystem;
    use crate::services::assets::{AssetService, ImportImagesInput};
    use crate::services::generation::{
        insert_task_event, CreateGenerationTaskInput, GenerationService,
        GenerationTaskInputAssetInput,
    };
    use crate::services::model_config::ModelConfigError;
    use crate::services::model_gateway::ModelGatewayResult;
    use crate::services::workspace::{InitializeWorkspaceInput, WorkspaceService};
    use std::fs;
    use std::ops::Range;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    #[test]
    fn clothing_base_model_task_uses_text_to_image_capability() {
        let task = ClaimedTask {
            id: "task_clothing_base_model_capability".to_string(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({ "kind": "clothing-base-model-generation" }),
            input_assets: Vec::new(),
        };

        assert_eq!(
            capability_for_claimed_task(&task),
            "clothing-base-model-generation"
        );
    }

    #[test]
    fn provider_rate_limit_is_retryable_in_task_history() {
        let error = normalize_model_gateway_task_error(TaskModelInvocationError::Gateway(
            ModelConfigError::ProviderHttp {
                status_code: 429,
                provider_error_code: Some("rate_limit_exceeded".to_string()),
            },
        ));

        assert_eq!(error.code, "PROVIDER_RATE_LIMITED");
        assert!(error.retryable);
        assert_eq!(error.provider_status_code, Some(429));
        assert_eq!(
            error.provider_error_code.as_deref(),
            Some("rate_limit_exceeded")
        );
        assert_eq!(error.stage, Some(GenerationTaskStage::Failed));
    }

    #[test]
    fn provider_timeout_and_network_failures_stay_retryable_in_task_history() {
        for (kind, expected_code) in [
            (ProviderTransportErrorKind::Timeout, "PROVIDER_TIMEOUT"),
            (ProviderTransportErrorKind::Network, "NETWORK_ERROR"),
        ] {
            let error = normalize_model_gateway_task_error(TaskModelInvocationError::Gateway(
                ModelConfigError::ProviderTransport(kind),
            ));

            assert_eq!(error.code, expected_code);
            assert!(error.retryable);
            assert_eq!(error.provider_status_code, None);
            assert_eq!(error.provider_error_code, None);
            assert_eq!(error.stage, Some(GenerationTaskStage::Failed));
        }
    }

    #[test]
    fn provider_request_validation_has_no_fabricated_http_status_in_task_history() {
        let error = normalize_model_gateway_task_error(TaskModelInvocationError::Gateway(
            ModelConfigError::Validation("当前 Provider 不支持该本地请求。".to_string()),
        ));

        assert_eq!(error.code, "MODEL_CAPABILITY_UNAVAILABLE");
        assert!(!error.retryable);
        assert_eq!(error.provider_status_code, None);
        assert_eq!(error.provider_error_code, None);
        assert_eq!(error.stage, Some(GenerationTaskStage::Failed));
    }

    #[test]
    fn provider_failure_without_response_has_no_fabricated_http_status_in_task_history() {
        let error = normalize_model_gateway_task_error(TaskModelInvocationError::Gateway(
            ModelConfigError::Validation("读取 Provider 响应失败。".to_string()),
        ));

        assert_eq!(error.code, "MODEL_CAPABILITY_UNAVAILABLE");
        assert!(!error.retryable);
        assert_eq!(error.provider_status_code, None);
        assert_eq!(error.provider_error_code, None);
        assert_eq!(error.stage, Some(GenerationTaskStage::Failed));
    }

    #[test]
    fn task_execution_diagnostic_omits_raw_error_message() {
        let diagnostic = task_execution_error_diagnostic(
            "task_clothing_retry",
            "clothing-tryon-generation",
            &NormalizedTaskError {
                code: "VALIDATION_ERROR".to_string(),
                message: "raw prompt marker sk-task-diagnostic-secret".to_string(),
                retryable: false,
                stage: Some(GenerationTaskStage::Failed),
                provider_status_code: None,
                provider_error_code: None,
            },
        );
        let serialized = diagnostic.to_string();

        assert_eq!(diagnostic["event"], "task_execution_error");
        assert_eq!(diagnostic["taskId"], "task_clothing_retry");
        assert_eq!(diagnostic["capabilityId"], "clothing-tryon-generation");
        assert_eq!(diagnostic["errorCode"], "VALIDATION_ERROR");
        assert!(!serialized.contains("raw prompt marker"));
        assert!(!serialized.contains("sk-task-diagnostic-secret"));
    }

    #[test]
    fn invalid_clothing_reference_roles_are_not_reported_as_model_capability_failure() {
        let error = normalize_model_gateway_task_error(TaskModelInvocationError::Input(
            crate::domain::generation::GenerationError::Validation(
                "服饰任务必须至少包含 1 张服装参考图，并且恰好 1 张模特参考图。".to_string(),
            ),
        ));

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(!error.retryable);
        assert_eq!(error.stage, Some(GenerationTaskStage::Failed));
    }

    #[test]
    fn clothing_scene_planning_persist_failure_uses_structured_output_error_in_history() {
        let workspace_dir = initialized_workspace("clothing-plan-persist-error");
        let generation_service = GenerationService::new();
        let created = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("clothing-plan-persist-error".to_string()),
                    workspace: WorkspaceKind::Clothing,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "服饰场景动作规划".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({
                        "kind": "clothing-scene-planning",
                        "selectedScenes": ["都市街头"],
                        "aiRecommended": false,
                    })),
                    prompt_plan_snapshot: None,
                    input_assets: Vec::new(),
                },
            )
            .expect("task should create");
        let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET status = 'running', stage = 'saving-result' WHERE id = ?1",
                [&created.id],
            )
            .expect("task should be running");
        let task = ClaimedTask {
            id: created.id.clone(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({
                "kind": "clothing-scene-planning",
                "selectedScenes": ["都市街头"],
                "aiRecommended": false,
            }),
            input_assets: Vec::new(),
        };

        let error = normalized_persist_error(&task);
        mark_task_failed(&workspace_dir, &task.id, &error).expect("failure should persist");
        let failed = generation_service
            .get_task(&workspace_dir, &task.id)
            .expect("failed task should reload");

        assert_eq!(
            failed.error.as_ref().map(|error| error.code.as_str()),
            Some("CLOTHING_SCENE_PLAN_OUTPUT_INVALID")
        );
        assert_eq!(
            failed.error.as_ref().map(|error| error.message.as_str()),
            Some("服饰场景规划结果不是有效结构化 JSON，或未满足场景与动作数量要求，请重试。")
        );

        remove_workspace(&workspace_dir);
    }

    #[test]
    fn product_detail_item_prompt_keeps_china_chinese_locale_constraint() {
        let input = product_detail_item_gateway_input(
            &json!({
                "platform": "淘宝天猫",
                "market": "中国",
                "language": "中文",
                "productSellingPoints": "藏青运动风字母印花圆领短袖T恤",
            }),
            &json!({
                "title": "使用场景图",
                "targetLanguage": "中文",
                "imagePrompt": "户外公园运动场景，保留文字安全区。",
            }),
            0,
            1,
        )
        .expect("product detail input should build");

        let user_prompt = input["prompt"]["messages"][1]["content"]
            .as_str()
            .expect("user prompt should be text");
        assert!(user_prompt.contains("目标市场：中国"));
        assert!(user_prompt.contains("目标语言：中文"));
        assert!(user_prompt.contains("当前模块目标语言：中文"));
        assert!(user_prompt.contains("必须是中国人或中国电商模特气质"));
        assert!(user_prompt.contains("新增画面文案、信息区文字和标注标签必须使用中文"));
        assert!(
            user_prompt.contains("参考图商品主体上已有英文、Logo、印花文字和图案不受目标语言影响")
        );
        assert!(user_prompt.contains("必须按原图原样保留，不得翻译、重写、删除或替换"));
        assert!(!user_prompt.contains("任何文字、标识或信息区文字"));
        assert!(!user_prompt.contains("文字安全区"));
        assert!(!user_prompt.contains("预留文字安全区"));
        assert!(user_prompt.contains("必须严格按照用户可修改文案要求生成画面内文字"));
        assert!(user_prompt.contains("“使用场景”"));
        assert!(user_prompt.contains("每一段文字必须完整使用中文双引号包裹"));
        assert!(user_prompt.contains("不得生成未被中文双引号包裹的文字"));
        assert_eq!(input["targetLanguage"].as_str(), Some("中文"));
        assert!(!user_prompt.contains("不得出现任何可读文字"));
        assert!(!user_prompt.contains("不得绘制任何文字内容"));
    }

    #[test]
    fn product_detail_item_prompt_combines_hidden_image_prompt_and_editable_copy_requirements() {
        let input = product_detail_item_gateway_input(
            &json!({
                "platform": "淘宝天猫",
                "market": "中国",
                "language": "中文",
                "productSellingPoints": "深蓝到荧光绿渐变运动T恤，胸前有英文印花 TRAINING IS NEVER DONE 和点阵图案。",
            }),
            &json!({
                "title": "首屏主视觉",
                "targetLanguage": "中文",
                "imageType": "首屏主视觉: 传递潮酷运动双属性",
                "designSpec": "设计规范：商品卖点：深蓝到荧光绿渐变运动T恤，胸前有英文印花 TRAINING IS NEVER DONE 和点阵图案；当前场景：首屏主视觉；爆款风格：街头运动风；视觉一致性：深灰工业背景、左上柔光。",
                "ratio": "9:16",
                "image_prompt": "一张高清电商首屏主视觉图，街头运动摄影风格。产品位于画面中央偏上。【产品锁定】严格保留产品原始外观与细节。",
                "copy_requirements": "主标题: \"潮酷运动无袖背心\", 排版: 粗锐利无衬线体, 下半部分居中, 大号\n副标题: \"撸铁出街都好穿\", 排版: 中等干净无衬线体, 主标题下方紧跟, 中号\n目标语言: 中文",
            }),
            0,
            1,
        )
        .expect("product detail input should build");

        let user_prompt = input["prompt"]["messages"][1]["content"]
            .as_str()
            .expect("user prompt should be text");
        assert!(user_prompt.contains("一张高清电商首屏主视觉图"));
        assert!(user_prompt.contains("【产品锁定】严格保留产品原始外观与细节"));
        assert!(user_prompt.contains("用户可修改文案要求：主标题: \"潮酷运动无袖背心\""));
        assert!(user_prompt.contains("副标题: \"撸铁出街都好穿\""));
        assert!(user_prompt.contains("场景核心卖点：首屏主视觉: 传递潮酷运动双属性"));
        assert!(user_prompt.contains("设计规范：商品卖点：深蓝到荧光绿渐变运动T恤"));
        assert!(user_prompt.contains("画面比例：9:16"));
        assert!(user_prompt.contains("必须按用户第一步选择的 9:16 比例生成"));
        assert!(user_prompt.contains("爆款风格：街头运动风"));
        assert!(user_prompt.contains("原图忠实约束"));
        assert!(user_prompt.contains("深蓝到荧光绿渐变"));
        assert!(user_prompt.contains("胸前英文印花"));
        assert!(user_prompt.contains("TRAINING IS NEVER DONE"));
        assert!(user_prompt.contains("不得翻译、重写、删除或弱化"));
        assert!(user_prompt
            .contains("核心商品主体只能做光影、背景、构图、清晰度和额外画面文案层面的微调"));
        assert!(user_prompt.contains("禁止重绘、换款、换包装"));
        assert!(user_prompt.contains("画面要求："));
        assert!(!user_prompt.contains("不得出现任何可读文字"));
        assert!(!user_prompt.contains("不得绘制任何文字内容"));
        assert!(!user_prompt.contains("后期叠字"));
        assert_eq!(input["ratio"].as_str(), Some("9:16"));
    }

    #[test]
    fn clothing_base_model_generation_expands_every_selected_body_type_in_prompts() {
        let body_types = [
            ("纤细", "小至中等骨架，身体横向宽度较窄，肩部和胯部较窄，腰身纤细，四肢细长，体脂偏低，肌肉量较少，肌肉轮廓不明显，整体线条轻盈柔和；外观健康自然，不过度消瘦，肋骨不明显，无病态骨感，人体比例真实。"),
            ("苗条", "小至中等骨架，体脂较低，腰腹平坦，腰线清晰，四肢较细，身体轮廓流畅，整体比例自然协调；身形轻盈但不过度纤弱，具有正常肌肉量，外观健康，不显干瘪，不突出骨骼，人体比例真实。"),
            ("精瘦", "中等骨架，体脂较低，肌肉量适中，腰腹紧实，肩背、手臂和腿部具有清晰但不过分突出的肌肉线条，身体紧致有力量感；肌肉体积适中，不臃肿，不呈现健美运动员般的夸张肌肉，人体比例真实。"),
            ("匀称", "中等骨架，体脂和肌肉量适中，肩、腰、胯及四肢比例协调，身体左右对称，躯干与腿部比例自然，没有明显偏瘦、偏胖或局部过度发达；整体轮廓平衡自然，人体比例真实。"),
            ("健美", "中等骨架，体脂偏低，肌肉量适中，身体紧实，肩背、腰腹、手臂和腿部均有清晰而美观的训练线条，腰腹平坦，姿态挺拔，整体富有力量感和健康感；肌肉分布均衡，不粗壮，不臃肿，不呈现专业健美运动员般的夸张体积，人体比例真实。"),
            ("运动型", "中等至较大骨架，肩部较宽，腰腹紧实，肌肉量适中，肩背、核心、臀腿和四肢具有自然的运动训练痕迹，身体灵活、有爆发力和协调感；肌肉以实用、自然为主，不过度膨胀，不追求极低体脂或明显肌肉分离度，人体比例真实。"),
            ("肌肉型", "中等至较大骨架，体脂较低至适中，肌肉量明显，肩部宽阔，胸背厚实，手臂、腰腹、臀部和腿部肌肉轮廓清晰，整体具有强烈力量感；肌肉发达但分布均衡，不出现异常膨胀，不呈现不自然的极端比例，人体比例真实。"),
            ("壮硕", "大骨架，肩背宽厚，胸腔和躯干体积较大，腰腹厚实，手臂和腿部粗壮，肌肉量较高，整体轮廓厚重、稳固，具有明显力量感和压迫感；身体结实而非单纯肥胖，肌肉与体脂自然分布，不过度夸张，不呈现漫画化体型，人体比例真实。"),
            ("结实", "中等至较大骨架，身体轮廓厚实紧致，肩背、躯干和四肢具有适中的肌肉量，手臂和腿部有力量感，腰腹不松垮，体脂处于正常或略高水平；肌肉线条自然，不追求明显分离度，不显臃肿，也不过度健美化，人体比例真实。"),
            ("丰满", "中等至较大骨架，体脂中等偏高，胸部、胯部、臀部和四肢轮廓饱满，腰线仍然清晰可辨，身体曲线圆润柔和，脂肪分布自然均衡；整体丰润但不过度肥胖，不出现异常夸张的胸、腰、臀比例，不漫画化，人体比例真实。"),
            ("微胖", "中等骨架，体脂略高，脸部、腰腹、臀部和四肢略显圆润，身体轮廓柔和，腰线较弱但仍可辨识，肌肉线条不明显，整体比例自然；仅有轻微脂肪感，不呈现明显腹部突出，不属于肥胖，不夸张圆润程度，人体比例真实。"),
            ("大码", "中等至较大骨架，体脂中等偏高，胸部、胯部、臀部和四肢轮廓饱满，腰线仍然清晰可辨，身体曲线圆润柔和，脂肪分布自然均衡；整体丰润但不过度肥胖，不出现异常夸张的胸、腰、臀比例，不漫画化，人体比例真实。"),
        ];
        let obesity_description = "中等至较大骨架，体脂明显较高，脸部、颈部、腰腹、躯干、臀部和四肢体积较大，腹部明显突出，身体轮廓宽厚圆润，肌肉线条通常不明显；脂肪分布符合真实人体结构，不进行丑化或漫画化处理，不出现不自然的局部膨胀，人体比例和关节结构真实。";

        for (body, description) in body_types {
            let task = ClaimedTask {
                id: format!("task_clothing_base_model_{body}"),
                workspace: WorkspaceKind::Clothing,
                kind: GenerationTaskKind::ImageGeneration,
                input: json!({
                    "kind": "clothing-base-model-generation",
                    "gender": "男",
                    "age": "青年",
                    "ethnicity": "中国人",
                    "body": body,
                    "appearance": "寸头，宽肩"
                }),
                input_assets: Vec::new(),
            };

            let inputs = task_gateway_inputs(Path::new("/tmp"), &task)
                .expect("clothing base model input should render");

            assert_eq!(inputs.len(), 1);
            let prompt = &inputs[0]["prompt"];
            let system_prompt = prompt["messages"][0]["content"]
                .as_str()
                .expect("system prompt should render");
            let user_prompt = prompt["messages"][1]["content"]
                .as_str()
                .expect("user prompt should render");
            let roleless_prompt = prompt["rolelessPrompt"]
                .as_str()
                .expect("roleless prompt should render");

            assert!(system_prompt.contains("专业电商服饰试穿基准模特生成器"));
            assert!(user_prompt.contains("性别：男"));
            assert!(user_prompt.contains("年龄阶段：约25岁的年轻成年人"));
            assert!(user_prompt.contains("国家/族群：中国汉族人物，呈现自然真实的现代人物外貌，仅限定人物的中国汉族身份；不自动添加传统服装、古典发型、武侠元素、红色装饰或其他中国文化符号，不夸张族裔特征，不使用刻板化形象。"));
            assert!(user_prompt.contains(&format!("身材：{description}")));
            assert!(roleless_prompt.contains(&format!("身材：{description}")));
            assert!(!user_prompt.contains(&format!("身材：{body}\n")));
            assert!(!roleless_prompt.contains(&format!("身材：{body}\n")));
            assert!(user_prompt.contains("外貌细节补充：寸头，宽肩"));
            assert!(user_prompt.contains("不要生成品牌 Logo、文字、水印"));
            assert!(!user_prompt.contains("{{gender}}"));
            assert!(!roleless_prompt.contains("{{appearance}}"));

            if body == "大码" {
                assert!(!user_prompt.contains(obesity_description));
                assert!(!roleless_prompt.contains(obesity_description));
            }
        }
    }

    #[test]
    fn clothing_base_model_generation_keeps_legacy_and_unknown_body_values_compatible() {
        let legacy_body_types = [
            ("标准", "中等骨架，体脂和肌肉量适中，肩、腰、胯及四肢比例协调，身体左右对称，躯干与腿部比例自然，没有明显偏瘦、偏胖或局部过度发达；整体轮廓平衡自然，人体比例真实。"),
            ("肌肉", "中等至较大骨架，体脂较低至适中，肌肉量明显，肩部宽阔，胸背厚实，手臂、腰腹、臀部和腿部肌肉轮廓清晰，整体具有强烈力量感；肌肉发达但分布均衡，不出现异常膨胀，不呈现不自然的极端比例，人体比例真实。"),
        ];

        for (body, description) in legacy_body_types {
            let input = clothing_base_model_gateway_input(&json!({ "body": body }))
                .expect("legacy body type should render");
            let user_prompt = input["prompt"]["messages"][1]["content"]
                .as_str()
                .expect("user prompt should render");
            let roleless_prompt = input["prompt"]["rolelessPrompt"]
                .as_str()
                .expect("roleless prompt should render");

            assert!(user_prompt.contains(&format!("身材：{description}")));
            assert!(roleless_prompt.contains(&format!("身材：{description}")));
        }

        let input = clothing_base_model_gateway_input(&json!({ "body": "自定义体型" }))
            .expect("unknown body type should render");
        let user_prompt = input["prompt"]["messages"][1]["content"]
            .as_str()
            .expect("user prompt should render");
        let roleless_prompt = input["prompt"]["rolelessPrompt"]
            .as_str()
            .expect("roleless prompt should render");

        assert!(user_prompt.contains("身材：自定义体型"));
        assert!(roleless_prompt.contains("身材：自定义体型"));
    }

    #[test]
    fn clothing_base_model_generation_expands_selected_age_groups_in_prompts() {
        let age_groups = [
            ("婴儿", "约1岁的婴儿，处于婴儿期，面部高度稚嫩，额头较宽，脸颊具有婴儿特有的圆润感，眼睛相对较大，鼻子和下巴小巧，乳牙尚未完全长齐，皮肤细腻柔嫩，头发细软或较稀疏；具有明确的婴儿年龄特征，不呈现学龄儿童、青少年或成年人的成熟五官。"),
            ("儿童", "约8岁的儿童，处于学龄儿童阶段，面部稚嫩，额头相对较宽，五官尚未完全发育成熟，鼻梁和下颌轮廓较柔和，脸部保留明显童真感，皮肤光滑细嫩，没有青春期或成年人的成熟面部特征；不婴儿化，不呈现青少年或成年人的成熟感。"),
            ("青少年", "约16岁的青少年，处于青春期后期，面部仍带有稚嫩感，同时开始出现逐渐清晰的鼻梁、下颌和面部骨骼轮廓，五官接近成年人但尚未完全成熟，皮肤年轻，可能存在少量青春期皮肤纹理；具有明确的未成年青少年特征，不幼儿化，不呈现成熟成年人的年龄感。"),
            ("青年", "约25岁的年轻成年人，面部发育完全，五官和骨骼轮廓清晰自然，皮肤紧致平滑，眼周、额头和嘴角没有明显皱纹，面部组织饱满而有弹性，头发状态年轻自然，整体呈现明确的成年感和青春活力；不呈现未成年人的稚嫩面容，也不呈现中年或老年特征。"),
            ("中年", "约45岁的中年成年人，面部轮廓成熟，眼角、额头和嘴角具有轻微自然细纹，法令纹轻微可见，皮肤质感较青年时期更加成熟，眼周可能出现轻微松弛或疲态，头发可能夹杂少量灰白，整体呈现稳定、成熟的中年年龄感；不过度年轻化，也不呈现深度皱纹或明显老年特征。"),
            ("老年", "约70岁的老年人，具有明确而自然的衰老特征，额头、眼角、眼下、嘴角和面颊存在较明显皱纹，法令纹较深，皮肤弹性下降并出现自然松弛，颈部和手部具有年龄纹理，头发大部分灰白或全白，发量可能减少；符合真实衰老规律，不极端苍老，不病态化，不使用夸张或漫画化的皱纹。"),
        ];

        for (age, description) in age_groups {
            let input = clothing_base_model_gateway_input(&json!({ "age": age }))
                .expect("selected age group should render");
            let user_prompt = input["prompt"]["messages"][1]["content"]
                .as_str()
                .expect("user prompt should render");
            let roleless_prompt = input["prompt"]["rolelessPrompt"]
                .as_str()
                .expect("roleless prompt should render");

            assert!(user_prompt.contains(&format!("年龄阶段：{description}")));
            assert!(roleless_prompt.contains(&format!("年龄阶段：{description}")));
            assert!(!user_prompt.contains(&format!("年龄阶段：{age}\n")));
            assert!(!roleless_prompt.contains(&format!("年龄阶段：{age}\n")));
        }

        let input = clothing_base_model_gateway_input(&json!({ "age": "自定义年龄" }))
            .expect("unknown age group should render");
        let user_prompt = input["prompt"]["messages"][1]["content"]
            .as_str()
            .expect("user prompt should render");
        let roleless_prompt = input["prompt"]["rolelessPrompt"]
            .as_str()
            .expect("roleless prompt should render");

        assert!(user_prompt.contains("年龄阶段：自定义年龄"));
        assert!(roleless_prompt.contains("年龄阶段：自定义年龄"));
    }

    #[test]
    fn clothing_base_model_generation_expands_selected_ethnicities_in_prompts() {
        let ethnicities = [
            (
                "欧美白人",
                "具有欧洲族裔背景的白人人物，呈现自然真实的现代人物外貌，仅限定人物的欧洲族裔背景，不限定具体国家；族裔特征自然适度，不夸张五官，不自动添加金发碧眼等固定特征，不使用影视化或刻板化形象。",
            ),
            (
                "中国人",
                "中国汉族人物，呈现自然真实的现代人物外貌，仅限定人物的中国汉族身份；不自动添加传统服装、古典发型、武侠元素、红色装饰或其他中国文化符号，不夸张族裔特征，不使用刻板化形象。",
            ),
            (
                "东亚人",
                "东亚族裔人物，呈现自然真实的现代人物外貌，仅限定人物具有东亚族裔背景，不指定中国、日本或韩国等具体国籍；不夸张面部特征，不自动套用韩式审美、日系风格或动漫形象。",
            ),
            (
                "东南亚人",
                "东南亚族裔人物，呈现自然真实的现代人物外貌，仅限定人物具有东南亚族裔背景，不指定具体国家；肤色和五官符合真实人群的自然差异，不刻意加深肤色，不自动添加民族服饰、热带背景或旅游文化符号。",
            ),
            (
                "非裔",
                "具有非洲族裔背景的人物，呈现自然真实的现代人物外貌，仅限定人物的非洲族裔背景，不默认其为非裔美国人，也不指定具体非洲地区；肤色、五官和发型自然真实，不夸张，不漫画化，不使用刻板化形象。",
            ),
            (
                "中东人",
                "具有中东地区族裔背景的人物，呈现自然真实的现代人物外貌，仅限定人物具有中东地区背景，不指定阿拉伯、波斯、库尔德或土耳其等具体族群；不自动添加头巾、宗教服饰、传统长袍、沙漠或其他文化符号。",
            ),
            (
                "拉丁裔",
                "具有拉丁美洲背景的人物，呈现自然真实的现代人物外貌，仅限定人物的拉丁美洲地域与文化背景；不预设固定肤色、五官或单一人种，不自动添加热带服装、舞蹈元素或其他拉丁文化刻板符号。",
            ),
        ];

        for (ethnicity, description) in ethnicities {
            let input = clothing_base_model_gateway_input(&json!({ "ethnicity": ethnicity }))
                .expect("selected ethnicity should render");
            let user_prompt = input["prompt"]["messages"][1]["content"]
                .as_str()
                .expect("user prompt should render");
            let roleless_prompt = input["prompt"]["rolelessPrompt"]
                .as_str()
                .expect("roleless prompt should render");

            assert!(user_prompt.contains(&format!("国家/族群：{description}")));
            assert!(roleless_prompt.contains(&format!("国家/族群：{description}")));
            assert!(!user_prompt.contains(&format!("国家/族群：{ethnicity}\n")));
            assert!(!roleless_prompt.contains(&format!("国家/族群：{ethnicity}\n")));
        }

        let input = clothing_base_model_gateway_input(&json!({ "ethnicity": "自定义人群" }))
            .expect("unknown ethnicity should render");
        let user_prompt = input["prompt"]["messages"][1]["content"]
            .as_str()
            .expect("user prompt should render");
        let roleless_prompt = input["prompt"]["rolelessPrompt"]
            .as_str()
            .expect("roleless prompt should render");

        assert!(user_prompt.contains("国家/族群：自定义人群"));
        assert!(roleless_prompt.contains("国家/族群：自定义人群"));
    }

    #[test]
    fn clothing_base_model_generation_maps_gender_to_hair_and_prioritizes_user_appearance() {
        let gender_hair = [
            (
                "男",
                "男性化自然发型，以短发或中短发为主，头发长度不超过耳部和后颈，顶部保留适度层次和自然蓬松感，两侧与后部整洁利落，发际线和头发质感真实，发型符合人物年龄与日常身份；不使用长发、女性化编发、夸张造型、奇异发饰或舞台化发型。",
            ),
            (
                "女",
                "女性化自然发型，以中长发或长发为主，头发自然垂落或采用简洁的低马尾、自然盘发，具有柔和层次、自然发量和真实发丝质感，发型符合人物年龄与日常身份；不使用男性化极短发、夸张编发、复杂发饰、奇异造型或舞台化发型。",
            ),
        ];

        for (gender, hair_description) in gender_hair {
            let input = clothing_base_model_gateway_input(&json!({
                "gender": gender,
                "appearance": "用户指定的长发、粉色发夹",
            }))
            .expect("gender hair prompt should render");
            let system_prompt = input["prompt"]["messages"][0]["content"]
                .as_str()
                .expect("system prompt should render");
            let user_prompt = input["prompt"]["messages"][1]["content"]
                .as_str()
                .expect("user prompt should render");
            let roleless_prompt = input["prompt"]["rolelessPrompt"]
                .as_str()
                .expect("roleless prompt should render");

            assert!(user_prompt.contains(&format!("性别对应发型：{hair_description}")));
            assert!(roleless_prompt.contains(&format!("性别对应发型：{hair_description}")));
            assert!(system_prompt.contains(
                "用户输入的外貌细节与性别对应的内置发型描述冲突时，以用户输入的外貌细节为主"
            ));
            assert!(user_prompt
                .contains("用户填写的外貌细节与性别对应的内置发型描述冲突时，以用户输入为主"));
            assert!(roleless_prompt
                .contains("用户填写的外貌细节与性别对应的内置发型描述冲突时，以用户输入为主"));
            assert!(user_prompt.contains("外貌细节补充：用户指定的长发、粉色发夹"));
            assert!(system_prompt.contains("输出图片必须严格为 2:3 纵向比例"));
            assert!(user_prompt.contains("输出图片必须严格为 2:3 纵向比例"));
            assert!(roleless_prompt.contains("输出图片必须严格为 2:3 纵向比例"));
        }

        let input = clothing_base_model_gateway_input(&json!({ "gender": "未知性别" }))
            .expect("unknown gender should remain renderable");
        let user_prompt = input["prompt"]["messages"][1]["content"]
            .as_str()
            .expect("user prompt should render");
        assert!(user_prompt.contains("性别：未知性别"));
        assert!(user_prompt.contains("性别对应发型：未知性别"));
    }

    #[test]
    fn clothing_scene_planning_input_uses_configured_prompt_template() {
        let task = ClaimedTask {
            id: "task_clothing_scene_plan".to_string(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({
                "kind": "clothing-scene-planning",
                "selectedScenes": ["都市街头"],
                "customScene": "午后暖调阳光，轻奢门店橱窗背景",
                "aiRecommended": false,
                "ratio": "3:4",
                "userImages": [
                    { "role": "source", "dataUrl": "data:image/png;base64,garment-a" },
                    { "role": "model", "dataUrl": "data:image/png;base64,model-b" }
                ],
            }),
            input_assets: Vec::new(),
        };

        let inputs = task_gateway_inputs(Path::new("/tmp"), &task)
            .expect("clothing scene planning input should render");

        assert_eq!(inputs.len(), 1);
        let prompt = &inputs[0]["prompt"];
        let system_prompt = prompt["messages"][0]["content"]
            .as_str()
            .expect("system prompt should render");
        let user_prompt = prompt["messages"][1]["content"]
            .as_str()
            .expect("user prompt should render");
        assert!(system_prompt.contains("专业服饰商拍场景与动作规划师"));
        assert!(system_prompt.contains("场景与动作规划阶段"));
        assert!(user_prompt.contains("用户已选择场景：都市街头"));
        assert!(user_prompt.contains("自定义场景描述：午后暖调阳光，轻奢门店橱窗背景"));
        assert!(user_prompt.contains("服装参考：用户上传的服装原图"));
        assert!(user_prompt.contains("模特参考：用户选择的模特全身图"));
        assert!(user_prompt.contains("出图比例/尺寸：3:4"));
        assert!(user_prompt.contains("不得规划会遮挡、扭曲或覆盖服装文字、Logo、花纹的动作"));
        assert!(user_prompt.contains("每个场景必须输出 4 个动作"));
        assert!(!user_prompt.contains("{{selectedScenes}}"));
        assert!(!user_prompt.contains("{{clothingReference}}"));
        assert!(!user_prompt.contains("{{modelReference}}"));
        assert_eq!(inputs[0]["maxOutputTokens"], 3000);
    }

    #[test]
    fn clothing_scene_planning_prompt_labels_multiple_garments_and_one_model_in_image_order() {
        let input = clothing_scene_planning_gateway_input(&json!({
            "kind": "clothing-scene-planning",
            "selectedScenes": ["都市街头"],
            "aiRecommended": false,
            "ratio": "3:4",
            "userImages": [
                { "role": "source", "dataUrl": "data:image/png;base64,garment-a" },
                { "role": "reference", "dataUrl": "data:image/png;base64,garment-b" },
                { "role": "source", "dataUrl": "data:image/png;base64,garment-c" },
                { "role": "model", "dataUrl": "data:image/png;base64,model-d" }
            ]
        }))
        .expect("planning prompt should accept multiple garment references and one model");
        let prompt = input.get("prompt").expect("prompt should render");
        let combined_prompt = format!(
            "{}\n{}",
            prompt["messages"]
                .as_array()
                .expect("messages should be an array")
                .iter()
                .filter_map(|message| message.get("content").and_then(serde_json::Value::as_str))
                .collect::<Vec<_>>()
                .join("\n"),
            prompt["rolelessPrompt"]
                .as_str()
                .expect("roleless prompt should render")
        );

        for expected in [
            "参考图 A：服装参考图 1。用于锁定服装设计。",
            "参考图 B：服装参考图 2。用于锁定服装设计。",
            "参考图 C：服装参考图 3。用于锁定服装设计。",
            "参考图 D：模特参考图。用于锁定人物身份。",
            "参考图 A、B、C",
            "参考图 D",
        ] {
            assert!(
                combined_prompt.contains(expected),
                "planning prompt should include {expected}"
            );
        }
        assert!(!combined_prompt.contains("{{referenceImageRoles}}"));
        assert!(!combined_prompt.contains("严格基于两张参考图"));
    }

    #[test]
    fn clothing_scene_planning_rejects_multiple_model_references() {
        let error = clothing_scene_planning_gateway_input(&json!({
            "kind": "clothing-scene-planning",
            "selectedScenes": ["都市街头"],
            "userImages": [
                { "role": "source", "dataUrl": "data:image/png;base64,garment-a" },
                { "role": "model", "dataUrl": "data:image/png;base64,model-b" },
                { "role": "model", "dataUrl": "data:image/png;base64,model-c" }
            ]
        }))
        .expect_err("planning should require exactly one model reference");

        assert!(error.to_string().contains("恰好 1 张模特参考图"));
    }

    #[test]
    fn clothing_tryon_generation_rejects_missing_or_empty_items() {
        for input in [
            json!({ "kind": "clothing-tryon-generation" }),
            json!({ "kind": "clothing-tryon-generation", "items": [] }),
        ] {
            let task = ClaimedTask {
                id: "task_clothing_tryon_without_items".to_string(),
                workspace: WorkspaceKind::Clothing,
                kind: GenerationTaskKind::ImageGeneration,
                input,
                input_assets: Vec::new(),
            };

            let error = task_gateway_inputs(Path::new("/tmp"), &task)
                .expect_err("clothing tryon should require at least one item");

            match error {
                crate::domain::generation::GenerationError::Validation(message) => {
                    assert_eq!(message, "服饰出图任务必须至少包含 1 个已选择的场景动作。")
                }
                other => panic!("expected validation error, got {other}"),
            }
        }
    }

    #[test]
    fn clothing_tryon_generation_items_expand_to_per_pose_gateway_inputs() {
        let task = ClaimedTask {
            id: "task_clothing_tryon".to_string(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({
                "kind": "clothing-tryon-generation",
                "ratio": "9:16",
                "userImages": [
                    { "role": "source", "dataUrl": "data:image/png;base64,garment-a" },
                    { "role": "model", "dataUrl": "data:image/png;base64,model-b" }
                ],
                "items": [
                    {
                        "id": "urban-1",
                        "scene": "都市街头",
                        "sceneVisualAnchor": "城市核心商圈人行道，背景是轻奢门店招牌",
                        "scenePromptSegment": "街头时尚摄影，自然光充足照明，8K高清商业电商质感",
                        "cameraSetup": {
                            "framing": "全身",
                            "perspective": "正面",
                            "shootingPosition": "平视机位"
                        },
                        "poseAction": "站立于街头，双手自然垂在身侧，抬头直视镜头"
                    },
                    {
                        "id": "urban-2",
                        "scene": "都市街头",
                        "sceneVisualAnchor": "城市核心商圈人行道，背景是轻奢门店招牌",
                        "scenePromptSegment": "街头时尚摄影，自然光充足照明，8K高清商业电商质感",
                        "cameraSetup": {
                            "framing": "四分之三",
                            "perspective": "3/4侧",
                            "shootingPosition": "低机位轻仰拍"
                        },
                        "poseAction": "身体微侧对镜头，一只手插裤袋，另一只手搭挎包肩带"
                    }
                ]
            }),
            input_assets: Vec::new(),
        };

        let inputs = task_gateway_inputs(Path::new("/tmp"), &task)
            .expect("clothing tryon inputs should render");

        assert_eq!(inputs.len(), 2);
        assert_eq!(inputs[0]["itemId"], "urban-1");
        assert_eq!(inputs[1]["itemId"], "urban-2");
        assert_eq!(inputs[0]["ratio"], "9:16");
        let prompt = &inputs[0]["prompt"];
        let system_prompt = prompt["messages"][0]["content"]
            .as_str()
            .expect("tryon system prompt should render");
        let user_prompt = prompt["messages"][1]["content"]
            .as_str()
            .expect("tryon user prompt should render");
        let roleless_prompt = prompt["rolelessPrompt"]
            .as_str()
            .expect("tryon roleless prompt should render");
        assert!(system_prompt.contains("电商服饰虚拟试穿与场景商拍图像生成模型"));
        assert!(system_prompt.contains("image-to-image 服饰试穿合成任务"));
        assert!(system_prompt.contains("不得换脸、换人"));
        assert!(system_prompt.contains("不得新增不存在的图案、文字、Logo"));
        assert!(user_prompt.contains("场景标题：都市街头"));
        assert!(user_prompt.contains("城市核心商圈人行道"));
        assert!(user_prompt.contains("图片尺寸 / 比例：9:16"));
        assert!(user_prompt.contains("拍摄画幅：全身"));
        assert!(user_prompt.contains("拍摄角度：正面"));
        assert!(user_prompt.contains("拍摄位置：平视机位"));
        assert!(user_prompt.contains("动作要求：站立于街头"));
        assert!(user_prompt.contains("参考图 A：服装参考图 1。用于锁定服装设计。"));
        assert!(user_prompt.contains("参考图 B：模特参考图。用于锁定人物身份。"));
        assert!(user_prompt
            .contains("服装的颜色、版型、图案、Logo、文字、关键结构必须与参考图 A 保持一致"));
        assert!(roleless_prompt.contains("【用户选择的场景】"));
        assert!(roleless_prompt.contains("图片尺寸 / 比例：9:16"));
        assert!(!user_prompt.contains("{{scene}}"));
        assert!(!roleless_prompt.contains("{{poseAction}}"));
        assert!(!system_prompt.contains("{{"));
        assert!(!user_prompt.contains("{{"));
        assert!(!roleless_prompt.contains("{{"));
    }

    #[test]
    fn clothing_tryon_prompt_labels_multiple_garments_and_model_in_actual_image_order() {
        let task_input = json!({
            "kind": "clothing-tryon-generation",
            "ratio": "3:4",
            "userImages": [
                { "role": "source", "dataUrl": "data:image/png;base64,garment-a" },
                { "role": "source", "dataUrl": "data:image/png;base64,garment-b" },
                { "role": "source", "dataUrl": "data:image/png;base64,garment-c" },
                { "role": "source", "dataUrl": "data:image/png;base64,garment-d" },
                { "role": "source", "dataUrl": "data:image/png;base64,garment-e" },
                { "role": "model", "dataUrl": "data:image/png;base64,model-f" }
            ]
        });
        let item = json!({
            "scene": "都市街头",
            "sceneVisualAnchor": "城市核心商圈人行道",
            "scenePromptSegment": "街头时尚摄影",
            "cameraSetup": {
                "framing": "全身",
                "perspective": "正面",
                "shootingPosition": "平视机位"
            },
            "poseAction": "自然站立"
        });

        let input = clothing_tryon_item_gateway_input(&task_input, &item, 0)
            .expect("clothing tryon input should render");
        let user_prompt = input["prompt"]["messages"][1]["content"]
            .as_str()
            .expect("user prompt should render");
        let system_prompt = input["prompt"]["messages"][0]["content"]
            .as_str()
            .expect("system prompt should render");
        let roleless_prompt = input["prompt"]["rolelessPrompt"]
            .as_str()
            .expect("roleless prompt should render");

        for prompt in [system_prompt, user_prompt, roleless_prompt] {
            assert!(prompt.contains("参考图 A：服装参考图 1"));
            assert!(prompt.contains("参考图 E：服装参考图 5"));
            assert!(prompt.contains("参考图 F：模特参考图"));
            assert!(prompt.contains("参考图 A、B、C、D、E"));
            assert!(prompt.contains("参考图 F 中的同一位模特"));
            assert!(!prompt.contains("参考图 B：模特参考图"));
            assert!(!prompt.contains("{{referenceImageRoles}}"));
        }
    }

    #[test]
    fn clothing_tryon_stops_invoking_after_task_is_cancelled_between_items() {
        let workspace_dir = initialized_workspace("local-executor-clothing-cancel-between-items");
        let generation_service = GenerationService::new();
        let task = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("clothing-cancel-between-items".to_string()),
                    workspace: WorkspaceKind::Clothing,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "服饰出图".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({
                        "kind": "clothing-tryon-generation",
                        "items": [{ "id": "pose-1" }, { "id": "pose-2" }],
                    })),
                    prompt_plan_snapshot: None,
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
            .expect("mark running");
        let claimed_task = ClaimedTask {
            id: task.id.clone(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({ "kind": "clothing-tryon-generation" }),
            input_assets: Vec::new(),
        };
        let mut invocation_count = 0usize;

        let results = invoke_gateway_inputs_for_task(
            &workspace_dir,
            &claimed_task,
            "clothing-tryon-generation",
            vec![json!({ "itemId": "pose-1" }), json!({ "itemId": "pose-2" })],
            |_capability_id, _input| {
                invocation_count += 1;
                generation_service
                    .cancel_task(&workspace_dir, &task.id)
                    .expect("first invocation should cancel task");
                Ok(ModelGatewayResult {
                    invocation_id: format!("model_invocation_{invocation_count}"),
                    capability_id: "clothing-tryon-generation".to_string(),
                    provider_profile_id: "volcengine".to_string(),
                    model: "image-model".to_string(),
                    output_text: None,
                    output_json: json!({ "type": "image", "images": [] }),
                })
            },
        )
        .expect("cancelled task should stop without failing completed invocation");

        assert_eq!(invocation_count, 1);
        assert_eq!(results.len(), 1);
        assert!(!task_is_running(&workspace_dir, &task.id).expect("task should be cancelled"));

        remove_workspace(&workspace_dir);
    }

    #[test]
    fn clothing_tryon_persists_successful_item_before_later_provider_failure() {
        let workspace_dir = initialized_workspace("local-executor-clothing-persist-before-failure");
        let generation_service = GenerationService::new();
        let task = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("clothing-persist-before-failure".to_string()),
                    workspace: WorkspaceKind::Clothing,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "服饰出图".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({
                        "kind": "clothing-tryon-generation",
                        "items": [{ "id": "pose-1" }, { "id": "pose-2" }],
                    })),
                    prompt_plan_snapshot: None,
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
            .expect("mark running");
        let claimed_task = ClaimedTask {
            id: task.id.clone(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({ "kind": "clothing-tryon-generation" }),
            input_assets: Vec::new(),
        };
        let mut invocation_count = 0usize;

        let error = invoke_gateway_inputs_for_task(
            &workspace_dir,
            &claimed_task,
            "clothing-tryon-generation",
            vec![json!({ "itemId": "pose-1" }), json!({ "itemId": "pose-2" })],
            |_capability_id, _input| {
                invocation_count += 1;
                if invocation_count == 2 {
                    return Err(crate::services::model_config::ModelConfigError::Validation(
                        "second item provider failed".to_string(),
                    ));
                }
                Ok(ModelGatewayResult {
                    invocation_id: "model_invocation_first_item".to_string(),
                    capability_id: "clothing-tryon-generation".to_string(),
                    provider_profile_id: "volcengine".to_string(),
                    model: "image-model".to_string(),
                    output_text: None,
                    output_json: json!({
                        "type": "image",
                        "images": [{
                            "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
                            "mimeType": "image/png",
                        }],
                    }),
                })
            },
        )
        .expect_err("later provider failure should still surface");

        assert!(error.to_string().contains("second item provider failed"));
        assert_eq!(invocation_count, 2);
        let detail = generation_service
            .get_task_detail(&workspace_dir, &task.id)
            .expect("task detail should load");
        assert_eq!(detail.output_assets.len(), 1);
        assert_eq!(detail.output_assets[0].sort_order, 0);
        assert_eq!(
            task_event_count(&workspace_dir, &task.id, "task.item-provider-called"),
            2
        );
        assert_eq!(
            task_event_count(&workspace_dir, &task.id, "task.item-provider-succeeded"),
            1
        );

        remove_workspace(&workspace_dir);
    }

    #[test]
    fn clothing_scene_plan_output_rejects_missing_scenes_poses_and_required_fields() {
        let invalid_outputs = [
            json!({}),
            json!({ "scenes": [] }),
            json!({
                "scenes": [{
                    "scene": "都市街头",
                    "sceneVisualAnchor": "",
                    "scenePromptSegment": "街头时尚摄影",
                    "recommendedPoses": complete_clothing_scene_poses(),
                }],
            }),
            json!({
                "scenes": [{
                    "scene": "都市街头",
                    "sceneVisualAnchor": "城市核心商圈人行道",
                    "scenePromptSegment": "街头时尚摄影",
                    "recommendedPoses": [complete_clothing_scene_poses()[0].clone()],
                }],
            }),
            json!({
                "scenes": [{
                    "scene": "都市街头",
                    "sceneVisualAnchor": "城市核心商圈人行道",
                    "scenePromptSegment": "街头时尚摄影",
                    "recommendedPoses": [
                        {
                            "cameraSetup": {
                                "framing": "",
                                "perspective": "正面",
                                "shootingPosition": "平视机位",
                            },
                            "poseAction": "自然站立",
                        },
                        complete_clothing_scene_poses()[1].clone(),
                        complete_clothing_scene_poses()[2].clone(),
                        complete_clothing_scene_poses()[3].clone(),
                    ],
                }],
            }),
        ];

        for (index, output) in invalid_outputs.into_iter().enumerate() {
            let workspace_dir = initialized_workspace(&format!(
                "local-executor-invalid-clothing-scene-plan-{index}"
            ));
            let generation_service = GenerationService::new();
            let task = generation_service
                .create_task(
                    &workspace_dir,
                    CreateGenerationTaskInput {
                        idempotency_key: Some(format!("invalid-clothing-scene-plan-{index}")),
                        workspace: WorkspaceKind::Clothing,
                        kind: GenerationTaskKind::ImageGeneration,
                        title: "服饰场景动作规划".to_string(),
                        prompt_plan_id: None,
                        input: Some(json!({
                            "kind": "clothing-scene-planning",
                            "selectedScenes": ["都市街头"],
                            "aiRecommended": false,
                        })),
                        prompt_plan_snapshot: None,
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
                .expect("mark running");
            let claimed_task = ClaimedTask {
                id: task.id.clone(),
                workspace: WorkspaceKind::Clothing,
                kind: GenerationTaskKind::ImageGeneration,
                input: json!({
                    "kind": "clothing-scene-planning",
                    "selectedScenes": ["都市街头"],
                    "aiRecommended": false,
                }),
                input_assets: Vec::new(),
            };

            let error = persist_structured_model_output(
                &workspace_dir,
                &claimed_task,
                &ModelGatewayResult {
                    invocation_id: format!("model_invocation_invalid_{index}"),
                    capability_id: "clothing-scene-planning".to_string(),
                    provider_profile_id: "openai".to_string(),
                    model: "vision-model".to_string(),
                    output_text: Some(output.to_string()),
                    output_json: json!({ "type": "text" }),
                },
            )
            .expect_err("incomplete clothing scene plan should be rejected");

            assert!(error.to_string().contains("服饰场景规划结果"));
            remove_workspace(&workspace_dir);
        }
    }

    #[test]
    fn clothing_scene_plan_output_requires_four_scenes_for_ai_recommendation() {
        let workspace_dir = initialized_workspace("local-executor-ai-clothing-scene-count");
        let generation_service = GenerationService::new();
        let task = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("ai-clothing-scene-count".to_string()),
                    workspace: WorkspaceKind::Clothing,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "服饰场景动作规划".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({
                        "kind": "clothing-scene-planning",
                        "selectedScenes": [],
                        "aiRecommended": true,
                    })),
                    prompt_plan_snapshot: None,
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
            .expect("mark running");
        let claimed_task = ClaimedTask {
            id: task.id.clone(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({
                "kind": "clothing-scene-planning",
                "selectedScenes": [],
                "aiRecommended": true,
            }),
            input_assets: Vec::new(),
        };
        let output = json!({
            "scenes": [{
                "scene": "都市街头",
                "sceneVisualAnchor": "城市核心商圈人行道",
                "scenePromptSegment": "街头时尚摄影",
                "recommendedPoses": complete_clothing_scene_poses(),
            }],
        });

        let error = persist_structured_model_output(
            &workspace_dir,
            &claimed_task,
            &ModelGatewayResult {
                invocation_id: "model_invocation_ai_scene_count".to_string(),
                capability_id: "clothing-scene-planning".to_string(),
                provider_profile_id: "openai".to_string(),
                model: "vision-model".to_string(),
                output_text: Some(output.to_string()),
                output_json: json!({ "type": "text" }),
            },
        )
        .expect_err("AI recommendation should require exactly four scenes");

        assert!(error.to_string().contains("AI 推荐时必须包含 4 个 scenes"));
        remove_workspace(&workspace_dir);
    }

    #[test]
    fn clothing_scene_plan_output_accepts_variable_user_selected_scene_count() {
        let claimed_task = ClaimedTask {
            id: "task_selected_clothing_scene".to_string(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({
                "kind": "clothing-scene-planning",
                "selectedScenes": ["都市街头"],
                "aiRecommended": false,
            }),
            input_assets: Vec::new(),
        };
        let output = json!({
            "scenes": [{
                "scene": "都市街头",
                "sceneVisualAnchor": "城市核心商圈人行道",
                "scenePromptSegment": "街头时尚摄影",
                "recommendedPoses": complete_clothing_scene_poses(),
            }],
        });

        validate_clothing_scene_plan_output(&claimed_task, &output)
            .expect("one user-selected scene with four complete poses should be valid");
    }

    #[test]
    fn clothing_scene_plan_output_must_cover_exactly_the_user_selected_scenes() {
        let claimed_task = ClaimedTask {
            id: "task_selected_clothing_scene_mismatch".to_string(),
            workspace: WorkspaceKind::Clothing,
            kind: GenerationTaskKind::ImageGeneration,
            input: json!({
                "kind": "clothing-scene-planning",
                "selectedScenes": ["都市街头", "通勤咖啡馆"],
                "aiRecommended": false,
            }),
            input_assets: Vec::new(),
        };
        let output = json!({
            "scenes": [
                {
                    "scene": "都市街头",
                    "sceneVisualAnchor": "城市核心商圈人行道",
                    "scenePromptSegment": "街头时尚摄影",
                    "recommendedPoses": complete_clothing_scene_poses(),
                },
                {
                    "scene": "海滩度假",
                    "sceneVisualAnchor": "海边沙滩与棕榈树",
                    "scenePromptSegment": "度假生活方式摄影",
                    "recommendedPoses": complete_clothing_scene_poses(),
                },
            ],
        });

        let error = validate_clothing_scene_plan_output(&claimed_task, &output)
            .expect_err("missing or unexpected selected scene should be rejected");

        assert!(error
            .to_string()
            .contains("scenes 必须与用户 selectedScenes 完全一致"));
    }

    fn complete_clothing_scene_poses() -> Vec<serde_json::Value> {
        (1..=4)
            .map(|index| {
                json!({
                    "cameraSetup": {
                        "framing": "全身",
                        "perspective": "正面",
                        "shootingPosition": "平视机位",
                    },
                    "poseAction": format!("动作 {index}"),
                })
            })
            .collect()
    }

    #[test]
    fn parse_listing_copy_output_accepts_json_code_fence() {
        let output = parse_listing_copy_output(&ModelGatewayResult {
            invocation_id: "model_invocation_test".to_string(),
            capability_id: "listing-copy".to_string(),
            provider_profile_id: "volcengine".to_string(),
            model: "deepseek-v4-flash-260425".to_string(),
            output_text: Some(
                r#"```json
{
  "title": "满婷氨基酸净澈清透洁面乳",
  "sellingPoints": ["氨基酸表活洁面", "软管包装取用方便"],
  "promotionBenefits": ["适合日常面部清洁"],
  "detailCopy": "适合日常早晚洁面使用，清洁后肤感清爽。",
  "searchKeywords": ["满婷洁面乳", "氨基酸洁面"],
  "attributeWords": ["白色软管", "蓝色标识"],
  "mainImageGuidance": ["主图突出产品正面包装"]
}
```"#
                    .to_string(),
            ),
            output_json: serde_json::json!({ "type": "text" }),
        })
        .expect("json code fence should parse");

        assert_eq!(
            output.get("title").and_then(serde_json::Value::as_str),
            Some("满婷氨基酸净澈清透洁面乳")
        );
    }

    #[test]
    fn downloaded_image_mime_type_falls_back_to_hint_for_octet_stream() {
        let mime_type = downloaded_image_mime_type(Some("application/octet-stream"), "image/jpeg")
            .expect("octet stream should fall back to image hint");

        assert_eq!(mime_type, "image/jpeg");
    }

    #[test]
    fn product_detail_inputs_are_batched_by_background_concurrency_limit() {
        assert_eq!(
            product_detail_input_batches(0, BACKGROUND_TASK_CONCURRENCY),
            Vec::<Range<usize>>::new()
        );
        assert_eq!(
            product_detail_input_batches(3, BACKGROUND_TASK_CONCURRENCY),
            vec![0..3]
        );
        assert_eq!(
            product_detail_input_batches(10, BACKGROUND_TASK_CONCURRENCY),
            vec![0..4, 4..8, 8..10]
        );
        assert_eq!(product_detail_input_batches(3, 0), vec![0..1, 1..2, 2..3]);
    }

    #[test]
    fn product_detail_item_batches_use_bounded_parallelism_inside_one_background_task() {
        assert_eq!(PRODUCT_DETAIL_ITEM_CONCURRENCY, 4);
        assert_eq!(
            product_detail_input_batches(5, PRODUCT_DETAIL_ITEM_CONCURRENCY),
            vec![0..4, 4..5]
        );
    }

    #[test]
    fn product_detail_output_sort_order_keeps_failed_item_slots_and_unique_multi_outputs() {
        assert_eq!(product_detail_output_sort_order_start(0, 1), 1);
        assert_eq!(product_detail_output_sort_order_start(2, 1), 2);
        assert_eq!(product_detail_output_sort_order_start(2, 2), 2);
    }

    #[test]
    fn task_input_with_asset_reference_images_loads_images_without_persisting_data_urls() {
        let workspace_dir = initialized_workspace("local-executor-input-assets");
        let source_path = workspace_dir.join("source.png");
        let model_path = workspace_dir.join("model.png");
        fs::write(&source_path, transparent_png_bytes()).expect("source image should write");
        fs::write(&model_path, transparent_png_bytes()).expect("model image should write");
        let asset_service = AssetService::new();
        let imported_source_assets = asset_service
            .import_images(
                &workspace_dir,
                ImportImagesInput {
                    kind: AssetKind::Source,
                    paths: vec![source_path.to_string_lossy().to_string()],
                },
            )
            .expect("source image should import");
        let imported_model_assets = asset_service
            .import_images(
                &workspace_dir,
                ImportImagesInput {
                    kind: AssetKind::Model,
                    paths: vec![model_path.to_string_lossy().to_string()],
                },
            )
            .expect("model image should import");
        let generation_service = GenerationService::new();
        let task = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("input-assets".to_string()),
                    workspace: WorkspaceKind::Product,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "商品详情图".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({
                        "kind": "product-detail-generation",
                        "items": [
                            {
                                "imagePrompt": "展示商品细节",
                                "sceneDescription": "展示商品细节",
                                "title": "细节图",
                            }
                        ],
                    })),
                    prompt_plan_snapshot: None,
                    input_assets: vec![
                        GenerationTaskInputAssetInput {
                            asset_id: imported_source_assets[0].id.clone(),
                            role: "source".to_string(),
                            sort_order: 0,
                        },
                        GenerationTaskInputAssetInput {
                            asset_id: imported_model_assets[0].id.clone(),
                            role: "model".to_string(),
                            sort_order: 1,
                        },
                    ],
                },
            )
            .expect("task should create");

        let claimed = claim_next_queued_task(&workspace_dir)
            .expect("claim should query")
            .expect("task should claim");
        assert_eq!(claimed.id, task.id);
        let provider_input = task_input_with_asset_reference_images(&workspace_dir, &claimed)
            .expect("provider input should build");
        let user_images = provider_input
            .get("userImages")
            .and_then(serde_json::Value::as_array)
            .expect("provider input should include user images");

        assert_eq!(user_images.len(), 2);
        assert_eq!(user_images[0]["assetId"], imported_source_assets[0].id);
        assert_eq!(user_images[0]["role"], "source");
        assert_eq!(user_images[0]["sortOrder"], 0);
        assert_eq!(user_images[0]["mimeType"], "image/png");
        assert!(user_images[0]["dataUrl"]
            .as_str()
            .expect("data url should be string")
            .starts_with("data:image/png;base64,"));
        assert_eq!(user_images[1]["assetId"], imported_model_assets[0].id);
        assert_eq!(user_images[1]["role"], "model");
        assert_eq!(user_images[1]["sortOrder"], 1);
        assert!(user_images[1]["dataUrl"]
            .as_str()
            .expect("model data url should be string")
            .starts_with("data:image/png;base64,"));
        let detail = generation_service
            .get_task_detail(&workspace_dir, &task.id)
            .expect("task detail should reload");
        assert!(!detail.input.unwrap().to_string().contains("data:image/"));

        remove_workspace(&workspace_dir);
    }

    #[test]
    fn terminal_updates_do_not_override_cancelled_running_task() {
        let workspace_dir = initialized_workspace("local-executor-cancelled-terminal");
        let generation_service = GenerationService::new();
        let task = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("cancelled-terminal".to_string()),
                    workspace: WorkspaceKind::Scene,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "场景图任务".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({ "prompt": "白色摄影棚，柔光" })),
                    prompt_plan_snapshot: None,
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
            .expect("mark running");

        generation_service
            .cancel_task(&workspace_dir, &task.id)
            .expect("running task should cancel");
        mark_task_succeeded(
            &workspace_dir,
            &ClaimedTask {
                id: task.id.clone(),
                workspace: WorkspaceKind::Scene,
                kind: GenerationTaskKind::ImageGeneration,
                input: json!({}),
                input_assets: Vec::new(),
            },
            &["inv_cancelled".to_string()],
            None,
        )
        .expect("terminal no-op should not fail");
        update_stage(
            &workspace_dir,
            &task.id,
            GenerationTaskStage::SavingResult,
            "task.result-saving",
            None,
        )
        .expect("stage no-op should not fail");
        insert_task_event(
            &database,
            &task.id,
            "test.marker",
            Some(GenerationTaskStage::Failed),
            None,
        )
        .expect("control event should insert");

        let cancelled = generation_service
            .get_task(&workspace_dir, &task.id)
            .expect("task should reload");

        assert_eq!(cancelled.status, GenerationTaskStatus::Cancelled);
        assert_eq!(
            task_event_count(&workspace_dir, &task.id, "task.succeeded"),
            0
        );
        assert_eq!(
            task_event_count(&workspace_dir, &task.id, "task.result-saving"),
            0
        );
        assert_eq!(task_event_count(&workspace_dir, &task.id, "test.marker"), 1);

        remove_workspace(&workspace_dir);
    }

    #[test]
    fn claimed_task_does_not_call_provider_after_it_was_cancelled() {
        let workspace_dir = initialized_workspace("local-executor-cancel-before-provider");
        let generation_service = GenerationService::new();
        let task = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("cancel-before-provider".to_string()),
                    workspace: WorkspaceKind::Scene,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "场景图任务".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({ "prompt": "白色摄影棚，柔光" })),
                    prompt_plan_snapshot: None,
                    input_assets: Vec::new(),
                },
            )
            .expect("task should create");
        let database = WorkspaceDatabase::open(&workspace_dir).expect("database should open");
        database
            .connection()
            .execute(
                "UPDATE generation_tasks SET status = 'cancelled', stage = 'failed' WHERE id = ?1",
                [&task.id],
            )
            .expect("mark cancelled");

        let result = execute_claimed_task(
            &workspace_dir,
            ClaimedTask {
                id: task.id.clone(),
                workspace: WorkspaceKind::Scene,
                kind: GenerationTaskKind::ImageGeneration,
                input: json!({ "prompt": "白色摄影棚，柔光" }),
                input_assets: Vec::new(),
            },
        )
        .expect("cancelled task should return cleanly");

        assert_eq!(result.task_id, task.id);
        assert!(result.invocation_id.is_none());
        assert_eq!(model_invocation_count(&workspace_dir), 0);
        assert_eq!(
            task_event_count(&workspace_dir, &task.id, "task.provider-called"),
            0
        );

        remove_workspace(&workspace_dir);
    }

    #[test]
    fn task_running_check_tracks_cancelled_status_between_detail_items() {
        let workspace_dir = initialized_workspace("local-executor-detail-cancel-between-items");
        let generation_service = GenerationService::new();
        let task = generation_service
            .create_task(
                &workspace_dir,
                CreateGenerationTaskInput {
                    idempotency_key: Some("detail-cancel-between-items".to_string()),
                    workspace: WorkspaceKind::Product,
                    kind: GenerationTaskKind::ImageGeneration,
                    title: "商品详情图".to_string(),
                    prompt_plan_id: None,
                    input: Some(json!({
                        "kind": "product-detail-generation",
                        "items": [
                            {
                                "imagePrompt": "首屏主视觉",
                                "sceneDescription": "首屏主视觉",
                                "title": "首屏主视觉",
                            },
                            {
                                "imagePrompt": "使用场景图",
                                "sceneDescription": "使用场景图",
                                "title": "使用场景图",
                            }
                        ],
                    })),
                    prompt_plan_snapshot: None,
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
            .expect("mark running");

        assert!(task_is_running(&workspace_dir, &task.id).expect("running check should query"));
        generation_service
            .cancel_task(&workspace_dir, &task.id)
            .expect("running task should cancel");
        assert!(!task_is_running(&workspace_dir, &task.id).expect("running check should query"));

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
        std::env::temp_dir().join(format!("commerce-shoot-studio-{label}-{nanos}"))
    }

    fn remove_workspace(path: &Path) {
        let _ = fs::remove_dir_all(path);
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

    fn model_invocation_count(workspace_dir: &Path) -> i64 {
        let database = WorkspaceDatabase::open(workspace_dir).expect("database should open");
        database
            .connection()
            .query_row("SELECT COUNT(*) FROM model_invocations", [], |row| {
                row.get(0)
            })
            .expect("invocation count should query")
    }

    fn transparent_png_bytes() -> Vec<u8> {
        vec![
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]
    }
}
