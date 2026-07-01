use serde::Serialize;

use crate::domain::assets::Asset;
use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::assets::{AssetPage, AssetQuery, AssetService, ImportImagesInput};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDto {
    id: String,
    kind: String,
    name: String,
    original_name: String,
    mime_type: String,
    relative_path: String,
    sha256: String,
    width: Option<i64>,
    height: Option<i64>,
    size_bytes: i64,
    lifecycle: String,
    deleted_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPageDto {
    items: Vec<AssetDto>,
    page: i64,
    page_size: i64,
    total: i64,
}

#[tauri::command]
pub fn asset_list(query: Option<AssetQuery>) -> Result<AssetPageDto, String> {
    AssetService::new()
        .list_assets(&default_workspace_directory(), query.unwrap_or_default())
        .map(AssetPageDto::from)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn asset_get(asset_id: String) -> Result<AssetDto, String> {
    AssetService::new()
        .get_asset(&default_workspace_directory(), &asset_id)
        .map(AssetDto::from)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn asset_import_images(input: ImportImagesInput) -> Result<Vec<AssetDto>, String> {
    AssetService::new()
        .import_images(&default_workspace_directory(), input)
        .map(|assets| assets.into_iter().map(AssetDto::from).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn asset_delete(asset_id: String) -> Result<(), String> {
    AssetService::new()
        .delete_asset(&default_workspace_directory(), &asset_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn asset_reveal(asset_id: String) -> Result<(), String> {
    let service = AssetService::new();
    let path = service
        .asset_file_path(&default_workspace_directory(), &asset_id)
        .map_err(|error| error.to_string())?;
    super::shell::shell_reveal_path(path.to_string_lossy().to_string())
}

impl From<AssetPage> for AssetPageDto {
    fn from(page: AssetPage) -> Self {
        Self {
            items: page.items.into_iter().map(AssetDto::from).collect(),
            page: page.page,
            page_size: page.page_size,
            total: page.total,
        }
    }
}

impl From<Asset> for AssetDto {
    fn from(asset: Asset) -> Self {
        Self {
            id: asset.id,
            kind: asset.kind.as_str().to_string(),
            name: asset.name,
            original_name: asset.original_name,
            mime_type: asset.mime_type,
            relative_path: asset.relative_path,
            sha256: asset.sha256,
            width: asset.width,
            height: asset.height,
            size_bytes: asset.size_bytes,
            lifecycle: asset.lifecycle.as_str().to_string(),
            deleted_at: asset.deleted_at,
            created_at: asset.created_at,
            updated_at: asset.updated_at,
        }
    }
}
