use tauri::{AppHandle, State};

use crate::domain::model::SaveModelConfigRequest;
use crate::domain::task::{GenerationTaskDetail, LocalGenerationTask, StartGenerationRequest};
use crate::error::AppResult;
use crate::providers::openai_provider::OpenAiImageProvider;
use crate::services::credential_service::ProviderCredentialService;
use crate::services::task_runner::{
    get_generation_task_detail_by_id, get_latest_generation_task_detail_by_combination,
    list_recent_generation_task_details, list_running_generation_task_details,
    open_generation_result_asset, rerun_generation_from_current_combination_with_provider,
    retry_generation_task_with_provider,
};
use crate::state::AppState;

#[tauri::command]
pub async fn start_generation(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    request: StartGenerationRequest,
) -> AppResult<LocalGenerationTask> {
    state.run_generation_with_events(app_handle, request).await
}

#[tauri::command]
pub async fn cancel_generation_task(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<LocalGenerationTask> {
    state.cancel_generation_task(&task_id).await
}

#[tauri::command]
pub async fn get_generation_task_detail(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<Option<GenerationTaskDetail>> {
    get_generation_task_detail_by_id(state.database(), state.workspace_paths(), &task_id).await
}

#[tauri::command]
pub async fn get_latest_generation_task_by_combination(
    state: State<'_, AppState>,
    combination_id: String,
) -> AppResult<Option<GenerationTaskDetail>> {
    get_latest_generation_task_detail_by_combination(
        state.database(),
        state.workspace_paths(),
        &combination_id,
    )
    .await
}

#[tauri::command]
pub async fn list_running_generation_tasks(
    state: State<'_, AppState>,
) -> AppResult<Vec<GenerationTaskDetail>> {
    list_running_generation_task_details(state.database(), state.workspace_paths()).await
}

#[tauri::command]
pub async fn list_recent_generation_tasks(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> AppResult<Vec<GenerationTaskDetail>> {
    list_recent_generation_task_details(
        state.database(),
        state.workspace_paths(),
        limit.unwrap_or(20),
    )
    .await
}

#[tauri::command]
pub async fn open_generation_result(state: State<'_, AppState>, asset_id: String) -> AppResult<()> {
    open_generation_result_asset(state.database(), state.workspace_paths(), &asset_id).await
}

#[tauri::command]
pub async fn retry_generation_task(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<LocalGenerationTask> {
    let api_key = ProviderCredentialService::system()
        .read_provider_api_key("openai")
        .await?;
    retry_generation_task_with_provider(
        state.database(),
        state.workspace_paths(),
        &OpenAiImageProvider::new(),
        &api_key,
        &task_id,
        None,
    )
    .await
}

#[tauri::command]
pub async fn rerun_generation_from_current_combination(
    state: State<'_, AppState>,
    combination_id: String,
    model_config: SaveModelConfigRequest,
) -> AppResult<LocalGenerationTask> {
    let api_key = ProviderCredentialService::system()
        .read_provider_api_key(&model_config.provider)
        .await?;
    rerun_generation_from_current_combination_with_provider(
        state.database(),
        state.workspace_paths(),
        &OpenAiImageProvider::new(),
        &api_key,
        &combination_id,
        model_config,
        None,
    )
    .await
}
