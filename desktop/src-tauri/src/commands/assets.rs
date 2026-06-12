use tauri::State;

use crate::domain::asset::{AssetFileView, AssetType, ImportImageResponse};
use crate::error::AppResult;
use crate::services::assets::{
    delete_asset as delete_asset_file, get_asset_file_view_by_id, import_image_file,
    list_asset_file_views, run_asset_gc,
};
use crate::state::AppState;

#[tauri::command]
pub async fn import_image(
    state: State<'_, AppState>,
    source_path: String,
    asset_type: AssetType,
) -> AppResult<ImportImageResponse> {
    import_image_file(
        state.database(),
        state.workspace_paths(),
        source_path.into(),
        asset_type,
    )
    .await
}

#[tauri::command]
pub async fn get_asset(
    state: State<'_, AppState>,
    asset_id: String,
) -> AppResult<Option<AssetFileView>> {
    get_asset_file_view_by_id(state.database(), state.workspace_paths(), &asset_id).await
}

#[tauri::command]
pub async fn list_assets(
    state: State<'_, AppState>,
    asset_type: Option<AssetType>,
) -> AppResult<Vec<AssetFileView>> {
    list_asset_file_views(state.database(), state.workspace_paths(), asset_type).await
}

#[tauri::command]
pub async fn delete_asset(state: State<'_, AppState>, asset_id: String) -> AppResult<()> {
    delete_asset_file(state.database(), state.workspace_paths(), &asset_id).await
}

#[tauri::command]
pub async fn run_asset_garbage_collection(state: State<'_, AppState>) -> AppResult<u64> {
    run_asset_gc(state.database(), state.workspace_paths()).await
}
