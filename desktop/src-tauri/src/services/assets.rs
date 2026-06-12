use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use image::GenericImageView;
use sha2::{Digest, Sha256};
use ulid::Ulid;

use crate::domain::asset::{Asset, AssetType, ImportImageResponse};
use crate::error::{AppError, AppResult};
use crate::storage::file_store::WorkspacePaths;
use crate::storage::sqlite::WorkspaceDatabase;

pub async fn import_image_file(
    database: &WorkspaceDatabase,
    paths: &WorkspacePaths,
    source_path: PathBuf,
    asset_type: AssetType,
) -> AppResult<ImportImageResponse> {
    if !source_path.is_file() {
        return Err(AppError::InvalidInput(
            "sourcePath must point to an existing image file".to_string(),
        ));
    }

    let extension = normalized_image_extension(&source_path)?;
    let mime_type = mime_type_for_extension(extension);
    let sha256 = calculate_sha256(&source_path)?;

    if let Some(existing) = find_asset_by_type_and_sha256(database, &asset_type, &sha256).await? {
        let thumb_file_path = paths.root().join(&existing.thumb_relative_path);
        return Ok(ImportImageResponse {
            asset: existing,
            duplicate: true,
            thumb_file_path: thumb_file_path.to_string_lossy().to_string(),
        });
    }

    let id = format!("asset_{}", Ulid::new());
    let relative_path = format!("assets/{}/{}.{}", asset_type.as_str(), id, extension);
    let thumb_relative_path = format!("assets/cache/thumbs/{id}.jpg");
    let destination_path = paths.root().join(&relative_path);
    let thumb_path = paths.root().join(&thumb_relative_path);

    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = thumb_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let image = image::open(&source_path)
        .map_err(|err| AppError::InvalidInput(format!("invalid image file: {err}")))?;
    let (width, height) = image.dimensions();

    fs::copy(&source_path, &destination_path)?;
    let thumbnail = image.thumbnail(320, 320).to_rgb8();
    thumbnail
        .save_with_format(&thumb_path, image::ImageFormat::Jpeg)
        .map_err(|err| AppError::InvalidInput(format!("failed to create thumbnail: {err}")))?;

    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::InvalidInput("sourcePath file name is invalid".to_string()))?
        .to_string();

    let mut writer = database.writer().await;
    sqlx::query(
        "INSERT INTO assets (
            id,
            asset_type,
            original_name,
            relative_path,
            thumb_relative_path,
            mime_type,
            sha256,
            width,
            height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(asset_type.as_str())
    .bind(&original_name)
    .bind(&relative_path)
    .bind(&thumb_relative_path)
    .bind(mime_type)
    .bind(&sha256)
    .bind(i64::from(width))
    .bind(i64::from(height))
    .execute(&mut *writer)
    .await?;
    drop(writer);

    let asset = get_asset_by_id(database, &id)
        .await?
        .ok_or_else(|| AppError::InvalidInput("created asset was not found".to_string()))?;

    Ok(ImportImageResponse {
        asset,
        duplicate: false,
        thumb_file_path: thumb_path.to_string_lossy().to_string(),
    })
}

pub async fn get_asset_by_id(database: &WorkspaceDatabase, id: &str) -> AppResult<Option<Asset>> {
    let row = sqlx::query_as::<_, AssetRow>(
        "SELECT
            id,
            asset_type,
            original_name,
            relative_path,
            thumb_relative_path,
            mime_type,
            sha256,
            width,
            height,
            created_at
        FROM assets
        WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await?;

    row.map(AssetRow::try_into_asset).transpose()
}

async fn find_asset_by_type_and_sha256(
    database: &WorkspaceDatabase,
    asset_type: &AssetType,
    sha256: &str,
) -> AppResult<Option<Asset>> {
    let row = sqlx::query_as::<_, AssetRow>(
        "SELECT
            id,
            asset_type,
            original_name,
            relative_path,
            thumb_relative_path,
            mime_type,
            sha256,
            width,
            height,
            created_at
        FROM assets
        WHERE asset_type = ? AND sha256 = ?",
    )
    .bind(asset_type.as_str())
    .bind(sha256)
    .fetch_optional(database.pool())
    .await?;

    row.map(AssetRow::try_into_asset).transpose()
}

fn normalized_image_extension(source_path: &Path) -> AppResult<&'static str> {
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| AppError::InvalidInput("image file extension is required".to_string()))?;

    match extension.as_str() {
        "jpg" | "jpeg" => Ok("jpg"),
        "png" => Ok("png"),
        _ => Err(AppError::InvalidInput(
            "only png, jpg and jpeg images are supported".to_string(),
        )),
    }
}

fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        _ => "image/jpeg",
    }
}

fn calculate_sha256(source_path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(source_path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(sqlx::FromRow)]
struct AssetRow {
    id: String,
    asset_type: String,
    original_name: String,
    relative_path: String,
    thumb_relative_path: String,
    mime_type: String,
    sha256: String,
    width: i64,
    height: i64,
    created_at: String,
}

impl AssetRow {
    fn try_into_asset(self) -> AppResult<Asset> {
        let asset_type = match self.asset_type.as_str() {
            "person" => AssetType::Person,
            "garment" => AssetType::Garment,
            "result" => AssetType::Result,
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "unknown asset type {}",
                    self.asset_type
                )))
            }
        };

        Ok(Asset {
            id: self.id,
            asset_type,
            original_name: self.original_name,
            relative_path: self.relative_path,
            thumb_relative_path: self.thumb_relative_path,
            mime_type: self.mime_type,
            sha256: self.sha256,
            width: self.width,
            height: self.height,
            created_at: self.created_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use image::{ImageBuffer, Rgba};

    use super::*;
    use crate::storage::migrations::run_workspace_migrations;

    async fn test_workspace() -> (tempfile::TempDir, WorkspacePaths, WorkspaceDatabase) {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let paths = WorkspacePaths::new(temp_dir.path().join("workspace"));
        paths.ensure().expect("ensure");
        let database = WorkspaceDatabase::connect(&paths.database_path())
            .await
            .expect("connect");
        run_workspace_migrations(&paths, &database)
            .await
            .expect("migrate");
        (temp_dir, paths, database)
    }

    fn write_png(path: &Path) {
        let image = ImageBuffer::<Rgba<u8>, _>::from_pixel(16, 12, Rgba([42, 84, 126, 255]));
        image.save(path).expect("write png");
    }

    #[tokio::test]
    async fn import_image_file_stores_relative_paths_and_thumbnail() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("source.png");
        write_png(&source_path);

        let response = import_image_file(&database, &paths, source_path.clone(), AssetType::Person)
            .await
            .expect("import");

        assert!(!response.duplicate);
        assert_eq!(response.asset.asset_type.as_str(), "person");
        assert_eq!(response.asset.width, 16);
        assert_eq!(response.asset.height, 12);
        assert!(!response.asset.relative_path.contains(source_path.to_str().unwrap()));
        assert!(response.asset.relative_path.starts_with("assets/person/asset_"));
        assert!(paths.root().join(&response.asset.relative_path).is_file());
        assert!(paths.root().join(&response.asset.thumb_relative_path).is_file());
    }

    #[tokio::test]
    async fn import_image_file_deduplicates_only_within_same_asset_type() {
        let (_temp_dir, paths, database) = test_workspace().await;
        let source_path = paths.root().join("source.png");
        write_png(&source_path);

        let first = import_image_file(&database, &paths, source_path.clone(), AssetType::Person)
            .await
            .expect("first import");
        let duplicate = import_image_file(&database, &paths, source_path.clone(), AssetType::Person)
            .await
            .expect("duplicate import");
        let other_type = import_image_file(&database, &paths, source_path, AssetType::Garment)
            .await
            .expect("other type import");

        assert_eq!(first.asset.id, duplicate.asset.id);
        assert!(duplicate.duplicate);
        assert_ne!(first.asset.id, other_type.asset.id);
        assert!(!other_type.duplicate);
    }
}
