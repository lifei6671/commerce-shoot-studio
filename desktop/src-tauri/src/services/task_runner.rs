use std::fs;

use image::GenericImageView;
use serde_json::json;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Executor, QueryBuilder, Row};
use ulid::Ulid;

use crate::domain::asset::{Asset, AssetType};
use crate::domain::combination::{DraftImageCombination, ValidateCombinationRequest};
use crate::domain::task::{
    CreateGenerationTaskResultRequest, CreateGenerationTaskSnapshotRequest, GenerationTaskResult,
    GenerationTaskInputAsset, GenerationTaskInputRole, LocalGenerationTask, StartGenerationRequest,
    APP_UNEXPECTED_SHUTDOWN, RUNNING_TASK_STATUSES,
};
use crate::error::{AppError, AppResult};
use crate::providers::provider_trait::{
    GenerateInput, GenerateInputImage, GeneratedImage, ImageGenerationProvider, PromptPayload,
};
use crate::services::assets::get_asset_by_id;
use crate::services::combinations::get_image_combination_by_id;
use crate::services::model_validator::validate_combination_request;
use crate::services::prompt_resolver::{
    get_prompt_binding_save_request_for_combination, preview_resolved_prompt_for_combination,
};
use crate::storage::file_store::WorkspacePaths;
use crate::storage::sqlite::WorkspaceDatabase;

struct TaskAssetRole {
    asset: Asset,
    role: GenerationTaskInputRole,
    sort_order: i64,
    is_primary: bool,
}

struct GenerationPlan {
    combination_id: String,
    provider: String,
    model_id: String,
    output_count: u32,
    request_summary_json: Value,
    input_snapshot_json: Value,
    final_prompt_snapshot_json: Value,
    model_config_snapshot_json: Value,
    asset_snapshot_json: Value,
    input_assets: Vec<GenerationTaskInputAsset>,
    provider_input: GenerateInput,
}

pub async fn recover_interrupted_tasks(database: &WorkspaceDatabase) -> AppResult<u64> {
    let mut writer = database.writer().await;
    let mut builder =
        QueryBuilder::new("UPDATE generation_tasks SET status = 'failed', error_code = ");
    builder.push_bind(APP_UNEXPECTED_SHUTDOWN);
    builder.push(", finished_at = datetime('now') WHERE status IN (");

    let mut separated = builder.separated(", ");
    for status in RUNNING_TASK_STATUSES {
        separated.push_bind(status);
    }
    separated.push_unseparated(")");

    let result = builder.build().execute(&mut *writer).await?;
    Ok(result.rows_affected())
}

pub async fn run_generation_flow<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    request: StartGenerationRequest,
) -> AppResult<LocalGenerationTask> {
    run_generation_flow_with_task_id(database, paths, provider, api_key, request, None).await
}

pub async fn run_generation_flow_with_task_id<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    request: StartGenerationRequest,
    task_id: Option<String>,
) -> AppResult<LocalGenerationTask> {
    let plan = build_generation_plan(database, paths, request).await?;
    if plan.provider != provider.provider_name() {
        return Err(AppError::InvalidInput(format!(
            "provider {} is not supported by {} adapter",
            plan.provider,
            provider.provider_name()
        )));
    }

    let task = create_generation_task_snapshot(
        database,
        CreateGenerationTaskSnapshotRequest {
            id: task_id,
            combination_id: Some(plan.combination_id.clone()),
            provider: plan.provider.clone(),
            model_id: plan.model_id.clone(),
            request_summary_json: Some(plan.request_summary_json.clone()),
            input_snapshot_json: plan.input_snapshot_json.clone(),
            final_prompt_snapshot_json: plan.final_prompt_snapshot_json.clone(),
            model_config_snapshot_json: plan.model_config_snapshot_json.clone(),
            asset_snapshot_json: plan.asset_snapshot_json.clone(),
            input_assets: plan.input_assets.clone(),
            output_count: i64::from(plan.output_count),
        },
    )
    .await?;

    if let Err(err) = execute_generation_task(database, paths, provider, api_key, &task, plan).await
    {
        mark_generation_task_failed(database, &task.id, &err).await?;
        return Err(err);
    }

    get_generation_task_by_id(database, &task.id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("generation task was not found".to_string()))
}

