use tauri::State;

use crate::domain::task::{CreateGenerationTaskSnapshotRequest, LocalGenerationTask};
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn start_generation(
    state: State<'_, AppState>,
    request: CreateGenerationTaskSnapshotRequest,
) -> AppResult<LocalGenerationTask> {
    state.start_generation_task(request).await
}

#[tauri::command]
pub async fn cancel_generation_task(
    state: State<'_, AppState>,
    task_id: String,
) -> AppResult<()> {
    state.cancel_generation_task(&task_id).await
}
