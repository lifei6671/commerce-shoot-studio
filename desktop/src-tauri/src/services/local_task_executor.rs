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

use crate::domain::generation::{
    GenerationError, GenerationTaskKind, GenerationTaskStage, NormalizedTaskError, WorkspaceKind,
};
use crate::infrastructure::database::WorkspaceDatabase;
use crate::services::assets::AssetService;
use crate::services::generation::insert_task_event;
use crate::services::model_config::{default_config_for_capability, ModelConfigError};
use crate::services::model_gateway::{
    ModelGatewayRequest, ModelGatewayResult, ModelGatewayService,
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
    let first_invocation_id = gateway_results
        .first()
        .map(|result| result.invocation_id.clone());
    let persist_result = if task.kind == GenerationTaskKind::ListingCopy {
        persist_listing_copy_output(workspace_directory, &task, &gateway_results[0]).map(|_| 0)
    } else {
        persist_generated_outputs(workspace_directory, &task, &gateway_results)
    };
    if let Err(_source) = persist_result {
        let error = normalized_persist_error(task.kind);
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
        let error = normalized_persist_error(task.kind);
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
) -> Result<Vec<ModelGatewayResult>, ModelConfigError> {
    let capability_id = capability_for_task(task.workspace, task.kind);
    task_gateway_inputs(workspace_directory, task)
        .map_err(|source| ModelConfigError::Validation(source.to_string()))?
        .into_iter()
        .map(|input| invoke_model_gateway(workspace_directory, capability_id, input))
        .collect()
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

fn task_input_with_asset_reference_images(
    workspace_directory: &Path,
    task: &ClaimedTask,
) -> Result<serde_json::Value, GenerationError> {
    let reference_assets = task
        .input_assets
        .iter()
        .filter(|asset| asset.role == "source" || asset.role == "reference")
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
        return "国家与语言约束：如果画面中出现人物，必须是中国人或中国电商模特气质；如果画面中出现任何文字、标识或信息区文字，必须使用中文，不得出现英文或外文。";
    }
    if is_chinese_language {
        return "语言约束：如果画面中出现任何文字、标识或信息区文字，必须使用中文，不得出现英文或外文。";
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

fn normalized_persist_error(kind: GenerationTaskKind) -> NormalizedTaskError {
    if kind == GenerationTaskKind::ListingCopy {
        return NormalizedTaskError {
            code: "LISTING_COPY_OUTPUT_INVALID".to_string(),
            message: "上架文案结果不是有效结构化 JSON，请重试。".to_string(),
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
        claim_next_queued_task, downloaded_image_mime_type, execute_claimed_task,
        mark_task_succeeded, parse_listing_copy_output, product_detail_input_batches,
        product_detail_item_gateway_input, product_detail_output_sort_order_start,
        task_input_with_asset_reference_images, task_is_running, update_stage, ClaimedTask,
        BACKGROUND_TASK_CONCURRENCY, PRODUCT_DETAIL_ITEM_CONCURRENCY,
    };
    use crate::domain::assets::AssetKind;
    use crate::domain::generation::{
        GenerationTaskKind, GenerationTaskStage, GenerationTaskStatus, WorkspaceKind,
    };
    use crate::infrastructure::database::WorkspaceDatabase;
    use crate::infrastructure::filesystem::WorkspaceFileSystem;
    use crate::services::assets::{AssetService, ImportImagesInput};
    use crate::services::generation::{
        insert_task_event, CreateGenerationTaskInput, GenerationService,
        GenerationTaskInputAssetInput,
    };
    use crate::services::model_gateway::ModelGatewayResult;
    use crate::services::workspace::{InitializeWorkspaceInput, WorkspaceService};
    use std::fs;
    use std::ops::Range;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

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
        assert!(user_prompt.contains("必须使用中文"));
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
        fs::write(&source_path, transparent_png_bytes()).expect("source image should write");
        let imported_assets = AssetService::new()
            .import_images(
                &workspace_dir,
                ImportImagesInput {
                    kind: AssetKind::Source,
                    paths: vec![source_path.to_string_lossy().to_string()],
                },
            )
            .expect("source image should import");
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
                    input_assets: vec![GenerationTaskInputAssetInput {
                        asset_id: imported_assets[0].id.clone(),
                        role: "source".to_string(),
                        sort_order: 0,
                    }],
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

        assert_eq!(user_images.len(), 1);
        assert_eq!(user_images[0]["assetId"], imported_assets[0].id);
        assert_eq!(user_images[0]["mimeType"], "image/png");
        assert!(user_images[0]["dataUrl"]
            .as_str()
            .expect("data url should be string")
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
