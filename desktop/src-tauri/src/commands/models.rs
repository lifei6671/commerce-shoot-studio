use tauri::State;

use crate::domain::model::{ModelConfig, ModelDefinition, SaveModelConfigRequest};
use crate::error::AppResult;
use crate::services::model_validator::{
    get_model_config_by_id, list_model_definitions as list_definitions, save_model_config_request,
};
use crate::state::AppState;

#[tauri::command]
pub async fn list_model_definitions(
    advanced_models: Option<bool>,
) -> AppResult<Vec<ModelDefinition>> {
    Ok(list_definitions(advanced_models.unwrap_or(false)))
}

#[tauri::command]
pub async fn save_model_config(
    state: State<'_, AppState>,
    request: SaveModelConfigRequest,
    advanced_models: Option<bool>,
) -> AppResult<ModelConfig> {
    save_model_config_request(state.database(), request, advanced_models.unwrap_or(false)).await
}

#[tauri::command]
pub async fn get_model_config(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<ModelConfig>> {
    get_model_config_by_id(state.database(), &id).await
}
