use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::process::Command;
use std::time::Duration;

use image::GenericImageView;
use serde_json::json;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Executor, QueryBuilder, Row};
use ulid::Ulid;

use crate::domain::asset::{Asset, AssetType};
use crate::domain::combination::{DraftImageCombination, ValidateCombinationRequest};
use crate::domain::task::{
    CreateGenerationTaskResultRequest, CreateGenerationTaskSnapshotRequest, GenerationTaskDetail,
    GenerationTaskExecutionLog, GenerationTaskHistoryPage, GenerationTaskHistoryQuery,
    GenerationTaskHistoryStats, GenerationTaskInputAsset, GenerationTaskInputRole,
    GenerationTaskResult, GenerationTaskResultAsset, LocalGenerationTask, StartGenerationRequest,
    APP_UNEXPECTED_SHUTDOWN, RUNNING_TASK_STATUSES,
};
use crate::error::{AppError, AppResult};
use crate::providers::provider_trait::{
    GenerateInput, GenerateInputImage, GeneratedImage, ImageGenerationProvider, PromptPayload,
    ProviderError, ProviderErrorCode, RemoteCancelResult,
};
use crate::services::assets::get_asset_by_id;
use crate::services::combinations::get_image_combination_by_id;
use crate::services::model_validator::{
    normalize_openai_provider_base_url, validate_combination_request,
};
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

pub type GenerationTaskObserver<'a> = &'a (dyn Fn(LocalGenerationTask) + Send + Sync + 'a);
pub type GenerationTaskCancellationChecker<'a> = &'a (dyn Fn() -> bool + Send + Sync + 'a);

#[derive(Clone)]
struct NormalizedHistoryQuery {
    search: Option<String>,
    status: Option<String>,
    provider: Option<String>,
    model_id: Option<String>,
    created_from: Option<String>,
    created_to: Option<String>,
    limit: i64,
    offset: i64,
}

impl From<GenerationTaskHistoryQuery> for NormalizedHistoryQuery {
    fn from(query: GenerationTaskHistoryQuery) -> Self {
        Self {
            search: query.search.and_then(non_empty_string),
            status: query.status.and_then(non_empty_string),
            provider: query.provider.and_then(non_empty_string),
            model_id: query.model_id.and_then(non_empty_string),
            created_from: query.created_from.and_then(non_empty_string),
            created_to: query.created_to.and_then(non_empty_string),
            limit: query.limit.unwrap_or(20).clamp(1, 100),
            offset: query.offset.unwrap_or(0).max(0),
        }
    }
}

pub async fn recover_interrupted_tasks(database: &WorkspaceDatabase) -> AppResult<u64> {
    let mut writer = database.writer().await;
    let mut id_builder =
        QueryBuilder::<sqlx::Sqlite>::new("SELECT id FROM generation_tasks WHERE status IN (");
    let mut id_separated = id_builder.separated(", ");
    for status in RUNNING_TASK_STATUSES {
        id_separated.push_bind(status);
    }
    id_separated.push_unseparated(")");
    let interrupted_task_ids: Vec<String> = id_builder
        .build_query_scalar()
        .fetch_all(&mut *writer)
        .await?;

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
    if !interrupted_task_ids.is_empty() {
        let recovery_error_json = json!({ "code": APP_UNEXPECTED_SHUTDOWN }).to_string();
        let mut log_builder = QueryBuilder::<sqlx::Sqlite>::new(
            "UPDATE generation_task_execution_logs
             SET finished_at = datetime('now'),
                 success_response_json = NULL,
                 error_response_json = ",
        );
        log_builder.push_bind(recovery_error_json);
        log_builder
            .push(", updated_at = datetime('now') WHERE finished_at IS NULL AND task_id IN (");
        let mut log_separated = log_builder.separated(", ");
        for task_id in interrupted_task_ids {
            log_separated.push_bind(task_id);
        }
        log_separated.push_unseparated(")");
        log_builder.build().execute(&mut *writer).await?;
    }
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
    run_generation_flow_with_task_id_and_observer(
        database, paths, provider, api_key, request, task_id, None,
    )
    .await
}

pub async fn run_generation_flow_with_task_id_and_observer<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    request: StartGenerationRequest,
    task_id: Option<String>,
    observer: Option<GenerationTaskObserver<'_>>,
) -> AppResult<LocalGenerationTask> {
    run_generation_flow_with_task_id_observer_and_cancellation(
        database, paths, provider, api_key, request, task_id, observer, None,
    )
    .await
}

pub async fn run_generation_flow_with_task_id_observer_and_cancellation<
    P: ImageGenerationProvider,
>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    request: StartGenerationRequest,
    task_id: Option<String>,
    observer: Option<GenerationTaskObserver<'_>>,
    cancellation_checker: Option<GenerationTaskCancellationChecker<'_>>,
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
    notify_generation_task_change(database, &task.id, observer).await?;

    if let Err(err) = execute_generation_task(
        database,
        paths,
        provider,
        api_key,
        &task,
        plan,
        observer,
        cancellation_checker,
    )
    .await
    {
        if !matches!(err, AppError::GenerationCancelled(_)) {
            mark_generation_task_failed(database, &task.id, &err).await?;
        }
        notify_generation_task_change(database, &task.id, observer).await?;
        return Err(err);
    }
    notify_generation_task_change(database, &task.id, observer).await?;

    get_generation_task_by_id(database, &task.id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("generation task was not found".to_string()))
}

pub async fn retry_generation_task_with_provider<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    source_task_id: &str,
    task_id: Option<String>,
    observer: Option<GenerationTaskObserver<'_>>,
    cancellation_checker: Option<GenerationTaskCancellationChecker<'_>>,
) -> AppResult<LocalGenerationTask> {
    let source_task = get_generation_task_by_id(database, source_task_id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput(format!("generation task {source_task_id} was not found"))
        })?;
    if source_task.provider != provider.provider_name() {
        return Err(AppError::InvalidInput(format!(
            "provider {} is not supported by {} adapter",
            source_task.provider,
            provider.provider_name()
        )));
    }
    let plan = build_retry_generation_plan(database, paths, &source_task).await?;
    let task = create_generation_task_snapshot(
        database,
        CreateGenerationTaskSnapshotRequest {
            id: task_id,
            combination_id: source_task.combination_id.clone(),
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
    notify_generation_task_change(database, &task.id, observer).await?;

    if let Err(err) = execute_generation_task(
        database,
        paths,
        provider,
        api_key,
        &task,
        plan,
        observer,
        cancellation_checker,
    )
    .await
    {
        if !matches!(err, AppError::GenerationCancelled(_)) {
            mark_generation_task_failed(database, &task.id, &err).await?;
        }
        notify_generation_task_change(database, &task.id, observer).await?;
        return Err(err);
    }
    notify_generation_task_change(database, &task.id, observer).await?;

    get_generation_task_by_id(database, &task.id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("generation task was not found".to_string()))
}

pub async fn rerun_generation_from_current_combination_with_provider<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    combination_id: &str,
    model_config: crate::domain::model::SaveModelConfigRequest,
    task_id: Option<String>,
    observer: Option<GenerationTaskObserver<'_>>,
    cancellation_checker: Option<GenerationTaskCancellationChecker<'_>>,
) -> AppResult<LocalGenerationTask> {
    let mut plan = build_generation_plan(
        database,
        paths,
        StartGenerationRequest {
            combination_id: combination_id.to_string(),
            draft_prompt_binding: None,
            draft_model_config: Some(model_config),
            draft_garment_asset_ids: None,
            revision: None,
        },
    )
    .await?;
    if plan.provider != provider.provider_name() {
        return Err(AppError::InvalidInput(format!(
            "provider {} is not supported by {} adapter",
            plan.provider,
            provider.provider_name()
        )));
    }
    if let Some(summary) = plan.request_summary_json.as_object_mut() {
        summary.insert("source".to_string(), json!("rerun"));
        summary.insert("sourceCombinationId".to_string(), json!(combination_id));
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
    notify_generation_task_change(database, &task.id, observer).await?;

    if let Err(err) = execute_generation_task(
        database,
        paths,
        provider,
        api_key,
        &task,
        plan,
        observer,
        cancellation_checker,
    )
    .await
    {
        if !matches!(err, AppError::GenerationCancelled(_)) {
            mark_generation_task_failed(database, &task.id, &err).await?;
        }
        notify_generation_task_change(database, &task.id, observer).await?;
        return Err(err);
    }
    notify_generation_task_change(database, &task.id, observer).await?;

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
                combination_snapshot_json,
                prompt_snapshot_json,
                model_snapshot_json,
                input_assets_snapshot_json,
                request_summary_json,
                input_snapshot_json,
                final_prompt_snapshot_json,
                model_config_snapshot_json,
                asset_snapshot_json,
                output_count,
                updated_at
             ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&id)
        .bind(&request.combination_id)
        .bind(&request.provider)
        .bind(&request.model_id)
        .bind(request.input_snapshot_json.to_string())
        .bind(request.final_prompt_snapshot_json.to_string())
        .bind(request.model_config_snapshot_json.to_string())
        .bind(request.asset_snapshot_json.to_string())
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
            message,
            request_summary_json,
            response_summary_json,
            input_snapshot_json,
            final_prompt_snapshot_json,
            model_config_snapshot_json,
            asset_snapshot_json,
            output_count,
            cancel_mode,
            error_code,
            error_message,
            error_detail,
            created_at,
            started_at,
            finished_at,
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

pub async fn cancel_generation_task_by_id<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    provider: &P,
    api_key: &str,
    task_id: &str,
) -> AppResult<LocalGenerationTask> {
    let task = get_generation_task_by_id(database, task_id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput(format!("generation task {task_id} was not found"))
        })?;
    if !RUNNING_TASK_STATUSES.contains(&task.status.as_str()) {
        return Err(AppError::InvalidInput(format!(
            "generation task {task_id} is not running"
        )));
    }

    let (cancel_mode, message) = match provider.cancel_remote(task_id, api_key).await {
        Ok(RemoteCancelResult::Confirmed) => (
            "remote_confirmed",
            "Remote cancellation was confirmed by provider",
        ),
        Ok(RemoteCancelResult::NotSupported) => (
            "remote_not_supported",
            "Local waiting was cancelled; provider may continue processing or billing",
        ),
        Err(_) => (
            "remote_failed",
            "Local waiting was cancelled; remote cancellation failed",
        ),
    };

    mark_generation_task_cancelled(database, task_id, cancel_mode, Some(message)).await?;
    get_generation_task_by_id(database, task_id)
        .await?
        .ok_or_else(|| AppError::InvalidInput(format!("generation task {task_id} was not found")))
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

