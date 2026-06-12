use tauri::State;

use crate::domain::task::{LocalGenerationTask, StartGenerationRequest};
use crate::error::AppResult;
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
