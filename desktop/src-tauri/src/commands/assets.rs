use tauri::State;

use crate::domain::asset::{AssetType, ImportImageResponse};
use crate::error::AppResult;
use crate::services::assets::import_image_file;
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