pub async fn get_generation_task_detail_by_id(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    id: &str,
) -> AppResult<Option<GenerationTaskDetail>> {
    let Some(task) = get_generation_task_by_id(database, id).await? else {
        return Ok(None);
    };
    let results = list_generation_task_result_assets(database, paths, id).await?;
    let execution_logs = list_generation_task_execution_logs(database, id).await?;
    Ok(Some(GenerationTaskDetail {
        task,
        results,
        execution_logs,
    }))
}

pub async fn get_latest_generation_task_detail_by_combination(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    combination_id: &str,
) -> AppResult<Option<GenerationTaskDetail>> {
    let task_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM generation_tasks
         WHERE combination_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
    )
    .bind(combination_id)
    .fetch_optional(database.pool())
    .await?;

    match task_id {
        Some(task_id) => get_generation_task_detail_by_id(database, paths, &task_id).await,
        None => Ok(None),
    }
}

pub async fn list_generation_task_details_by_combination(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    combination_id: &str,
    limit: i64,
) -> AppResult<Vec<GenerationTaskDetail>> {
    let limit = limit.clamp(1, 100);
    let task_ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM generation_tasks
         WHERE combination_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?",
    )
    .bind(combination_id)
    .bind(limit)
    .fetch_all(database.pool())
    .await?;
    list_generation_task_details_by_ids(database, paths, task_ids).await
}

pub async fn list_running_generation_task_details(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
) -> AppResult<Vec<GenerationTaskDetail>> {
    let mut builder =
        QueryBuilder::<sqlx::Sqlite>::new("SELECT id FROM generation_tasks WHERE status IN (");
    let mut separated = builder.separated(", ");
    for status in RUNNING_TASK_STATUSES {
        separated.push_bind(status);
    }
    separated.push_unseparated(") ORDER BY created_at DESC, id DESC");

    let task_ids: Vec<String> = builder
        .build_query_scalar()
        .fetch_all(database.pool())
        .await?;
    list_generation_task_details_by_ids(database, paths, task_ids).await
}

pub async fn list_recent_generation_task_details(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    limit: i64,
) -> AppResult<Vec<GenerationTaskDetail>> {
    let limit = limit.clamp(1, 50);
    let task_ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM generation_tasks
         ORDER BY created_at DESC, id DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(database.pool())
    .await?;
    list_generation_task_details_by_ids(database, paths, task_ids).await
}

pub async fn list_generation_task_history_details(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    query: GenerationTaskHistoryQuery,
) -> AppResult<GenerationTaskHistoryPage> {
    let normalized = NormalizedHistoryQuery::from(query);

    let mut stats_builder = QueryBuilder::<sqlx::Sqlite>::new(
        "SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
            COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
         FROM generation_tasks",
    );
    push_history_filters(&mut stats_builder, &normalized, false);
    let stats_row = stats_builder.build().fetch_one(database.pool()).await?;
    let stats = GenerationTaskHistoryStats {
        total: stats_row.get::<i64, _>("total"),
        succeeded: stats_row.get::<i64, _>("succeeded"),
        failed: stats_row.get::<i64, _>("failed"),
        cancelled: stats_row.get::<i64, _>("cancelled"),
    };
    let providers =
        list_generation_task_history_distinct_values(database, "provider", &normalized, |query| {
            query.provider = None;
        })
        .await?;
    let model_ids =
        list_generation_task_history_distinct_values(database, "model_id", &normalized, |query| {
            query.model_id = None;
        })
        .await?;

    let mut total_builder =
        QueryBuilder::<sqlx::Sqlite>::new("SELECT COUNT(*) FROM generation_tasks");
    push_history_filters(&mut total_builder, &normalized, true);
    let total: i64 = total_builder
        .build_query_scalar()
        .fetch_one(database.pool())
        .await?;

    let mut id_builder = QueryBuilder::<sqlx::Sqlite>::new("SELECT id FROM generation_tasks");
    push_history_filters(&mut id_builder, &normalized, true);
    id_builder.push(" ORDER BY created_at DESC, id DESC LIMIT ");
    id_builder.push_bind(normalized.limit);
    id_builder.push(" OFFSET ");
    id_builder.push_bind(normalized.offset);
    let task_ids: Vec<String> = id_builder
        .build_query_scalar()
        .fetch_all(database.pool())
        .await?;

    let items = list_generation_task_details_by_ids(database, paths, task_ids).await?;
    Ok(GenerationTaskHistoryPage {
        items,
        total,
        limit: normalized.limit,
        offset: normalized.offset,
        stats,
        providers,
        model_ids,
    })
}

pub async fn open_generation_result_asset(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    asset_id: &str,
) -> AppResult<()> {
    let asset = get_required_asset(database, asset_id, AssetType::Result).await?;
    let file_path = paths.root().join(asset.relative_path);
    if !file_path.is_file() {
        return Err(AppError::InvalidInput(format!(
            "result asset {asset_id} file was not found"
        )));
    }
    open_file_with_system_viewer(&file_path)
}

async fn build_generation_plan(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    request: StartGenerationRequest,
) -> AppResult<GenerationPlan> {
    let combination = get_image_combination_by_id(database, &request.combination_id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput(format!(
                "combination {} was not found",
                request.combination_id
            ))
        })?;

    let draft_model_config = request.draft_model_config.clone().ok_or_else(|| {
        AppError::InvalidInput("draftModelConfig is required to start generation".to_string())
    })?;
    let generation_garment_asset_ids = resolve_generation_garment_asset_ids(
        &combination.garment_asset_ids,
        request.draft_garment_asset_ids.as_deref(),
    )?;

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
                garment_asset_ids: generation_garment_asset_ids.clone(),
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
    let person =
        get_required_asset(database, &combination.person_asset_id, AssetType::Person).await?;
    assets.push(TaskAssetRole {
        asset: person,
        role: GenerationTaskInputRole::Person,
        sort_order: 0,
        is_primary: true,
    });
    for (index, garment_id) in generation_garment_asset_ids.iter().enumerate() {
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
        "garmentAssetIds": generation_garment_asset_ids
    });
    let final_prompt_snapshot_json = serde_json::to_value(&resolved_prompt).map_err(|err| {
        AppError::InvalidInput(format!("resolved prompt snapshot invalid: {err}"))
    })?;
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
            provider_base_url: provider_base_url_from_params(&params_json)?,
            images: provider_images,
            prompt: PromptPayload {
                system: resolved_prompt.system,
                user: resolved_prompt.user,
                negative: resolved_prompt.negative,
            },
            params: params_json,
        },
    })
}

fn resolve_generation_garment_asset_ids(
    combination_garment_asset_ids: &[String],
    draft_garment_asset_ids: Option<&[String]>,
) -> AppResult<Vec<String>> {
    let Some(draft_ids) = draft_garment_asset_ids else {
        return Ok(combination_garment_asset_ids.to_vec());
    };
    let combination_ids = combination_garment_asset_ids
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let mut seen = std::collections::HashSet::new();
    let mut resolved = Vec::new();
    for id in draft_ids {
        let value = id.trim();
        if value.is_empty() || !seen.insert(value.to_string()) {
            continue;
        }
        if !combination_ids.contains(value) {
            return Err(AppError::InvalidInput(format!(
                "draft garment asset {value} is not part of combination"
            )));
        }
        resolved.push(value.to_string());
    }
    Ok(resolved)
}