pub async fn create_generation_task_snapshot(
    database: &WorkspaceDatabase,
    request: CreateGenerationTaskSnapshotRequest,
) -> AppResult<LocalGenerationTask> {
    validate_safe_summary(request.request_summary_json.as_ref())?;

    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("generation_task_{}", Ulid::new()));

    let mut writer = database.writer().await;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *writer).await?;

    match get_running_task_id_for_writer(&mut *writer).await {
        Ok(Some(existing_task_id)) => {
            writer.execute("ROLLBACK").await?;
            return Err(AppError::TaskAlreadyRunning(existing_task_id));
        }
        Ok(None) => {}
        Err(err) => {
            writer.execute("ROLLBACK").await?;
            return Err(AppError::Storage(err));
        }
    }

    let write_result = async {
        sqlx::query(
            "INSERT INTO generation_tasks (
                id,
                combination_id,
                provider,
                model_id,
                status,
                progress,
                request_summary_json,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json,
                output_count
             ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&request.combination_id)
        .bind(&request.provider)
        .bind(&request.model_id)
        .bind(request.request_summary_json.as_ref().map(Value::to_string))
        .bind(request.input_snapshot_json.to_string())
        .bind(request.final_prompt_snapshot_json.to_string())
        .bind(request.model_config_snapshot_json.to_string())
        .bind(request.asset_snapshot_json.to_string())
        .bind(request.output_count)
        .execute(&mut *writer)
        .await?;

        for input_asset in &request.input_assets {
            sqlx::query(
                "INSERT INTO generation_task_input_assets (
                    task_id,
                    asset_id,
                    role,
                    view_type,
                    sort_order,
                    is_primary
                ) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&input_asset.asset_id)
            .bind(input_asset.role.as_str())
            .bind(&input_asset.view_type)
            .bind(input_asset.sort_order)
            .bind(if input_asset.is_primary { 1_i64 } else { 0_i64 })
            .execute(&mut *writer)
            .await?;
        }

        Ok::<(), sqlx::Error>(())
    }
    .await;

    if let Err(err) = write_result {
        writer.execute("ROLLBACK").await?;
        return Err(AppError::Storage(err));
    }

    writer.execute("COMMIT").await?;
    drop(writer);

    get_generation_task_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("created generation task was not found".to_string()))
}

pub async fn get_generation_task_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<LocalGenerationTask>> {
    let row = sqlx::query(
        "SELECT
            id,
            combination_id,
            provider,
            model_id,
            status,
            progress,
            request_summary_json,
            input_snapshot_json,
            final_prompt_snapshot_json,
            model_config_snapshot_json,
            asset_snapshot_json,
            output_count,
            created_at,
            updated_at
         FROM generation_tasks
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    row.map(row_to_generation_task).transpose()
}

pub async fn create_generation_task_result(
    database: &WorkspaceDatabase,
    request: CreateGenerationTaskResultRequest,
) -> AppResult<GenerationTaskResult> {
    let id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("generation_task_result_{}", Ulid::new()));
    let source_url = request.source_url.as_deref().and_then(sanitize_source_url);

    sqlx::query(
        "INSERT INTO generation_task_results (
            id,
            task_id,
            asset_id,
            sort_order,
            source_url
         ) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&request.task_id)
    .bind(&request.asset_id)
    .bind(request.sort_order)
    .bind(&source_url)
    .execute(database.pool())
    .await?;

    get_generation_task_result_by_id(database, &id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput("created generation task result was not found".to_string())
        })
}

