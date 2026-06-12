use tauri::State;

use crate::domain::task::{GenerationTaskDetail, LocalGenerationTask, StartGenerationRequest};
use crate::error::AppResult;
use crate::services::task_runner::{
    get_generation_task_detail_by_id, get_latest_generation_task_detail_by_combination,
    open_generation_result_asset,
};
use crate::state::AppState;

#[tauri::command]
pub async fn start_generation(
    state: State<'_, AppState>,
    request: StartGenerationRequest,
) -> AppResult<LocalGenerationTask> {
    state.run_generation(request).await
}

#[tauri::command]
pub async fn cancel_generation_task(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<()> {
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
pub async fn open_generation_result(
    state: State<'_, AppState>,
    asset_id: String,
) -> AppResult<()> {
    open_generation_result_asset(state.database(), state.workspace_paths(), &asset_id).await
}