async fn build_retry_generation_plan(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    source_task: &LocalGenerationTask,
) -> AppResult<GenerationPlan> {
    let input_assets = list_generation_task_input_assets(database, &source_task.id).await?;
    let mut provider_images = Vec::new();
    for input_asset in &input_assets {
        let asset = get_asset_by_id(database, &input_asset.asset_id)
            .await?
            .ok_or_else(|| {
                AppError::InvalidInput(format!(
                    "asset {} was not found for retry",
                    input_asset.asset_id
                ))
            })?;
        let file_path = paths.root().join(&asset.relative_path);
        if !file_path.is_file() {
            return Err(asset_file_missing_error(
                &input_asset.asset_id,
                &asset.original_name,
                input_asset.role.as_str(),
            ));
        }
        provider_images.push(GenerateInputImage {
            asset_id: asset.id,
            role: input_asset.role.as_str().to_string(),
            mime_type: asset.mime_type,
            resolved_local_path: file_path,
        });
    }

    let mut request_summary_json = source_task
        .request_summary_json
        .clone()
        .unwrap_or_else(|| json!({}));
    if let Some(summary) = request_summary_json.as_object_mut() {
        summary.insert("source".to_string(), json!("retry"));
        summary.insert("sourceTaskId".to_string(), json!(source_task.id.clone()));
    }

    Ok(GenerationPlan {
        combination_id: source_task.combination_id.clone().unwrap_or_default(),
        provider: source_task.provider.clone(),
        model_id: source_task.model_id.clone(),
        output_count: u32::try_from(source_task.output_count).map_err(|_| {
            AppError::InvalidInput("source task output_count is invalid".to_string())
        })?,
        request_summary_json,
        input_snapshot_json: source_task.input_snapshot_json.clone(),
        final_prompt_snapshot_json: source_task.final_prompt_snapshot_json.clone(),
        model_config_snapshot_json: source_task.model_config_snapshot_json.clone(),
        asset_snapshot_json: source_task.asset_snapshot_json.clone(),
        input_assets,
        provider_input: GenerateInput {
            task_id: String::new(),
            provider: source_task.provider.clone(),
            model_id: source_task.model_id.clone(),
            provider_base_url: provider_base_url_from_params(
                source_task
                    .model_config_snapshot_json
                    .get("paramsJson")
                    .unwrap_or(&Value::Null),
            )?,
            images: provider_images,
            prompt: PromptPayload {
                system: source_task
                    .final_prompt_snapshot_json
                    .get("system")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                user: source_task
                    .final_prompt_snapshot_json
                    .get("user")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                negative: source_task
                    .final_prompt_snapshot_json
                    .get("negative")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            params: source_task
                .model_config_snapshot_json
                .get("paramsJson")
                .cloned()
                .unwrap_or_else(|| json!({})),
        },
    })
}

fn provider_base_url_from_params(params_json: &Value) -> AppResult<Option<String>> {
    let Some(value) = params_json.get("providerBaseUrl") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }

    Ok(Some(normalize_openai_provider_base_url(value)?))
}

async fn list_generation_task_input_assets(
    database: &WorkspaceDatabase,
    task_id: &str,
) -> AppResult<Vec<GenerationTaskInputAsset>> {
    let rows = sqlx::query(
        "SELECT asset_id, role, view_type, sort_order, is_primary
         FROM generation_task_input_assets
         WHERE task_id = ?
         ORDER BY sort_order ASC, asset_id ASC",
    )
    .bind(task_id)
    .fetch_all(database.pool())
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(GenerationTaskInputAsset {
                asset_id: row.get("asset_id"),
                role: generation_task_input_role_from_str(row.get::<String, _>("role").as_str())?,
                view_type: row.get("view_type"),
                sort_order: row.get("sort_order"),
                is_primary: row.get::<i64, _>("is_primary") != 0,
            })
        })
        .collect()
}

fn generation_task_input_role_from_str(value: &str) -> AppResult<GenerationTaskInputRole> {
    match value {
        "person" => Ok(GenerationTaskInputRole::Person),
        "garment" => Ok(GenerationTaskInputRole::Garment),
        "reference" => Ok(GenerationTaskInputRole::Reference),
        "mask" => Ok(GenerationTaskInputRole::Mask),
        _ => Err(AppError::InvalidInput(format!(
            "generation task input role {value} is invalid"
        ))),
    }
}

fn asset_file_missing_error(asset_id: &str, file_name: &str, role: &str) -> AppError {
    AppError::InvalidInput(format!(
        "ASSET_FILE_MISSING assetId={asset_id} fileName={file_name} role={role}"
    ))
}