pub async fn get_generation_task_result_by_id(
    database: &WorkspaceDatabase,
    id: &str,
) -> AppResult<Option<GenerationTaskResult>> {
    let row = sqlx::query(
        "SELECT id, task_id, asset_id, sort_order, source_url, created_at
         FROM generation_task_results
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    Ok(row.map(row_to_generation_task_result))
}

async fn build_generation_plan(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    request: StartGenerationRequest,
) -> AppResult<GenerationPlan> {
    let combination = get_image_combination_by_id(database, &request.combination_id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput(format!("combination {} was not found", request.combination_id))
        })?;

    let draft_model_config = request.draft_model_config.clone().ok_or_else(|| {
        AppError::InvalidInput("draftModelConfig is required to start generation".to_string())
    })?;

    let prompt_binding = match request.draft_prompt_binding.clone() {
        Some(binding) => Some(binding),
        None => get_prompt_binding_save_request_for_combination(database, &combination.id).await?,
    };

    let validation = validate_combination_request(
        database,
        ValidateCombinationRequest {
            revision: request.revision.unwrap_or(0),
            draft_combination: DraftImageCombination {
                id: Some(combination.id.clone()),
                name: Some(combination.name.clone()),
                person_asset_id: Some(combination.person_asset_id.clone()),
                garment_asset_ids: combination.garment_asset_ids.clone(),
            },
            draft_prompt_binding: prompt_binding.clone(),
            draft_model_config: Some(draft_model_config.clone()),
        },
    )
    .await?;

    if !validation.executable {
        let message = validation
            .reasons
            .first()
            .map(|reason| reason.message.clone())
            .unwrap_or_else(|| "combination is not executable".to_string());
        return Err(AppError::InvalidInput(message));
    }

    let resolved_prompt = preview_resolved_prompt_for_combination(
        database,
        &combination.id,
        prompt_binding,
        request.revision,
    )
    .await?;
    let effective_model = validation
        .effective_model
        .ok_or_else(|| AppError::InvalidInput("model config is required".to_string()))?;
    let provider_name = effective_model.provider.clone();
    let model_id = effective_model.model_id.clone();
    let params_json = effective_model.params_json.clone();
    let output_count = validation.effective_limits.normalized_output_count;

    let mut assets = Vec::new();
    let person = get_required_asset(database, &combination.person_asset_id, AssetType::Person).await?;
    assets.push(TaskAssetRole {
        asset: person,
        role: GenerationTaskInputRole::Person,
        sort_order: 0,
        is_primary: true,
    });
    for (index, garment_id) in combination.garment_asset_ids.iter().enumerate() {
        let garment = get_required_asset(database, garment_id, AssetType::Garment).await?;
        assets.push(TaskAssetRole {
            asset: garment,
            role: GenerationTaskInputRole::Garment,
            sort_order: index as i64,
            is_primary: false,
        });
    }

    let input_assets = assets
        .iter()
        .map(|asset| GenerationTaskInputAsset {
            asset_id: asset.asset.id.clone(),
            role: asset.role.clone(),
            view_type: None,
            sort_order: asset.sort_order,
            is_primary: asset.is_primary,
        })
        .collect();

    let provider_images = assets
        .iter()
        .map(|asset| GenerateInputImage {
            asset_id: asset.asset.id.clone(),
            role: asset.role.as_str().to_string(),
            mime_type: asset.asset.mime_type.clone(),
            resolved_local_path: paths.root().join(&asset.asset.relative_path),
        })
        .collect();

    let asset_snapshot_json = Value::Array(
        assets
            .iter()
            .map(|asset| {
                json!({
                    "assetId": asset.asset.id,
                    "role": asset.role.as_str(),
                    "relativePath": asset.asset.relative_path,
                    "mimeType": asset.asset.mime_type,
                    "width": asset.asset.width,
                    "height": asset.asset.height,
                    "sha256": asset.asset.sha256,
                    "sortOrder": asset.sort_order,
                    "isPrimary": asset.is_primary
                })
            })
            .collect(),
    );

    let input_snapshot_json = json!({
        "combinationId": combination.id.clone(),
        "combinationName": combination.name.clone(),
        "personAssetId": combination.person_asset_id.clone(),
        "garmentAssetIds": combination.garment_asset_ids.clone()
    });
    let final_prompt_snapshot_json = serde_json::to_value(&resolved_prompt)
        .map_err(|err| AppError::InvalidInput(format!("resolved prompt snapshot invalid: {err}")))?;
    let model_config_snapshot_json = json!({
        "provider": provider_name.clone(),
        "modelId": model_id.clone(),
        "advanced": effective_model.advanced,
        "paramsJson": params_json.clone(),
        "normalizedOutputCount": output_count
    });
    let request_summary_json = json!({
        "provider": provider_name.clone(),
        "modelId": model_id.clone(),
        "assetCount": assets.len(),
        "promptLength": resolved_prompt.user.chars().count(),
        "outputCount": output_count
    });

    Ok(GenerationPlan {
        combination_id: combination.id,
        provider: provider_name.clone(),
        model_id: model_id.clone(),
        output_count,
        request_summary_json,
        input_snapshot_json,
        final_prompt_snapshot_json,
        model_config_snapshot_json,
        asset_snapshot_json,
        input_assets,
        provider_input: GenerateInput {
            task_id: String::new(),
            provider: provider_name,
            model_id,
            images: provider_images,
            prompt: PromptPayload {
                system: resolved_prompt.system,
                user: resolved_prompt.user,
                negative: resolved_prompt.negative,
            },
            params: draft_model_config.params_json,
        },
    })
}

async fn execute_generation_task<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    task: &LocalGenerationTask,
    mut plan: GenerationPlan,
) -> AppResult<()> {
    update_generation_task_status(database, &task.id, "preparing", 10, Some("Preparing inputs"))
        .await?;
    plan.provider_input.task_id = task.id.clone();

    update_generation_task_status(
        database,
        &task.id,
        "calling_model",
        35,
        Some("Calling image provider"),
    )
    .await?;
    update_generation_task_status(
        database,
        &task.id,
        "waiting_result",
        55,
        Some("Waiting for provider result"),
    )
    .await?;
    let result = provider
        .generate(plan.provider_input, api_key)
        .await
        .map_err(provider_error_to_app_error)?;

    update_generation_task_response_summary(database, &task.id, &result.response_summary_json)
        .await?;
    update_generation_task_status(
        database,
        &task.id,
        "saving_result",
        80,
        Some("Saving generated results"),
    )
    .await?;

    for (index, image) in result.images.into_iter().enumerate() {
        let source_url = image.source_url.clone();
        let asset = store_generated_result_asset(database, paths, &task.id, index, image).await?;
        create_generation_task_result(
            database,
            CreateGenerationTaskResultRequest {
                id: None,
                task_id: task.id.clone(),
                asset_id: asset.id,
                sort_order: index as i64,
                source_url,
            },
        )
        .await?;
    }

    mark_generation_task_succeeded(database, &task.id).await
}

pub fn sanitize_source_url(source_url: &str) -> Option<String> {
    let lower = source_url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return None;
    }
    if let Some(query_start) = lower.find('?') {
        let query = &lower[query_start + 1..];
        if query.contains("token")
            || query.contains("signature")
            || query.contains("sig=")
            || query.contains("expires")
            || query.contains("x-amz")
            || query.contains("credential")
            || query.contains("api_key")
            || query.contains("apikey")
            || query.contains("access_key")
            || query.contains("authorization")
            || query.contains("secret")
        {
            return None;
        }
    }
    Some(source_url.to_string())
}

