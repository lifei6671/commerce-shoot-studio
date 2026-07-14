use serde::Serialize;
use std::path::PathBuf;
use tauri::{path::BaseDirectory, Manager};

use crate::domain::assets::{Asset, AssetKind};
use crate::infrastructure::filesystem::default_workspace_directory;
use crate::services::assets::{AssetPage, AssetQuery, AssetService, ImportImagesInput};
use crate::services::builtin_models::{BuiltinModel, BuiltinModelService};

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
    local_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail_path: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinModelDto {
    id: String,
    label: String,
    file_name: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail_path: Option<String>,
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
pub fn asset_list_builtin_models(handle: tauri::AppHandle) -> Result<Vec<BuiltinModelDto>, String> {
    let (directory, thumbnail_directory) = resolve_builtin_models_directories(&handle)?;
    BuiltinModelService::new()
        .list_builtin_models(&directory, &thumbnail_directory)
        .map(|models| models.into_iter().map(BuiltinModelDto::from).collect())
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
        let local_path = default_workspace_directory()
            .join(asset.relative_path.split('/').collect::<PathBuf>())
            .to_string_lossy()
            .to_string();
        let thumbnail_path = model_thumbnail_path(&asset);

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
            local_path,
            thumbnail_path,
            deleted_at: asset.deleted_at,
            created_at: asset.created_at,
            updated_at: asset.updated_at,
        }
    }
}

fn model_thumbnail_path(asset: &Asset) -> Option<String> {
    if asset.kind != AssetKind::Model {
        return None;
    }

    let path = default_workspace_directory()
        .join("assets")
        .join("thumbnail")
        .join(format!("{}.png", asset.id));
    path.is_file().then(|| path.to_string_lossy().to_string())
}

impl From<BuiltinModel> for BuiltinModelDto {
    fn from(model: BuiltinModel) -> Self {
        Self {
            id: model.id,
            label: model.label,
            file_name: model.file_name,
            path: model.path.to_string_lossy().to_string(),
            thumbnail_path: model
                .thumbnail_path
                .map(|path| path.to_string_lossy().to_string()),
        }
    }
}

fn resolve_builtin_models_directories(
    handle: &tauri::AppHandle,
) -> Result<(PathBuf, PathBuf), String> {
    let bundled_models = resolve_resource_directory(handle, "builtin-models")?;
    let bundled_thumbnails = resolve_resource_directory(handle, "builtin-model-thumbnails")?;
    if bundled_models.is_dir() {
        return Ok((bundled_models, bundled_thumbnails));
    }

    let source_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("builtin-models");
    let source_thumbnail_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("builtin-model-thumbnails");
    if source_directory.is_dir() {
        return Ok((source_directory, source_thumbnail_directory));
    }

    Ok((bundled_models, bundled_thumbnails))
}

fn resolve_resource_directory(handle: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    handle
        .path()
        .resolve(path, BaseDirectory::Resource)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::BuiltinModelDto;

    #[test]
    fn builtin_model_dto_omits_missing_thumbnail_path() {
        let dto = BuiltinModelDto {
            id: "model-1".to_string(),
            label: "模特 1".to_string(),
            file_name: "model-1.png".to_string(),
            path: "/models/model-1.png".to_string(),
            thumbnail_path: None,
        };

        let value = serde_json::to_value(dto).expect("内置模特 DTO 应可序列化");

        assert!(value.get("thumbnailPath").is_none());
    }

    #[test]
    fn builtin_model_dto_serializes_existing_thumbnail_path() {
        let dto = BuiltinModelDto {
            id: "model-1".to_string(),
            label: "模特 1".to_string(),
            file_name: "model-1.png".to_string(),
            path: "/models/model-1.png".to_string(),
            thumbnail_path: Some("/thumbnails/model-1.png".to_string()),
        };

        let value = serde_json::to_value(dto).expect("内置模特 DTO 应可序列化");

        assert_eq!(
            value
                .get("thumbnailPath")
                .and_then(serde_json::Value::as_str),
            Some("/thumbnails/model-1.png")
        );
    }
}