async fn execute_generation_task<P: ImageGenerationProvider>(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    provider: &P,
    api_key: &str,
    task: &LocalGenerationTask,
    mut plan: GenerationPlan,
    observer: Option<GenerationTaskObserver<'_>>,
    cancellation_checker: Option<GenerationTaskCancellationChecker<'_>>,
) -> AppResult<()> {
    ensure_generation_task_not_cancelled(database, &task.id, observer, cancellation_checker)
        .await?;
    update_generation_task_status(
        database,
        &task.id,
        "preparing",
        10,
        Some("Preparing inputs"),
    )
    .await?;
    notify_generation_task_change(database, &task.id, observer).await?;
    plan.provider_input.task_id = task.id.clone();

    ensure_generation_task_not_cancelled(database, &task.id, observer, cancellation_checker)
        .await?;
    update_generation_task_status(
        database,
        &task.id,
        "calling_model",
        35,
        Some("Calling image provider"),
    )
    .await?;
    notify_generation_task_change(database, &task.id, observer).await?;
    ensure_generation_task_not_cancelled(database, &task.id, observer, cancellation_checker)
        .await?;
    let prompt_json = serde_json::to_value(&plan.provider_input.prompt)
        .map_err(|err| AppError::InvalidInput(format!("prompt payload is invalid: {err}")))?;
    start_generation_task_execution_log(
        database,
        &task.id,
        &plan.provider_input.provider,
        &plan.provider_input.model_id,
        &prompt_json,
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
    notify_generation_task_change(database, &task.id, observer).await?;
    let provider_call = provider.generate(plan.provider_input, api_key);
    tokio::pin!(provider_call);
    let provider_result = loop {
        tokio::select! {
            result = &mut provider_call => {
                break result;
            }
            _ = tokio::time::sleep(Duration::from_millis(250)) => {
                ensure_generation_task_not_cancelled(
                    database,
                    &task.id,
                    observer,
                    cancellation_checker,
                )
                .await?;
            }
        }
    };
    let result = match provider_result {
        Ok(result) => {
            finish_generation_task_execution_log_success(
                database,
                &task.id,
                &result.response_summary_json,
            )
            .await?;
            result
        }
        Err(err) => {
            let error_json = provider_error_response_json(&err);
            finish_generation_task_execution_log_error(database, &task.id, &error_json).await?;
            return Err(provider_error_to_app_error(err));
        }
    };

    ensure_generation_task_not_cancelled(database, &task.id, observer, cancellation_checker)
        .await?;
    update_generation_task_response_summary(database, &task.id, &result.response_summary_json)
        .await?;
    ensure_generation_task_not_cancelled(database, &task.id, observer, cancellation_checker)
        .await?;
    update_generation_task_status(
        database,
        &task.id,
        "saving_result",
        80,
        Some("Saving generated results"),
    )
    .await?;
    notify_generation_task_change(database, &task.id, observer).await?;

    for (index, image) in result.images.into_iter().enumerate() {
        ensure_generation_task_not_cancelled(database, &task.id, observer, cancellation_checker)
            .await?;
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

    ensure_generation_task_not_cancelled(database, &task.id, observer, cancellation_checker)
        .await?;
    mark_generation_task_succeeded(database, &task.id).await
}

async fn ensure_generation_task_not_cancelled(
    database: &WorkspaceDatabase,
    task_id: &str,
    observer: Option<GenerationTaskObserver<'_>>,
    cancellation_checker: Option<GenerationTaskCancellationChecker<'_>>,
) -> AppResult<()> {
    let task = get_generation_task_by_id(database, task_id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput(format!("generation task {task_id} was not found"))
        })?;
    if task.status == "cancelled" {
        return Err(AppError::GenerationCancelled(task_id.to_string()));
    }
    if cancellation_checker.is_some_and(|checker| checker()) {
        mark_generation_task_cancelled(
            database,
            task_id,
            "local_only",
            Some("Local waiting was cancelled before saving generated results"),
        )
        .await?;
        notify_generation_task_change(database, task_id, observer).await?;
        return Err(AppError::GenerationCancelled(task_id.to_string()));
    }
    Ok(())
}

async fn notify_generation_task_change(
    database: &WorkspaceDatabase,
    task_id: &str,
    observer: Option<GenerationTaskObserver<'_>>,
) -> AppResult<()> {
    let Some(observer) = observer else {
        return Ok(());
    };
    let task = get_generation_task_by_id(database, task_id)
        .await?
        .ok_or_else(|| {
            AppError::InvalidInput(format!("generation task {task_id} was not found"))
        })?;
    observer(task);
    Ok(())
}

async fn list_generation_task_details_by_ids(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    task_ids: Vec<String>,
) -> AppResult<Vec<GenerationTaskDetail>> {
    let mut details = Vec::with_capacity(task_ids.len());
    for task_id in task_ids {
        if let Some(detail) = get_generation_task_detail_by_id(database, paths, &task_id).await? {
            details.push(detail);
        }
    }
    Ok(details)
}

fn non_empty_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn push_history_filters(
    builder: &mut QueryBuilder<'_, sqlx::Sqlite>,
    query: &NormalizedHistoryQuery,
    include_status: bool,
) {
    builder.push(" WHERE 1 = 1");
    if include_status {
        if let Some(status) = &query.status {
            builder.push(" AND status = ");
            builder.push_bind(status.clone());
        }
    }
    if let Some(provider) = &query.provider {
        builder.push(" AND provider = ");
        builder.push_bind(provider.clone());
    }
    if let Some(model_id) = &query.model_id {
        builder.push(" AND model_id = ");
        builder.push_bind(model_id.clone());
    }
    if let Some(created_from) = &query.created_from {
        builder.push(" AND created_at >= ");
        builder.push_bind(created_from.clone());
    }
    if let Some(created_to) = &query.created_to {
        builder.push(" AND created_at <= ");
        builder.push_bind(created_to.clone());
    }
    if let Some(search) = &query.search {
        let like = format!("%{search}%");
        builder.push(
            " AND (
                id LIKE ",
        );
        builder.push_bind(like.clone());
        builder.push(" OR provider LIKE ");
        builder.push_bind(like.clone());
        builder.push(" OR model_id LIKE ");
        builder.push_bind(like.clone());
        builder.push(" OR input_snapshot_json LIKE ");
        builder.push_bind(like.clone());
        builder.push(" OR final_prompt_snapshot_json LIKE ");
        builder.push_bind(like);
        builder.push(")");
    }
}

async fn list_generation_task_history_distinct_values(
    database: &WorkspaceDatabase,
    column: &'static str,
    query: &NormalizedHistoryQuery,
    clear_self_filter: impl FnOnce(&mut NormalizedHistoryQuery),
) -> AppResult<Vec<String>> {
    let mut query = query.clone();
    clear_self_filter(&mut query);
    let mut builder = QueryBuilder::<sqlx::Sqlite>::new(format!(
        "SELECT DISTINCT {column} FROM generation_tasks"
    ));
    push_history_filters(&mut builder, &query, true);
    builder.push(format!(" ORDER BY {column} ASC"));
    Ok(builder
        .build_query_scalar()
        .fetch_all(database.pool())
        .await?)
}

pub fn sanitize_source_url(source_url: &str) -> Option<String> {
    let lower = source_url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return None;
    }
    if !is_public_http_url(&lower) {
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

fn is_public_http_url(lower_url: &str) -> bool {
    let Some(authority) = lower_url
        .strip_prefix("https://")
        .or_else(|| lower_url.strip_prefix("http://"))
        .and_then(|value| value.split(['/', '?', '#']).next())
    else {
        return false;
    };
    if authority.is_empty() || authority.contains('@') {
        return false;
    }

    let host = if let Some(rest) = authority.strip_prefix('[') {
        let Some((host, _)) = rest.split_once(']') else {
            return false;
        };
        host
    } else {
        authority.split(':').next().unwrap_or_default()
    };
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
        return false;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => is_public_ipv4(address),
        Ok(IpAddr::V6(address)) => is_public_ipv6(address),
        Err(_) => true,
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_unspecified())
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    !(address.is_loopback()
        || address.is_unspecified()
        || address.is_unique_local()
        || address.is_unicast_link_local())
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

async fn start_generation_task_execution_log(
    database: &WorkspaceDatabase,
    task_id: &str,
    provider: &str,
    model_id: &str,
    prompt_json: &Value,
) -> AppResult<()> {
    let id = format!("generation_task_execution_log_{}", Ulid::new());
    sqlx::query(
        "INSERT INTO generation_task_execution_logs (
            id,
            task_id,
            provider,
            model_id,
            started_at,
            prompt_json,
            created_at,
            updated_at
         ) VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
         ON CONFLICT(task_id) DO UPDATE SET
            provider = excluded.provider,
            model_id = excluded.model_id,
            started_at = excluded.started_at,
            finished_at = NULL,
            prompt_json = excluded.prompt_json,
            success_response_json = NULL,
            error_response_json = NULL,
            updated_at = datetime('now')",
    )
    .bind(id)
    .bind(task_id)
    .bind(provider)
    .bind(model_id)
    .bind(prompt_json.to_string())
    .execute(database.pool())
    .await?;
    Ok(())
}

async fn finish_generation_task_execution_log_success(
    database: &WorkspaceDatabase,
    task_id: &str,
    response_json: &Value,
) -> AppResult<()> {
    validate_safe_summary(Some(response_json))?;
    sqlx::query(
        "UPDATE generation_task_execution_logs
         SET finished_at = datetime('now'),
             success_response_json = ?,
             error_response_json = NULL,
             updated_at = datetime('now')
         WHERE task_id = ?",
    )
    .bind(response_json.to_string())
    .bind(task_id)
    .execute(database.pool())
    .await?;
    Ok(())
}

async fn finish_generation_task_execution_log_error(
    database: &WorkspaceDatabase,
    task_id: &str,
    error_json: &Value,
) -> AppResult<()> {
    validate_safe_summary(Some(error_json))?;
    sqlx::query(
        "UPDATE generation_task_execution_logs
         SET finished_at = datetime('now'),
             success_response_json = NULL,
             error_response_json = ?,
             updated_at = datetime('now')
         WHERE task_id = ?",
    )
    .bind(error_json.to_string())
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

async fn mark_generation_task_cancelled(
    database: &WorkspaceDatabase,
    task_id: &str,
    cancel_mode: &str,
    message: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE generation_tasks
         SET status = 'cancelled',
             progress = 100,
             cancel_mode = ?,
             message = ?,
             updated_at = datetime('now'),
             finished_at = datetime('now')
         WHERE id = ?",
    )
    .bind(cancel_mode)
    .bind(message)
    .bind(task_id)
    .execute(database.pool())
    .await?;
    finish_generation_task_execution_log_error(
        database,
        task_id,
        &generation_cancelled_error_json(task_id),
    )
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
        .map_err(|err| {
            AppError::InvalidInput(format!("failed to create result thumbnail: {err}"))
        })?;

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
    let asset_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM assets WHERE asset_type = 'result' AND sha256 = ?")
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

fn provider_error_response_json(err: &ProviderError) -> Value {
    json!({
        "provider": err.provider,
        "modelId": err.model_id,
        "code": err.code,
        "message": err.message,
        "statusCode": err.status_code,
        "retryable": err.retryable,
    })
}

fn generation_cancelled_error_json(task_id: &str) -> Value {
    json!({
        "code": "GENERATION_CANCELLED",
        "message": format!("generation task {task_id} was cancelled"),
    })
}

fn provider_error_to_app_error(err: ProviderError) -> AppError {
    AppError::Provider {
        code: provider_error_code(err.code),
        message: format!("{:?}: {}", err.code, err.message),
    }
}

fn provider_error_code(code: ProviderErrorCode) -> &'static str {
    match code {
        ProviderErrorCode::MissingCredential => "MISSING_CREDENTIAL",
        ProviderErrorCode::UnsupportedProvider => "UNSUPPORTED_PROVIDER",
        ProviderErrorCode::UnsupportedModel => "UNSUPPORTED_MODEL",
        ProviderErrorCode::InvalidInput => "INVALID_INPUT",
        ProviderErrorCode::RequestTimeout => "REQUEST_TIMEOUT",
        ProviderErrorCode::Cancelled => "CANCELLED",
        ProviderErrorCode::RateLimited => "RATE_LIMITED",
        ProviderErrorCode::RemoteError => "REMOTE_ERROR",
        ProviderErrorCode::ResponseInvalid => "RESPONSE_INVALID",
    }
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
        AppError::GenerationCancelled(_) => "GENERATION_CANCELLED",
        AppError::Provider { code, .. } => code,
        AppError::InvalidInput(_) => "INVALID_INPUT",
    }
}

#[cfg(target_os = "macos")]
fn open_file_with_system_viewer(path: &std::path::Path) -> AppResult<()> {
    let status = Command::new("/usr/bin/open").arg(path).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "failed to open result file {}",
            path.display()
        )))
    }
}

#[cfg(not(target_os = "macos"))]
fn open_file_with_system_viewer(_path: &std::path::Path) -> AppResult<()> {
    Err(AppError::InvalidInput(
        "opening result files is only supported on macOS".to_string(),
    ))
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
                    "summary_json contains sensitive value at {path}"
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
                        "summary_json contains sensitive key at {path}.{key}"
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
        message: row.get("message"),
        request_summary_json: parse_optional_json(row.get("request_summary_json"))?,
        response_summary_json: parse_optional_json(row.get("response_summary_json"))?,
        input_snapshot_json: parse_required_json(row.get("input_snapshot_json"))?,
        final_prompt_snapshot_json: parse_required_json(row.get("final_prompt_snapshot_json"))?,
        model_config_snapshot_json: parse_required_json(row.get("model_config_snapshot_json"))?,
        asset_snapshot_json: parse_required_json(row.get("asset_snapshot_json"))?,
        output_count: row.get("output_count"),
        cancel_mode: row.get("cancel_mode"),
        error_code: row.get("error_code"),
        error_message: row.get("error_message"),
        error_detail: row.get("error_detail"),
        created_at: row.get("created_at"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        updated_at: row.get("updated_at"),
    })
}

