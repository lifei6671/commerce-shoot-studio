use tauri::State;

use crate::domain::combination::{
    ImageCombination, ImageCombinationSummary, SaveImageCombinationRequest,
    ValidateCombinationRequest, ValidateCombinationResponse,
};
use crate::error::AppResult;
use crate::services::combinations::{
    get_image_combination_by_id, list_image_combination_summaries, save_image_combination_request,
};
use crate::services::model_validator::validate_combination_request;
use crate::state::AppState;

#[tauri::command]
pub async fn save_image_combination(
    state: State<'_, AppState>,
    request: SaveImageCombinationRequest,
) -> AppResult<ImageCombination> {
    save_image_combination_request(state.database(), request).await
}

#[tauri::command]
pub async fn get_image_combination(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<ImageCombination>> {
    get_image_combination_by_id(state.database(), &id).await
}

#[tauri::command]
pub async fn list_image_combinations(
    state: State<'_, AppState>,
) -> AppResult<Vec<ImageCombinationSummary>> {
    list_image_combination_summaries(state.database()).await
}

#[tauri::command]
pub async fn validate_combination(
    state: State<'_, AppState>,
    request: ValidateCombinationRequest,
) -> AppResult<ValidateCombinationResponse> {
    validate_combination_request(state.database(), request).await
}
