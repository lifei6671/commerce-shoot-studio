use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::domain::generation::{
    GenerationError, GenerationTaskKind, GenerationTaskStage, NormalizedTaskError, WorkspaceKind,
};
use crate::infrastructure::database::WorkspaceDatabase;
use crate::services::assets::AssetService;
use crate::services::generation::insert_task_event;
use crate::services::model_gateway::{
    ModelGatewayRequest, ModelGatewayResult, ModelGatewayService,
};

const PROVIDER_RESULT_TIMEOUT_SECONDS: u64 = 30;

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
            input: task.input.clone(),
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
    if let Err(_source) = persist_generated_outputs(workspace_directory, &task, &gateway_result) {
        let error = NormalizedTaskError {
            code: "DOWNLOAD_RESULT_FAILED".to_string(),
            message: "生成结果下载或保存失败，请稍后重试。".to_string(),
            retryable: true,
            stage: Some(GenerationTaskStage::Failed),
            provider_status_code: None,
            provider_error_code: None,
        };
        mark_task_failed(workspace_directory, &task.id, &error)?;
        return Ok(LocalTaskExecutionResult {
            task_id: task.id,
            invocation_id: Some(gateway_result.invocation_id),
        });
    }
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

fn persist_generated_outputs(
    workspace_directory: &Path,
    task: &ClaimedTask,
    gateway_result: &ModelGatewayResult,
) -> Result<usize, GenerationError> {
    if !task_requires_generated_asset(task.kind) {
        return Ok(0);
    }

    update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::DownloadingResult,
        "task.result-downloading",
        Some(json!({ "invocation_id": gateway_result.invocation_id })),
    )?;
    let images = collect_generated_images(&gateway_result.output_json)?;
    if images.is_empty() {
        return Err(GenerationError::Validation(
            "模型结果不包含可保存图片。".to_string(),
        ));
    }

    update_stage(
        workspace_directory,
        &task.id,
        GenerationTaskStage::SavingResult,
        "task.result-saving",
        Some(json!({ "image_count": images.len() })),
    )?;

    let asset_service = AssetService::new();
    let database = WorkspaceDatabase::open(workspace_directory)?;
    for (sort_order, image) in images.iter().enumerate() {
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
            params![task.id, asset.id, sort_order as i64],
        )?;
    }
    insert_task_event(
        &database,
        &task.id,
        "task.result-saved",
        Some(GenerationTaskStage::SavingResult),
        Some(json!({ "image_count": images.len() })),
    )?;

    Ok(images.len())
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
        .send()
        .map_err(|_| GenerationError::Validation("生成结果下载失败。".to_string()))?;
    if !response.status().is_success() {
        return Err(GenerationError::Validation(
            "生成结果下载失败。".to_string(),
        ));
    }
    let mime_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| !value.is_empty())
        .unwrap_or(mime_hint)
        .to_string();
    ensure_supported_image_mime(&mime_type)?;
    let bytes = response
        .bytes()
        .map_err(|_| GenerationError::Validation("生成结果读取失败。".to_string()))?
        .to_vec();
    Ok(GeneratedImage { mime_type, bytes })
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