fn row_to_generation_task_execution_log(
    row: sqlx::sqlite::SqliteRow,
) -> AppResult<GenerationTaskExecutionLog> {
    Ok(GenerationTaskExecutionLog {
        id: row.get("id"),
        task_id: row.get("task_id"),
        provider: row.get("provider"),
        model_id: row.get("model_id"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        prompt_json: parse_required_json(row.get("prompt_json"))?,
        success_response_json: parse_optional_json(row.get("success_response_json"))?,
        error_response_json: parse_optional_json(row.get("error_response_json"))?,
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

async fn list_generation_task_execution_logs(
    database: &WorkspaceDatabase,
    task_id: &str,
) -> AppResult<Vec<GenerationTaskExecutionLog>> {
    let rows = sqlx::query(
        "SELECT
            id,
            task_id,
            provider,
            model_id,
            started_at,
            finished_at,
            prompt_json,
            success_response_json,
            error_response_json,
            created_at,
            updated_at
         FROM generation_task_execution_logs
         WHERE task_id = ?
         ORDER BY started_at ASC, id ASC",
    )
    .bind(task_id)
    .fetch_all(database.pool())
    .await?;

    rows.into_iter()
        .map(row_to_generation_task_execution_log)
        .collect()
}

async fn list_generation_task_result_assets(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    task_id: &str,
) -> AppResult<Vec<GenerationTaskResultAsset>> {
    let rows = sqlx::query(
        "SELECT
            r.id,
            r.task_id,
            r.asset_id,
            r.sort_order,
            r.source_url,
            r.created_at,
            a.relative_path,
            a.thumb_relative_path,
            a.mime_type,
            a.width,
            a.height
         FROM generation_task_results r
         INNER JOIN assets a ON a.id = r.asset_id
         WHERE r.task_id = ?
         ORDER BY r.sort_order ASC",
    )
    .bind(task_id)
    .fetch_all(database.pool())
    .await?;

    rows.into_iter()
        .map(|row| {
            let relative_path: String = row.get("relative_path");
            let thumb_relative_path: String = row.get("thumb_relative_path");
            Ok(GenerationTaskResultAsset {
                id: row.get("id"),
                task_id: row.get("task_id"),
                asset_id: row.get("asset_id"),
                sort_order: row.get("sort_order"),
                source_url: row.get("source_url"),
                file_path: paths
                    .root()
                    .join(&relative_path)
                    .to_string_lossy()
                    .to_string(),
                thumb_file_path: paths
                    .root()
                    .join(&thumb_relative_path)
                    .to_string_lossy()
                    .to_string(),
                relative_path,
                thumb_relative_path,
                mime_type: row.get("mime_type"),
                width: row.get("width"),
                height: row.get("height"),
                created_at: row.get("created_at"),
            })
        })
        .collect()
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
    use std::sync::{Arc, Mutex};

    use serde_json::json;
    use sqlx::Row;

    use super::*;
    use crate::domain::asset::AssetType;
    use crate::domain::combination::SaveImageCombinationRequest;
    use crate::domain::model::SaveModelConfigRequest;
    use crate::domain::prompt::{PromptBindingSection, PromptMode, SavePromptBindingRequest};
    use crate::domain::task::{
        CreateGenerationTaskResultRequest, CreateGenerationTaskSnapshotRequest,
        GenerationTaskInputAsset, GenerationTaskInputRole, StartGenerationRequest,
    };
    use crate::providers::provider_trait::{
        GenerateInput, GenerateResult, GeneratedImage, ImageGenerationProvider, ProviderError,
        ProviderErrorCode, RemoteCancelResult,
    };
    use crate::services::assets::import_image_file;
    use crate::services::combinations::{
        get_image_combination_by_id, save_image_combination_request,
    };
    use crate::services::prompt_resolver::save_prompt_binding_request;
    use crate::storage::file_store::WorkspacePaths;
    use crate::storage::migrations::run_workspace_migrations;

    #[tokio::test]
    async fn recover_interrupted_tasks_fails_running_task_and_closes_execution_log() {
        let (_temp_dir, database) = test_database().await;

        for (id, status) in [
            ("task-calling", "calling_model"),
            ("task-succeeded", "succeeded"),
        ] {
            sqlx::query(
                "INSERT INTO generation_tasks (
                    id,
                    status,
                    combination_snapshot_json,
                    prompt_snapshot_json,
                    model_snapshot_json,
                    input_assets_snapshot_json
                ) VALUES (?, ?, '{}', '{}', '{}', '[]')",
            )
            .bind(id)
            .bind(status)
            .execute(database.pool())
            .await
            .expect("insert task");
        }
        start_generation_task_execution_log(
            &database,
            "task-calling",
            "openai",
            "gpt-image-2",
            &json!({ "user": "prompt before crash" }),
        )
        .await
        .expect("start calling log");
        start_generation_task_execution_log(
            &database,
            "task-succeeded",
            "openai",
            "gpt-image-2",
            &json!({ "user": "already done" }),
        )
        .await
        .expect("start succeeded log");

        let recovered = recover_interrupted_tasks(&database).await.expect("recover");
        assert_eq!(recovered, 1);

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
                ("task-succeeded".to_string(), "succeeded".to_string(), None),
            ]
        );

        let logs = sqlx::query(
            "SELECT task_id, finished_at, error_response_json
             FROM generation_task_execution_logs
             ORDER BY task_id",
        )
        .fetch_all(database.pool())
        .await
        .expect("fetch logs");
        let log_states: Vec<(String, Option<String>, Option<String>)> = logs
            .into_iter()
            .map(|row| {
                (
                    row.get("task_id"),
                    row.get("finished_at"),
                    row.get("error_response_json"),
                )
            })
            .collect();

        assert_eq!(log_states.len(), 2);
        assert_eq!(log_states[0].0, "task-calling");
        assert!(log_states[0].1.is_some());
        assert_eq!(
            log_states[0].2,
            Some(json!({ "code": APP_UNEXPECTED_SHUTDOWN }).to_string())
        );
        assert_eq!(log_states[1].0, "task-succeeded");
        assert!(log_states[1].1.is_none());
        assert!(log_states[1].2.is_none());
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
                model_id: "gpt-image-2".to_string(),
                request_summary_json: Some(json!({
                    "provider": "openai",
                    "modelId": "gpt-image-2",
                    "assetCount": 2,
                    "promptLength": 24
                })),
                input_snapshot_json: json!({"inputAssets": ["person_1", "garment_1"]}),
                final_prompt_snapshot_json: json!({"user": "wear linen dress"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-2", "outputCount": 1}),
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
        assert_eq!(task.model_config_snapshot_json["modelId"], "gpt-image-2");

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
                model_id: "gpt-image-2".to_string(),
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

    #[test]
    fn validate_safe_summary_rejects_sensitive_provider_payloads() {
        let cases = [
            json!({"rawResponse": {"id": "response-id"}}),
            json!({"headers": {"Authorization": "Bearer placeholder-token"}}),
            json!({"api_key": "placeholder-api-key"}),
            json!({"image": "data:image/png;base64,AAAA"}),
            json!({"path": "/Users/example/source.png"}),
        ];

        for summary in cases {
            assert!(matches!(
                validate_safe_summary(Some(&summary)),
                Err(AppError::InvalidInput(_))
            ));
        }
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
                model_id: "gpt-image-2".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-2"}),
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
                source_url: Some(
                    "https://cdn.example.com/result.png?token=placeholder".to_string(),
                ),
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
    async fn list_generation_tasks_returns_running_and_recent_details() {
        let (_temp_dir, paths, database) = test_workspace().await;
        seed_assets(&database).await;

        create_minimal_task(&database, "task_done").await;
        mark_generation_task_succeeded(&database, "task_done")
            .await
            .expect("mark done");
        create_generation_task_result(
            &database,
            CreateGenerationTaskResultRequest {
                id: Some("result_done".to_string()),
                task_id: "task_done".to_string(),
                asset_id: "result_1".to_string(),
                sort_order: 0,
                source_url: Some("https://cdn.example.com/result.png".to_string()),
            },
        )
        .await
        .expect("result");

        create_minimal_task(&database, "task_running").await;
        update_generation_task_status(&database, "task_running", "calling_model", 45, None)
            .await
            .expect("status");

        let running = list_running_generation_task_details(&database, &paths)
            .await
            .expect("running tasks");
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].task.id, "task_running");
        assert_eq!(running[0].task.status, "calling_model");

        let recent = list_recent_generation_task_details(&database, &paths, 10)
            .await
            .expect("recent tasks");
        let recent_ids: Vec<String> = recent.iter().map(|detail| detail.task.id.clone()).collect();
        assert_eq!(recent_ids, vec!["task_running", "task_done"]);
        assert_eq!(recent[1].results.len(), 1);
        assert_eq!(recent[1].results[0].asset_id, "result_1");
    }

    #[tokio::test]
    async fn cancel_generation_task_records_remote_not_supported_by_default() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;
        create_minimal_task(&database, "task_cancel_default").await;
        update_generation_task_status(&database, "task_cancel_default", "calling_model", 45, None)
            .await
            .expect("status");

        let task = cancel_generation_task_by_id(
            &database,
            &StaticProvider,
            "placeholder-api-key",
            "task_cancel_default",
        )
        .await
        .expect("cancel");

        assert_eq!(task.status, "cancelled");
        assert_eq!(task.cancel_mode.as_deref(), Some("remote_not_supported"));
    }

    #[tokio::test]
    async fn cancel_generation_task_records_remote_confirmed_when_provider_supports_it() {
        let (_temp_dir, database) = test_database().await;
        seed_assets(&database).await;
        create_minimal_task(&database, "task_cancel_remote").await;
        update_generation_task_status(&database, "task_cancel_remote", "calling_model", 45, None)
            .await
            .expect("status");

        let task = cancel_generation_task_by_id(
            &database,
            &RemoteCancelProvider,
            "placeholder-api-key",
            "task_cancel_remote",
        )
        .await
        .expect("cancel");

        assert_eq!(task.status, "cancelled");
        assert_eq!(task.cancel_mode.as_deref(), Some("remote_confirmed"));
    }

    #[tokio::test]
    async fn run_generation_flow_notifies_task_status_changes() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observed_for_callback = Arc::clone(&observed);
        let observer = move |task: LocalGenerationTask| {
            observed_for_callback
                .lock()
                .expect("lock observed")
                .push(task.status);
        };

        let task = run_generation_flow_with_task_id_and_observer(
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
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_observed".to_string()),
            Some(&observer),
        )
        .await
        .expect("run generation");

        assert_eq!(task.status, "succeeded");
        assert_eq!(
            observed.lock().expect("observed").as_slice(),
            &[
                "queued",
                "preparing",
                "calling_model",
                "waiting_result",
                "saving_result",
                "succeeded"
            ]
        );
    }

    #[tokio::test]
    async fn run_generation_flow_stops_before_saving_when_cancelled_after_provider_returns() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cancelled_for_provider = Arc::clone(&cancelled);
        let cancellation_checker = || cancelled.load(std::sync::atomic::Ordering::SeqCst);

        let result = run_generation_flow_with_task_id_observer_and_cancellation(
            &database,
            &paths,
            &CancellingProvider {
                cancelled: cancelled_for_provider,
            },
            "placeholder-api-key",
            StartGenerationRequest {
                combination_id,
                draft_prompt_binding: None,
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_cancelled_during_flow".to_string()),
            None,
            Some(&cancellation_checker),
        )
        .await;

        assert!(
            matches!(result, Err(AppError::GenerationCancelled(task_id)) if task_id == "task_cancelled_during_flow")
        );
        let task = get_generation_task_by_id(&database, "task_cancelled_during_flow")
            .await
            .expect("task")
            .expect("task");
        assert_eq!(task.status, "cancelled");
        assert_eq!(task.cancel_mode.as_deref(), Some("local_only"));
        let result_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM generation_task_results WHERE task_id = ?")
                .bind("task_cancelled_during_flow")
                .fetch_one(database.pool())
                .await
                .expect("result count");
        assert_eq!(result_count, 0);
        let log_row = sqlx::query(
            "SELECT finished_at, error_response_json
             FROM generation_task_execution_logs
             WHERE task_id = ?",
        )
        .bind("task_cancelled_during_flow")
        .fetch_one(database.pool())
        .await
        .expect("execution log");
        let finished_at: Option<String> = log_row.get("finished_at");
        let error_response_json: Option<String> = log_row.get("error_response_json");
        assert!(finished_at.is_some());
        assert_eq!(
            error_response_json,
            Some(
                json!({
                    "code": "GENERATION_CANCELLED",
                    "message": "generation task task_cancelled_during_flow was cancelled"
                })
                .to_string()
            )
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
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({
                        "outputCount": 1,
                        "size": "1024x1024",
                        "providerBaseUrl": "https://gateway.example.com/v1/"
                    }),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
        )
        .await
        .expect("run generation");

        assert_eq!(task.status, "succeeded");
        assert_eq!(task.final_prompt_snapshot_json["user"], "wear linen dress");
        assert_eq!(task.model_config_snapshot_json["modelId"], "gpt-image-2");
        assert_eq!(
            task.model_config_snapshot_json["paramsJson"]["providerBaseUrl"],
            "https://gateway.example.com/v1"
        );

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

        let detail = get_generation_task_detail_by_id(&database, &paths, &task.id)
            .await
            .expect("task detail")
            .expect("task detail");
        assert_eq!(detail.task.id, task.id);
        assert_eq!(detail.results.len(), 1);
        assert_eq!(detail.results[0].asset_id, result_refs[0].0);
        assert_eq!(detail.results[0].sort_order, 0);
        assert!(std::path::Path::new(&detail.results[0].file_path).is_file());
        assert!(std::path::Path::new(&detail.results[0].thumb_file_path).is_file());

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
        assert_eq!(
            reloaded.final_prompt_snapshot_json["user"],
            "wear linen dress"
        );
    }

    #[tokio::test]
    async fn run_generation_flow_uses_draft_garments_without_rewriting_combination() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let extra_garment_path = paths.root().join("garment-extra.png");
        write_png(&extra_garment_path, [20, 120, 160, 255]);
        let extra_garment =
            import_image_file(&database, &paths, extra_garment_path, AssetType::Garment)
                .await
                .expect("extra garment");
        let original = get_image_combination_by_id(&database, &combination_id)
            .await
            .expect("load combination")
            .expect("combination exists");
        save_image_combination_request(
            &database,
            SaveImageCombinationRequest {
                id: Some(combination_id.clone()),
                name: original.name,
                person_asset_id: original.person_asset_id,
                person_asset_ids: original.person_asset_ids,
                garment_asset_ids: vec![
                    original.garment_asset_ids[0].clone(),
                    extra_garment.asset.id.clone(),
                ],
            },
        )
        .await
        .expect("add garment to combination library");

        let task = run_generation_flow_with_task_id(
            &database,
            &paths,
            &StaticProvider,
            "placeholder-api-key",
            StartGenerationRequest {
                combination_id: combination_id.clone(),
                draft_prompt_binding: None,
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: Some(vec![extra_garment.asset.id.clone()]),
                revision: Some(8),
            },
            Some("task_draft_garments".to_string()),
        )
        .await
        .expect("run generation");

        assert_eq!(
            task.input_snapshot_json["garmentAssetIds"],
            json!([extra_garment.asset.id.clone()])
        );

        let input_garments: Vec<String> = sqlx::query(
            "SELECT asset_id
             FROM generation_task_input_assets
             WHERE task_id = ? AND role = 'garment'
             ORDER BY sort_order",
        )
        .bind(&task.id)
        .fetch_all(database.pool())
        .await
        .expect("input garments")
        .into_iter()
        .map(|row| row.get("asset_id"))
        .collect();
        assert_eq!(input_garments, vec![extra_garment.asset.id.clone()]);

        let reloaded = get_image_combination_by_id(&database, &combination_id)
            .await
            .expect("reload combination")
            .expect("combination exists");
        assert_eq!(reloaded.garment_asset_ids.len(), 2);
    }

    #[tokio::test]
    async fn run_generation_flow_persists_success_execution_log() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;

        let task = run_generation_flow_with_task_id(
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
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_success_execution_log".to_string()),
        )
        .await
        .expect("run generation");

        let detail = get_generation_task_detail_by_id(&database, &paths, &task.id)
            .await
            .expect("task detail")
            .expect("task detail");
        assert_eq!(detail.execution_logs.len(), 1);
        let log = &detail.execution_logs[0];
        assert_eq!(log.task_id, task.id);
        assert_eq!(log.provider, "openai");
        assert_eq!(log.model_id, "gpt-image-2");
        assert_eq!(log.prompt_json["user"], "wear linen dress");
        assert_eq!(
            log.success_response_json
                .as_ref()
                .expect("success response")["statusCode"],
            200
        );
        assert!(log.error_response_json.is_none());
        assert!(log.finished_at.is_some());
    }

    #[tokio::test]
    async fn list_generation_task_history_returns_stats_and_execution_logs() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;

        let task = run_generation_flow_with_task_id(
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
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_history_page".to_string()),
        )
        .await
        .expect("run generation");

        let page = list_generation_task_history_details(
            &database,
            &paths,
            GenerationTaskHistoryQuery {
                search: Some("look".to_string()),
                status: Some("succeeded".to_string()),
                provider: Some("openai".to_string()),
                model_id: Some("gpt-image-2".to_string()),
                created_from: None,
                created_to: None,
                limit: Some(20),
                offset: Some(0),
            },
        )
        .await
        .expect("history page");

        assert_eq!(page.total, 1);
        assert_eq!(page.stats.total, 1);
        assert_eq!(page.stats.succeeded, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].task.id, task.id);
        assert_eq!(page.items[0].execution_logs.len(), 1);
        assert_eq!(page.items[0].execution_logs[0].provider, "openai");
    }

    #[tokio::test]
    async fn list_generation_task_history_returns_filter_options_beyond_current_page() {
        let (_temp_dir, paths, database) = test_workspace().await;
        seed_assets(&database).await;

        create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_legacy_history".to_string()),
                combination_id: None,
                provider: "legacy-provider".to_string(),
                model_id: "legacy-model".to_string(),
                request_summary_json: Some(json!({"provider": "legacy-provider"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "legacy prompt"}),
                model_config_snapshot_json: json!({"modelId": "legacy-model"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await
        .expect("legacy task");
        mark_generation_task_succeeded(&database, "task_legacy_history")
            .await
            .expect("legacy done");
        create_generation_task_snapshot(
            &database,
            CreateGenerationTaskSnapshotRequest {
                id: Some("task_openai_history".to_string()),
                combination_id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-2".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "openai prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-2"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await
        .expect("openai task");
        mark_generation_task_succeeded(&database, "task_openai_history")
            .await
            .expect("openai done");

        let page = list_generation_task_history_details(
            &database,
            &paths,
            GenerationTaskHistoryQuery {
                search: None,
                status: None,
                provider: None,
                model_id: None,
                created_from: None,
                created_to: None,
                limit: Some(1),
                offset: Some(0),
            },
        )
        .await
        .expect("history page");

        assert_eq!(page.items.len(), 1);
        assert_eq!(page.total, 2);
        assert_eq!(page.providers, vec!["legacy-provider", "openai"]);
        assert_eq!(page.model_ids, vec!["gpt-image-2", "legacy-model"]);
    }

    #[tokio::test]
    async fn run_generation_flow_saves_failure_reason() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;

        let result = run_generation_flow_with_task_id(
            &database,
            &paths,
            &FailingProvider,
            "placeholder-api-key",
            StartGenerationRequest {
                combination_id,
                draft_prompt_binding: None,
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_provider_failed".to_string()),
        )
        .await;

        assert!(matches!(
            result,
            Err(AppError::Provider {
                code: "REMOTE_ERROR",
                ..
            })
        ));
        let row = sqlx::query(
            "SELECT status, error_code, error_message
             FROM generation_tasks
             WHERE id = 'task_provider_failed'",
        )
        .fetch_one(database.pool())
        .await
        .expect("failed task");
        assert_eq!(row.get::<String, _>("status"), "failed");
        assert_eq!(
            row.get::<Option<String>, _>("error_code").as_deref(),
            Some("REMOTE_ERROR")
        );
        assert!(row
            .get::<Option<String>, _>("error_message")
            .expect("error message")
            .contains("provider unavailable"));
    }

    #[test]
    fn provider_error_codes_map_to_task_error_codes() {
        let cases = [
            (ProviderErrorCode::MissingCredential, "MISSING_CREDENTIAL"),
            (
                ProviderErrorCode::UnsupportedProvider,
                "UNSUPPORTED_PROVIDER",
            ),
            (ProviderErrorCode::UnsupportedModel, "UNSUPPORTED_MODEL"),
            (ProviderErrorCode::InvalidInput, "INVALID_INPUT"),
            (ProviderErrorCode::RequestTimeout, "REQUEST_TIMEOUT"),
            (ProviderErrorCode::Cancelled, "CANCELLED"),
            (ProviderErrorCode::RateLimited, "RATE_LIMITED"),
            (ProviderErrorCode::RemoteError, "REMOTE_ERROR"),
            (ProviderErrorCode::ResponseInvalid, "RESPONSE_INVALID"),
        ];

        for (provider_code, expected_task_code) in cases {
            let err = provider_error_to_app_error(ProviderError::new(
                "openai",
                Some("gpt-image-2".to_string()),
                provider_code,
                "provider failed",
            ));

            assert_eq!(app_error_code(&err), expected_task_code);
        }
    }

    #[tokio::test]
    async fn run_generation_flow_persists_failed_execution_log() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;

        let result = run_generation_flow_with_task_id(
            &database,
            &paths,
            &FailingProvider,
            "placeholder-api-key",
            StartGenerationRequest {
                combination_id,
                draft_prompt_binding: None,
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_failed_execution_log".to_string()),
        )
        .await;

        assert!(matches!(
            result,
            Err(AppError::Provider {
                code: "REMOTE_ERROR",
                ..
            })
        ));
        let detail =
            get_generation_task_detail_by_id(&database, &paths, "task_failed_execution_log")
                .await
                .expect("task detail")
                .expect("task detail");
        assert_eq!(detail.execution_logs.len(), 1);
        let log = &detail.execution_logs[0];
        assert_eq!(log.provider, "openai");
        assert_eq!(log.model_id, "gpt-image-2");
        assert_eq!(log.prompt_json["user"], "wear linen dress");
        assert!(log.success_response_json.is_none());
        let error_response = log.error_response_json.as_ref().expect("error response");
        assert_eq!(error_response["code"], "REMOTE_ERROR");
        assert_eq!(error_response["message"], "provider unavailable");
        assert!(log.finished_at.is_some());
    }

    #[tokio::test]
    async fn retry_generation_task_reuses_original_snapshots() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let original = run_generation_flow_with_task_id(
            &database,
            &paths,
            &StaticProvider,
            "placeholder-api-key",
            StartGenerationRequest {
                combination_id: combination_id.clone(),
                draft_prompt_binding: None,
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_retry_source".to_string()),
        )
        .await
        .expect("original generation");
        save_prompt_binding_request(
            &database,
            SavePromptBindingRequest {
                id: None,
                combination_id,
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
                    override_text: "changed prompt".to_string(),
                },
                negative: None,
                variables_json: json!({}),
            },
        )
        .await
        .expect("change prompt");

        let retried = retry_generation_task_with_provider(
            &database,
            &paths,
            &StaticProvider,
            "placeholder-api-key",
            &original.id,
            Some("task_retry_new".to_string()),
            None,
            None,
        )
        .await
        .expect("retry generation");

        assert_eq!(retried.status, "succeeded");
        assert_eq!(
            retried.final_prompt_snapshot_json["user"],
            "wear linen dress"
        );
        assert_eq!(
            retried.request_summary_json.expect("summary")["source"],
            "retry"
        );
    }

    #[tokio::test]
    async fn retry_generation_task_rejects_invalid_provider_base_url_snapshot() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let original = run_generation_flow_with_task_id(
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
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_retry_invalid_base_url_source".to_string()),
        )
        .await
        .expect("original generation");
        sqlx::query("UPDATE generation_tasks SET model_config_snapshot_json = ? WHERE id = ?")
            .bind(
                json!({
                    "provider": "openai",
                    "modelId": "gpt-image-2",
                    "advanced": false,
                    "paramsJson": {
                        "outputCount": 1,
                        "size": "1024x1024",
                        "providerBaseUrl": "http://localhost:8080/v1"
                    },
                    "normalizedOutputCount": 1
                })
                .to_string(),
            )
            .bind(&original.id)
            .execute(database.pool())
            .await
            .expect("poison retry snapshot");

        let result = retry_generation_task_with_provider(
            &database,
            &paths,
            &StaticProvider,
            "placeholder-api-key",
            &original.id,
            Some("task_retry_invalid_base_url_new".to_string()),
            None,
            None,
        )
        .await;

        assert!(matches!(result, Err(AppError::ModelConfigInvalid(_))));
    }

    #[tokio::test]
    async fn retry_generation_task_rejects_missing_input_file() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let original = run_generation_flow_with_task_id(
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
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_retry_missing_source".to_string()),
        )
        .await
        .expect("original generation");
        let garment_path: String = sqlx::query_scalar(
            "SELECT a.relative_path
             FROM generation_task_input_assets tia
             INNER JOIN assets a ON a.id = tia.asset_id
             WHERE tia.task_id = ? AND tia.role = 'garment'",
        )
        .bind(&original.id)
        .fetch_one(database.pool())
        .await
        .expect("garment path");
        std::fs::remove_file(paths.root().join(garment_path)).expect("remove garment file");

        let result = retry_generation_task_with_provider(
            &database,
            &paths,
            &StaticProvider,
            "placeholder-api-key",
            &original.id,
            Some("task_retry_missing_new".to_string()),
            None,
            None,
        )
        .await;

        let message = match result {
            Err(AppError::InvalidInput(message)) => message,
            other => panic!("unexpected retry result: {other:?}"),
        };
        assert!(message.contains("ASSET_FILE_MISSING"));
        assert!(message.contains("role=garment"));
        assert!(message.contains("assetId="));
        assert!(message.contains("fileName="));
    }

    #[tokio::test]
    async fn retry_generation_task_uses_observer_and_cancellation_checker() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let original = run_generation_flow_with_task_id(
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
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
            Some("task_retry_cancel_source".to_string()),
        )
        .await
        .expect("original generation");
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cancelled_for_provider = Arc::clone(&cancelled);
        let cancellation_checker = || cancelled.load(std::sync::atomic::Ordering::SeqCst);
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observed_for_callback = Arc::clone(&observed);
        let observer = move |task: LocalGenerationTask| {
            observed_for_callback
                .lock()
                .expect("observed")
                .push(task.status);
        };

        let result = retry_generation_task_with_provider(
            &database,
            &paths,
            &CancellingProvider {
                cancelled: cancelled_for_provider,
            },
            "placeholder-api-key",
            &original.id,
            Some("task_retry_cancelled".to_string()),
            Some(&observer),
            Some(&cancellation_checker),
        )
        .await;

        assert!(
            matches!(result, Err(AppError::GenerationCancelled(task_id)) if task_id == "task_retry_cancelled")
        );
        let task = get_generation_task_by_id(&database, "task_retry_cancelled")
            .await
            .expect("task")
            .expect("task");
        assert_eq!(task.status, "cancelled");
        assert!(observed
            .lock()
            .expect("observed")
            .iter()
            .any(|status| status == "cancelled"));
    }

    #[tokio::test]
    async fn rerun_generation_from_current_combination_uses_current_prompt() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        run_generation_flow(
            &database,
            &paths,
            &StaticProvider,
            "placeholder-api-key",
            StartGenerationRequest {
                combination_id: combination_id.clone(),
                draft_prompt_binding: None,
                draft_model_config: Some(SaveModelConfigRequest {
                    id: None,
                    provider: "openai".to_string(),
                    model_id: "gpt-image-2".to_string(),
                    params_json: json!({"outputCount": 1, "size": "1024x1024"}),
                }),
                draft_garment_asset_ids: None,
                revision: Some(7),
            },
        )
        .await
        .expect("original generation");
        save_prompt_binding_request(
            &database,
            SavePromptBindingRequest {
                id: None,
                combination_id: combination_id.clone(),
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
                    override_text: "changed prompt".to_string(),
                },
                negative: None,
                variables_json: json!({}),
            },
        )
        .await
        .expect("change prompt");

        let rerun = rerun_generation_from_current_combination_with_provider(
            &database,
            &paths,
            &ChangedPromptProvider,
            "placeholder-api-key",
            &combination_id,
            SaveModelConfigRequest {
                id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-2".to_string(),
                params_json: json!({"outputCount": 1, "size": "1024x1024"}),
            },
            Some("task_rerun_current".to_string()),
            None,
            None,
        )
        .await
        .expect("rerun generation");

        assert_eq!(rerun.status, "succeeded");
        assert_eq!(rerun.final_prompt_snapshot_json["user"], "changed prompt");
        assert_eq!(
            rerun.request_summary_json.expect("summary")["source"],
            "rerun"
        );
    }

    #[tokio::test]
    async fn list_generation_task_details_by_combination_filters_and_orders_tasks() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        create_completed_task_for_combination(&database, "task_old", Some(&combination_id)).await;
        create_completed_task_for_combination(&database, "task_new", Some(&combination_id)).await;
        create_completed_task_for_combination(&database, "task_other", None).await;

        let tasks =
            list_generation_task_details_by_combination(&database, &paths, &combination_id, 10)
                .await
                .expect("tasks by combination");

        let ids: Vec<String> = tasks.into_iter().map(|detail| detail.task.id).collect();
        assert_eq!(ids, vec!["task_new".to_string(), "task_old".to_string()]);
    }

    #[tokio::test]
    async fn rerun_generation_task_uses_observer_and_cancellation_checker() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let combination_id = seed_generation_inputs(&database, &paths).await;
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cancelled_for_provider = Arc::clone(&cancelled);
        let cancellation_checker = || cancelled.load(std::sync::atomic::Ordering::SeqCst);
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observed_for_callback = Arc::clone(&observed);
        let observer = move |task: LocalGenerationTask| {
            observed_for_callback
                .lock()
                .expect("observed")
                .push(task.status);
        };

        let result = rerun_generation_from_current_combination_with_provider(
            &database,
            &paths,
            &CancellingProvider {
                cancelled: cancelled_for_provider,
            },
            "placeholder-api-key",
            &combination_id,
            SaveModelConfigRequest {
                id: None,
                provider: "openai".to_string(),
                model_id: "gpt-image-2".to_string(),
                params_json: json!({"outputCount": 1, "size": "1024x1024"}),
            },
            Some("task_rerun_cancelled".to_string()),
            Some(&observer),
            Some(&cancellation_checker),
        )
        .await;

        assert!(
            matches!(result, Err(AppError::GenerationCancelled(task_id)) if task_id == "task_rerun_cancelled")
        );
        let task = get_generation_task_by_id(&database, "task_rerun_cancelled")
            .await
            .expect("task")
            .expect("task");
        assert_eq!(task.status, "cancelled");
        assert!(observed
            .lock()
            .expect("observed")
            .iter()
            .any(|status| status == "cancelled"));
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
        assert_eq!(sanitize_source_url("https://localhost/result.png"), None);
        assert_eq!(sanitize_source_url("http://127.0.0.1/result.png"), None);
        assert_eq!(sanitize_source_url("http://10.0.0.2/result.png"), None);
        assert_eq!(
            sanitize_source_url("https://user:password@cdn.example.com/result.png"),
            None
        );
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
                person_asset_ids: vec![],
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
        let image =
            image::ImageBuffer::<image::Rgba<u8>, _>::from_pixel(16, 12, image::Rgba(color));
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
                dyn std::future::Future<Output = Result<GenerateResult, ProviderError>> + Send + 'a,
            >,
        > {
            Box::pin(async move {
                assert_eq!(input.prompt.user, "wear linen dress");
                if let Some(expected_base_url) =
                    input.params.get("providerBaseUrl").and_then(Value::as_str)
                {
                    assert_eq!(input.provider_base_url.as_deref(), Some(expected_base_url));
                } else {
                    assert!(input.provider_base_url.is_none());
                }
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

    struct RemoteCancelProvider;

    impl ImageGenerationProvider for RemoteCancelProvider {
        fn provider_name(&self) -> &'static str {
            "openai"
        }

        fn generate<'a>(
            &'a self,
            _input: GenerateInput,
            _api_key: &'a str,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<GenerateResult, ProviderError>> + Send + 'a,
            >,
        > {
            Box::pin(async {
                panic!("remote cancel test does not generate");
            })
        }

        fn cancel_remote<'a>(
            &'a self,
            task_id: &'a str,
            _api_key: &'a str,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<RemoteCancelResult, ProviderError>>
                    + Send
                    + 'a,
            >,
        > {
            Box::pin(async move {
                assert_eq!(task_id, "task_cancel_remote");
                Ok(RemoteCancelResult::Confirmed)
            })
        }
    }

    struct FailingProvider;

    impl ImageGenerationProvider for FailingProvider {
        fn provider_name(&self) -> &'static str {
            "openai"
        }

        fn generate<'a>(
            &'a self,
            input: GenerateInput,
            _api_key: &'a str,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<GenerateResult, ProviderError>> + Send + 'a,
            >,
        > {
            Box::pin(async move {
                Err(ProviderError::new(
                    "openai",
                    Some(input.model_id),
                    ProviderErrorCode::RemoteError,
                    "provider unavailable",
                ))
            })
        }
    }

    struct ChangedPromptProvider;

    impl ImageGenerationProvider for ChangedPromptProvider {
        fn provider_name(&self) -> &'static str {
            "openai"
        }

        fn generate<'a>(
            &'a self,
            input: GenerateInput,
            _api_key: &'a str,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<GenerateResult, ProviderError>> + Send + 'a,
            >,
        > {
            Box::pin(async move {
                assert_eq!(input.prompt.user, "changed prompt");
                Ok(GenerateResult {
                    provider: "openai".to_string(),
                    model_id: input.model_id,
                    images: vec![GeneratedImage {
                        bytes: png_bytes([4, 5, 6, 255]),
                        mime_type: "image/png".to_string(),
                        source_url: None,
                    }],
                    response_summary_json: json!({"provider": "openai"}),
                })
            })
        }
    }

    struct CancellingProvider {
        cancelled: Arc<std::sync::atomic::AtomicBool>,
    }

    impl ImageGenerationProvider for CancellingProvider {
        fn provider_name(&self) -> &'static str {
            "openai"
        }

        fn generate<'a>(
            &'a self,
            input: GenerateInput,
            _api_key: &'a str,
        ) -> std::pin::Pin<
            Box<
                dyn std::future::Future<Output = Result<GenerateResult, ProviderError>> + Send + 'a,
            >,
        > {
            Box::pin(async move {
                self.cancelled
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(GenerateResult {
                    provider: "openai".to_string(),
                    model_id: input.model_id,
                    images: vec![GeneratedImage {
                        bytes: png_bytes([1, 2, 3, 255]),
                        mime_type: "image/png".to_string(),
                        source_url: None,
                    }],
                    response_summary_json: json!({"provider": "openai"}),
                })
            })
        }
    }

    fn png_bytes(color: [u8; 4]) -> Vec<u8> {
        let image = image::ImageBuffer::<image::Rgba<u8>, _>::from_pixel(8, 8, image::Rgba(color));
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
                model_id: "gpt-image-2".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-2"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await
        .expect("create minimal task");
    }

    async fn create_completed_task_for_combination(
        database: &WorkspaceDatabase,
        id: &str,
        combination_id: Option<&str>,
    ) {
        create_generation_task_snapshot(
            database,
            CreateGenerationTaskSnapshotRequest {
                id: Some(id.to_string()),
                combination_id: combination_id.map(str::to_string),
                provider: "openai".to_string(),
                model_id: "gpt-image-2".to_string(),
                request_summary_json: Some(json!({"provider": "openai"})),
                input_snapshot_json: json!({}),
                final_prompt_snapshot_json: json!({"user": "prompt"}),
                model_config_snapshot_json: json!({"modelId": "gpt-image-2"}),
                asset_snapshot_json: json!([]),
                input_assets: vec![],
                output_count: 1,
            },
        )
        .await
        .expect("create task");
        let offset = if id == "task_old" {
            "-1 minute"
        } else {
            "+0 second"
        };
        sqlx::query(
            "UPDATE generation_tasks
             SET status = 'succeeded',
                 progress = 100,
                 created_at = datetime('now', ?),
                 updated_at = datetime('now', ?)
             WHERE id = ?",
        )
        .bind(offset)
        .bind(offset)
        .bind(id)
        .execute(database.pool())
        .await
        .expect("complete task");
    }
}