async fn get_running_task_id_for_writer(
    writer: &mut sqlx::SqliteConnection,
) -> Result<Option<String>, sqlx::Error> {
    let mut builder =
        QueryBuilder::<sqlx::Sqlite>::new("SELECT id FROM generation_tasks WHERE status IN (");
    let mut separated = builder.separated(", ");
    for status in RUNNING_TASK_STATUSES {
        separated.push_bind(status);
    }
    separated.push_unseparated(") ORDER BY created_at DESC LIMIT 1");

    builder.build_query_scalar().fetch_optional(writer).await
}

async fn get_required_asset(
    database: &WorkspaceDatabase,
    asset_id: &str,
    expected_type: AssetType,
) -> AppResult<Asset> {
    let asset = get_asset_by_id(database, asset_id)
        .await?
        .ok_or_else(|| AppError::InvalidInput(format!("asset {asset_id} was not found")))?;
    if asset.asset_type.as_str() != expected_type.as_str() {
        return Err(AppError::InvalidInput(format!(
            "asset {asset_id} must be {}",
            expected_type.as_str()
        )));
    }
    Ok(asset)
}

async fn update_generation_task_status(
    database: &WorkspaceDatabase,
    task_id: &str,
    status: &str,
    progress: i64,
    message: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE generation_tasks
         SET status = ?, progress = ?, message = ?, updated_at = datetime('now'),
             started_at = COALESCE(started_at, datetime('now'))
         WHERE id = ?",
    )
    .bind(status)
    .bind(progress)
    .bind(message)
    .bind(task_id)
    .execute(database.pool())
    .await?;
    Ok(())
}

async fn update_generation_task_response_summary(
    database: &WorkspaceDatabase,
    task_id: &str,
    response_summary_json: &Value,
) -> AppResult<()> {
    validate_safe_summary(Some(response_summary_json))?;
    sqlx::query(
        "UPDATE generation_tasks
         SET response_summary_json = ?, updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(response_summary_json.to_string())
    .bind(task_id)
    .execute(database.pool())
    .await?;
    Ok(())
}

async fn mark_generation_task_succeeded(
    database: &WorkspaceDatabase,
    task_id: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE generation_tasks
         SET status = 'succeeded',
             progress = 100,
             message = NULL,
             updated_at = datetime('now'),
             finished_at = datetime('now')
         WHERE id = ?",
    )
    .bind(task_id)
    .execute(database.pool())
    .await?;
    Ok(())
}

async fn mark_generation_task_failed(
    database: &WorkspaceDatabase,
    task_id: &str,
    err: &AppError,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE generation_tasks
         SET status = 'failed',
             error_code = ?,
             error_message = ?,
             updated_at = datetime('now'),
             finished_at = datetime('now')
         WHERE id = ?",
    )
    .bind(app_error_code(err))
    .bind(err.to_string())
    .bind(task_id)
    .execute(database.pool())
    .await?;
    Ok(())
}

async fn store_generated_result_asset(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    task_id: &str,
    sort_order: usize,
    image: GeneratedImage,
) -> AppResult<Asset> {
    let extension = match image.mime_type.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        _ => {
            return Err(AppError::InvalidInput(format!(
                "generated image mime type {} is not supported",
                image.mime_type
            )))
        }
    };
    let decoded = image::load_from_memory(&image.bytes)
        .map_err(|err| AppError::InvalidInput(format!("generated image is invalid: {err}")))?;
    let (width, height) = decoded.dimensions();
    let sha256 = calculate_bytes_sha256(&image.bytes);

    if let Some(existing) = find_result_asset_by_sha256(database, &sha256).await? {
        return Ok(existing);
    }

    let id = format!("asset_{}", Ulid::new());
    let relative_path = format!("assets/result/{id}.{extension}");
    let thumb_relative_path = format!("assets/cache/thumbs/{id}.jpg");
    let destination_path = paths.root().join(&relative_path);
    let thumb_path = paths.root().join(&thumb_relative_path);
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = thumb_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&destination_path, &image.bytes)?;
    decoded
        .thumbnail(320, 320)
        .to_rgb8()
        .save_with_format(&thumb_path, image::ImageFormat::Jpeg)
        .map_err(|err| AppError::InvalidInput(format!("failed to create result thumbnail: {err}")))?;

    let mut writer = database.writer().await;
    sqlx::query(
        "INSERT INTO assets (
            id, asset_type, original_name, relative_path, thumb_relative_path,
            mime_type, sha256, width, height
         ) VALUES (?, 'result', ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(format!("{task_id}-{sort_order}.{extension}"))
    .bind(&relative_path)
    .bind(&thumb_relative_path)
    .bind(&image.mime_type)
    .bind(&sha256)
    .bind(i64::from(width))
    .bind(i64::from(height))
    .execute(&mut *writer)
    .await?;
    drop(writer);

    get_asset_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("created result asset was not found".to_string()))
}

async fn find_result_asset_by_sha256(
    database: &WorkspaceDatabase,
    sha256: &str,
) -> AppResult<Option<Asset>> {
    let asset_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM assets WHERE asset_type = 'result' AND sha256 = ?",
    )
    .bind(sha256)
    .fetch_optional(database.pool())
    .await?;
    match asset_id {
        Some(asset_id) => get_asset_by_id(database, &asset_id).await,
        None => Ok(None),
    }
}

fn calculate_bytes_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn provider_error_to_app_error(err: crate::providers::provider_trait::ProviderError) -> AppError {
    AppError::InvalidInput(format!("{:?}: {}", err.code, err.message))
}

fn app_error_code(err: &AppError) -> &'static str {
    match err {
        AppError::Storage(_) => "STORAGE_ERROR",
        AppError::Migration(_) => "MIGRATION_ERROR",
        AppError::Io(_) => "IO_ERROR",
        AppError::WorkspaceUnavailable => "WORKSPACE_UNAVAILABLE",
        AppError::PromptTemplateInvalid(_) => "PROMPT_TEMPLATE_INVALID",
        AppError::PromptRequiredVariableMissing(_) => "PROMPT_REQUIRED_VARIABLE_MISSING",
        AppError::ModelConfigInvalid(_) => "MODEL_CONFIG_INVALID",
        AppError::TaskAlreadyRunning(_) => "TASK_ALREADY_RUNNING",
        AppError::InvalidInput(_) => "INVALID_INPUT",
    }
}

fn validate_safe_summary(summary: Option<&Value>) -> AppResult<()> {
    if let Some(summary) = summary {
        validate_safe_json_value(summary, "$")?;
    }
    Ok(())
}

fn validate_safe_json_value(value: &Value, path: &str) -> AppResult<()> {
    match value {
        Value::String(value) => {
            let lower = value.to_ascii_lowercase();
            if lower.contains("base64")
                || lower.contains("data:image")
                || lower.contains("authorization:")
                || lower.contains("bearer ")
                || lower.contains("/users/")
            {
                return Err(AppError::InvalidInput(format!(
                    "request_summary_json contains sensitive value at {path}"
                )));
            }
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_safe_json_value(value, &format!("{path}[{index}]"))?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                let lower_key = key.to_ascii_lowercase();
                if lower_key.contains("rawresponse")
                    || lower_key.contains("apikey")
                    || lower_key.contains("api_key")
                    || lower_key.contains("authorization")
                    || lower_key.contains("base64")
                {
                    return Err(AppError::InvalidInput(format!(
                        "request_summary_json contains sensitive key at {path}.{key}"
                    )));
                }
                validate_safe_json_value(value, &format!("{path}.{key}"))?;
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
    Ok(())
}

fn row_to_generation_task(row: sqlx::sqlite::SqliteRow) -> AppResult<LocalGenerationTask> {
    Ok(LocalGenerationTask {
        id: row.get("id"),
        combination_id: row.get("combination_id"),
        provider: row.get("provider"),
        model_id: row.get("model_id"),
        status: row.get("status"),
        progress: row.get("progress"),
        request_summary_json: parse_optional_json(row.get("request_summary_json"))?,
        input_snapshot_json: parse_required_json(row.get("input_snapshot_json"))?,
        final_prompt_snapshot_json: parse_required_json(row.get("final_prompt_snapshot_json"))?,
        model_config_snapshot_json: parse_required_json(row.get("model_config_snapshot_json"))?,
        asset_snapshot_json: parse_required_json(row.get("asset_snapshot_json"))?,
        output_count: row.get("output_count"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn row_to_generation_task_result(row: sqlx::sqlite::SqliteRow) -> GenerationTaskResult {
    GenerationTaskResult {
        id: row.get("id"),
        task_id: row.get("task_id"),
        asset_id: row.get("asset_id"),
        sort_order: row.get("sort_order"),
        source_url: row.get("source_url"),
        created_at: row.get("created_at"),
    }
}

fn parse_optional_json(value: Option<String>) -> AppResult<Option<Value>> {
    value
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(|err| AppError::InvalidInput(format!("task json field is invalid: {err}")))
}

fn parse_required_json(value: String) -> AppResult<Value> {
    serde_json::from_str(&value)
        .map_err(|err| AppError::InvalidInput(format!("task json field is invalid: {err}")))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sqlx::Row;

    use super::*;
    use crate::domain::model::SaveModelConfigRequest;
    use crate::domain::prompt::{
        PromptBindingSection, PromptMode, SavePromptBindingRequest,
    };
    use crate::domain::task::{
        StartGenerationRequest,
        CreateGenerationTaskResultRequest, CreateGenerationTaskSnapshotRequest,
        GenerationTaskInputAsset, GenerationTaskInputRole,
    };
    use crate::providers::provider_trait::{
        GenerateInput, GenerateResult, GeneratedImage, ImageGenerationProvider, ProviderError,
    };
    use crate::services::combinations::save_image_combination_request;
    use crate::services::prompt_resolver::save_prompt_binding_request;
    use crate::domain::asset::AssetType;
    use crate::domain::combination::SaveImageCombinationRequest;
    use crate::services::assets::import_image_file;
    use crate::storage::file_store::WorkspacePaths;
    use crate::storage::migrations::run_workspace_migrations;

    #[tokio::test]
    async fn recover_interrupted_tasks_fails_only_running_tasks() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let database = WorkspaceDatabase::connect(&temp_dir.path().join("workspace.db"))
            .await
            .expect("connect");

        let mut writer = database.writer().await;
        sqlx::query(
            "CREATE TABLE generation_tasks (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                error_code TEXT,
                finished_at TEXT
            )",
        )
        .execute(&mut *writer)
        .await
        .expect("create table");

        for (id, status) in [
            ("task-queued", "queued"),
            ("task-calling", "calling_model"),
            ("task-succeeded", "succeeded"),
        ] {
            sqlx::query("INSERT INTO generation_tasks (id, status) VALUES (?, ?)")
                .bind(id)
                .bind(status)
                .execute(&mut *writer)
                .await
                .expect("insert task");
        }
        drop(writer);

        let recovered = recover_interrupted_tasks(&database).await.expect("recover");
        assert_eq!(recovered, 2);

        let rows = sqlx::query("SELECT id, status, error_code FROM generation_tasks ORDER BY id")
            .fetch_all(database.pool())
            .await
            .expect("fetch tasks");

        let states: Vec<(String, String, Option<String>)> = rows
            .into_iter()
            .map(|row| (row.get("id"), row.get("status"), row.get("error_code")))
            .collect();

        assert_eq!(
            states,
            vec![
                (
                    "task-calling".to_string(),
                    "failed".to_string(),
                    Some(APP_UNEXPECTED_SHUTDOWN.to_string())
                ),
                (
                    "task-queued".to_string(),
                    "failed".to_string(),
                    Some(APP_UNEXPECTED_SHUTDOWN.to_string())
                ),
                ("task-succeeded".to_string(), "succeeded".to_string(), None),
            ]
        );
    }

    #[tokio::test]
    async fn create_generation_task_snapshot_persists_snapshots_and_input_asset_refs() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;

        let task = create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_1".to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({
                    "provider": "openai",
                    "modelId": "gpt-image-1",
                    "assetCount": 2,
                    "promptLength": 24
                })),
                input_snapshot_json: json!({"inputAssets": ["person_1", "garment_1"]}),
                final_prompt_snapshot_json: json!({"user": "wear linen dress"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-1", "outputCount": 1}),
                asset_snapshot_json: json!([
                    {"assetId": "person_1", "relativePath": "assets/person/person_1.png"},
                    {"assetId": "garment_1", "relativePath": "assets/garment/garment_1.png"}
                ]),
                input_assets: vec![
                    GenerationTaskInputAsset {
                        asset_id: "person_1".to_string(),
                        role: GenerationTaskInputRole::Person,
                        view_type: None,
                        sort_order: 0,
                        is_primary: true,
                    },
                    GenerationTaskInputAsset {
                        asset_id: "garment_1".to_string(),
                        role: GenerationTaskInputRole::Garment,
                        view_type: Some("front".to_string()),
                        sort_order: 0,
                        is_primary: false,
                    },
                ],
                output_count: 1,
            },
        )
        .await
        .expect("create task");

        assert_eq!(task.status, "queued");
        assert_eq!(task.final_prompt_snapshot_json["user"], "wear linen dress");
        assert_eq!(task.model_config_snapshot_json["modelId"], "gpt-image-1");

        let input_refs: Vec<(String, String, i64)> = sqlx::query(
            "SELECT asset_id, role, is_primary
             FROM generation_task_input_assets
             WHERE task_id = ?
             ORDER BY role DESC",
        )
        .bind(&task.id)
        .fetch_all(database.pool())
        .await
        .expect("input refs")
        .into_iter()
        .map(|row| (row.get("asset_id"), row.get("role"), row.get("is_primary")))
        .collect();

        assert_eq!(
            input_refs,
            vec![
                ("person_1".to_string(), "person".to_string(), 1),
                ("garment_1".to_string(), "garment".to_string(), 0),
            ]
        );
    }

    #[tokio::test]
    async fn create_generation_task_snapshot_rejects_unsafe_request_summary() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;

        let result = create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_unsafe".to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({
                    "Authorization": "redacted",
                    "image": "data:image/png;base64,AAAA"
                })),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await;

        assert!(matches!(result, Err(AppError::InvalidInput(_))));

        let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM generation_tasks")
            .fetch_one(database.pool())
            .await
            .expect("task count");
        assert_eq!(task_count, 0);
    }

    #[tokio::test]
    async fn create_generation_task_snapshot_rejects_existing_running_task() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;
        create_minimal_task(&database, "task_first").await;

        let second = create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_second".to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-1"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await;

        assert!(matches!(
            second,
            Err(AppError::TaskAlreadyRunning(task_id)) if task_id == "task_first"
        ));

        let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM generation_tasks")
            .fetch_one(database.pool())
            .await
            .expect("task count");
        assert_eq!(task_count, 1);
    }

    #[tokio::test]
    async fn create_generation_task_result_sanitizes_source_url_before_persisting() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;
        create_minimal_task(&database, "task_for_result").await;

        let safe_result = create_generation_task_result(
            &database,
            CreateGenerationTaskResultRequest {
                id: Some("result_safe".to_string()),
                task_id: "task_for_result".to_string(),
                asset_id: "result_1".to_string(),
                sort_order: 0,
                source_url: Some("https://cdn.example.com/result.png".to_string()),
            },
        )
        .await
        .expect("safe result");

        assert_eq!(
            safe_result.source_url,
            Some("https://cdn.example.com/result.png".to_string())
        );

        let signed_result = create_generation_task_result(
            &database,
            CreateGenerationTaskResultRequest {
                id: Some("result_signed".to_string()),
                task_id: "task_for_result".to_string(),
                asset_id: "result_1".to_string(),
                sort_order: 1,
                source_url: Some("https://cdn.example.com/result.png?token=placeholder".to_string()),
            },
        )
        .await
        .expect("signed result");

        assert_eq!(signed_result.source_url, None);

        let refs: Vec<(String, String, i64, Option<String>)> = sqlx::query(
            "SELECT task_id, asset_id, sort_order, source_url
             FROM generation_task_results
             WHERE task_id = ?
             ORDER BY sort_order",
        )
        .bind("task_for_result")
        .fetch_all(database.pool())
        .await
        .expect("result refs")
        .into_iter()
        .map(|row| {
            (
                row.get("task_id"),
                row.get("asset_id"),
                row.get("sort_order"),
                row.get("source_url"),
            )
        })
        .collect();

        assert_eq!(
            refs,
            vec![
                (
                    "task_for_result".to_string(),
                    "result_1".to_string(),
                    0,
                    Some("https://cdn.example.com/result.png".to_string()),
                ),
                (
                    "task_for_result".to_string(),
                    "result_1".to_string(),
                    1,
                    None,
                ),
            ]
        );
    }

    #[tokio::test]
    async fn run_generation_flow_saves_result_asset_and_marks_task_succeeded() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;

        let task = run_generation_flow(
            &database,
            &paths,
            &StaticProvider,
            "placeholder-api-key",
            StartGenerationRequest {
                combination_id,
                draft_prompt_binding: None,
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-1".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                revision: Some(7),
            },
        )
        .await
        .expect("run generation");

        assert_eq!(task.status, "succeeded");
        assert_eq!(task.final_prompt_snapshot_json["user"], "wear linen dress");
        assert_eq!(task.model_config_snapshot_json["modelId"], "gpt-image-1");

        let result_refs: Vec<(String, Option<String>)> = sqlx::query(
            "SELECT r.asset_id, r.source_url
             FROM generation_task_results r
             WHERE r.task_id = ?
             ORDER BY r.sort_order",
        )
        .bind(&task.id)
        .fetch_all(database.pool())
        .await
        .expect("result refs")
        .into_iter()
        .map(|row| (row.get("asset_id"), row.get("source_url")))
        .collect();

        assert_eq!(result_refs.len(), 1);
        assert_eq!(result_refs[0].1, None);

        let result_asset_type: String =
            sqlx::query_scalar("SELECT asset_type FROM assets WHERE id = ?")
                .bind(&result_refs[0].0)
                .fetch_one(database.pool())
                .await
                .expect("result asset type");
        assert_eq!(result_asset_type, "result");

        save_prompt_binding_request(
            &database,
            SavePromptBindingRequest {
                id: None,
                combination_id: "combination_generation".to_string(),
                system: PromptBindingSection {
                    mode: PromptMode::Default,
                    base_template_id: None,
                    append_text: String::new(),
                    override_text: String::new(),
                },
                user: PromptBindingSection {
                    mode: PromptMode::Override,
                    base_template_id: None,
                    append_text: String::new(),
                    override_text: "changed after execution".to_string(),
                },
                negative: None,
                variables_json: json!({}),
            },
        )
        .await
        .expect("update prompt after generation");
        let reloaded = get_generation_task_by_id(&database, &task.id)
            .await
            .expect("reload task")
            .expect("task");
        assert_eq!(reloaded.final_prompt_snapshot_json["user"], "wear linen dress");
    }

    #[test]
    fn sanitize_source_url_drops_signed_or_sensitive_urls() {
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png"),
            Some("https://cdn.example.com/result.png".to_string())
        );
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png?token=placeholder"),
            None
        );
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png?X-Amz-Signature=abc"),
            None
        );
        assert_eq!(
            sanitize_source_url("https://cdn.example.com/result.png?api_key=secret"),
            None
        );
        assert_eq!(sanitize_source_url("file:///Users/me/result.png"), None);
    }

    async fn test_database() -> (tempfile::TempDir, WorkspaceDatabase) {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().join("workspace"));
        paths.ensure().expect("ensure workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect");
        run_workspace_migrations(&paths, &database)
            .await
            .expect("migrate");
        (temp_dir, database)
    }

    async fn test_workspace() -> (tempfile::TempDir, WorkspacePaths, WorkspaceDatabase) {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().join("workspace"));
        paths.ensure().expect("ensure workspace");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect");
        run_workspace_migrations(&paths, &database)
            .await
            .expect("migrate");
        (temp_dir, paths, database)
    }

    async fn seed_generation_inputs(
        database: &WorkspaceDatabase,
        paths: &WorkspacePaths,
    ) -> String {
        let person_path = paths.root().join("person.png");
        let garment_path = paths.root().join("garment.png");
        write_png(&person_path, [12, 34, 56, 255]);
        write_png(&garment_path, [90, 34, 56, 255]);

        let person = import_image_file(database, paths, person_path, AssetType::Person)
            .await
            .expect("person");
        let garment = import_image_file(database, paths, garment_path, AssetType::Garment)
            .await
            .expect("garment");

        let combination = save_image_combination_request(
            database,
            SaveImageCombinationRequest {
                id: Some("combination_generation".to_string()),
                name: "look".to_string(),
                person_asset_id: person.asset.id,
                garment_asset_ids: vec![garment.asset.id],
            },
        )
        .await
        .expect("combination");

        seed_prompt_template(database).await;

        save_prompt_binding_request(
            database,
            SavePromptBindingRequest {
                id: None,
                combination_id: combination.id.clone(),
                system: PromptBindingSection {
                    mode: PromptMode::Default,
                    base_template_id: None,
                    append_text: String::new(),
                    override_text: String::new(),
                },
                user: PromptBindingSection {
                    mode: PromptMode::Default,
                    base_template_id: Some("template_user_generation".to_string()),
                    append_text: String::new(),
                    override_text: String::new(),
                },
                negative: None,
                variables_json: json!({"garment": "linen dress"}),
            },
        )
        .await
        .expect("prompt binding");

        combination.id
    }

    async fn seed_prompt_template(database: &WorkspaceDatabase) {
        sqlx::query(
            "INSERT INTO prompt_templates (id, name, body, variables_json)
             VALUES ('template_user_generation', 'User', 'wear {{garment}}', '{\"garment\":{\"required\":true}}')",
        )
        .execute(database.pool())
        .await
        .expect("seed prompt template");
    }

    fn write_png(path: &std::path::Path, color: [u8; 4]) {
        let image = image::ImageBuffer::<image::Rgba<u8>, _>::from_pixel(
            16,
            12,
            image::Rgba(color),
        );
        image.save(path).expect("write png");
    }

    struct StaticProvider;

    impl ImageGenerationProvider for StaticProvider {
        fn provider_name(&self) -> &'static str {
            "openai"
        }

        fn generate<'a>(
            &'a self,
            input: GenerateInput,
            _api_key: &'a str,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<GenerateResult, ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                assert_eq!(input.prompt.user, "wear linen dress");
                Ok(GenerateResult {
                    provider: "openai".to_string(),
                    model_id: input.model_id,
                    images: vec![GeneratedImage {
                        bytes: png_bytes([1, 2, 3, 255]),
                        mime_type: "image/png".to_string(),
                        source_url: Some(
                            "https://cdn.example.com/result.png?token=placeholder".to_string(),
                        ),
                    }],
                    response_summary_json: json!({
                        "provider": "openai",
                        "statusCode": 200,
                        "imageCount": 1
                    }),
                })
            })
        }
    }

    fn png_bytes(color: [u8; 4]) -> Vec<u8> {
        let image = image::ImageBuffer::<image::Rgba<u8>, _>::from_pixel(
            8,
            8,
            image::Rgba(color),
        );
        let mut bytes = Vec::new();
        image
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode png");
        bytes
    }

    async fn seed_assets(database: &WorkspaceDatabase) {
        let mut writer = database.writer().await;
        for (id, asset_type) in [
            ("person_1", "person"),
            ("garment_1", "garment"),
            ("result_1", "result"),
        ] {
            sqlx::query(
                "INSERT INTO assets (
                    id, asset_type, original_name, relative_path, thumb_relative_path,
                    mime_type, sha256, width, height
                ) VALUES (?, ?, ?, ?, ?, 'image/png', ?, 10, 10)",
            )
            .bind(id)
            .bind(asset_type)
            .bind(format!("{id}.png"))
            .bind(format!("assets/{asset_type}/{id}.png"))
            .bind(format!("assets/cache/thumbs/{id}.jpg"))
            .bind(format!("sha-{id}"))
            .execute(&mut *writer)
            .await
            .expect("seed asset");
        }
    }

    async fn create_minimal_task(database: &WorkspaceDatabase, id: &str) {
        create_generation_task_snapshot(
            database,
            CreateGenerationTaskSnapshotRequest {
                id: Some(id.to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-1".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-1"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await
        .expect("create minimal task");
    }
}
